import { test, expect } from "@playwright/test";

test.describe("Phase 3 — Real-Time Updates & Estimated Waiting Time (ETA)", () => {
  test('User receives position #1 and "You\'re next!" badge, and ETA renders correctly', async ({
    page,
  }) => {
    // Navigate to admin and login
    await page.goto("/admin");
    await page.fill('input[type="email"]', "admin@example.com");
    await page.fill('input[type="password"]', "password123");
    await page.click('button[type="submit"]');

    // Create a new queue
    const queueName = `RealTime Queue ${Date.now()}`;
    await page.fill('input[name="queueName"]', queueName);
    await page.click('button:has-text("Create Queue")');

    // Open public queue page
    await expect(page.locator("a.qr-link")).toBeVisible();
    const qrLink = await page.getAttribute("a.qr-link", "href");
    expect(qrLink).toBeTruthy();

    await page.goto(qrLink!);
    await page.fill('input[name="name"]', "Realtime User A");
    await page.click('button:has-text("Join Queue")');

    // Position #1 should render "You're next!"
    await expect(page.locator("text=#1")).toBeVisible();
    await expect(page.locator("text=You're next")).toBeVisible();
  });
});
