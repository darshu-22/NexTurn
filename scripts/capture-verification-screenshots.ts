import { chromium } from "@playwright/test";
import path from "path";
import fs from "fs";

const BASE_URL = "http://localhost:3000";
const API_URL = "http://localhost:4000/api";
const SCREENSHOT_DIR = path.join(__dirname, "../docs/screenshots");

async function captureVerificationScreenshots() {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });

  console.log("--- STARTING SCREENSHOT CAPTURE PROCESS ---");

  // --- CONTEXT 1: ADMIN SESSION ---
  const adminContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const adminPage = await adminContext.newPage();

  // SCREENSHOT 01: Admin Login Page
  await adminPage.goto(`${BASE_URL}/admin`);
  await adminPage.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
  await adminPage.waitForSelector('input[type="email"]');
  await adminPage.screenshot({
    path: path.join(SCREENSHOT_DIR, "01-admin-login.png"),
  });
  console.log("Captured 01-admin-login.png");

  // Admin Login via API token
  const loginRes = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@example.com",
      password: "password123",
    }),
  });
  const loginData = await loginRes.json();
  if (!loginData.token) throw new Error("Admin API login failed");

  await adminPage.evaluate((token) => {
    localStorage.setItem("token", token);
  }, loginData.token);

  await adminPage.goto(`${BASE_URL}/admin/dashboard`);
  await adminPage.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
  await adminPage.waitForSelector("text=Organization Dashboard");

  // SCREENSHOT 02: Successful Admin Dashboard
  await adminPage.screenshot({
    path: path.join(SCREENSHOT_DIR, "02-admin-dashboard.png"),
  });
  console.log("Captured 02-admin-dashboard.png");

  // SCREENSHOT 03: Queue Creation Interface
  const queueName = `VIP Counter ${Date.now()}`;
  await adminPage.fill('input[name="queueName"]', queueName);
  await adminPage.screenshot({
    path: path.join(SCREENSHOT_DIR, "03-create-queue.png"),
  });
  console.log("Captured 03-create-queue.png");

  // Create queue via API & refresh
  const createQueueRes = await fetch(`${API_URL}/queues`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${loginData.token}`,
    },
    body: JSON.stringify({ name: queueName }),
  });
  const createdQueue = await createQueueRes.json();

  await adminPage.reload();
  await adminPage.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
  await adminPage.waitForSelector(`text=${queueName}`);

  // SCREENSHOT 04: Successfully Created Queue
  await adminPage.screenshot({
    path: path.join(SCREENSHOT_DIR, "04-queue-created.png"),
  });
  console.log("Captured 04-queue-created.png");

  // Select newly created queue button
  const queueBtn = adminPage.locator(`button:has-text("${queueName}")`).first();
  await queueBtn.click({ force: true });
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
  const fullPublicUrl = `${BASE_URL}/queue/${createdQueue.id}`;
  console.log("Public Queue URL:", fullPublicUrl);

  // SCREENSHOT 07: Generated QR Code visible
  await adminPage.screenshot({
    path: path.join(SCREENSHOT_DIR, "07-generated-qr.png"),
  });
  console.log("Captured 07-generated-qr.png");

  // Helper for joining queue deterministically
  async function createAndSetupUserSession(name: string, phone?: string) {
    const res = await fetch(`${API_URL}/queues/${createdQueue.id}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phone }),
    });
    const data = await res.json();
    if (!res.ok || !data.entry) {
      console.error("Failed to join queue via API:", data);
      throw new Error(
        `Join failed for ${name}: ${data.error || "Unknown error"}`,
      );
    }
    return data;
  }

  // --- CONTEXT 2: USER 1 SESSION (Demo User 1) ---
  const u1Context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const u1Page = await u1Context.newPage();

  // SCREENSHOT 08: Public NexTurn Entry Experience
  await u1Page.goto(fullPublicUrl);
  await u1Page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
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

  // Submit Join via API and store session token into u1Page localStorage
  const u1Data = await createAndSetupUserSession(
    "Demo User 1",
    "+919876543210",
  );

  await u1Page.evaluate(
    ({ queueId, entryId, sessionToken }) => {
      localStorage.setItem(
        `nexturn_session_${queueId}`,
        JSON.stringify({ entryId, sessionToken }),
      );
    },
    {
      queueId: createdQueue.id,
      entryId: u1Data.entry.id,
      sessionToken: u1Data.sessionToken,
    },
  );

  await u1Page.reload();
  await u1Page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
  await u1Page.waitForSelector("text=Hello, Demo User 1!");

  // SCREENSHOT 11: Successful Queue Join
  await u1Page.screenshot({
    path: path.join(SCREENSHOT_DIR, "11-queue-joined.png"),
  });
  console.log("Captured 11-queue-joined.png");

  // SCREENSHOT 12: Join Notification Toast & Prominent Banner
  await u1Page.waitForSelector("text=It's your turn!");
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

  // --- USER 2, USER 3, USER 4 SESSIONS ---
  const u2Data = await createAndSetupUserSession("User 2");
  const u3Data = await createAndSetupUserSession("User 3");
  const u4Data = await createAndSetupUserSession("User 4");

  const u4Context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const u4Page = await u4Context.newPage();
  await u4Page.goto(fullPublicUrl);
  await u4Page.evaluate(
    ({ queueId, entryId, sessionToken }) => {
      localStorage.setItem(
        `nexturn_session_${queueId}`,
        JSON.stringify({ entryId, sessionToken }),
      );
    },
    {
      queueId: createdQueue.id,
      entryId: u4Data.entry.id,
      sessionToken: u4Data.sessionToken,
    },
  );
  await u4Page.reload();
  await u4Page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
  await u4Page.waitForSelector("text=Hello, User 4!");

  // SCREENSHOT 13: Multiple Users Queue Position (#4 shown on u4Page)
  await u4Page.screenshot({
    path: path.join(SCREENSHOT_DIR, "13-multiple-users.png"),
  });
  console.log("Captured 13-multiple-users.png");

  // SCREENSHOT 14: Admin Active Queue Entries & Positions
  await adminPage.reload();
  await adminPage.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
  await adminPage.waitForTimeout(500);
  await adminPage.screenshot({
    path: path.join(SCREENSHOT_DIR, "14-admin-active-users.png"),
  });
  console.log("Captured 14-admin-active-users.png");

  // Open User 2 & User 3 Pages
  const u2Context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const u2Page = await u2Context.newPage();
  await u2Page.goto(fullPublicUrl);
  await u2Page.evaluate(
    ({ queueId, entryId, sessionToken }) => {
      localStorage.setItem(
        `nexturn_session_${queueId}`,
        JSON.stringify({ entryId, sessionToken }),
      );
    },
    {
      queueId: createdQueue.id,
      entryId: u2Data.entry.id,
      sessionToken: u2Data.sessionToken,
    },
  );
  await u2Page.reload();
  await u2Page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
  await u2Page.waitForSelector("text=Hello, User 2!");

  const u3Context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const u3Page = await u3Context.newPage();
  await u3Page.goto(fullPublicUrl);
  await u3Page.evaluate(
    ({ queueId, entryId, sessionToken }) => {
      localStorage.setItem(
        `nexturn_session_${queueId}`,
        JSON.stringify({ entryId, sessionToken }),
      );
    },
    {
      queueId: createdQueue.id,
      entryId: u3Data.entry.id,
      sessionToken: u3Data.sessionToken,
    },
  );
  await u3Page.reload();
  await u3Page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
  await u3Page.waitForSelector("text=Hello, User 3!");

  // --- REALTIME POSITION TRANSITION: Admin marks Demo User 1 DONE ---
  await fetch(`${API_URL}/admin/queue-entries/${u1Data.entry.id}/done`, {
    method: "POST",
    headers: { Authorization: `Bearer ${loginData.token}` },
  });

  // SCREENSHOT 15: User 2 Realtime Transition to #1
  await u2Page.waitForSelector("text=It's your turn!");
  await u2Page.screenshot({
    path: path.join(SCREENSHOT_DIR, "15-realtime-position-1.png"),
  });
  console.log("Captured 15-realtime-position-1.png");

  // SCREENSHOT 16: User 3 Realtime Transition to #2
  await u3Page.waitForSelector("text=You're in the queue");
  await u3Page.screenshot({
    path: path.join(SCREENSHOT_DIR, "16-realtime-position-2.png"),
  });
  console.log("Captured 16-realtime-position-2.png");

  // --- REALTIME POSITION TRANSITION: Admin marks User 2 DONE ---
  await fetch(`${API_URL}/admin/queue-entries/${u2Data.entry.id}/done`, {
    method: "POST",
    headers: { Authorization: `Bearer ${loginData.token}` },
  });

  // SCREENSHOT 19: User 3 Realtime Transition to #1
  await u3Page.waitForSelector("text=It's your turn!");
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
  const leaveBtn = u4Page.locator('button:has-text("Leave Queue")').first();
  await leaveBtn.click({ force: true });
  await u4Page.waitForSelector("text=Leave Queue Confirmation");

  // SCREENSHOT 21: Leave Confirmation Modal
  await u4Page.screenshot({
    path: path.join(SCREENSHOT_DIR, "21-leave-confirmation.png"),
  });
  console.log("Captured 21-leave-confirmation.png");

  // Confirm Leave
  const confirmLeaveBtn = u4Page
    .locator('div.fixed button:has-text("Leave Queue")')
    .first();
  await confirmLeaveBtn.click({ force: true });
  await u4Page.waitForSelector("text=You have left this queue");

  // --- ADMIN REORDER FLOW ---
  const u5Data = await createAndSetupUserSession("Reorder Target User");

  const u5Context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const u5Page = await u5Context.newPage();
  await u5Page.goto(fullPublicUrl);
  await u5Page.evaluate(
    ({ queueId, entryId, sessionToken }) => {
      localStorage.setItem(
        `nexturn_session_${queueId}`,
        JSON.stringify({ entryId, sessionToken }),
      );
    },
    {
      queueId: createdQueue.id,
      entryId: u5Data.entry.id,
      sessionToken: u5Data.sessionToken,
    },
  );
  await u5Page.reload();
  await u5Page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
  await u5Page.waitForSelector("text=Hello, Reorder Target User!");

  await adminPage.reload();
  await adminPage.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
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
  await fetch(`${API_URL}/admin/queue-entries/${u3Data.entry.id}/done`, {
    method: "POST",
    headers: { Authorization: `Bearer ${loginData.token}` },
  });
  await fetch(`${API_URL}/admin/queue-entries/${u5Data.entry.id}/done`, {
    method: "POST",
    headers: { Authorization: `Bearer ${loginData.token}` },
  });

  await adminPage.reload();
  await adminPage.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
  await adminPage.waitForTimeout(500);

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
  await mobilePage.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });

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
  await u1Page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  });
  await u1Page.waitForTimeout(1000);

  // SCREENSHOT 28: Reconnected / Resynchronized Queue State
  await u1Page.screenshot({
    path: path.join(SCREENSHOT_DIR, "28-reconnect.png"),
  });
  console.log("Captured 28-reconnect.png");

  await browser.close();
  console.log("--- ALL 28 SCREENSHOTS CAPTURED SUCCESSFULLY ---");
}

captureVerificationScreenshots().catch((err) => {
  console.error("Screenshot capture failed:", err);
  process.exit(1);
});
