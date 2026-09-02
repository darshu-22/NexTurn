import { test, expect } from "@playwright/test";

test.describe("Phase 4 — Website-Only Realtime Notifications", () => {
  test("Public customer joining queue receives website notification toast and position status update", async ({
    page,
  }) => {
    // 1. Admin login & queue setup
    await page.goto("/admin");
    await page.fill('input[type="email"]', "admin@example.com");
    await page.fill('input[type="password"]', "password123");
    await page.click('button[type="submit"]');

    const queueName = `Web Notification Queue ${Date.now()}`;
    await page.fill('input[name="queueName"]', queueName);
    await page.click('button:has-text("Create Queue")');

    await expect(page.locator("a.qr-link")).toBeVisible();
    const qrLink = await page.getAttribute("a.qr-link", "href");
    expect(qrLink).toBeTruthy();

    // 2. Open public queue status page
    await page.goto(qrLink!);
    await page.fill('input[name="name"]', "Darshan Customer");
    await page.fill('input[name="phone"]', "+919876543210");
    await page.click('button:has-text("Join Queue")');

    // 3. Verify website notification toast and prominent turn alert
    await expect(page.locator("text=You're in the queue")).toBeVisible();
    await expect(page.locator("text=It's your turn")).toBeVisible();
    await expect(
      page.locator("text=Please proceed now to the counter"),
    ).toBeVisible();
  });
});
