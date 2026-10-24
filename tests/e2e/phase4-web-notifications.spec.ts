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
      await adminPage.fill('input[name="queueName"]', queueName);
      await adminPage.click('button:has-text("Create Queue")');

      await expect(adminPage.locator("a.qr-link")).toBeVisible();
      const qrLink = await adminPage.getAttribute("a.qr-link", "href");
      expect(qrLink).toBeTruthy();

      // 2. User registers and joins
      const userEmail = `webnotif-user-${Date.now()}@example.com`;
      await userPage.goto("/signup");
      await userPage.fill('input[name="name"]', "Darshan Customer");
      await userPage.fill('input[name="email"]', userEmail);
      await userPage.fill('input[name="password"]', "password123");
      await userPage.click('button[type="submit"]');
      await expect(userPage).toHaveURL(/\/dashboard/);

      await userPage.goto(qrLink!);
      await userPage.fill('input[name="name"]', "Darshan Customer");
      await userPage.fill('input[name="phone"]', "+919876543210");
      await userPage.click('button:has-text("Join Queue")');

      // 3. Verify website notification toast and prominent turn alert
      await expect(userPage.locator("text=It's your turn!")).toBeVisible();
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
