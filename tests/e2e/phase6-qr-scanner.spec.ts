import { test, expect } from "@playwright/test";

const BASE_URL = "http://localhost:3000";

test.describe("Phase 6 — Camera QR Scanner E2E Verification", () => {
  test("User can open QR Scanner modal from dashboard and navigate via fallback/scanner input", async ({
    browser,
  }) => {
    const adminContext = await browser.newContext();
    const userContext = await browser.newContext();

    try {
      const adminPage = await adminContext.newPage();
      const userPage = await userContext.newPage();

      // 1. Create dedicated queue as admin
      await adminPage.goto(`${BASE_URL}/admin`);
      await adminPage.fill('input[type="email"]', "admin@example.com");
      await adminPage.fill('input[type="password"]', "password123");
      await adminPage.click('button[type="submit"]');
      await expect(adminPage).toHaveURL(/\/admin\/dashboard/);

      const queueName = `Scanner Queue ${Date.now()}`;
      const queueCreatePromise = adminPage.waitForResponse(
        (res) =>
          res.url().includes("/api/queues") &&
          res.request().method() === "POST" &&
          res.status() === 201,
      );
      await adminPage.fill('input[name="queueName"]', queueName);
      await adminPage.click('button:has-text("Create Queue")');
      const createRes = await queueCreatePromise;
      const createdData = await createRes.json();
      const createdQueueId = createdData.id;

      const qrLinkLocator = adminPage.locator(
        `a.qr-link[href="/queue/${createdQueueId}"]`,
      );
      await expect(qrLinkLocator).toBeVisible();
      const qrLink = `/queue/${createdQueueId}`;

      // 2. User registers and lands on dashboard
      const userEmail = `scanner-user-${Date.now()}@example.com`;
      await userPage.goto(`${BASE_URL}/signup`);
      await userPage.fill('input[placeholder="Jane Doe"]', "Scanner User");
      await userPage.fill('input[placeholder="jane@example.com"]', userEmail);
      await userPage.fill(
        'input[placeholder="At least 6 characters"]',
        "password123",
      );
      await userPage.click('button[type="submit"]');
      await expect(userPage).toHaveURL(/\/dashboard/);
      await expect(userPage.locator("h1")).toContainText("Welcome");

      // 3. Open QR scanner modal
      await userPage.click('button:has-text("Scan QR Code")');
      await expect(userPage.locator("text=Scan Queue QR")).toBeVisible();
      await expect(
        userPage.locator('input[placeholder*="Paste URL or Queue ID"]'),
      ).toBeVisible();

      // 4. Test manual entry fallback with real queue URL
      await userPage.fill(
        'input[placeholder*="Paste URL or Queue ID"]',
        `${BASE_URL}${qrLink}`,
      );
      await userPage.click('button:has-text("Open Queue")');

      // 5. Automatically navigates to the queue page
      await expect(userPage).toHaveURL(
        new RegExp(qrLink.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
      await expect(userPage.locator("h1")).toContainText(queueName);
    } finally {
      await adminContext.close().catch(() => {});
      await userContext.close().catch(() => {});
    }
  });

  test("Unauthenticated user entering scanner URL is required to log in before joining", async ({
    browser,
  }) => {
    const adminContext = await browser.newContext();
    const guestContext = await browser.newContext();

    try {
      const adminPage = await adminContext.newPage();
      const guestPage = await guestContext.newPage();

      // Create dedicated queue as admin
      await adminPage.goto(`${BASE_URL}/admin`);
      await adminPage.fill('input[type="email"]', "admin@example.com");
      await adminPage.fill('input[type="password"]', "password123");
      await adminPage.click('button[type="submit"]');
      await expect(adminPage).toHaveURL(/\/admin\/dashboard/);

      const queueName = `Auth Gate Queue ${Date.now()}`;
      const queueCreatePromise = adminPage.waitForResponse(
        (res) =>
          res.url().includes("/api/queues") &&
          res.request().method() === "POST" &&
          res.status() === 201,
      );
      await adminPage.fill('input[name="queueName"]', queueName);
      await adminPage.click('button:has-text("Create Queue")');
      const createRes = await queueCreatePromise;
      const createdData = await createRes.json();
      const createdQueueId = createdData.id;

      const qrLinkLocator = adminPage.locator(
        `a.qr-link[href="/queue/${createdQueueId}"]`,
      );
      await expect(qrLinkLocator).toBeVisible();
      const qrLink = `/queue/${createdQueueId}`;

      // Guest visits queue directly
      await guestPage.goto(`${BASE_URL}${qrLink}`);
      await expect(guestPage.locator("h1")).toContainText(queueName);

      // Fill required name input with harmless test value before submit
      await guestPage.fill('input[name="name"]', "Guest User");

      // Attempting to join without logging in redirects to /login?redirect=<qrLink>
      await guestPage.click('button[type="submit"]');
      await expect(guestPage).toHaveURL(
        new RegExp(
          `/login\\?redirect=${qrLink!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
        ),
      );
      await expect(
        guestPage.locator("text=Sign in to access your dashboard"),
      ).toBeVisible();
    } finally {
      await adminContext.close().catch(() => {});
      await guestContext.close().catch(() => {});
    }
  });
});
