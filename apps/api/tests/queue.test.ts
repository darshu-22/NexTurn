import dotenv from "dotenv";
dotenv.config();

import request from "supertest";
import jwt from "jsonwebtoken";

const JWT_SECRET =
  process.env.JWT_SECRET || "fallback-secret-do-not-use-in-prod";

// In-Memory Database Store for unit tests
const db = {
  tenants: [
    { id: "tenant-1", name: "Tenant One", slug: "tenant-1" },
    { id: "tenant-2", name: "Tenant Two", slug: "tenant-2" },
  ],
  users: [
    {
      id: "admin-1",
      tenantId: "tenant-1",
      name: "Admin One",
      role: "ORGANIZATION_ADMIN",
      passwordHash: "password123",
      email: "admin1@example.com",
    },
    {
      id: "admin-2",
      tenantId: "tenant-2",
      name: "Admin Two",
      role: "ORGANIZATION_ADMIN",
      passwordHash: "password123",
      email: "admin2@example.com",
    },
    {
      id: "user-1",
      tenantId: "tenant-1",
      name: "User One",
      role: "USER",
      passwordHash: "password123",
      email: "user1@example.com",
    },
  ],
  queues: [
    {
      id: "queue-1",
      tenantId: "tenant-1",
      name: "Main Queue",
      status: "ACTIVE",
      joinEnabled: true,
    },
    {
      id: "queue-2",
      tenantId: "tenant-2",
      name: "Other Queue",
      status: "ACTIVE",
      joinEnabled: true,
    },
    {
      id: "queue-closed",
      tenantId: "tenant-1",
      name: "Closed Queue",
      status: "CLOSED",
      joinEnabled: false,
    },
  ],
  queueEntries: [] as any[],
  queueEvents: [] as any[],
};

// Mock Prisma Client
jest.mock("@prisma/client", () => {
  return {
    PrismaClient: jest.fn().mockImplementation(() => {
      const queueDelegate = {
        findMany: jest.fn().mockImplementation(({ where }) => {
          return Promise.resolve(
            db.queues.filter((q) => q.tenantId === where.tenantId),
          );
        }),
        findUnique: jest.fn().mockImplementation(({ where }) => {
          return Promise.resolve(
            db.queues.find((q) => q.id === where.id) || null,
          );
        }),
        create: jest.fn().mockImplementation(({ data }) => {
          const q = {
            id: `queue-${db.queues.length + 1}`,
            status: "ACTIVE",
            joinEnabled: true,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...data,
          };
          db.queues.push(q);
          return Promise.resolve(q);
        }),
      };

      const queueEntryDelegate = {
        findFirst: jest.fn().mockImplementation(({ where, orderBy }) => {
          let entries = db.queueEntries.filter(
            (e) => e.queueId === where.queueId && e.status === where.status,
          );
          if (orderBy?.position === "desc") {
            entries.sort((a, b) => b.position - a.position);
          }
          return Promise.resolve(entries[0] || null);
        }),
        create: jest.fn().mockImplementation(({ data }) => {
          const entry = {
            id: `entry-${db.queueEntries.length + 1}`,
            createdAt: new Date(),
            updatedAt: new Date(),
            completedAt: null,
            cancelledAt: null,
            ...data,
          };
          db.queueEntries.push(entry);
          return Promise.resolve(entry);
        }),
        findUnique: jest.fn().mockImplementation(({ where, include }) => {
          const entry = db.queueEntries.find((e) => e.id === where.id);
          if (!entry) return Promise.resolve(null);
          if (include?.queue) {
            const queue = db.queues.find((q) => q.id === entry.queueId);
            return Promise.resolve({ ...entry, queue });
          }
          return Promise.resolve(entry);
        }),
        findMany: jest.fn().mockImplementation(({ where, orderBy }) => {
          let entries = db.queueEntries.filter((e) => {
            if (where.queueId && e.queueId !== where.queueId) return false;
            if (where.tenantId && e.tenantId !== where.tenantId) return false;
            if (where.status && e.status !== where.status) return false;
            return true;
          });
          if (orderBy) {
            if (Array.isArray(orderBy)) {
              entries.sort(
                (a, b) =>
                  a.position - b.position ||
                  a.createdAt.getTime() - b.createdAt.getTime(),
              );
            } else if (orderBy.position === "asc") {
              entries.sort((a, b) => a.position - b.position);
            }
          }
          return Promise.resolve([...entries]);
        }),
        update: jest.fn().mockImplementation(({ where, data }) => {
          const index = db.queueEntries.findIndex((e) => e.id === where.id);
          if (index !== -1) {
            db.queueEntries[index] = {
              ...db.queueEntries[index],
              ...data,
              updatedAt: new Date(),
            };
            return Promise.resolve(db.queueEntries[index]);
          }
          return Promise.resolve(null);
        }),
        count: jest.fn().mockImplementation(({ where }) => {
          const count = db.queueEntries.filter((e) => {
            if (e.queueId !== where.queueId) return false;
            if (e.status !== where.status) return false;
            if (
              where.position?.lt !== undefined &&
              e.position >= where.position.lt
            )
              return false;
            return true;
          }).length;
          return Promise.resolve(count);
        }),
      };

      const queueEventDelegate = {
        create: jest.fn().mockImplementation(({ data }) => {
          const event = {
            id: `event-${db.queueEvents.length + 1}`,
            createdAt: new Date(),
            ...data,
          };
          db.queueEvents.push(event);
          return Promise.resolve(event);
        }),
      };

      const mockTx = {
        $executeRaw: jest.fn().mockResolvedValue(1),
        queue: queueDelegate,
        queueEntry: queueEntryDelegate,
        queueEvent: queueEventDelegate,
      };

      return {
        $transaction: jest.fn().mockImplementation(async (callback) => {
          return await callback(mockTx);
        }),
        user: {
          findFirst: jest.fn().mockImplementation(({ where }) => {
            return Promise.resolve(
              db.users.find((u) => u.email === where.email) || null,
            );
          }),
        },
        queue: queueDelegate,
        queueEntry: queueEntryDelegate,
        queueEvent: queueEventDelegate,
      };
    }),
  };
});

