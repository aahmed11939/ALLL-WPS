import { Router, type Request, type Response } from "express";
import { requireAuth, clerkClient, getAuth } from "@clerk/express";
import { eq, sql } from "drizzle-orm";
import { db, users, whitelistEmails } from "@workspace/db";
import { getUncachableStripeClient } from "./stripeClient";

const router = Router();

const ADMIN_EMAIL = "azizahmed1234@gmail.com";

/**
 * The server-configured Stripe Price ID for the annual plan.
 * Loaded once at module init — never overridden by client requests.
 */
const SERVER_PRICE_ID = process.env.STRIPE_PRICE_ID ?? "";

/**
 * Returns the canonical app origin, validated against the REPLIT_DOMAINS allowlist.
 * Falls back to the first configured domain — never blindly trusts req.headers.origin.
 */
function getTrustedOrigin(req: Request): string {
  const configuredDomains = (process.env.REPLIT_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);

  const canonical =
    configuredDomains.length > 0
      ? `https://${configuredDomains[0]}`
      : "http://localhost:5173";

  const requestOrigin = req.headers.origin as string | undefined;
  if (requestOrigin) {
    try {
      const reqHost = new URL(requestOrigin).host;
      if (configuredDomains.some((d) => reqHost === d || reqHost.endsWith(`.${d}`))) {
        return requestOrigin;
      }
    } catch {
      // malformed origin — fall through to canonical
    }
  }

  return canonical;
}

async function getOrCreateUser(
  clerkUserId: string,
  email: string,
): Promise<typeof users.$inferSelect> {
  // 1. Fast path: row keyed by real Clerk user ID
  const byClerkId = await db
    .select()
    .from(users)
    .where(eq(users.clerkUserId, clerkUserId))
    .limit(1);

  if (byClerkId[0]) return byClerkId[0];

  // 2. Reconciliation path: admin may have pre-created a placeholder via invite
  //    (clerkUserId = null, id = `invited_${email}`).  Claim that row now.
  const normalised = email.toLowerCase();
  const byEmail = await db
    .select()
    .from(users)
    .where(eq(users.email, normalised))
    .limit(1);

  if (byEmail[0] && byEmail[0].clerkUserId === null) {
    // Merge: stamp the placeholder with the real Clerk ID so subsequent lookups
    // use path (1) and all admin-set role/active values are preserved.
    const [merged] = await db
      .update(users)
      .set({ clerkUserId, id: clerkUserId })
      .where(eq(users.id, byEmail[0].id))
      .returning();
    if (merged) return merged;
  }

  // 3. Brand-new user — create a canonical row
  const [created] = await db
    .insert(users)
    .values({ id: clerkUserId, email: normalised, clerkUserId })
    .onConflictDoNothing()
    .returning();

  return (
    created ?? {
      id: clerkUserId,
      email: normalised,
      clerkUserId,
      stripeCustomerId: null,
      createdAt: new Date(),
    }
  );
}

async function isWhitelisted(email: string): Promise<boolean> {
  const normalised = email.toLowerCase();
  if (normalised === ADMIN_EMAIL.toLowerCase()) return true;
  const rows = await db
    .select()
    .from(whitelistEmails)
    .where(eq(whitelistEmails.email, normalised))
    .limit(1);
  return rows.length > 0 && (rows[0].active ?? false);
}

/**
 * Checks for an active subscription scoped to the configured price, if known.
 * Falls back to checking any active subscription on the customer when no
 * STRIPE_PRICE_ID is configured (e.g. during initial setup).
 */
async function hasActiveSubscription(customerId: string): Promise<boolean> {
  try {
    if (SERVER_PRICE_ID) {
      // Strict: require an active sub containing the exact configured price
      const result = await db.execute(
        sql`SELECT s.id
            FROM stripe.subscriptions s
            JOIN stripe.subscription_items si ON si.subscription = s.id
            WHERE s.customer = ${customerId}
              AND s.status IN ('active', 'trialing')
              AND si.price = ${SERVER_PRICE_ID}
            LIMIT 1`,
      );
      return result.rows.length > 0;
    }
    // No price configured yet — broad check (setup mode only)
    const result = await db.execute(
      sql`SELECT id FROM stripe.subscriptions
          WHERE customer = ${customerId}
            AND status IN ('active', 'trialing')
          LIMIT 1`,
    );
    return result.rows.length > 0;
  } catch {
    return false;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Internal error";
}

router.get("/status", requireAuth(), async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const clerkUser = await clerkClient.users.getUser(userId);
    const primaryEmailId = clerkUser.primaryEmailAddressId;
    const email =
      clerkUser.emailAddresses.find((e) => e.id === primaryEmailId)?.emailAddress ??
      clerkUser.emailAddresses[0]?.emailAddress ??
      "";

    if (await isWhitelisted(email)) {
      res.json({ active: true, whitelisted: true });
      return;
    }

    const user = await getOrCreateUser(userId, email);

    // Deactivated accounts are always blocked regardless of subscription
    if (user.active === false) {
      res.json({ active: false, reason: "account_disabled" });
      return;
    }

    if (!user.stripeCustomerId) {
      res.json({ active: false });
      return;
    }

    const active = await hasActiveSubscription(user.stripeCustomerId);
    res.json({ active });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.post("/checkout", requireAuth(), async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // Price is always server-configured — never accept from client
    if (!SERVER_PRICE_ID) {
      res.status(503).json({
        error:
          "Stripe Price ID not yet configured. Ask your admin to set STRIPE_PRICE_ID and connect the Stripe integration.",
      });
      return;
    }

    const clerkUser = await clerkClient.users.getUser(userId);
    const primaryEmailId = clerkUser.primaryEmailAddressId;
    const email =
      clerkUser.emailAddresses.find((e) => e.id === primaryEmailId)?.emailAddress ??
      clerkUser.emailAddresses[0]?.emailAddress ??
      "";

    const user = await getOrCreateUser(userId, email);
    const stripe = await getUncachableStripeClient();

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email,
        metadata: { clerkUserId: userId },
      });
      customerId = customer.id;
      await db
        .update(users)
        .set({ stripeCustomerId: customerId })
        .where(eq(users.clerkUserId, userId));
    }

    const origin = getTrustedOrigin(req);

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ["card"],
      line_items: [{ price: SERVER_PRICE_ID, quantity: 1 }],
      mode: "subscription",
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/?checkout=cancel`,
    });

    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.post("/portal", requireAuth(), async (req: Request, res: Response) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const userRows = await db
      .select()
      .from(users)
      .where(eq(users.clerkUserId, userId))
      .limit(1);

    if (!userRows[0]?.stripeCustomerId) {
      res.status(400).json({ error: "No Stripe customer found for this user." });
      return;
    }

    const origin = getTrustedOrigin(req);

    const stripe = await getUncachableStripeClient();
    const session = await stripe.billingPortal.sessions.create({
      customer: userRows[0].stripeCustomerId,
      return_url: `${origin}/app`,
    });

    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

export default router;
