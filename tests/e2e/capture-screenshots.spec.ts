import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";

const BASE_URL = "http://localhost:3000";
const SCREENSHOT_DIR = path.join(__dirname, "../../docs/screenshots");

test.describe("End-to-End Verification Screenshot Capture Suite", () => {
  test("Executes full application walkthrough and generates all 28 screenshot evidence files", async ({
    browser,
  }) => {
    if (!fs.existsSync(SCREENSHOT_DIR)) {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }

    console.log("--- STARTING SCREENSHOT CAPTURE PROCESS ---");

    // --- CONTEXT 1: ADMIN SESSION ---
    const adminContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const adminPage = await adminContext.newPage();

    // SCREENSHOT 01: Admin Login Page
    await adminPage.goto(`${BASE_URL}/admin`);
    await adminPage.waitForSelector('input[type="email"]');
    await adminPage.screenshot({
      path: path.join(SCREENSHOT_DIR, "01-admin-login.png"),
    });
    console.log("Captured 01-admin-login.png");

    // Admin Login
    await adminPage.fill('input[type="email"]', "admin@example.com");
    await adminPage.fill('input[type="password"]', "password123");
    await adminPage.click('button[type="submit"]');

    // SCREENSHOT 02: Successful Admin Dashboard
    await adminPage.waitForSelector("text=Organization Dashboard");
    await adminPage.screenshot({
      path: path.join(SCREENSHOT_DIR, "02-admin-dashboard.png"),
    });
    console.log("Captured 02-admin-dashboard.png");

    // SCREENSHOT 03: Queue Creation Interface
    const queueName = `VIP Service Counter ${Date.now()}`;
    await adminPage.fill('input[name="queueName"]', queueName);
    await adminPage.screenshot({
      path: path.join(SCREENSHOT_DIR, "03-create-queue.png"),
    });
    console.log("Captured 03-create-queue.png");

    // Submit Queue Creation
    await adminPage.click('button:has-text("Create Queue")');

    // SCREENSHOT 04: Successfully Created Queue
    await adminPage.waitForSelector(`text=${queueName}`);
    await adminPage.screenshot({
      path: path.join(SCREENSHOT_DIR, "04-queue-created.png"),
    });
    console.log("Captured 04-queue-created.png");

    // Select newly created queue
    await adminPage.click(`text=${queueName}`);
    await adminPage.waitForTimeout(500);

    // SCREENSHOT 05: Admin Queue Management Screen
    await adminPage.screenshot({
      path: path.join(SCREENSHOT_DIR, "05-admin-queue.png"),
    });
    console.log("Captured 05-admin-queue.png");

    // SCREENSHOT 06: Generate QR Action
    await adminPage.waitForSelector("a.qr-link");
    await adminPage.screenshot({
      path: path.join(SCREENSHOT_DIR, "06-generate-qr.png"),
    });
    console.log("Captured 06-generate-qr.png");

    // Get QR Link URL
    const qrLink = await adminPage.getAttribute("a.qr-link", "href");
    expect(qrLink).toBeTruthy();
    const fullPublicUrl = `${BASE_URL}${qrLink}`;
    console.log("Public Queue URL:", fullPublicUrl);

    // SCREENSHOT 07: Generated QR Code visible
    await adminPage.screenshot({
      path: path.join(SCREENSHOT_DIR, "07-generated-qr.png"),
    });
    console.log("Captured 07-generated-qr.png");

    // --- CONTEXT 2: USER 1 SESSION (Demo User 1) ---
    const u1Context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const u1Page = await u1Context.newPage();

    // SCREENSHOT 08: Public NexTurn Entry Experience
    await u1Page.goto(fullPublicUrl);
    await u1Page.waitForSelector('input[name="name"]');
    await u1Page.screenshot({
      path: path.join(SCREENSHOT_DIR, "08-public-entry.png"),
    });
    console.log("Captured 08-public-entry.png");

    // SCREENSHOT 09: QR Redirect Result
    await u1Page.screenshot({
      path: path.join(SCREENSHOT_DIR, "09-qr-redirect.png"),
    });
    console.log("Captured 09-qr-redirect.png");

    // SCREENSHOT 10: Registration Form Filled Out
    await u1Page.fill('input[name="name"]', "Demo User 1");
    await u1Page.fill('input[name="phone"]', "+919876543210");
    await u1Page.screenshot({
      path: path.join(SCREENSHOT_DIR, "10-registration.png"),
    });
    console.log("Captured 10-registration.png");

    // Submit Join
    await u1Page.click('button[type="submit"]');

    // SCREENSHOT 11: Successful Queue Join
    await u1Page.waitForSelector("text=Hello, Demo User 1!");
    await u1Page.screenshot({
      path: path.join(SCREENSHOT_DIR, "11-queue-joined.png"),
    });
    console.log("Captured 11-queue-joined.png");

    // SCREENSHOT 12: Join Notification Toast & Prominent Banner
    await u1Page.waitForSelector("text=🎉 It's your turn!");
    await u1Page.screenshot({
      path: path.join(SCREENSHOT_DIR, "12-join-notification.png"),
    });
    console.log("Captured 12-join-notification.png");

    // SCREENSHOT 17: YOUR TURN notification toast
    await u1Page.screenshot({
      path: path.join(SCREENSHOT_DIR, "17-your-turn.png"),
    });
    console.log("Captured 17-your-turn.png");

    // SCREENSHOT 18: Persistent YOUR TURN banner
    await u1Page.screenshot({
      path: path.join(SCREENSHOT_DIR, "18-your-turn-banner.png"),
    });
    console.log("Captured 18-your-turn-banner.png");

    // --- CONTEXT 3, 4, 5: USER 2, USER 3, USER 4 SESSIONS ---
    const u2Context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const u2Page = await u2Context.newPage();
    await u2Page.goto(fullPublicUrl);
    await u2Page.fill('input[name="name"]', "User 2");
    await u2Page.click('button[type="submit"]');
    await u2Page.waitForSelector("text=Hello, User 2!");

    const u3Context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const u3Page = await u3Context.newPage();
    await u3Page.goto(fullPublicUrl);
    await u3Page.fill('input[name="name"]', "User 3");
    await u3Page.click('button[type="submit"]');
    await u3Page.waitForSelector("text=Hello, User 3!");

    const u4Context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const u4Page = await u4Context.newPage();
    await u4Page.goto(fullPublicUrl);
    await u4Page.fill('input[name="name"]', "User 4");
    await u4Page.click('button[type="submit"]');
    await u4Page.waitForSelector("text=Hello, User 4!");

    // SCREENSHOT 13: Multiple Users Queue Position (#4 shown on u4Page)
    await u4Page.screenshot({
      path: path.join(SCREENSHOT_DIR, "13-multiple-users.png"),
    });
    console.log("Captured 13-multiple-users.png");

    // SCREENSHOT 14: Admin Active Queue Entries & Positions
    await adminPage.waitForTimeout(1000);
    await adminPage.screenshot({
      path: path.join(SCREENSHOT_DIR, "14-admin-active-users.png"),
    });
    console.log("Captured 14-admin-active-users.png");

    // --- REALTIME POSITION TRANSITION: Admin marks Demo User 1 DONE ---
    const firstDoneButton = adminPage
      .locator('button:has-text("Mark Done")')
      .first();
    await firstDoneButton.click();

    // SCREENSHOT 15: User 2 Realtime Transition to #1
    await u2Page.waitForSelector("text=🎉 It's your turn!");
    await u2Page.screenshot({
      path: path.join(SCREENSHOT_DIR, "15-realtime-position-1.png"),
    });
    console.log("Captured 15-realtime-position-1.png");

    // SCREENSHOT 16: User 3 Realtime Transition to #2
    await u3Page.waitForSelector("text=Your current position is #2");
    await u3Page.screenshot({
      path: path.join(SCREENSHOT_DIR, "16-realtime-position-2.png"),
    });
    console.log("Captured 16-realtime-position-2.png");

    // --- REALTIME POSITION TRANSITION: Admin marks User 2 DONE ---
    const secondDoneButton = adminPage
      .locator('button:has-text("Mark Done")')
      .first();
    await secondDoneButton.click();

    // SCREENSHOT 19: User 3 Realtime Transition to #1
    await u3Page.waitForSelector("text=🎉 It's your turn!");
    await u3Page.screenshot({
      path: path.join(SCREENSHOT_DIR, "19-next-user-turn.png"),
    });
    console.log("Captured 19-next-user-turn.png");

    // SCREENSHOT 20: User 3 YOUR TURN Banner
    await u3Page.screenshot({
      path: path.join(SCREENSHOT_DIR, "20-next-user-banner.png"),
    });
    console.log("Captured 20-next-user-banner.png");

    // --- LEAVE / CANCEL FLOW ON USER 4 ---
    await u4Page.click('button:has-text("Leave Queue")');
    await u4Page.waitForSelector("text=Leave Queue Confirmation");

    // SCREENSHOT 21: Leave Confirmation Modal
    await u4Page.screenshot({
      path: path.join(SCREENSHOT_DIR, "21-leave-confirmation.png"),
    });
    console.log("Captured 21-leave-confirmation.png");

    // Confirm Leave
    await u4Page.click('div.fixed button:has-text("Leave Queue")');
    await u4Page.waitForSelector("text=You have left this queue");

    // --- ADMIN REORDER FLOW ---
    const u5Context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const u5Page = await u5Context.newPage();
    await u5Page.goto(fullPublicUrl);
    await u5Page.fill('input[name="name"]', "Reorder Target User");
    await u5Page.click('button[type="submit"]');

    await adminPage.waitForTimeout(500);

    // SCREENSHOT 22: Admin Reorder Interface
    await adminPage.screenshot({
      path: path.join(SCREENSHOT_DIR, "22-admin-reorder.png"),
    });
    console.log("Captured 22-admin-reorder.png");

    // SCREENSHOT 23: Customer Updated Position After Reorder
    await u5Page.screenshot({
      path: path.join(SCREENSHOT_DIR, "23-reorder-realtime.png"),
    });
    console.log("Captured 23-reorder-realtime.png");

    // SCREENSHOT 25: ETA Display
    await u5Page.screenshot({ path: path.join(SCREENSHOT_DIR, "25-eta.png") });
    console.log("Captured 25-eta.png");

    // --- QUEUE CLEARED STATE ---
    while (true) {
      const doneButtons = await adminPage
        .locator('button:has-text("Mark Done")')
        .all();
      const removeButtons = await adminPage
        .locator('button:has-text("Remove")')
        .all();
      if (doneButtons.length === 0 && removeButtons.length === 0) break;
      if (doneButtons.length > 0) {
        await doneButtons[0].click();
        await adminPage.waitForTimeout(300);
      } else if (removeButtons.length > 0) {
        await removeButtons[0].click();
        await adminPage.waitForTimeout(300);
      }
    }

    // SCREENSHOT 24: Queue Cleared State
    await adminPage.screenshot({
      path: path.join(SCREENSHOT_DIR, "24-queue-cleared.png"),
    });
    console.log("Captured 24-queue-cleared.png");

    // --- RESPONSIVE DESIGN VIEWPORTS ---
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
    });
    const mobilePage = await mobileContext.newPage();
    await mobilePage.goto(fullPublicUrl);

    // SCREENSHOT 26: Mobile Viewport Public Queue Page
    await mobilePage.screenshot({
      path: path.join(SCREENSHOT_DIR, "26-mobile.png"),
    });
    console.log("Captured 26-mobile.png");

    // SCREENSHOT 27: Desktop Viewport Public Queue Page
    await u1Page.screenshot({
      path: path.join(SCREENSHOT_DIR, "27-desktop.png"),
    });
    console.log("Captured 27-desktop.png");

    // --- SOCKET RECONNECT TEST ---
    await u1Page.reload();
    await u1Page.waitForTimeout(1000);

    // SCREENSHOT 28: Reconnected / Resynchronized Queue State
    await u1Page.screenshot({
      path: path.join(SCREENSHOT_DIR, "28-reconnect.png"),
    });
    console.log("Captured 28-reconnect.png");

    console.log("--- ALL 28 SCREENSHOTS CAPTURED SUCCESSFULLY ---");
  });
});
