import { Router, type Request, type Response } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import { eq, desc, sql } from "drizzle-orm";
import { db, users, whitelistEmails, auditLogs } from "@workspace/db";
import { requireAdmin } from "./middlewares/requireAdmin";

const router = Router();
router.use(requireAdmin);

const ADMIN_EMAIL = "azizahmed1234@gmail.com";

async function getActorEmail(req: Request): Promise<string> {
  try {
    const { userId } = getAuth(req);
    if (!userId) return ADMIN_EMAIL;
    const clerkUser = await clerkClient.users.getUser(userId);
    const primaryEmailId = clerkUser.primaryEmailAddressId;
    return (
      clerkUser.emailAddresses.find((e) => e.id === primaryEmailId)?.emailAddress ??
      clerkUser.emailAddresses[0]?.emailAddress ??
      ADMIN_EMAIL
    );
  } catch {
    return ADMIN_EMAIL;
  }
}

async function writeAuditLog(
  actorEmail: string,
  action: string,
  target: string,
  details?: Record<string, unknown>,
): Promise<void> {
  await db.insert(auditLogs).values({
    actorEmail,
    action,
    target,
    details: details ?? null,
  });
}

// ── Whitelist ─────────────────────────────────────────────────────────────────

router.get("/whitelist", async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(whitelistEmails)
      .orderBy(desc(whitelistEmails.createdAt));
    res.json({ entries: rows });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
  }
});

router.post("/whitelist", async (req: Request, res: Response) => {
  const body = req.body as { email?: string };
  const email = body.email?.trim().toLowerCase();
  if (!email) {
    res.status(400).json({ error: "email is required" });
    return;
  }
  try {
    const [inserted] = await db
      .insert(whitelistEmails)
      .values({ email })
      .onConflictDoNothing()
      .returning();
    if (!inserted) {
      res.status(409).json({ error: "Email already whitelisted" });
      return;
    }
    const actor = await getActorEmail(req);
    await writeAuditLog(actor, "whitelist_add", email);
    res.status(201).json({ entry: inserted });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
  }
});

router.delete("/whitelist/:id", async (req: Request, res: Response) => {
  const rawId = Array.isArray(req.params.id) ? (req.params.id[0] ?? "") : (req.params.id ?? "");
  const id = parseInt(rawId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  try {
    const [deleted] = await db
      .delete(whitelistEmails)
      .where(eq(whitelistEmails.id, id))
      .returning();
    if (!deleted) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const actor = await getActorEmail(req);
    await writeAuditLog(actor, "whitelist_remove", deleted.email ?? String(id));
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
  }
});

router.patch("/whitelist/:id", async (req: Request, res: Response) => {
  const rawId = Array.isArray(req.params.id) ? (req.params.id[0] ?? "") : (req.params.id ?? "");
  const id = parseInt(rawId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const body = req.body as { active?: boolean };
  if (typeof body.active !== "boolean") {
    res.status(400).json({ error: "active (boolean) is required" });
    return;
  }
  try {
    const [updated] = await db
      .update(whitelistEmails)
      .set({ active: body.active })
      .where(eq(whitelistEmails.id, id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const actor = await getActorEmail(req);
    const action = body.active ? "whitelist_activate" : "whitelist_deactivate";
    await writeAuditLog(actor, action, updated.email ?? String(id));
    res.json({ entry: updated });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
  }
});

// ── Users ─────────────────────────────────────────────────────────────────────

router.get("/users", async (_req: Request, res: Response) => {
  try {
    const rows = await db.select().from(users).orderBy(desc(users.createdAt));
    res.json({ users: rows });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
  }
});

router.post("/users/invite", async (req: Request, res: Response) => {
  const body = req.body as { email?: string };
  const email = body.email?.trim().toLowerCase();
  if (!email) {
    res.status(400).json({ error: "email is required" });
    return;
  }
  try {
    const invitation = await clerkClient.invitations.createInvitation({
      emailAddress: email,
    });
    // Pre-create user record so admin can manage it before first login
    await db
      .insert(users)
      .values({ id: `invited_${email}`, email, clerkUserId: null })
      .onConflictDoNothing();
    const actor = await getActorEmail(req);
    await writeAuditLog(actor, "user_invite", email);
    res.status(201).json({ invitation });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
  }
});

// ── Admin login event ─────────────────────────────────────────────────────────

router.post("/login-event", async (req: Request, res: Response) => {
  try {
    const actor = await getActorEmail(req);
    await writeAuditLog(actor, "admin_login", "admin_panel");
    res.json({ logged: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
  }
});

router.patch("/users/:id", async (req: Request, res: Response) => {
  const id = Array.isArray(req.params.id) ? (req.params.id[0] ?? "") : (req.params.id ?? "");
  const body = req.body as { role?: string; active?: boolean };

  const updates: Partial<{ role: string; active: boolean }> = {};
  if (typeof body.role === "string") updates.role = body.role;
  if (typeof body.active === "boolean") updates.active = body.active;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Provide role or active to update" });
    return;
  }
  try {
    const [updated] = await db
      .update(users)
      .set(updates)
      .where(eq(users.id, id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const actor = await getActorEmail(req);
    if (typeof body.role === "string") {
      const action = body.role === "admin" ? "user_promote_admin" : "user_demote_user";
      await writeAuditLog(actor, action, updated.email ?? id, { role: body.role });
    }
    if (typeof body.active === "boolean") {
      const action = body.active ? "user_activate" : "user_deactivate";
      await writeAuditLog(actor, action, updated.email ?? id);
    }
    res.json({ user: updated });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
  }
});

// ── Projects proxy ────────────────────────────────────────────────────────────

router.get("/projects", async (_req: Request, res: Response) => {
  try {
    const secret = process.env.ADMIN_SECRET ?? "";
    if (!secret) {
      // No shared secret configured — warn and return empty rather than an unprotected call
      res.json({ projects: [], count: 0, warning: "ADMIN_SECRET env var not set" });
      return;
    }
    const response = await fetch("http://localhost:8000/api/v1/admin/projects", {
      headers: { "X-Admin-Secret": secret },
    });
    if (!response.ok) {
      res.status(response.status).json({ error: "Failed to fetch projects from backend" });
      return;
    }
    const data = (await response.json()) as unknown;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
  }
});

// ── Audit Logs ────────────────────────────────────────────────────────────────

router.get("/audit-logs", async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt((req.query.page as string) ?? "1", 10));
  const limit = 50;
  const offset = (page - 1) * limit;
  try {
    const [rows, countResult] = await Promise.all([
      db
        .select()
        .from(auditLogs)
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit)
        .offset(offset),
      db.execute(sql`SELECT COUNT(*) as count FROM audit_logs`),
    ]);
    const total = parseInt(String((countResult.rows[0] as { count: string }).count), 10);
    res.json({ logs: rows, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
  }
});

export default router;
