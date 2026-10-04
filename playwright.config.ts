import { defineConfig } from "@playwright/test";
const port = process.env.TEST_PORT || "4174";
export default defineConfig({
  testDir: "tests",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  globalSetup: "./tests/setup.ts",
  use: {
    baseURL: process.env.APP_URL || `http://127.0.0.1:${port}/I_HAVE_A_PLAN/`,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    timezoneId: "Europe/Moscow",
  },
});
