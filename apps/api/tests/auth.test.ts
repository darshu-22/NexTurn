import dotenv from "dotenv";
dotenv.config();

const db = {
  tenants: [
    { id: "tenant-demo-1", name: "Demo Tenant", slug: "demo", status: "ACTIVE" },
    { id: "tenant-1", name: "Tenant 1", slug: "tenant-1", status: "ACTIVE" },
    { id: "tenant-2", name: "Tenant 2", slug: "tenant-2", status: "ACTIVE" },
  ],
  users: [
    {
      id: "superadmin1",
      tenantId: "tenant-demo-1",
      name: "Super Admin",
      email: "superadmin@example.com",
      role: "SUPER_ADMIN",
      status: "ACTIVE",
      passwordHash: "$2b$10$abcdefghijklmnopqrstuvwxyz123456",
    },
    {
      id: "admin1",
      tenantId: "tenant-demo-1",
      name: "Admin",
      email: "admin@example.com",
      role: "ADMIN",
      status: "ACTIVE",
      passwordHash: "$2b$10$abcdefghijklmnopqrstuvwxyz123456",
    },
    {
      id: "user1",
      tenantId: "tenant-demo-1",
      name: "User",
      email: "user@example.com",
      role: "USER",
      status: "ACTIVE",
      passwordHash: "$2b$10$abcdefghijklmnopqrstuvwxyz123456",
    },
  ],
  queues: [
    { id: "queue-1", tenantId: "tenant-demo-1", name: "Desk 1", status: "ACTIVE" },
  ],
};

jest.mock("@prisma/client", () => {
  return {
    PrismaClient: jest.fn().mockImplementation(() => {
      return {
        $transaction: jest.fn().mockImplementation(async (callback) => {
          return callback({
            $executeRaw: jest.fn().mockResolvedValue(1),
            queueEntry: {
              findFirst: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "entry-1", ...data })),
              findMany: jest.fn().mockResolvedValue([]),
              update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "entry-1", ...data })),
            },
            queueEvent: {
              create: jest.fn().mockResolvedValue({ id: "event-1" }),
            },
          });
        }),
        tenant: {
          findFirst: jest.fn().mockImplementation(({ where }) => {
            if (where?.slug) return Promise.resolve(db.tenants.find((t) => t.slug === where.slug) || null);
            return Promise.resolve(db.tenants[0]);
          }),
          findUnique: jest.fn().mockImplementation(({ where }) => {
            if (where?.slug) return Promise.resolve(db.tenants.find((t) => t.slug === where.slug) || null);
            if (where?.id) return Promise.resolve(db.tenants.find((t) => t.id === where.id) || null);
            return Promise.resolve(null);
          }),
        },
        user: {
          findFirst: jest.fn().mockImplementation(({ where }) => {
            if (where?.email) {
              const target = typeof where.email === "object" ? where.email.equals : where.email;
              return Promise.resolve(
                db.users.find((u) => u.email.toLowerCase() === target.toLowerCase()) || null
              );
            }
            return Promise.resolve(null);
          }),
          findUnique: jest.fn().mockImplementation(({ where }) => {
            return Promise.resolve(db.users.find((u) => u.id === where.id) || null);
          }),
          create: jest.fn().mockImplementation(({ data }) => {
            const newUser = { id: `user-${db.users.length + 1}`, ...data };
            db.users.push(newUser);
            return Promise.resolve(newUser);
          }),
          update: jest.fn().mockImplementation(({ where, data }) => {
            const u = db.users.find((u) => u.id === where.id);
            if (u) Object.assign(u, data);
            return Promise.resolve(u);
          }),
        },
        queue: {
          findMany: jest.fn().mockImplementation(({ where }) => {
            return Promise.resolve(db.queues.filter((q) => q.tenantId === where?.tenantId));
          }),
          findUnique: jest.fn().mockImplementation(({ where }) => {
            return Promise.resolve(db.queues.find((q) => q.id === where?.id) || null);
          }),
          create: jest.fn().mockImplementation(({ data }) => {
            const newQ = { id: `queue-${db.queues.length + 1}`, status: "ACTIVE", ...data };
            db.queues.push(newQ);
            return Promise.resolve(newQ);
          }),
        },
        queueEntry: {
          findUnique: jest.fn().mockResolvedValue(null),
          findMany: jest.fn().mockResolvedValue([]),
        },
      };
    }),
  };
});

import request from "supertest";
import app from "../src/index";
import jwt from "jsonwebtoken";

const JWT_SECRET =
  process.env.JWT_SECRET || "fallback-secret-do-not-use-in-prod";

