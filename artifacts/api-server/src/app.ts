import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import fs from "fs";
import path from "path";
import { createProxyMiddleware } from "http-proxy-middleware";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Clerk proxy MUST be before body parsers (streams raw bytes)
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

// Stripe webhook MUST be before express.json() — needs raw Buffer body
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (!signature) {
      res.status(400).json({ error: "Missing stripe-signature header" });
      return;
    }
    const sig = Array.isArray(signature) ? signature[0] : signature;
    try {
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body as string);

      // Parse the event before sync so we can fire transactional emails
      let customerEmail: string | null = null;
      let eventType: string | null = null;
      try {
        const event = JSON.parse(rawBody.toString()) as {
          type?: string;
          data?: { object?: { customer_email?: string; customer_details?: { email?: string }; customer?: unknown } };
        };
        eventType = event.type ?? null;
        const obj = event.data?.object;
        customerEmail =
          (obj as { customer_email?: string })?.customer_email ??
          (obj as { customer_details?: { email?: string } })?.customer_details?.email ??
          null;
      } catch {
        // non-parseable body — sync will handle/reject it
      }

      const { WebhookHandlers } = await import("./webhookHandlers");
      await WebhookHandlers.processWebhook(rawBody, sig);

      // Fire transactional emails after successful sync
      if (customerEmail && eventType) {
        const { sendSubscriptionActivated, sendSubscriptionLapsed } = await import("./emailService");
        if (
          eventType === "checkout.session.completed" ||
          eventType === "customer.subscription.created"
        ) {
          sendSubscriptionActivated(customerEmail);
        } else if (eventType === "customer.subscription.deleted") {
          sendSubscriptionLapsed(customerEmail);
        }
      }

      res.status(200).json({ received: true });
    } catch (err) {
      logger.error({ err }, "Stripe webhook error");
      res.status(400).json({ error: "Webhook processing error" });
    }
  },
);

app.use(cors({ credentials: true, origin: true }));

// Resolve publishable key from host for multi-domain support
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

// Body parsers scoped ONLY to the routes actually handled by this Express server
// (/api/billing, /api/admin). They MUST NOT run for Python-proxied routes
// (/api/v1/*, /compute, /surge, /export) — consuming the stream there makes
// forwarding impossible (Content-Length is set but bytes never arrive → Python
// hangs for 30 s). /api/stripe/webhook already has its own raw-body handler above.
app.use("/api/billing", express.json({ limit: "10mb" }));
app.use("/api/billing", express.urlencoded({ extended: true, limit: "10mb" }));
app.use("/api/admin", express.json({ limit: "10mb" }));
app.use("/api/admin", express.urlencoded({ extended: true, limit: "10mb" }));

// Billing / Stripe / Clerk API routes (handled by this server)
app.use("/api", router);

// ---------------------------------------------------------------------------
// Python FastAPI proxy factory
//
// When Express mounts middleware with app.use("/prefix", handler), it strips
// the matched prefix from req.url before the handler sees it. For example,
// app.use("/compute", proxy) receives req.url = "/pump-types" for a request
// to /compute/pump-types, and the proxy would forward to http://…/pump-types
// (404). pathRewrite restores the stripped prefix so Python sees the full path.
// ---------------------------------------------------------------------------
function makePythonProxy(strippedPrefix: string) {
  return createProxyMiddleware({
    target: "http://localhost:8000",
    changeOrigin: true,
    // Express strips strippedPrefix from req.url; prepend it back so that
    // Python receives the original full path (e.g. /compute/pump-types).
    pathRewrite: { "^/": `${strippedPrefix}/` },
    on: {
      error: (_err, _req, res) => {
        (res as Response).status(502).json({ error: "Backend unavailable" });
      },
    },
  });
}

if (process.env.NODE_ENV === "production") {
  // Production: proxy Python engine routes to FastAPI (internal port 8000)
  app.use("/compute", makePythonProxy("/compute"));
  app.use("/surge", makePythonProxy("/surge"));
  app.use("/export", makePythonProxy("/export"));

  // Remaining /api/* routes not matched by the billing router → FastAPI
  // (Express strips /api, so /v1/calculate becomes /api/v1/calculate via rewrite)
  app.use("/api", makePythonProxy("/api"));

  // Serve the built React SPA (must be last so all API routes take priority)
  const distPath = path.resolve(process.cwd(), "frontend/dist");
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    // SPA fallback — serve index.html for any unmatched route
    app.use((_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else {
    logger.warn({ distPath }, "frontend/dist not found — React app will not be served");
  }
} else {
  // Development: proxy Python engine routes directly to FastAPI BEFORE the Vite
  // fallback. These must be registered here (not left to the Vite proxy chain)
  // because without this the request body stream is already consumed by the time
  // Vite tries to forward to Python.
  //
  // Body parsers above are scoped to /api/billing and /api/admin only, so the
  // stream is still intact when these proxy handlers fire for /api/v1/* routes.
  //
  // pathRewrite restores the prefix that Express strips before each handler fires.
  app.use("/compute", makePythonProxy("/compute"));
  app.use("/surge", makePythonProxy("/surge"));
  app.use("/export", makePythonProxy("/export"));

  // Remaining /api/* routes (e.g. /api/v1/calculate) → Python FastAPI.
  // Express strips /api from req.url, so rewrite restores: /v1/calculate → /api/v1/calculate.
  app.use("/api", makePythonProxy("/api"));

  // All other traffic → Vite dev server (port 20825)
  const viteProxy = createProxyMiddleware({
    target: "http://localhost:20825",
    changeOrigin: true,
    ws: true,
    on: {
      error: (_err, _req, res) => {
        (res as Response).status(502).send("Vite dev server not ready yet");
      },
    },
  });
  app.use("/", viteProxy);
}

export default app;
