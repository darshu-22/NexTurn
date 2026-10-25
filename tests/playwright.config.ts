import { defineConfig, devices } from "@playwright/test";
import fs from "fs";
import path from "path";

// 1. Load root .env.test.local safely without printing secrets
const envTestPath = path.resolve(__dirname, "../.env.test.local");
const testEnv: Record<string, string> = {};

if (fs.existsSync(envTestPath)) {
  const content = fs.readFileSync(envTestPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match) {
      testEnv[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

// 2. Strict Safety Guard: Conclusively verify target database is local loopback test DB
const localDbUrl = process.env.DATABASE_URL || testEnv.DATABASE_URL;
if (!localDbUrl) {
  throw new Error(
    "FATAL SAFETY CHECK: DATABASE_URL is not defined in .env.test.local or environment.",
  );
}

let parsedDb: URL;
try {
  parsedDb = new URL(localDbUrl);
} catch {
  throw new Error("FATAL SAFETY CHECK: DATABASE_URL is not a valid URL.");
}

const isLoopback =
  parsedDb.hostname === "127.0.0.1" ||
  parsedDb.hostname === "localhost" ||
  parsedDb.hostname === "[::1]";

if (!isLoopback) {
  throw new Error(
    `FATAL SAFETY CHECK: Refusing to run tests against non-loopback host '${parsedDb.hostname}'.`,
  );
}

const cleanPath = parsedDb.pathname.replace(/^\/+/, "");
let dbName: string | null = null;
if (cleanPath && !cleanPath.includes("/")) {
  try {
    dbName = decodeURIComponent(cleanPath);
  } catch {
    dbName = null;
  }
}

if (dbName !== "nexturn_test") {
  throw new Error(
    `FATAL SAFETY CHECK: Refusing to run tests against non-test database '${parsedDb.pathname}' (expected exact 'nexturn_test').`,
  );
}

// 3. Propagate safe local test environment variables
process.env.DATABASE_URL = localDbUrl;
if (testEnv.SUPER_ADMIN_EMAIL && !process.env.E2E_SUPER_ADMIN_EMAIL) {
  process.env.E2E_SUPER_ADMIN_EMAIL = testEnv.SUPER_ADMIN_EMAIL;
}
if (testEnv.SUPER_ADMIN_PASSWORD && !process.env.E2E_SUPER_ADMIN_PASSWORD) {
  process.env.E2E_SUPER_ADMIN_PASSWORD = testEnv.SUPER_ADMIN_PASSWORD;
}

const isScreenshotRun =
  process.env.RUN_SCREENSHOTS === "true" ||
  process.argv.includes("--project=screenshots") ||
  process.argv.includes("screenshots") ||
  process.env.npm_lifecycle_event === "test:e2e:screenshots";

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
      env: {
        ...process.env,
        ...testEnv,
        DATABASE_URL: localDbUrl,
        E2E_TEST_MODE: "true",
      },
    },
    {
      command: "pnpm --filter web dev",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
      env: {
        ...process.env,
        NEXT_PUBLIC_API_URL: "http://localhost:4000/api",
        NEXT_PUBLIC_SOCKET_URL: "http://localhost:4000",
      },
    },
  ],
});