import app from "../src/index";

describe("Phase 2 — Queue Management API & Integration Tests", () => {
  let adminTokenTenant1: string;
  let adminTokenTenant2: string;
  let userTokenTenant1: string;

  beforeAll(() => {
    adminTokenTenant1 = jwt.sign(
      { id: "admin-1", tenantId: "tenant-1", role: "ORGANIZATION_ADMIN" },
      JWT_SECRET,
    );
    adminTokenTenant2 = jwt.sign(
      { id: "admin-2", tenantId: "tenant-2", role: "ORGANIZATION_ADMIN" },
      JWT_SECRET,
    );
    userTokenTenant1 = jwt.sign(
      { id: "user-1", tenantId: "tenant-1", role: "USER" },
      JWT_SECRET,
    );
  });

  beforeEach(() => {
    db.queueEntries = [];
    db.queueEvents = [];
  });

  describe("Queue Joining & FCFS Automatic Numbering", () => {
    it("assigns sequential positions (#1, #2, #3) to users joining queue", async () => {
      const res1 = await request(app)
        .post("/api/queues/queue-1/join")
        .send({ name: "Rahul", phone: "9876543210" });
      expect(res1.statusCode).toBe(201);
      expect(res1.body.entry.position).toBe(1);
      expect(res1.body.peopleAhead).toBe(0);
      expect(res1.body.sessionToken).toBeTruthy();

      const res2 = await request(app)
        .post("/api/queues/queue-1/join")
        .send({ name: "Priya", phone: "9876543211" });
      expect(res2.statusCode).toBe(201);
      expect(res2.body.entry.position).toBe(2);
      expect(res2.body.peopleAhead).toBe(1);

      const res3 = await request(app)
        .post("/api/queues/queue-1/join")
        .send({ name: "Arjun", phone: "9876543212" });
      expect(res3.statusCode).toBe(201);
      expect(res3.body.entry.position).toBe(3);
      expect(res3.body.peopleAhead).toBe(2);

      // Verify recorded events
      expect(
        db.queueEvents.filter((e) => e.eventType === "QUEUE_JOINED").length,
      ).toBe(3);
    });

    it("rejects joining closed or non-existent queues", async () => {
      const resClosed = await request(app)
        .post("/api/queues/queue-closed/join")
        .send({ name: "Rahul" });
      expect(resClosed.statusCode).toBe(400);

      const resNotFound = await request(app)
        .post("/api/queues/non-existent-id/join")
        .send({ name: "Rahul" });
      expect(resNotFound.statusCode).toBe(400);
    });
  });

  describe("Session Token Security & Entry Status", () => {
    it("allows a user with a valid session token to view their status", async () => {
      const joinRes = await request(app)
        .post("/api/queues/queue-1/join")
        .send({ name: "Rahul" });
      const { id } = joinRes.body.entry;
      const { sessionToken } = joinRes.body;

      const statusRes = await request(app)
        .get(`/api/queue-entries/${id}`)
        .set("x-session-token", sessionToken);

      expect(statusRes.statusCode).toBe(200);
      expect(statusRes.body.entry.name).toBe("Rahul");
      expect(statusRes.body.entry.position).toBe(1);
    });

    it("blocks unauthorized status view requests without valid session token", async () => {
      const joinRes = await request(app)
        .post("/api/queues/queue-1/join")
        .send({ name: "Rahul" });
      const { id } = joinRes.body.entry;

      // No header
      const resNoHeader = await request(app).get(`/api/queue-entries/${id}`);
      expect(resNoHeader.statusCode).toBe(401);

      // Invalid header token
      const resInvalidToken = await request(app)
        .get(`/api/queue-entries/${id}`)
        .set("x-session-token", "wrong-invalid-token");
      expect(resInvalidToken.statusCode).toBe(403);
    });
  });

  describe("User DONE & LEAVE Flows", () => {
    it("allows user to mark self DONE and recompacts remaining active queue positions", async () => {
      const u1 = await request(app)
        .post("/api/queues/queue-1/join")
        .send({ name: "User A" });
      const u2 = await request(app)
        .post("/api/queues/queue-1/join")
        .send({ name: "User B" });
      const u3 = await request(app)
        .post("/api/queues/queue-1/join")
        .send({ name: "User C" });

      // User A marks self DONE
      const doneRes = await request(app)
        .post(`/api/queue-entries/${u1.body.entry.id}/done`)
        .set("x-session-token", u1.body.sessionToken);
      expect(doneRes.statusCode).toBe(200);
      expect(doneRes.body.entry.status).toBe("COMPLETED");

      // User B should now be #1
      const bStatus = await request(app)
        .get(`/api/queue-entries/${u2.body.entry.id}`)
        .set("x-session-token", u2.body.sessionToken);
      expect(bStatus.body.entry.position).toBe(1);
      expect(bStatus.body.peopleAhead).toBe(0);

      // User C should now be #2
      const cStatus = await request(app)
        .get(`/api/queue-entries/${u3.body.entry.id}`)
        .set("x-session-token", u3.body.sessionToken);
      expect(cStatus.body.entry.position).toBe(2);
      expect(cStatus.body.peopleAhead).toBe(1);
    });

    it("allows user to LEAVE/CANCEL their entry and recompacts remaining queue", async () => {
      const u1 = await request(app)
        .post("/api/queues/queue-1/join")
        .send({ name: "User A" });
      const u2 = await request(app)
        .post("/api/queues/queue-1/join")
        .send({ name: "User B" });
      const u3 = await request(app)
        .post("/api/queues/queue-1/join")
        .send({ name: "User C" });

      // User B leaves
      const cancelRes = await request(app)
        .post(`/api/queue-entries/${u2.body.entry.id}/cancel`)
        .set("x-session-token", u2.body.sessionToken);
      expect(cancelRes.statusCode).toBe(200);
      expect(cancelRes.body.entry.status).toBe("CANCELLED");

      // User A remains #1, User C becomes #2
      const cStatus = await request(app)
        .get(`/api/queue-entries/${u3.body.entry.id}`)
        .set("x-session-token", u3.body.sessionToken);
      expect(cStatus.body.entry.position).toBe(2);
    });
  });

  describe("Admin Operations — View, DONE, REMOVE & REORDER", () => {
    it("allows admin to view active queue entries", async () => {
      await request(app)
        .post("/api/queues/queue-1/join")
        .send({ name: "Rahul" });
      await request(app)
        .post("/api/queues/queue-1/join")
        .send({ name: "Priya" });

      const res = await request(app)
        .get("/api/queues/queue-1/entries")
        .set("Authorization", `Bearer ${adminTokenTenant1}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.entries.length).toBe(2);
      expect(res.body.entries[0].name).toBe("Rahul");
      expect(res.body.entries[1].name).toBe("Priya");
    });

    it("allows admin to mark user DONE", async () => {
      const u1 = await request(app)
        .post("/api/queues/queue-1/join")
        .send({ name: "User A" });
      const u2 = await request(app)
        .post("/api/queues/queue-1/join")
        .send({ name: "User B" });

      const res = await request(app)
        .post(`/api/admin/queue-entries/${u1.body.entry.id}/done`)
        .set("Authorization", `Bearer ${adminTokenTenant1}`);

      expect(res.statusCode).toBe(200);

      // B should move to #1
      const bStatus = await request(app)
        .get(`/api/queue-entries/${u2.body.entry.id}`)
        .set("x-session-token", u2.body.sessionToken);
      expect(bStatus.body.entry.position).toBe(1);
    });

    it("allows admin to REMOVE user", async () => {
      const u1 = await request(app)
        .post("/api/queues/queue-1/join")
        .send({ name: "User A" });
      const u2 = await request(app)
        .post("/api/queues/queue-1/join")
        .send({ name: "User B" });
      const u3 = await request(app)
        .post("/api/queues/queue-1/join")
        .send({ name: "User C" });

      const removeRes = await request(app)
        .post(`/api/admin/queue-entries/${u2.body.entry.id}/remove`)
        .set("Authorization", `Bearer ${adminTokenTenant1}`);

      expect(removeRes.statusCode).toBe(200);
      expect(removeRes.body.entry.status).toBe("CANCELLED");

      // Check C becomes #2
      const cStatus = await request(app)
        .get(`/api/queue-entries/${u3.body.entry.id}`)
        .set("x-session-token", u3.body.sessionToken);
      expect(cStatus.body.entry.position).toBe(2);
    });

    it("allows admin to REORDER user positions without duplicate numbers", async () => {
      const u1 = await request(app)
        .post("/api/queues/queue-1/join")
        .send({ name: "User A" }); // #1
      const u2 = await request(app)
        .post("/api/queues/queue-1/join")
        .send({ name: "User B" }); // #2
      const u3 = await request(app)
        .post("/api/queues/queue-1/join")
        .send({ name: "User C" }); // #3
      const u4 = await request(app)
        .post("/api/queues/queue-1/join")
        .send({ name: "User D" }); // #4

      // Move D (#4) to position #2
      const reorderRes = await request(app)
        .post(`/api/admin/queue-entries/${u4.body.entry.id}/reorder`)
        .set("Authorization", `Bearer ${adminTokenTenant1}`)
        .send({ targetPosition: 2 });

      expect(reorderRes.statusCode).toBe(200);

      // Verify active queue order: User A (#1), User D (#2), User B (#3), User C (#4)
      const listRes = await request(app)
        .get("/api/queues/queue-1/entries")
        .set("Authorization", `Bearer ${adminTokenTenant1}`);

      const positions = listRes.body.entries.map((e: any) => ({
        name: e.name,
        pos: e.position,
      }));
      expect(positions).toEqual([
        { name: "User A", pos: 1 },
        { name: "User D", pos: 2 },
        { name: "User B", pos: 3 },
        { name: "User C", pos: 4 },
      ]);
    });
  });

  describe("Multi-Tenant Security Enforcement", () => {
    it("blocks Tenant A admin from viewing or modifying Tenant B queue entries", async () => {
      // User joins Tenant B queue
      const uB = await request(app)
        .post("/api/queues/queue-2/join")
        .send({ name: "Tenant B User" });

      // Tenant 1 Admin attempts to view Tenant 2 queue
      const viewRes = await request(app)
        .get("/api/queues/queue-2/entries")
        .set("Authorization", `Bearer ${adminTokenTenant1}`);
      expect(viewRes.statusCode).toBe(404);

      // Tenant 1 Admin attempts to mark Tenant 2 entry DONE
      const doneRes = await request(app)
        .post(`/api/admin/queue-entries/${uB.body.entry.id}/done`)
        .set("Authorization", `Bearer ${adminTokenTenant1}`);
      expect(doneRes.statusCode).toBe(404);

      // Tenant 1 Admin attempts to remove Tenant 2 entry
      const removeRes = await request(app)
        .post(`/api/admin/queue-entries/${uB.body.entry.id}/remove`)
        .set("Authorization", `Bearer ${adminTokenTenant1}`);
      expect(removeRes.statusCode).toBe(404);

      // Tenant 1 Admin attempts to reorder Tenant 2 entry
      const reorderRes = await request(app)
        .post(`/api/admin/queue-entries/${uB.body.entry.id}/reorder`)
        .set("Authorization", `Bearer ${adminTokenTenant1}`)
        .send({ targetPosition: 1 });
      expect(reorderRes.statusCode).toBe(404);
    });
  });

  describe("Negative & Edge Case Security Tests", () => {
    it("blocks normal USER role from executing admin APIs", async () => {
      const u = await request(app)
        .post("/api/queues/queue-1/join")
        .send({ name: "User A" });

      const adminDoneRes = await request(app)
        .post(`/api/admin/queue-entries/${u.body.entry.id}/done`)
        .set("Authorization", `Bearer ${userTokenTenant1}`);
      expect(adminDoneRes.statusCode).toBe(403);

      const adminRemoveRes = await request(app)
        .post(`/api/admin/queue-entries/${u.body.entry.id}/remove`)
        .set("Authorization", `Bearer ${userTokenTenant1}`);
      expect(adminRemoveRes.statusCode).toBe(403);

      const adminReorderRes = await request(app)
        .post(`/api/admin/queue-entries/${u.body.entry.id}/reorder`)
        .set("Authorization", `Bearer ${userTokenTenant1}`)
        .send({ targetPosition: 1 });
      expect(adminReorderRes.statusCode).toBe(403);
    });

    it("prevents modifying or re-completing an already completed entry", async () => {
      const u = await request(app)
        .post("/api/queues/queue-1/join")
        .send({ name: "User A" });

      // Mark DONE first time
      await request(app)
        .post(`/api/queue-entries/${u.body.entry.id}/done`)
        .set("x-session-token", u.body.sessionToken);

      // Try marking DONE second time
      const retryDone = await request(app)
        .post(`/api/queue-entries/${u.body.entry.id}/done`)
        .set("x-session-token", u.body.sessionToken);
      expect(retryDone.statusCode).toBe(400);

      // Try cancelling completed entry
      const retryCancel = await request(app)
        .post(`/api/queue-entries/${u.body.entry.id}/cancel`)
        .set("x-session-token", u.body.sessionToken);
      expect(retryCancel.statusCode).toBe(400);
    });
  });

  describe("Phase 3 — Service Duration & ETA Calculations", () => {
    it("sets serviceStartedAt on position #1 upon join", async () => {
      const u1 = await request(app)
        .post("/api/queues/queue-1/join")
        .send({ name: "User A" });
      expect(u1.body.entry.position).toBe(1);
      expect(u1.body.entry.serviceStartedAt).toBeTruthy();

      const u2 = await request(app)
        .post("/api/queues/queue-1/join")
        .send({ name: "User B" });
      expect(u2.body.entry.position).toBe(2);
      expect(u2.body.entry.serviceStartedAt).toBeFalsy();
    });

    it("calculates service duration as completedAt - serviceStartedAt and computes correct ETA", async () => {
      // Create completed entry with 10 minute service duration
      const now = new Date();
      const tenMinsAgo = new Date(now.getTime() - 10 * 60 * 1000);

      db.queueEntries.push({
        id: "entry-completed-1",
        tenantId: "tenant-1",
        queueId: "queue-1",
        name: "Completed User",
        status: "COMPLETED",
        position: 0,
        sessionTokenHash: "hash",
        createdAt: new Date(now.getTime() - 40 * 60 * 1000), // Joined 40m ago
        serviceStartedAt: tenMinsAgo, // Service started 10m ago
        completedAt: now, // Completed now -> Duration = 10 mins!
      });

      // User A joins at #1
      const u1 = await request(app)
        .post("/api/queues/queue-1/join")
        .send({ name: "User A" });
      expect(u1.body.entry.position).toBe(1);
      expect(u1.body.peopleAhead).toBe(0);
      expect(u1.body.estimatedWaitMinutes).toBe(0);

      // User B joins at #2
      const u2 = await request(app)
        .post("/api/queues/queue-1/join")
        .send({ name: "User B" });
      expect(u2.body.entry.position).toBe(2);
      expect(u2.body.peopleAhead).toBe(1);
      expect(u2.body.estimatedWaitMinutes).toBe(10); // 1 * 10 = 10 mins

      // User C joins at #3
      const u3 = await request(app)
        .post("/api/queues/queue-1/join")
        .send({ name: "User C" });
      expect(u3.body.entry.position).toBe(3);
      expect(u3.body.peopleAhead).toBe(2);
      expect(u3.body.estimatedWaitMinutes).toBe(20); // 2 * 10 = 20 mins
    });

    it("returns estimatedWaitMinutes = null when no completed entries exist", async () => {
      const u1 = await request(app)
        .post("/api/queues/queue-1/join")
        .send({ name: "User A" }); // #1
      const u2 = await request(app)
        .post("/api/queues/queue-1/join")
        .send({ name: "User B" }); // #2

      expect(u1.body.estimatedWaitMinutes).toBe(0);
      expect(u2.body.estimatedWaitMinutes).toBeNull();
    });

    it("promotes #2 to #1 and sets serviceStartedAt when #1 completes", async () => {
      const u1 = await request(app)
        .post("/api/queues/queue-1/join")
        .send({ name: "User A" });
      const u2 = await request(app)
        .post("/api/queues/queue-1/join")
        .send({ name: "User B" });

      // Complete User A
      await request(app)
        .post(`/api/queue-entries/${u1.body.entry.id}/done`)
        .set("x-session-token", u1.body.sessionToken);

      // Check User B status
      const bStatus = await request(app)
        .get(`/api/queue-entries/${u2.body.entry.id}`)
        .set("x-session-token", u2.body.sessionToken);

      expect(bStatus.body.entry.position).toBe(1);
      expect(bStatus.body.entry.serviceStartedAt).toBeTruthy();
    });
  });

  describe("Phase 4 — Website Realtime Notifications & Security", () => {
    it("ensures public queue endpoints supply all data required for client-side realtime notifications", async () => {
      const u1 = await request(app)
        .post("/api/queues/queue-1/join")
        .send({ name: "Darshan", phone: "+919876543210" });

      expect(u1.statusCode).toBe(201);
      expect(u1.body.entry.name).toBe("Darshan");
      expect(u1.body.entry.position).toBe(1);
      expect(u1.body.sessionToken).toBeTruthy();
      expect(u1.body.queueName).toBe("Main Queue");
    });

    it("verifies session token security: unauthorized token cannot fetch status", async () => {
      const u1 = await request(app)
        .post("/api/queues/queue-1/join")
        .send({ name: "Alice" });

      const fakeTokenRes = await request(app)
        .get(`/api/queue-entries/${u1.body.entry.id}`)
        .set("x-session-token", "invalid-session-token-12345");

      expect(fakeTokenRes.statusCode).toBe(403);
    });

    it("verifies position progression (#3 -> #2 -> #1) through queue completion steps", async () => {
      const u1 = await request(app)
        .post("/api/queues/queue-1/join")
        .send({ name: "User 1" });
      const u2 = await request(app)
        .post("/api/queues/queue-1/join")
        .send({ name: "User 2" });
      const u3 = await request(app)
        .post("/api/queues/queue-1/join")
        .send({ name: "User 3" });

      expect(u1.body.entry.position).toBe(1);
      expect(u2.body.entry.position).toBe(2);
      expect(u3.body.entry.position).toBe(3);

      // Complete U1
      await request(app)
        .post(`/api/queue-entries/${u1.body.entry.id}/done`)
        .set("x-session-token", u1.body.sessionToken);

      // Check U3 status -> now #2
      const u3Pos2 = await request(app)
        .get(`/api/queue-entries/${u3.body.entry.id}`)
        .set("x-session-token", u3.body.sessionToken);
      expect(u3Pos2.body.entry.position).toBe(2);

      // Complete U2
      await request(app)
        .post(`/api/queue-entries/${u2.body.entry.id}/done`)
        .set("x-session-token", u2.body.sessionToken);

      // Check U3 status -> now #1 (YOUR TURN!)
      const u3Pos1 = await request(app)
        .get(`/api/queue-entries/${u3.body.entry.id}`)
        .set("x-session-token", u3.body.sessionToken);
      expect(u3Pos1.body.entry.position).toBe(1);
      expect(u3Pos1.body.peopleAhead).toBe(0);
    });
  });
});
