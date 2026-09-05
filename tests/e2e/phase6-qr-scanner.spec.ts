import { test, expect } from "@playwright/test";

const BASE_URL = "http://localhost:3000";

test.describe("Phase 6 — Camera QR Scanner E2E Verification", () => {
  test("User can open QR Scanner modal from dashboard and navigate via fallback/scanner input", async ({
    page,
  }) => {
    // 1. Log in as normal USER
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[type="email"]', "user1@example.com");
    await page.fill('input[type="password"]', "password123");
    await page.click('button[type="submit"]');

    // Should land on user dashboard
    await page.waitForURL("**/dashboard");
    await expect(page.locator("h1")).toContainText("Welcome");

    // 2. Click "Scan QR Code" button
    await page.click('button:has-text("Scan QR Code")');

    // 3. Verify QR Scanner modal opens with title and fallback input
    await expect(page.locator("text=Scan Queue QR")).toBeVisible();
    await expect(
      page.locator('input[placeholder*="Paste URL or Queue ID"]'),
    ).toBeVisible();

    // 4. Test manual entry fallback (e.g. pasting queue URL)
    await page.fill(
      'input[placeholder*="Paste URL or Queue ID"]',
      `${BASE_URL}/queue/queue-1`,
    );
    await page.click('button:has-text("Open Queue")');

    // 5. Automatically navigates to /queue/queue-1
    await page.waitForURL("**/queue/queue-1");
    await expect(page.locator("h1")).toContainText("Main Queue");
  });

  test("Unauthenticated user entering scanner URL is required to log in before joining", async ({
    page,
  }) => {
    // Navigate directly to public queue URL (as detected by QR scanner)
    await page.goto(`${BASE_URL}/queue/queue-1`);
    await expect(page.locator("h1")).toContainText("Main Queue");

    // Attempting to join without logging in redirects to /login?redirect=/queue/queue-1
    await page.click('button[type="submit"]');
    await page.waitForURL("**/login?redirect=/queue/queue-1");
    await expect(page.locator("text=Sign in to your account")).toBeVisible();
  });
});
