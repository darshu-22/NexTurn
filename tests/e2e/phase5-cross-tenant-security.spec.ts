import { test, expect } from "@playwright/test";
import { io, Socket } from "../../apps/web/node_modules/socket.io-client";
import { seedCrossTenantFixtures } from "../fixtures/seed-cross-tenant-fixtures";
import fs from "fs";
import path from "path";
import jwt from "jsonwebtoken";

const API_BASE = "http://localhost:4000/api";
const SOCKET_URL = "http://localhost:4000";
const WEB_BASE = "http://localhost:3000";

// Safely load local test JWT_SECRET without exposing secrets
let jwtSecret = process.env.JWT_SECRET || "";
if (!jwtSecret) {
  const envTestPath = path.resolve(__dirname, "../../.env.test.local");
  if (fs.existsSync(envTestPath)) {
    const content = fs.readFileSync(envTestPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^JWT_SECRET=(.*)$/);
      if (match) {
        jwtSecret = match[1].trim().replace(/^["']|["']$/g, "");
        break;
      }
    }
  }
}
if (!jwtSecret) {
  jwtSecret = "fallback-secret-do-not-use-in-prod";
}

test.describe("Phase 5 — Multi-Tenant Cross-Tenant Security Boundary Verification", () => {
  let adminTokenA: string;
  let adminTokenB: string;
  let userTokenA: string;
  let userTokenB: string;
  let superAdminToken: string;

  test.beforeAll(async ({ request }) => {
    // 1. Synchronize idempotent cross-tenant test fixtures
    await seedCrossTenantFixtures();

    // 2. Obtain genuine JWT tokens via API login
    // Admin A (Tenant A)
    const resAdminA = await request.post(`${API_BASE}/auth/login`, {
      data: { email: "admin-a@example.com", password: "password123" },
    });
    expect(resAdminA.status()).toBe(200);
    const dataAdminA = await resAdminA.json();
    adminTokenA = dataAdminA.token;
    expect(dataAdminA.tenantId).toBe("tenant-cross-a");

    // Admin B (Tenant B)
    const resAdminB = await request.post(`${API_BASE}/auth/login`, {
      data: { email: "admin-b@example.com", password: "password123" },
    });
    expect(resAdminB.status()).toBe(200);
    const dataAdminB = await resAdminB.json();
    adminTokenB = dataAdminB.token;
    expect(dataAdminB.tenantId).toBe("tenant-cross-b");

    // User A (Tenant A)
    const resUserA = await request.post(`${API_BASE}/auth/login`, {
      data: { email: "user-a@example.com", password: "password123" },
    });
    expect(resUserA.status()).toBe(200);
    userTokenA = (await resUserA.json()).token;

    // User B (Tenant B)
    const resUserB = await request.post(`${API_BASE}/auth/login`, {
      data: { email: "user-b@example.com", password: "password123" },
    });
    expect(resUserB.status()).toBe(200);
    userTokenB = (await resUserB.json()).token;

    // Baseline Super Admin (Tenant Demo)
    const resSuperAdmin = await request.post(`${API_BASE}/auth/login`, {
      data: { email: "superadmin@example.com", password: "password123" },
    });
    expect(resSuperAdmin.status()).toBe(200);
    superAdminToken = (await resSuperAdmin.json()).token;
  });

  test("1. Positive Ownership: Admin A and Admin B can list and access their own queues", async ({
    request,
  }) => {
    // Admin A lists own queues
    const resA = await request.get(`${API_BASE}/queues`, {
      headers: { Authorization: `Bearer ${adminTokenA}` },
    });
    expect(resA.status()).toBe(200);
    const queuesA = await resA.json();
    const queueIdsA = queuesA.map((q: any) => q.id);
    expect(queueIdsA).toContain("queue-cross-a");
    expect(queueIdsA).not.toContain("queue-cross-b");
    // Verify 100% of returned queues belong exclusively to Tenant A
    expect(queuesA.every((q: any) => q.tenantId === "tenant-cross-a")).toBe(
      true,
    );

    // Admin B lists own queues
    const resB = await request.get(`${API_BASE}/queues`, {
      headers: { Authorization: `Bearer ${adminTokenB}` },
    });
    expect(resB.status()).toBe(200);
    const queuesB = await resB.json();
    const queueIdsB = queuesB.map((q: any) => q.id);
    expect(queueIdsB).toContain("queue-cross-b");
    expect(queueIdsB).not.toContain("queue-cross-a");
    // Verify 100% of returned queues belong exclusively to Tenant B
    expect(queuesB.every((q: any) => q.tenantId === "tenant-cross-b")).toBe(
      true,
    );

    // Admin A retrieves own queue entries
    const entriesResA = await request.get(
      `${API_BASE}/queues/queue-cross-a/entries`,
      {
        headers: { Authorization: `Bearer ${adminTokenA}` },
      },
    );
    expect(entriesResA.status()).toBe(200);
    const dataEntriesA = await entriesResA.json();
    expect(dataEntriesA.queueId).toBe("queue-cross-a");
    expect(
      dataEntriesA.entries.some((e: any) => e.id === "entry-cross-a1"),
    ).toBe(true);
    expect(
      dataEntriesA.entries.every((e: any) => e.tenantId === "tenant-cross-a"),
    ).toBe(true);

    // Admin B retrieves own queue entries
    const entriesResB = await request.get(
      `${API_BASE}/queues/queue-cross-b/entries`,
      {
        headers: { Authorization: `Bearer ${adminTokenB}` },
      },
    );
    expect(entriesResB.status()).toBe(200);
    const dataEntriesB = await entriesResB.json();
    expect(dataEntriesB.queueId).toBe("queue-cross-b");
    expect(
      dataEntriesB.entries.some((e: any) => e.id === "entry-cross-b1"),
    ).toBe(true);
    expect(
      dataEntriesB.entries.every((e: any) => e.tenantId === "tenant-cross-b"),
    ).toBe(true);
  });

  test("2. Negative Cross-Tenant Queue Isolation: Cross-tenant queue queries are blocked (404)", async ({
    request,
  }) => {
    // Admin A attempts to access Tenant B's queue entries
    const crossResA = await request.get(
      `${API_BASE}/queues/queue-cross-b/entries`,
      {
        headers: { Authorization: `Bearer ${adminTokenA}` },
      },
    );
    expect(crossResA.status()).toBe(404);
    const bodyA = await crossResA.json();
    expect(bodyA.error).toContain("Queue not found or tenant access denied");

    // Admin B attempts to access Tenant A's queue entries
    const crossResB = await request.get(
      `${API_BASE}/queues/queue-cross-a/entries`,
      {
        headers: { Authorization: `Bearer ${adminTokenB}` },
      },
    );
    expect(crossResB.status()).toBe(404);
    const bodyB = await crossResB.json();
    expect(bodyB.error).toContain("Queue not found or tenant access denied");
  });

  test("3. IDOR Attack: Admin A cannot complete, remove, or reorder Tenant B's queue entries", async ({
    request,
  }) => {
    // Attack 1: Admin A attempts to mark Tenant B entry as DONE
    const doneRes = await request.post(
      `${API_BASE}/admin/queue-entries/entry-cross-b1/done`,
      {
        headers: { Authorization: `Bearer ${adminTokenA}` },
      },
    );
    expect(doneRes.status()).toBe(404);
    const doneBody = await doneRes.json();
    expect(doneBody.error).toContain(
      "Queue entry not found or tenant access denied",
    );

    // Attack 2: Admin A attempts to remove Tenant B entry
    const removeRes = await request.post(
      `${API_BASE}/admin/queue-entries/entry-cross-b1/remove`,
      {
        headers: { Authorization: `Bearer ${adminTokenA}` },
      },
    );
    expect(removeRes.status()).toBe(404);
    const removeBody = await removeRes.json();
    expect(removeBody.error).toContain(
      "Queue entry not found or tenant access denied",
    );

    // Attack 3: Admin A attempts to reorder Tenant B entry
    const reorderRes = await request.post(
      `${API_BASE}/admin/queue-entries/entry-cross-b1/reorder`,
      {
        headers: { Authorization: `Bearer ${adminTokenA}` },
        data: { targetPosition: 2 },
      },
    );
    expect(reorderRes.status()).toBe(404);
    const reorderBody = await reorderRes.json();
    expect(reorderBody.error).toContain(
      "Queue entry not found or tenant access denied",
    );

    // Verification: Tenant B's entry was NOT mutated by unauthorized requests
    const verifyRes = await request.get(
      `${API_BASE}/queues/queue-cross-b/entries`,
      {
        headers: { Authorization: `Bearer ${adminTokenB}` },
      },
    );
    expect(verifyRes.status()).toBe(200);
    const verifyData = await verifyRes.json();
    const entryB1 = verifyData.entries.find(
      (e: any) => e.id === "entry-cross-b1",
    );
    expect(entryB1).toBeDefined();
    expect(entryB1.status).toBe("WAITING");
    expect(entryB1.position).toBe(1);
  });

  test("4. Cross-Tenant Entry Read & User Action Isolation (403)", async ({
    request,
  }) => {
    // Admin A attempts to read Tenant B entry via /api/queue-entries/:id
    const readRes = await request.get(
      `${API_BASE}/queue-entries/entry-cross-b1`,
      {
        headers: { Authorization: `Bearer ${adminTokenA}` },
      },
    );
    expect(readRes.status()).toBe(403);
    const readBody = await readRes.json();
    expect(readBody.error).toContain(
      "Forbidden: Access denied to this queue entry",
    );

    // Admin A attempts to self-complete Tenant B entry
    const adminDoneRes = await request.post(
      `${API_BASE}/queue-entries/entry-cross-b1/done`,
      {
        headers: { Authorization: `Bearer ${adminTokenA}` },
      },
    );
    expect(adminDoneRes.status()).toBe(403);
    const adminDoneBody = await adminDoneRes.json();
    expect(adminDoneBody.error).toContain(
      "Forbidden: Access denied to complete this entry",
    );

    // Admin A attempts to self-cancel Tenant B entry
    const adminCancelRes = await request.post(
      `${API_BASE}/queue-entries/entry-cross-b1/cancel`,
      {
        headers: { Authorization: `Bearer ${adminTokenA}` },
      },
    );
    expect(adminCancelRes.status()).toBe(403);
    const adminCancelBody = await adminCancelRes.json();
    expect(adminCancelBody.error).toContain(
      "Forbidden: Access denied to cancel this entry",
    );

    // User A (from Tenant A) attempts to read Tenant B entry
    const userAReadRes = await request.get(
      `${API_BASE}/queue-entries/entry-cross-b1`,
      {
        headers: { Authorization: `Bearer ${userTokenA}` },
      },
    );
    expect(userAReadRes.status()).toBe(403);
    expect((await userAReadRes.json()).error).toContain(
      "Forbidden: Access denied to this queue entry",
    );

    // P1: User A attempts to mark Tenant B entry as DONE
    const userDoneRes = await request.post(
      `${API_BASE}/queue-entries/entry-cross-b1/done`,
      {
        headers: { Authorization: `Bearer ${userTokenA}` },
      },
    );
    expect(userDoneRes.status()).toBe(403);
    expect((await userDoneRes.json()).error).toContain(
      "Forbidden: Access denied to complete this entry",
    );

    // P1: User A attempts to cancel Tenant B entry
    const userCancelRes = await request.post(
      `${API_BASE}/queue-entries/entry-cross-b1/cancel`,
      {
        headers: { Authorization: `Bearer ${userTokenA}` },
      },
    );
    expect(userCancelRes.status()).toBe(403);
    expect((await userCancelRes.json()).error).toContain(
      "Forbidden: Access denied to cancel this entry",
    );

    // P1: Confirm database persistence - Entry B1 remains WAITING and untouched
    const verifyResB = await request.get(
      `${API_BASE}/queues/queue-cross-b/entries`,
      {
        headers: { Authorization: `Bearer ${adminTokenB}` },
      },
    );
    expect(verifyResB.status()).toBe(200);
    const entryB1 = (await verifyResB.json()).entries.find(
      (e: any) => e.id === "entry-cross-b1",
    );
    expect(entryB1.status).toBe("WAITING");
    expect(entryB1.position).toBe(1);

    // P1: Confirm Entry A1 is not accidentally mutated
    const verifyResA = await request.get(
      `${API_BASE}/queues/queue-cross-a/entries`,
      {
        headers: { Authorization: `Bearer ${adminTokenA}` },
      },
    );
    expect(verifyResA.status()).toBe(200);
    const entryA1 = (await verifyResA.json()).entries.find(
      (e: any) => e.id === "entry-cross-a1",
    );
    expect(entryA1.status).toBe("WAITING");
    expect(entryA1.position).toBe(1);
  });

  test("5. Super Admin Cross-Tenant User Management Restrictions", async ({
    request,
  }) => {
    // Baseline Super Admin (belongs to tenant-demo-1) lists admins
    const superAdminRes = await request.get(`${API_BASE}/super-admin/admins`, {
      headers: { Authorization: `Bearer ${superAdminToken}` },
    });
    expect(superAdminRes.status()).toBe(200);
    const admins = await superAdminRes.json();
    const adminEmails = admins.map((a: any) => a.email);

    // Verified: Admins of Tenant A and Tenant B are NOT visible to Super Admin of tenant-demo-1
    expect(adminEmails).not.toContain("admin-a@example.com");
    expect(adminEmails).not.toContain("admin-b@example.com");

    // Attack: Super Admin of tenant-demo-1 attempts to modify status of Admin A (tenant-cross-a)
    const patchRes = await request.patch(
      `${API_BASE}/super-admin/admins/admin-cross-a/status`,
      {
        headers: { Authorization: `Bearer ${superAdminToken}` },
        data: { status: "INACTIVE" },
      },
    );
    expect(patchRes.status()).toBe(403);
    const patchBody = await patchRes.json();
    expect(patchBody.error).toContain(
      "Forbidden: Target user not found or access denied",
    );
  });

  test("6. Negative Authentication & Token Tampering: Forged, tampered, and expired JWTs are rejected (403)", async ({
    request,
  }) => {
    // 1. Malformed token string
    const malformedRes = await request.get(`${API_BASE}/queues`, {
      headers: { Authorization: "Bearer malformed.corrupted.token" },
    });
    expect(malformedRes.status()).toBe(403);
    expect((await malformedRes.json()).error).toContain(
      "Forbidden: Invalid token",
    );

    // 2. Modified tenant claim signed with an attacker's key
    const tamperedTenantToken = jwt.sign(
      { id: "admin-cross-a", tenantId: "tenant-cross-b", role: "ADMIN" },
      "untrusted-attacker-secret-key-12345",
    );
    const tamperedRes = await request.get(`${API_BASE}/queues`, {
      headers: { Authorization: `Bearer ${tamperedTenantToken}` },
    });
    expect(tamperedRes.status()).toBe(403);
    expect((await tamperedRes.json()).error).toContain(
      "Forbidden: Invalid token",
    );

    // 3. Forged signature (correct claims, wrong signature secret)
    const forgedSigToken = jwt.sign(
      { id: "admin-cross-a", tenantId: "tenant-cross-a", role: "ADMIN" },
      "forged-signature-key-56789",
    );
    const forgedRes = await request.get(`${API_BASE}/queues`, {
      headers: { Authorization: `Bearer ${forgedSigToken}` },
    });
    expect(forgedRes.status()).toBe(403);
    expect((await forgedRes.json()).error).toContain(
      "Forbidden: Invalid token",
    );

    // 4. Expired token (signed with valid JWT secret but negative expiration)
    const expiredToken = jwt.sign(
      { id: "admin-cross-a", tenantId: "tenant-cross-a", role: "ADMIN" },
      jwtSecret,
      { expiresIn: "-10s" },
    );
    const expiredRes = await request.get(`${API_BASE}/queues`, {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    expect(expiredRes.status()).toBe(403);
    expect((await expiredRes.json()).error).toContain(
      "Forbidden: Invalid token",
    );
  });

  test("7. Queue Creation Tenant Injection Defense: Admin A cannot create queue under Tenant B", async ({
    request,
  }) => {
    // Admin A sends queue creation request containing injected foreign tenantId
    const createRes = await request.post(`${API_BASE}/queues`, {
      headers: { Authorization: `Bearer ${adminTokenA}` },
      data: {
        name: "Queue Alpha Injected Test",
        tenantId: "tenant-cross-b", // Attacker injection attempt
      },
    });
    expect(createRes.status()).toBe(201);
    const createdQueue = await createRes.json();
    expect(createdQueue.name).toBe("Queue Alpha Injected Test");
    // Verify server forced tenantId to authenticated Admin A's tenant (ignoring payload tenantId)
    expect(createdQueue.tenantId).toBe("tenant-cross-a");

    // Admin B lists queues and does NOT see the newly created queue
    const listResB = await request.get(`${API_BASE}/queues`, {
      headers: { Authorization: `Bearer ${adminTokenB}` },
    });
    expect(listResB.status()).toBe(200);
    const queuesB = await listResB.json();
    expect(queuesB.some((q: any) => q.id === createdQueue.id)).toBe(false);

    // Admin B cannot access entries of the newly created queue (404)
    const entriesResB = await request.get(
      `${API_BASE}/queues/${createdQueue.id}/entries`,
      {
        headers: { Authorization: `Bearer ${adminTokenB}` },
      },
    );
    expect(entriesResB.status()).toBe(404);
  });

  test("8. Unauthenticated requests are rejected across all sensitive endpoints (401)", async ({
    request,
  }) => {
    // Missing tokens
    expect((await request.get(`${API_BASE}/queues`)).status()).toBe(401);
    expect(
      (
        await request.post(`${API_BASE}/queues`, {
          data: { name: "Unauth Queue" },
        })
      ).status(),
    ).toBe(401);
    expect(
      (await request.get(`${API_BASE}/queues/queue-cross-a/entries`)).status(),
    ).toBe(401);
    expect(
      (
        await request.post(
          `${API_BASE}/admin/queue-entries/entry-cross-a1/done`,
        )
      ).status(),
    ).toBe(401);
    expect(
      (
        await request.post(
          `${API_BASE}/admin/queue-entries/entry-cross-a1/remove`,
        )
      ).status(),
    ).toBe(401);
    expect(
      (
        await request.post(
          `${API_BASE}/admin/queue-entries/entry-cross-a1/reorder`,
          {
            data: { targetPosition: 1 },
          },
        )
      ).status(),
    ).toBe(401);
    expect(
      (await request.get(`${API_BASE}/queue-entries/entry-cross-a1`)).status(),
    ).toBe(401);
    expect(
      (
        await request.post(`${API_BASE}/super-admin/admins`, {
          data: {
            name: "Unauth Admin",
            email: "unauth@example.com",
            password: "password123",
          },
        })
      ).status(),
    ).toBe(401);
  });

  test("9. Socket.IO Admin Room Real-Time Isolation: Broadcast updates strictly isolated across tenants", async ({
    request,
  }) => {
    let socketA: Socket | null = null;
    let socketB: Socket | null = null;

    try {
      // Connect authenticated Socket client for Admin A
      socketA = io(SOCKET_URL, {
        transports: ["websocket"],
        autoConnect: true,
      });

      // Connect authenticated Socket client for Admin B
      socketB = io(SOCKET_URL, {
        transports: ["websocket"],
        autoConnect: true,
      });

      await new Promise<void>((resolve) => {
        let connectedCount = 0;
        const checkDone = () => {
          connectedCount++;
          if (connectedCount === 2) resolve();
        };
        socketA!.on("connect", checkDone);
        socketB!.on("connect", checkDone);
      });

      // Verification A: Cross-tenant room join attacks are rejected
      const crossTenantErrorPromiseA = new Promise<string>((resolve) => {
        socketA!.on("error", (err: any) => resolve(err.message));
      });
      socketA.emit("join_admin_room", {
        queueId: "queue-cross-b",
        token: adminTokenA,
      });
      expect(await crossTenantErrorPromiseA).toBe(
        "Cross-tenant access blocked",
      );

      const crossTenantErrorPromiseB = new Promise<string>((resolve) => {
        socketB!.on("error", (err: any) => resolve(err.message));
      });
      socketB.emit("join_admin_room", {
        queueId: "queue-cross-a",
        token: adminTokenB,
      });
      expect(await crossTenantErrorPromiseB).toBe(
        "Cross-tenant access blocked",
      );

      // Verification B: Establish authorized room subscriptions for both clients
      const subPromiseA = new Promise<any>((resolve) => {
        socketA!.once("queue:admin_updated", (data: any) => resolve(data));
      });
      socketA.emit("join_admin_room", {
        queueId: "queue-cross-a",
        token: adminTokenA,
      });
      const initialA = await subPromiseA;
      expect(initialA.queueId).toBe("queue-cross-a");

      const subPromiseB = new Promise<any>((resolve) => {
        socketB!.once("queue:admin_updated", (data: any) => resolve(data));
      });
      socketB.emit("join_admin_room", {
        queueId: "queue-cross-b",
        token: adminTokenB,
      });
      const initialB = await subPromiseB;
      expect(initialB.queueId).toBe("queue-cross-b");

      // Verification C: P1 Test - Start listeners BEFORE mutation, trigger REAL mutation on Queue A
      const receivedOnBFromA: any[] = [];
      const listenerBForA = (data: any) => {
        if (data.queueId === "queue-cross-a") {
          receivedOnBFromA.push(data);
        }
      };
      socketB.on("queue:admin_updated", listenerBForA);

      const socketAEventPromise = new Promise<any>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Timeout waiting for Socket A broadcast")),
          5000,
        );
        socketA!.once("queue:admin_updated", (data: any) => {
          if (data.queueId === "queue-cross-a") {
            clearTimeout(timer);
            resolve(data);
          }
        });
      });

      // Trigger authorized mutation on Queue A via API (reorder entry A2 to position 1)
      const reorderResA = await request.post(
        `${API_BASE}/admin/queue-entries/entry-cross-a2/reorder`,
        {
          headers: { Authorization: `Bearer ${adminTokenA}` },
          data: { targetPosition: 1 },
        },
      );
      expect(reorderResA.status()).toBe(200);

      // Assert Socket A receives the broadcast event for Queue A
      const broadcastDataA = await socketAEventPromise;
      expect(broadcastDataA.queueId).toBe("queue-cross-a");
      expect(broadcastDataA.entries.length).toBeGreaterThanOrEqual(1);

      // Assert Socket B receives ZERO events from Queue A over a bounded window
      await new Promise((r) => setTimeout(r, 1000));
      expect(receivedOnBFromA.length).toBe(0);
      socketB.off("queue:admin_updated", listenerBForA);

      // Verification D: Positive control on Queue B in opposite direction
      const receivedOnAFromB: any[] = [];
      const listenerAForB = (data: any) => {
        if (data.queueId === "queue-cross-b") {
          receivedOnAFromB.push(data);
        }
      };
      socketA.on("queue:admin_updated", listenerAForB);

      const socketBEventPromise = new Promise<any>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Timeout waiting for Socket B broadcast")),
          5000,
        );
        socketB!.once("queue:admin_updated", (data: any) => {
          if (data.queueId === "queue-cross-b") {
            clearTimeout(timer);
            resolve(data);
          }
        });
      });

      // Trigger authorized mutation on Queue B via API (reorder entry B2 to position 1)
      const reorderResB = await request.post(
        `${API_BASE}/admin/queue-entries/entry-cross-b2/reorder`,
        {
          headers: { Authorization: `Bearer ${adminTokenB}` },
          data: { targetPosition: 1 },
        },
      );
      expect(reorderResB.status()).toBe(200);

      // Assert Socket B receives the broadcast event for Queue B
      const broadcastDataB = await socketBEventPromise;
      expect(broadcastDataB.queueId).toBe("queue-cross-b");

      // Assert Socket A receives ZERO events from Queue B
      await new Promise((r) => setTimeout(r, 1000));
      expect(receivedOnAFromB.length).toBe(0);
      socketA.off("queue:admin_updated", listenerAForB);
    } finally {
      if (socketA) socketA.disconnect();
      if (socketB) socketB.disconnect();
    }
  });

  test("10. Socket.IO Public Room & Session Token Isolation", async () => {
    let customerSocket: Socket | null = null;

    try {
      customerSocket = io(SOCKET_URL, {
        transports: ["websocket"],
        autoConnect: true,
      });

      await new Promise<void>((resolve) => {
        customerSocket!.on("connect", () => resolve());
      });

      // 1. Authorized Public Room Join: Valid session token for Entry A1
      const authorizedPublicPromise = new Promise<any>((resolve) => {
        customerSocket!.once("queue:status_updated", (data: any) =>
          resolve(data),
        );
      });
      customerSocket.emit("join_public_room", {
        entryId: "entry-cross-a1",
        sessionToken: "token-cross-a1",
      });
      const statusData = await authorizedPublicPromise;
      expect(statusData.entry.id).toBe("entry-cross-a1");
      expect(statusData.queueName).toBe("Queue Alpha");

      // 2. Cross-Entry Attack: Session token A1 attempting to join Entry B1 room
      const crossEntryErrorPromise = new Promise<string>((resolve) => {
        customerSocket!.once("error", (err: any) => resolve(err.message));
      });
      customerSocket.emit("join_public_room", {
        entryId: "entry-cross-b1",
        sessionToken: "token-cross-a1",
      });
      expect(await crossEntryErrorPromise).toBe("Unauthorized entry access");

      // 3. Forged Session Token Attack: Invalid session token
      const invalidTokenErrorPromise = new Promise<string>((resolve) => {
        customerSocket!.once("error", (err: any) => resolve(err.message));
      });
      customerSocket.emit("join_public_room", {
        entryId: "entry-cross-a1",
        sessionToken: "forged-invalid-session-token",
      });
      expect(await invalidTokenErrorPromise).toBe("Unauthorized entry access");

      // 4. Unauthorized request_sync test: mismatched session token receives no update
      let receivedSyncUpdate = false;
      const syncListener = (data: any) => {
        if (data.entry?.id === "entry-cross-b1") {
          receivedSyncUpdate = true;
        }
      };
      customerSocket.on("queue:status_updated", syncListener);
      customerSocket.emit("request_sync", {
        entryId: "entry-cross-b1",
        sessionToken: "token-cross-a1", // wrong token for entry-cross-b1
      });
      await new Promise((r) => setTimeout(r, 600));
      expect(receivedSyncUpdate).toBe(false);
      customerSocket.off("queue:status_updated", syncListener);
    } finally {
      if (customerSocket) customerSocket.disconnect();
    }
  });

  test("11. User Entry Listing Scope Isolation (GET /api/user/entries)", async ({
    request,
  }) => {
    // User A lists own entries
    const resA = await request.get(`${API_BASE}/user/entries`, {
      headers: { Authorization: `Bearer ${userTokenA}` },
    });
    expect(resA.status()).toBe(200);
    const entriesA = await resA.json();
    // User A sees entry-cross-a1 and entry-cross-a2
    expect(entriesA.some((e: any) => e.id === "entry-cross-a1")).toBe(true);
    // User A does NOT see entry-cross-b1 or entry-cross-b2
    expect(entriesA.some((e: any) => e.id === "entry-cross-b1")).toBe(false);
    expect(entriesA.some((e: any) => e.id === "entry-cross-b2")).toBe(false);

    // User B lists own entries
    const resB = await request.get(`${API_BASE}/user/entries`, {
      headers: { Authorization: `Bearer ${userTokenB}` },
    });
    expect(resB.status()).toBe(200);
    const entriesB = await resB.json();
    // User B sees entry-cross-b1 and entry-cross-b2
    expect(entriesB.some((e: any) => e.id === "entry-cross-b1")).toBe(true);
    // User B does NOT see entry-cross-a1 or entry-cross-a2
    expect(entriesB.some((e: any) => e.id === "entry-cross-a1")).toBe(false);
    expect(entriesB.some((e: any) => e.id === "entry-cross-a2")).toBe(false);
  });

  test("12. Browser UI Multi-Tenant Dashboard Isolation", async ({
    browser,
  }) => {
    // Context A: Admin A logs into NexTurn web dashboard
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    try {
      await pageA.goto(`${WEB_BASE}/admin`);
      await pageA.fill('input[type="email"]', "admin-a@example.com");
      await pageA.fill('input[type="password"]', "password123");
      await pageA.click('button[type="submit"]');

      await pageA.waitForURL("**/admin/dashboard");
      await expect(pageA.locator("text=Organization Dashboard")).toBeVisible();

      // Verified: Tenant A dashboard renders Queue Alpha, but NOT Queue Beta
      await expect(
        pageA.getByRole("heading", { name: "Queue Alpha" }),
      ).toBeVisible();
      await expect(pageA.getByText("Queue Beta")).not.toBeVisible();
    } finally {
      await contextA.close();
    }

    // Context B: Admin B logs into NexTurn web dashboard
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    try {
      await pageB.goto(`${WEB_BASE}/admin`);
      await pageB.fill('input[type="email"]', "admin-b@example.com");
      await pageB.fill('input[type="password"]', "password123");
      await pageB.click('button[type="submit"]');

      await pageB.waitForURL("**/admin/dashboard");
      await expect(pageB.locator("text=Organization Dashboard")).toBeVisible();

      // Verified: Tenant B dashboard renders Queue Beta, but NOT Queue Alpha
      await expect(
        pageB.getByRole("heading", { name: "Queue Beta" }),
      ).toBeVisible();
      await expect(pageB.getByText("Queue Alpha")).not.toBeVisible();
    } finally {
      await contextB.close();
    }
  });
});
