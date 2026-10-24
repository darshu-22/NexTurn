import { test, expect } from "@playwright/test";

test.describe("Phase 3 — Real-Time Updates & Estimated Waiting Time (ETA)", () => {
  test("User receives position #1 with 'It's your turn!' banner, User 2 receives ETA, and real-time promotion occurs", async ({
    browser,
  }) => {
    test.setTimeout(90000);

    const adminContext = await browser.newContext();
    const user1Context = await browser.newContext();
    const user2Context = await browser.newContext();

    try {
      const adminPage = await adminContext.newPage();
      const user1Page = await user1Context.newPage();
      const user2Page = await user2Context.newPage();

      // 1. Admin login & queue creation
      await adminPage.goto("/admin");
      await adminPage.fill('input[type="email"]', "admin@example.com");
      await adminPage.fill('input[type="password"]', "password123");
      await adminPage.click('button[type="submit"]');
      await expect(adminPage).toHaveURL(/\/admin\/dashboard/);

      const queueName = `RealTime ETA Queue ${Date.now()}`;
      await adminPage.fill('input[name="queueName"]', queueName);
      await adminPage.click('button:has-text("Create Queue")');

      // 2. Select queue and retrieve public URL
      await adminPage.click(`text=${queueName}`);
      await expect(adminPage.locator("a.qr-link")).toBeVisible();
      const qrLink = await adminPage.getAttribute("a.qr-link", "href");
      expect(qrLink).toBeTruthy();

      // 3. User 1 registration & join (Position #1)
      const u1Timestamp = Date.now();
      const u1Email = `rt-user1-${u1Timestamp}@example.com`;
      await user1Page.goto("/signup");
      await user1Page.fill('input[name="name"]', "Realtime Customer 1");
      await user1Page.fill('input[name="email"]', u1Email);
      await user1Page.fill('input[name="password"]', "password123");
      await user1Page.click('button[type="submit"]');
      await expect(user1Page).toHaveURL(/\/dashboard/);

      await user1Page.goto(qrLink!);
      await user1Page.fill('input[name="name"]', "Realtime Customer 1");
      await user1Page.click('button[type="submit"]');

      // Assert Position #1 UI (It's your turn banner, not "#1" or "You're next")
      await expect(
        user1Page.locator("text=Hello, Realtime Customer 1!"),
      ).toBeVisible();
      await expect(user1Page.locator("text=It's your turn!")).toBeVisible();
      await expect(
        user1Page.locator("text=Please proceed now to the counter."),
      ).toBeVisible();
      await expect(user1Page.locator("text=Live")).toBeVisible();

      // 4. User 2 registration & join (Position #2)
      const u2Timestamp = Date.now() + 1;
      const u2Email = `rt-user2-${u2Timestamp}@example.com`;
      await user2Page.goto("/signup");
      await user2Page.fill('input[name="name"]', "Realtime Customer 2");
      await user2Page.fill('input[name="email"]', u2Email);
      await user2Page.fill('input[name="password"]', "password123");
      await user2Page.click('button[type="submit"]');
      await expect(user2Page).toHaveURL(/\/dashboard/);

      await user2Page.goto(qrLink!);
      await user2Page.fill('input[name="name"]', "Realtime Customer 2");
      await user2Page.click('button[type="submit"]');

      // Assert Position #2 UI
      await expect(
        user2Page.locator("text=Hello, Realtime Customer 2!"),
      ).toBeVisible();
      await expect(user2Page.locator("text=#2")).toBeVisible();
      await expect(
        user2Page.locator("text=1 person ahead of you"),
      ).toBeVisible();
      await expect(user2Page.locator("text=Estimated wait")).toBeVisible();

      // 5. Admin completes User 1 -> User 2 promoted in real time via Socket.IO
      const doneBtn = adminPage
        .locator('button:has-text("DONE"):not([disabled])')
        .first();
      await doneBtn.click();

      // User 2 should transition to "It's your turn!" in real time
      await expect(user2Page.locator("text=It's your turn!")).toBeVisible({
        timeout: 10000,
      });

      // 6. Socket reconnect verification on page reload
      await user2Page.reload();
      await expect(
        user2Page.locator("text=Hello, Realtime Customer 2!"),
      ).toBeVisible();
      await expect(user2Page.locator("text=It's your turn!")).toBeVisible();
      await expect(user2Page.locator("text=Live")).toBeVisible({
        timeout: 10000,
      });
    } finally {
      await adminContext.close().catch(() => {});
      await user1Context.close().catch(() => {});
      await user2Context.close().catch(() => {});
    }
  });
});