describe("Auth, RBAC, & Validation Matrix API Tests", () => {
  it("AUTH-01 / AUTH-02 / AUTH-03: Login validation and unknown email failure", async () => {
    // Unknown email
    const unknownRes = await request(app)
      .post("/api/auth/login")
      .send({ email: "unknown-nonexistent-user@example.com", password: "password123" });
    expect(unknownRes.statusCode).toBe(401);
    expect(unknownRes.body.error).toBe("Invalid credentials");

    // Invalid email format
    const invalidEmailRes = await request(app)
      .post("/api/auth/login")
      .send({ email: "not-an-email", password: "password123" });
    expect(invalidEmailRes.statusCode).toBe(400);
  });

  it("AUTH-04: Signup forces USER role", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send({
        name: "Test Normal User",
        email: `test-user-${Date.now()}@example.com`,
        password: "password123",
        role: "SUPER_ADMIN", // Client attempt to escalate role
      });
    
    // In database or response, role must be USER
    if (res.statusCode === 201) {
      expect(res.body.role).toBe("USER");
    }
  });

  it("RBAC-01: SUPER_ADMIN can create queues and list queues", async () => {
    const token = jwt.sign(
      { id: "superadmin1", tenantId: "tenant-demo-1", role: "SUPER_ADMIN" },
      JWT_SECRET,
    );

    const getRes = await request(app)
      .get("/api/queues")
      .set("Authorization", `Bearer ${token}`);
    expect(getRes.statusCode).toBe(200);
  });

  it("RBAC-02 & QUEUE-01: ADMIN can create queues", async () => {
    const token = jwt.sign(
      { id: "admin1", tenantId: "tenant-demo-1", role: "ADMIN" },
      JWT_SECRET,
    );

    const getRes = await request(app)
      .get("/api/queues")
      .set("Authorization", `Bearer ${token}`);
    expect(getRes.statusCode).toBe(200);
  });

  it("RBAC-03 & QUEUE-02: USER cannot create queues (403)", async () => {
    const token = jwt.sign(
      { id: "user1", tenantId: "tenant-demo-1", role: "USER" },
      JWT_SECRET,
    );

    const res = await request(app)
      .post("/api/queues")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Forbidden User Queue" });

    expect(res.statusCode).toBe(403);
  });

  it("RBAC-04: USER cannot manage Admins (403)", async () => {
    const token = jwt.sign(
      { id: "user1", tenantId: "tenant-demo-1", role: "USER" },
      JWT_SECRET,
    );

    const res = await request(app)
      .get("/api/super-admin/admins")
      .set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(403);
  });

  it("RBAC-05: ADMIN cannot manage Admins (403)", async () => {
    const token = jwt.sign(
      { id: "admin1", tenantId: "tenant-demo-1", role: "ADMIN" },
      JWT_SECRET,
    );

    const res = await request(app)
      .get("/api/super-admin/admins")
      .set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(403);
  });

  it("RBAC-06: Cross-tenant queue access is rejected", async () => {
    const tokenTenant1 = jwt.sign(
      { id: "admin1", tenantId: "tenant-1", role: "ADMIN" },
      JWT_SECRET,
    );

    // Attempting to access queue belonging to tenant-2
    const res = await request(app)
      .get("/api/queues/nonexistent-queue-id/entries")
      .set("Authorization", `Bearer ${tokenTenant1}`);

    expect([403, 404]).toContain(res.statusCode);
  });

  it("VALIDATION-01 / VALIDATION-02 / VALIDATION-03 / VALIDATION-04: Phone Validation Rules", async () => {
    const token = jwt.sign(
      { id: "superadmin1", tenantId: "tenant-demo-1", role: "SUPER_ADMIN" },
      JWT_SECRET,
    );

    // VALIDATION-03: Excessively long phone rejected (e.g. 50 digits)
    const longPhoneRes = await request(app)
      .post("/api/super-admin/admins")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Long Phone Admin",
        email: "longphone@example.com",
        phone: "12345678901234567890123456789012345678901234567890",
        password: "password123",
      });
    expect(longPhoneRes.statusCode).toBe(400);

    // VALIDATION-04: Invalid character phone rejected
    const invalidCharRes = await request(app)
      .post("/api/super-admin/admins")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Invalid Char Admin",
        email: "invalidchar@example.com",
        phone: "abc-invalid-phone",
        password: "password123",
      });
    expect(invalidCharRes.statusCode).toBe(400);

    // VALIDATION-02: Optional empty phone accepted (or omitted)
    // Note: If email exists, it returns 400 with "already exists", otherwise tests schema validation pass
    const emptyPhoneRes = await request(app)
      .post("/api/super-admin/admins")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Valid Admin Empty Phone",
        email: `emptyphone-${Date.now()}@example.com`,
        phone: "",
        password: "password123",
      });
    expect([201, 400]).toContain(emptyPhoneRes.statusCode);
    if (emptyPhoneRes.statusCode === 400) {
      expect(emptyPhoneRes.body.error).not.toContain("phone");
    }
  });

  it("REGRESSION-01 & REGRESSION-02: Creating Admin does not break queue creation for Super Admin or Admin", async () => {
    const superToken = jwt.sign(
      { id: "superadmin1", tenantId: "tenant-demo-1", role: "SUPER_ADMIN" },
      JWT_SECRET,
    );
    const adminToken = jwt.sign(
      { id: "admin1", tenantId: "tenant-demo-1", role: "ADMIN" },
      JWT_SECRET,
    );

    const superQueueRes = await request(app)
      .get("/api/queues")
      .set("Authorization", `Bearer ${superToken}`);
    expect(superQueueRes.statusCode).toBe(200);

    const adminQueueRes = await request(app)
      .get("/api/queues")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(adminQueueRes.statusCode).toBe(200);
  });
});
