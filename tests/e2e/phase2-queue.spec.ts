import { test, expect } from "@playwright/test";

test.describe("Phase 2 — Queue Management End-to-End Flows", () => {
  test("User joins queue, receives FCFS position, and marks service completed", async ({
    browser,
  }) => {
    // 1. Admin Context: Login and Create Dedicated Queue
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();

    let userContext;
    try {
      await adminPage.goto("/admin");
      await expect(adminPage.locator("h1")).toContainText("NexTurn");

      await adminPage.fill('input[type="email"]', "admin@example.com");
      await adminPage.fill('input[type="password"]', "password123");
      await adminPage.click('button[type="submit"]');

      await expect(adminPage).toHaveURL(/\/admin\/dashboard/);
      await expect(adminPage.locator("h1")).toContainText(
        "Organization Dashboard",
      );

      const queueName = `FCFS Queue ${Date.now()}`;
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

      // 2. User Context: Register as USER and Join Queue
      userContext = await browser.newContext();
      const userPage = await userContext.newPage();

      const userEmail = `fcfs-user-${Date.now()}@example.com`;
      await userPage.goto("/signup");
      await userPage.fill('input[placeholder="Jane Doe"]', "FCFS User");
      await userPage.fill('input[placeholder="jane@example.com"]', userEmail);
      await userPage.fill(
        'input[placeholder="At least 6 characters"]',
        "password123",
      );
      await userPage.click('button[type="submit"]');
      await expect(userPage).toHaveURL(/\/dashboard/);

      // 3. User navigates to public queue page and joins
      await userPage.goto(qrLink);
      await expect(userPage.locator("h1")).toContainText(queueName);
      await userPage.click('button:has-text("Join Queue")');

      // 4. Assert Position #1 state
      await expect(
        userPage.getByRole("heading", { name: "It's your turn!", exact: true }),
      ).toBeVisible();
      await expect(userPage.locator("h1")).toContainText("Hello, FCFS User!");
      await expect(
        userPage.locator("text=Please proceed now to the counter."),
      ).toBeVisible();

      // 5. User marks service completed
      await userPage.click('button:has-text("Mark Completed")');
      await expect(
        userPage.getByRole("heading", { name: "Service Completed", level: 3 }),
      ).toBeVisible();
      await expect(
        userPage.locator("text=Thank you for waiting!"),
      ).toBeVisible();
    } finally {
      if (userContext) await userContext.close();
      await adminContext.close();
    }
  });

  test("User joins queue, verifies leave confirmation dialog, and leaves queue", async ({
    browser,
  }) => {
    // 1. Admin Context: Create Dedicated Queue
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();

    let userContext;
    try {
      await adminPage.goto("/admin");
      await adminPage.fill('input[type="email"]', "admin@example.com");
      await adminPage.fill('input[type="password"]', "password123");
      await adminPage.click('button[type="submit"]');
      await expect(adminPage).toHaveURL(/\/admin\/dashboard/);

      const queueName = `Leave Queue ${Date.now()}`;
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

      // 2. User Context: Register as USER and Join Queue
      userContext = await browser.newContext();
      const userPage = await userContext.newPage();

      const userEmail = `leave-user-${Date.now()}@example.com`;
      await userPage.goto("/signup");
      await userPage.fill('input[placeholder="Jane Doe"]', "Leave User");
      await userPage.fill('input[placeholder="jane@example.com"]', userEmail);
      await userPage.fill(
        'input[placeholder="At least 6 characters"]',
        "password123",
      );
      await userPage.click('button[type="submit"]');
      await expect(userPage).toHaveURL(/\/dashboard/);

      // 3. User navigates to public queue page and joins
      await userPage.goto(qrLink);
      await expect(userPage.locator("h1")).toContainText(queueName);
      await userPage.click('button:has-text("Join Queue")');

      await expect(
        userPage.getByRole("heading", { name: "It's your turn!", exact: true }),
      ).toBeVisible();

      // 4. Trigger Leave Confirmation Modal
      await userPage.click('button:has-text("Leave Queue")');
      await expect(
        userPage.locator("text=Leave Queue Confirmation"),
      ).toBeVisible();
      await expect(
        userPage.locator("text=Are you sure you want to leave the queue?"),
      ).toBeVisible();

      // 5. Test Cancel button inside modal
      await userPage.click('button:has-text("Cancel")');
      await expect(
        userPage.locator("text=Leave Queue Confirmation"),
      ).not.toBeVisible();
      await expect(
        userPage.getByRole("heading", { name: "It's your turn!", exact: true }),
      ).toBeVisible();

      // 6. Trigger Modal again and Confirm Leave
      await userPage.click('button:has-text("Leave Queue")');
      await userPage.click('div.fixed button:has-text("Leave Queue")');

      // 7. Verify Ticket state updates to Cancelled
      await expect(userPage.locator("text=Queue Left")).toBeVisible();
      await expect(
        userPage.locator("text=You have left this queue"),
      ).toBeVisible();
    } finally {
      if (userContext) await userContext.close();
      await adminContext.close();
    }
  });
});
