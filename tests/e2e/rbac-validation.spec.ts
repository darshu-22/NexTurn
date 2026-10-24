import { test, expect } from "@playwright/test";

test.describe("Public & Unauthenticated RBAC Route Restrictions", () => {
  test("Unauthenticated user attempting to access /super-admin is redirected to /login", async ({
    page,
  }) => {
    await page.goto("/super-admin");
    await expect(page).toHaveURL(/\/login/);
  });

  test("Unauthenticated API request to /api/super-admin/admins returns 401 Unauthorized", async ({
    request,
  }) => {
    const res = await request.get(
      "http://localhost:4000/api/super-admin/admins",
    );
    expect(res.status()).toBe(401);
  });
});

test.describe("Privileged Super Admin & Admin Lifecycle (@privileged)", () => {
  test.beforeEach(() => {
    const email = process.env.E2E_SUPER_ADMIN_EMAIL?.trim();
    const password = process.env.E2E_SUPER_ADMIN_PASSWORD?.trim();

    if (!email || !password) {
      test.skip(
        true,
        "Skipping privileged test: E2E_SUPER_ADMIN_EMAIL and E2E_SUPER_ADMIN_PASSWORD environment variables are not configured.",
      );
    }
  });

  test("Super Admin provisions Admin, verifies Phone validation, validates Admin login & route restrictions", async ({
    browser,
  }) => {
    const superAdminEmail = process.env.E2E_SUPER_ADMIN_EMAIL!.trim();
    const superAdminPassword = process.env.E2E_SUPER_ADMIN_PASSWORD!.trim();

    const superAdminContext = await browser.newContext();
    const page = await superAdminContext.newPage();
    let adminContext: any;

    try {
      // 1. Super Admin Login
      await page.goto("/login");
      await page.fill('input[type="email"]', superAdminEmail);
      await page.fill('input[type="password"]', superAdminPassword);
      await page.click('button[type="submit"]');

      // 2. Redirect to Super Admin Dashboard
      await expect(page).toHaveURL(/\/super-admin/);
      await expect(page.locator("h1")).toContainText("Super Admin Dashboard");

      // 3. Open Add Admin Modal and test Phone Validation
      await page.click('button:has-text("+ Add Admin Account")');
      await expect(page.locator("h3")).toContainText("Add Admin Account");

      const uniqueSuffix = Date.now();
      const adminEmail = `e2eadmin-${uniqueSuffix}@example.com`;
      const adminPassword = `AdminPass${uniqueSuffix}!`;
      const adminName = `E2E Admin ${uniqueSuffix}`;

      // Enter invalid phone to test format validation
      await page.fill('input[placeholder="Alice Johnson"]', adminName);
      await page.fill('input[placeholder="alice@example.com"]', adminEmail);
      await page.fill('input[placeholder="+15559998888"]', "invalid-phone-xyz");
      await page.fill(
        'input[placeholder="At least 6 characters"]',
        adminPassword,
      );

      // Submit - Should be blocked by frontend validation regex
      await page.click('button:has-text("Create Admin")');
      await expect(page.locator(".text-rose-300")).toBeVisible();
      await expect(page.locator(".text-rose-300")).toContainText("phone");

      // Fix phone with valid format (+15559998888)
      await page.fill('input[placeholder="+15559998888"]', "+15559998888");
      await page.click('button:has-text("Create Admin")');

      // Should succeed and show success toast / message
      await expect(page.locator(".text-emerald-300").first()).toBeVisible();
      await expect(page.locator(".text-emerald-300").first()).toContainText(
        adminName,
      );

      // 4. Verify created Admin can authenticate in an isolated context
      adminContext = await browser.newContext();
      const adminPage = await adminContext.newPage();

      await adminPage.goto("/login");
      await adminPage.fill('input[type="email"]', adminEmail);
      await adminPage.fill('input[type="password"]', adminPassword);
      await adminPage.click('button[type="submit"]');

      // Verify routing to /admin/dashboard
      await expect(adminPage).toHaveURL(/\/admin\/dashboard/);
      await expect(adminPage.locator("h1")).toContainText("NexTurn");

      // 5. Verify Admin is restricted from Super Admin routes
      await adminPage.goto("/super-admin");
      await expect(adminPage).toHaveURL(/\/login/);

      // 6. Verify Admin token cannot access Super Admin API
      const token = await adminPage.evaluate(() =>
        localStorage.getItem("token"),
      );
      if (token) {
        const apiRes = await adminPage.request.get(
          "http://localhost:4000/api/super-admin/admins",
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        expect(apiRes.status()).toBe(403);
      }
    } finally {
      if (superAdminContext) await superAdminContext.close().catch(() => {});
      if (adminContext) await adminContext.close().catch(() => {});
    }
  });
});
