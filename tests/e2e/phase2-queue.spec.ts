import { test, expect } from "@playwright/test";

test.describe("Phase 2 — Queue Management End-to-End Flows", () => {
  test("User joins queue, receives FCFS position, and manages status", async ({
    page,
  }) => {
    // Navigate to admin login & login
    await page.goto("/admin");
    await expect(page.locator("h1")).toContainText("Admin Login");

    await page.fill('input[type="email"]', "admin@example.com");
    await page.fill('input[type="password"]', "password123");
    await page.click('button[type="submit"]');

    // Verify dashboard
    await expect(page.locator("h1")).toContainText("Organization Dashboard");

    // Create a new queue
    const queueName = `E2E Queue ${Date.now()}`;
    await page.fill('input[name="queueName"]', queueName);
    await page.click('button:has-text("Create Queue")');

    // Get public queue link
    await expect(page.locator("a.qr-link")).toBeVisible();
    const qrLink = await page.getAttribute("a.qr-link", "href");
    expect(qrLink).toBeTruthy();

    // User A joins
    await page.goto(qrLink!);
    await expect(page.locator("h1")).toContainText(queueName);
    await page.fill('input[name="name"]', "User A");
    await page.fill('input[name="phone"]', "9876543210");
    await page.click('button:has-text("Join Queue")');

    // User A receives position #1
    await expect(page.locator("text=#1")).toBeVisible();
    await expect(page.locator("text=0 people ahead")).toBeVisible();

    // User A clicks Mark Completed
    await page.click('button:has-text("Mark Completed")');
    await expect(page.locator("text=Service Completed")).toBeVisible();
  });

  test("User leave queue with confirmation dialog", async ({ page }) => {
    // Join queue
    await page.goto("/queue/queue-1");
    if (await page.locator('button:has-text("Leave Queue")').isVisible()) {
      // Leave existing session if any
      await page.click('button:has-text("Leave Queue")');
      await page.click('button:has-text("Leave Queue")'); // confirm modal
    }

    await page.goto("/queue/queue-1");
    await page.fill('input[name="name"]', "User Leave Test");
    await page.click('button:has-text("Join Queue")');

    await expect(page.locator("text=You're in the queue")).toBeVisible();

    // Click Leave Queue button to show confirmation modal
    await page.click('button:has-text("Leave Queue")');

    // Confirm modal should appear with prompt warning
    await expect(page.locator("text=Leave Queue Confirmation")).toBeVisible();
    await expect(
      page.locator("text=Are you sure you want to leave the queue?"),
    ).toBeVisible();

    // Click confirm leave inside modal
    await page.locator('div.fixed button:has-text("Leave Queue")').click();

    // Verify left status
    await expect(page.locator("text=You have left this queue")).toBeVisible();
  });
});
