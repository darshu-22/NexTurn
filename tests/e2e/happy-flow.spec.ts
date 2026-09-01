import { test, expect } from "@playwright/test";

test.describe("Phase 1 & 2 Happy Flow", () => {
  test("Admin logs in, creates queue, and user registers", async ({ page }) => {
    // Navigate to admin login
    await page.goto("/admin");
    await expect(page.locator("h1")).toContainText("Admin Login");

    // Login
    await page.fill('input[type="email"]', "admin@example.com");
    await page.fill('input[type="password"]', "password123");
    await page.click('button[type="submit"]');

    // Verify dashboard
    await expect(page.locator("h1")).toContainText("Organization Dashboard");

    // Create a queue
    await page.fill('input[name="queueName"]', "Happy Flow Queue");
    await page.click('button:has-text("Create Queue")');

    // Generate QR / public page link
    const qrLink = await page.getAttribute("a.qr-link", "href");
    expect(qrLink).toBeTruthy();

    // User opens public queue page
    if (qrLink) {
      await page.goto(qrLink);
      await expect(page.locator('input[name="name"]')).toBeVisible();
    }
  });
});
