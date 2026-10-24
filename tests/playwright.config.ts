import { defineConfig, devices } from "@playwright/test";

const isScreenshotRun =
  process.env.RUN_SCREENSHOTS === "true" ||
  process.argv.includes("--project=screenshots");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "html",
  testIgnore: isScreenshotRun ? [] : ["**/capture-screenshots.spec.ts"],
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: isScreenshotRun
    ? [
        {
          name: "screenshots",
          use: { ...devices["Desktop Chrome"] },
          testMatch: "**/capture-screenshots.spec.ts",
        },
      ]
    : [
        {
          name: "chromium",
          use: { ...devices["Desktop Chrome"] },
          testIgnore: ["**/capture-screenshots.spec.ts"],
        },
        {
          name: "Mobile Chrome",
          use: { ...devices["Pixel 5"] },
          testIgnore: ["**/capture-screenshots.spec.ts"],
        },
      ],
  webServer: [
    {
      command: "pnpm --filter api dev",
      url: "http://localhost:4000/api/health",
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
    },
    {
      command: "pnpm --filter web dev",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
    },
  ],
});
