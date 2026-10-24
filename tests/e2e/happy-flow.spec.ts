import { test, expect } from "@playwright/test";

test.describe("Phase 1 & 2 Happy Flow", () => {
  test("Admin logs in, creates queue, and user registers and joins", async ({
    browser,
  }) => {
    // 1. Isolated Admin Context
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();

    let userContext;
    try {
      // 2. Admin Login
      await adminPage.goto("/admin");
      await expect(adminPage.locator("h1")).toContainText("NexTurn");

      await adminPage.fill('input[type="email"]', "admin@example.com");
      await adminPage.fill('input[type="password"]', "password123");
      await adminPage.click('button[type="submit"]');

      // Verify routing strictly reaches /admin/dashboard
      await expect(adminPage).toHaveURL(/\/admin\/dashboard/);
      await expect(adminPage.locator("h1")).toContainText(
        "Organization Dashboard",
      );

      // 3. Create Queue
      const queueName = `Happy Flow Queue ${Date.now()}`;
      await adminPage.fill('input[name="queueName"]', queueName);
      await adminPage.click('button:has-text("Create Queue")');

      // 4. Verify public queue link
      const qrLinkLocator = adminPage.locator("a.qr-link");
      await expect(qrLinkLocator).toBeVisible();
      const qrLink = await qrLinkLocator.getAttribute("href");
      expect(qrLink).toBeTruthy();

      // 5. Isolated User Context (Clean cookies, localStorage, distinct role)
      userContext = await browser.newContext();
      const userPage = await userContext.newPage();

      // 6. User Signup (Application-supported customer registration flow)
      const userEmail = `happy-user-${Date.now()}@example.com`;
      await userPage.goto("/signup");
      await expect(userPage.locator("h1")).toContainText("NexTurn");

      await userPage.fill('input[placeholder="Jane Doe"]', "Happy Customer");
      await userPage.fill('input[placeholder="jane@example.com"]', userEmail);
      await userPage.fill(
        'input[placeholder="At least 6 characters"]',
        "password123",
      );
      await userPage.click('button[type="submit"]');

      // User arrives at customer dashboard
      await expect(userPage).toHaveURL(/\/dashboard/);

      // 7. User navigates to public queue page and joins
      await userPage.goto(qrLink!);
      await expect(userPage.locator("h1")).toContainText(queueName);
      await userPage.click('button:has-text("Join Queue")');

      // 8. Verify ticket creation and Position #1 status
      await expect(userPage.locator("text=It's your turn!")).toBeVisible();
      await expect(userPage.locator("h1")).toContainText(
        "Hello, Happy Customer!",
      );
      await expect(
        userPage.locator("text=Please proceed now to the counter."),
      ).toBeVisible();
    } finally {
      if (userContext) await userContext.close();
      await adminContext.close();
    }
  });
});
