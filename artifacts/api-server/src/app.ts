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
      const { WebhookHandlers } = await import("./webhookHandlers");
      await WebhookHandlers.processWebhook(rawBody, sig);
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

// Body parsers scoped ONLY to /api — must NOT run for proxy routes (/compute,
// /surge, /export) because express consuming the stream prevents the proxy from
// forwarding the body to the Python backend (Content-Length is set but bytes
// never arrive → backend hangs for 30 s).
app.use("/api", express.json({ limit: "10mb" }));
app.use("/api", express.urlencoded({ extended: true, limit: "10mb" }));

// Billing / Stripe / Clerk API routes (handled by this server)
app.use("/api", router);

if (process.env.NODE_ENV === "production") {
  // Production: proxy Python engine routes to FastAPI (internal port 8000)
  const fastApiProxy = createProxyMiddleware({
    target: "http://localhost:8000",
    changeOrigin: true,
    on: {
      error: (_err, _req, res) => {
        (res as Response).status(502).json({ error: "Backend unavailable" });
      },
    },
  });

  app.use("/compute", fastApiProxy);
  app.use("/surge", fastApiProxy);
  app.use("/export", fastApiProxy);

  // Remaining /api/* routes not matched by the billing router → FastAPI
  app.use("/api", fastApiProxy);

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
  // Development: proxy all remaining traffic to the Vite dev server.
  // The frontend artifact runs on port 20825 in development.
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
