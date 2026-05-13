/**
 * End-to-end tests for the billing / subscribe flow.
 *
 * Covers:
 *   1. GET /api/billing/status returns JSON (not HTML) for unauthenticated users
 *   2. GET /api/billing/status returns JSON (not HTML) for authenticated users
 *   3. Clicking "Subscribe" when signed in either redirects to Stripe checkout
 *      or shows a user-readable error message (never raw HTML / blank page)
 *
 * Requirements:
 *   CLERK_SECRET_KEY            — Clerk backend secret (creates/deletes test user + sign-in token)
 *   VITE_CLERK_PUBLISHABLE_KEY  — picked up automatically by clerkSetup()
 *
 * Run (while dev server + api-server are already running):
 *   PLAYWRIGHT_BASE_URL=http://localhost:20825 pnpm test:e2e
 */

import { test, expect } from "@playwright/test";
import { clerkSetup, setupClerkTestingToken, clerk } from "@clerk/testing/playwright";
import { createClerkClient } from "@clerk/backend";

const API_URL = process.env.API_SERVER_URL ?? "http://localhost:8080";

let testUserId: string | null = null;
let testUserEmail: string | null = null;

test.beforeAll(async () => {
  await clerkSetup();

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    throw new Error("CLERK_SECRET_KEY must be set to run billing e2e tests.");
  }

  const clerkClient = createClerkClient({ secretKey });
  const suffix = Date.now().toString(36);
  testUserEmail = `e2e-billing-${suffix}@example.com`;

  const user = await clerkClient.users.createUser({
    emailAddress: [testUserEmail],
    password: `E2eTest${suffix}!`,
    skipPasswordChecks: true,
  });
  testUserId = user.id;
});

test.afterAll(async () => {
  if (testUserId) {
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (secretKey) {
      const clerkClient = createClerkClient({ secretKey });
      await clerkClient.users.deleteUser(testUserId).catch(() => {});
    }
    testUserId = null;
    testUserEmail = null;
  }
});

test.describe("Billing API", () => {
  test("GET /api/billing/status returns 401 JSON for unauthenticated requests — no HTML in body", async ({
    request,
  }) => {
    const response = await request.get(`${API_URL}/api/billing/status`);

    expect(response.status()).toBe(401);

    const contentType = response.headers()["content-type"] ?? "";
    expect(contentType).toContain("application/json");

    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("error");

    const text = JSON.stringify(body);
    expect(text).not.toContain("<html");
    expect(text).not.toContain("<!DOCTYPE");
  });

  test("GET /api/billing/status returns JSON for authenticated users — active field present, no HTML", async ({
    page,
  }) => {
    if (!testUserEmail) throw new Error("Test user was not created.");

    await setupClerkTestingToken({ page });
    await page.goto("/");

    await clerk.signIn({ page, emailAddress: testUserEmail });

    const response = await page.request.get(`${API_URL}/api/billing/status`);

    const contentType = response.headers()["content-type"] ?? "";
    expect(contentType).toContain("application/json");

    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("active");
    expect(typeof body.active).toBe("boolean");

    const text = JSON.stringify(body);
    expect(text).not.toContain("<html");
    expect(text).not.toContain("<!DOCTYPE");
  });
});

test.describe("Subscribe flow", () => {
  test("clicking Subscribe when signed in returns Stripe checkout URL or a clean error message", async ({
    page,
  }) => {
    if (!testUserEmail) throw new Error("Test user was not created.");

    await setupClerkTestingToken({ page });
    await page.goto("/");

    await clerk.signIn({ page, emailAddress: testUserEmail });

    await page.goto("/subscribe");

    const subscribeButton = page.getByRole("button", { name: /Subscribe.*\$4,999/i });
    await expect(subscribeButton).toBeVisible({ timeout: 10_000 });
    await expect(subscribeButton).toBeEnabled();

    await subscribeButton.click();

    await page.waitForFunction(
      () => {
        const isStripe = window.location.href.includes("checkout.stripe.com");
        const errorEls = document.querySelectorAll("[class*='rose']");
        const hasError = Array.from(errorEls).some(
          (el) => (el.textContent ?? "").trim().length > 0,
        );
        return isStripe || hasError;
      },
      { timeout: 12_000 },
    );

    const currentUrl = page.url();

    if (currentUrl.includes("checkout.stripe.com")) {
      expect(currentUrl).toContain("checkout.stripe.com");
    } else {
      const errorBox = page
        .locator("[class*='rose']")
        .filter({ hasText: /.+/i })
        .first();
      await expect(errorBox).toBeVisible();
      const errorText = (await errorBox.textContent()) ?? "";
      expect(errorText.trim().length).toBeGreaterThan(0);
      expect(errorText).not.toContain("<html");
      expect(errorText).not.toContain("stack trace");
      expect(page.url()).toContain("/subscribe");
    }
  });
});
