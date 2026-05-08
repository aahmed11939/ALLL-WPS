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
    },
  },
});
