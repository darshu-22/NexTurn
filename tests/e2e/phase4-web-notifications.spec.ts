import { test, expect } from "@playwright/test";

test.describe("Phase 4 — Website-Only Realtime Notifications", () => {
  test("Public customer joining queue receives website notification toast and position status update", async ({
    browser,
  }) => {
    const adminContext = await browser.newContext();
    const userContext = await browser.newContext();

    try {
      const adminPage = await adminContext.newPage();
      const userPage = await userContext.newPage();

      // 1. Admin login & queue setup
      await adminPage.goto("/admin");
      await adminPage.fill('input[type="email"]', "admin@example.com");
      await adminPage.fill('input[type="password"]', "password123");
      await adminPage.click('button[type="submit"]');
      await expect(adminPage).toHaveURL(/\/admin\/dashboard/);

      const queueName = `Web Notification Queue ${Date.now()}`;
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

      // 2. User registers and joins
      const userEmail = `webnotif-user-${Date.now()}@example.com`;
      await userPage.goto("/signup");
      await userPage.fill('input[placeholder="Jane Doe"]', "Darshan Customer");
      await userPage.fill('input[placeholder="jane@example.com"]', userEmail);
      await userPage.fill(
        'input[placeholder="At least 6 characters"]',
        "password123",
      );
      await userPage.click('button[type="submit"]');
      await expect(userPage).toHaveURL(/\/dashboard/);

      await userPage.goto(qrLink);
      await userPage.fill('input[name="name"]', "Darshan Customer");
      await userPage.fill('input[name="phone"]', "+919876543210");
      await userPage.click('button:has-text("Join Queue")');

      // 3. Verify website notification toast and prominent turn alert
      await expect(
        userPage.getByRole("heading", { name: "🎉 It's your turn!" }),
      ).toBeVisible();
      await expect(
        userPage.getByRole("heading", { name: "It's your turn!", exact: true }),
      ).toBeVisible();
      await expect(
        userPage.locator("text=Please proceed now to the counter."),
      ).toBeVisible();
      await expect(userPage.locator("text=Live")).toBeVisible();
    } finally {
      await adminContext.close().catch(() => {});
      await userContext.close().catch(() => {});
    }
  });
});
