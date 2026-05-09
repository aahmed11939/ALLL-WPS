import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    react(),
    // optimize: false required for Tailwind v4 — prevents @layer reordering
    // in production builds that breaks Clerk UI styling
    tailwindcss({ optimize: false }),
  ],
  server: {
    port: 5173,
    host: true,
    allowedHosts: true,
    proxy: {
      // Billing and Stripe webhook → api-server (port 8080)
      "/api/billing": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
      "/api/stripe": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
      // Clerk proxy → api-server (port 8080)
      "/api/__clerk": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
      // All other /api → Python backend (port 8000)
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/compute": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/surge": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/export": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
