import { defineConfig, devices } from "@playwright/test";

const FRONTEND_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: FRONTEND_URL,
    trace: "on-first-retry",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
