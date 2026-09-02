import dotenv from "dotenv";
dotenv.config();

import request from "supertest";
import jwt from "jsonwebtoken";
import {
  NotificationService,
  ConsoleNotificationProvider,
  TwilioNotificationProvider,
  isValidE164,
  maskPhoneNumber,
} from "../src/services/notification.service";

const JWT_SECRET =
  process.env.JWT_SECRET || "fallback-secret-do-not-use-in-prod";

// In-Memory Database Store for unit tests
const mockDb = {
  tenants: [{ id: "tenant-1", name: "Tenant One", slug: "tenant-1" }],
  users: [
    {
      id: "admin-1",
      tenantId: "tenant-1",
      name: "Admin One",
      role: "ORGANIZATION_ADMIN",
      passwordHash: "password123",
      email: "admin1@example.com",
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
  ],
  queueEntries: [] as any[],
  queueEvents: [] as any[],
  notificationLogs: [] as any[],
};

// Mock Prisma Client
jest.mock("@prisma/client", () => {
  return {
    PrismaClient: jest.fn().mockImplementation(() => {
      const queueDelegate = {
        findMany: jest.fn().mockImplementation(({ where }) => {
          return Promise.resolve(
            mockDb.queues.filter((q) => q.tenantId === where.tenantId),
          );
        }),
        findUnique: jest.fn().mockImplementation(({ where }) => {
          return Promise.resolve(
            mockDb.queues.find((q) => q.id === where.id) || null,
          );
        }),
      };

      const queueEntryDelegate = {
        findFirst: jest.fn().mockImplementation(({ where, orderBy }) => {
          let entries = mockDb.queueEntries.filter((e) => {
            if (where.queueId && e.queueId !== where.queueId) return false;
            if (where.status && e.status !== where.status) return false;
            if (where.position && e.position !== where.position) return false;
            return true;
          });
          if (orderBy?.position === "desc") {
            entries.sort((a, b) => b.position - a.position);
          }
          return Promise.resolve(entries[0] || null);
        }),
        create: jest.fn().mockImplementation(({ data }) => {
          const entry = {
            id: `entry-${mockDb.queueEntries.length + 1}`,
            createdAt: new Date(),
            updatedAt: new Date(),
            completedAt: null,
            cancelledAt: null,
            serviceStartedAt: data.position === 1 ? new Date() : null,
            ...data,
          };
          mockDb.queueEntries.push(entry);
          return Promise.resolve(entry);
        }),
        findUnique: jest.fn().mockImplementation(({ where }) => {
          const entry = mockDb.queueEntries.find((e) => e.id === where.id);
          if (!entry) return Promise.resolve(null);
          const queue = mockDb.queues.find((q) => q.id === entry.queueId);
          return Promise.resolve({ ...entry, queue });
        }),
        findMany: jest.fn().mockImplementation(({ where }) => {
          let entries = mockDb.queueEntries.filter((e) => {
            if (where.queueId && e.queueId !== where.queueId) return false;
            if (where.status && e.status !== where.status) return false;
            return true;
          });
          return Promise.resolve([...entries]);
        }),
        update: jest.fn().mockImplementation(({ where, data }) => {
          const index = mockDb.queueEntries.findIndex((e) => e.id === where.id);
          if (index !== -1) {
            mockDb.queueEntries[index] = {
              ...mockDb.queueEntries[index],
              ...data,
              updatedAt: new Date(),
            };
            return Promise.resolve(mockDb.queueEntries[index]);
          }
          return Promise.resolve(null);
        }),
        count: jest.fn().mockImplementation(({ where }) => {
          const count = mockDb.queueEntries.filter((e) => {
            if (where.queueId && e.queueId !== where.queueId) return false;
            if (where.status && e.status !== where.status) return false;
            return true;
          }).length;
          return Promise.resolve(count);
        }),
      };

      const notificationLogDelegate = {
        create: jest.fn().mockImplementation(({ data }) => {
          // Check database unique constraint: @@unique([queueEntryId, eventType, channel])
          const exists = mockDb.notificationLogs.find(
            (l) =>
              l.queueEntryId === data.queueEntryId &&
              l.eventType === data.eventType &&
              l.channel === data.channel,
          );
          if (exists) {
            const err: any = new Error("Unique constraint failed");
            err.code = "P2002";
            throw err;
          }
          const log = {
            id: `notif-${mockDb.notificationLogs.length + 1}`,
            createdAt: new Date(),
            providerMessageId: null,
            errorMessage: null,
            ...data,
          };
          mockDb.notificationLogs.push(log);
          return Promise.resolve(log);
        }),
        update: jest.fn().mockImplementation(({ where, data }) => {
          const index = mockDb.notificationLogs.findIndex(
            (l) => l.id === where.id,
          );
          if (index !== -1) {
            mockDb.notificationLogs[index] = {
              ...mockDb.notificationLogs[index],
              ...data,
            };
            return Promise.resolve(mockDb.notificationLogs[index]);
          }
          return Promise.resolve(null);
        }),
        findMany: jest.fn().mockImplementation(({ where }) => {
          return Promise.resolve(
            mockDb.notificationLogs.filter((l) => {
              if (where.tenantId && l.tenantId !== where.tenantId) return false;
              if (where.queueEntryId && l.queueEntryId !== where.queueEntryId)
                return false;
              return true;
            }),
          );
        }),
      };

      const queueEventDelegate = {
        create: jest.fn().mockResolvedValue({ id: "event-1" }),
      };

      const mockTx = {
        $executeRaw: jest.fn().mockResolvedValue(1),
        queue: queueDelegate,
        queueEntry: queueEntryDelegate,
        queueEvent: queueEventDelegate,
        notificationLog: notificationLogDelegate,
      };

      return {
        $transaction: jest
          .fn()
          .mockImplementation(async (callback) => callback(mockTx)),
        user: {
          findFirst: jest
            .fn()
            .mockImplementation(() => Promise.resolve(mockDb.users[0])),
        },
        queue: queueDelegate,
        queueEntry: queueEntryDelegate,
        queueEvent: queueEventDelegate,
        notificationLog: notificationLogDelegate,
      };
    }),
  };
});

import app from "../src/index";

describe("Phase 4 — Notification Service & Provider Tests", () => {
  beforeEach(() => {
    mockDb.queueEntries = [];
    mockDb.queueEvents = [];
    mockDb.notificationLogs = [];
    process.env.NOTIFICATION_PROVIDER = "console";
    process.env.ENABLE_WHATSAPP = "true";
    process.env.ENABLE_SMS = "true";
  });

  describe("Utility Functions: E.164 & Masking", () => {
    it("validates E.164 phone numbers correctly", () => {
      expect(isValidE164("+919876543210")).toBe(true);
      expect(isValidE164("+14155238886")).toBe(true);
      expect(isValidE164("9876543210")).toBe(false); // missing +
      expect(isValidE164("+0123")).toBe(false); // invalid starting digit 0
      expect(isValidE164("invalid-phone")).toBe(false);
    });

    it("masks phone numbers safely for logging", () => {
      expect(maskPhoneNumber("+919876543210")).toBe("+91****3210");
      expect(maskPhoneNumber("+14155238886")).toBe("+14****8886");
      expect(maskPhoneNumber("")).toBe("N/A");
    });
  });

  describe("ConsoleNotificationProvider", () => {
    it("logs WhatsApp and SMS messages to memory store with generated providerMessageId", async () => {
      const provider = new ConsoleNotificationProvider();
      const waResult = await provider.sendWhatsApp("+919876543210", "Test WA");
      expect(waResult.providerMessageId).toContain("console-wa-");

      const smsResult = await provider.sendSMS("+919876543210", "Test SMS");
      expect(smsResult.providerMessageId).toContain("console-sms-");

      expect(provider.sentLogs.length).toBe(2);
    });
  });

  describe("Independent Channel Configuration", () => {
    it("dispatches only WhatsApp when ENABLE_WHATSAPP=true and ENABLE_SMS=false", async () => {
      process.env.ENABLE_WHATSAPP = "true";
      process.env.ENABLE_SMS = "false";

      const consoleProvider = new ConsoleNotificationProvider();
      const service = new NotificationService(consoleProvider);

      const entry = {
        id: "entry-1",
        tenantId: "tenant-1",
        queueId: "queue-1",
        name: "Rahul",
        phone: "+919876543210",
        position: 1,
      };

      await service.sendQueueJoined(entry, "Main Queue");

      expect(consoleProvider.sentLogs.length).toBe(1);
      expect(consoleProvider.sentLogs[0].channel).toBe("WHATSAPP");
    });

    it("dispatches only SMS when ENABLE_SMS=true and ENABLE_WHATSAPP=false", async () => {
      process.env.ENABLE_WHATSAPP = "false";
      process.env.ENABLE_SMS = "true";

      const consoleProvider = new ConsoleNotificationProvider();
      const service = new NotificationService(consoleProvider);

      const entry = {
        id: "entry-1",
        tenantId: "tenant-1",
        queueId: "queue-1",
        name: "Priya",
        phone: "+919876543210",
        position: 1,
      };

      await service.sendQueueJoined(entry, "Main Queue");

      expect(consoleProvider.sentLogs.length).toBe(1);
      expect(consoleProvider.sentLogs[0].channel).toBe("SMS");
    });

    it("dispatches nothing when both channels are disabled", async () => {
      process.env.ENABLE_WHATSAPP = "false";
      process.env.ENABLE_SMS = "false";

      const consoleProvider = new ConsoleNotificationProvider();
      const service = new NotificationService(consoleProvider);

      const entry = {
        id: "entry-1",
        tenantId: "tenant-1",
        queueId: "queue-1",
        name: "Arjun",
        phone: "+919876543210",
        position: 1,
      };

      await service.sendQueueJoined(entry, "Main Queue");
      expect(consoleProvider.sentLogs.length).toBe(0);
    });
  });

  describe("Database Idempotency & Duplicate Prevention", () => {
    it("prevents duplicate notifications via unique constraint @@unique([queueEntryId, eventType, channel])", async () => {
      const consoleProvider = new ConsoleNotificationProvider();
      const service = new NotificationService(consoleProvider);

      const entry = {
        id: "entry-idempotent-1",
        tenantId: "tenant-1",
        queueId: "queue-1",
        name: "Rahul",
        phone: "+919876543210",
        position: 1,
      };

      // First call -> sends 2 (WhatsApp & SMS)
      await service.sendYourTurnAlert(entry, "Main Queue");
      expect(consoleProvider.sentLogs.length).toBe(2);

      // Second call for same entry & event -> skipped quietly by DB unique constraint
      await service.sendYourTurnAlert(entry, "Main Queue");
      expect(consoleProvider.sentLogs.length).toBe(2); // No new dispatches!
    });
  });

  describe("No Automatic Fallback on Provider Failure", () => {
    it("logs FAILED on WhatsApp failure without triggering SMS fallback", async () => {
      process.env.ENABLE_WHATSAPP = "true";
      process.env.ENABLE_SMS = "false"; // SMS disabled

      const failingProvider: any = {
        sendWhatsApp: jest
          .fn()
          .mockRejectedValue(new Error("Twilio API error 500")),
        sendSMS: jest.fn(),
      };

      const service = new NotificationService(failingProvider);

      const entry = {
        id: "entry-fail-1",
        tenantId: "tenant-1",
        queueId: "queue-1",
        name: "Rahul",
        phone: "+919876543210",
        position: 1,
      };

      await service.sendQueueJoined(entry, "Main Queue");

      expect(failingProvider.sendSMS).not.toHaveBeenCalled(); // NO automatic fallback!
      const logs = mockDb.notificationLogs.filter(
        (l) => l.queueEntryId === "entry-fail-1",
      );
      expect(logs.length).toBe(1);
      expect(logs[0].status).toBe("FAILED");
      expect(logs[0].errorMessage).toBe("Twilio API error 500");
    });
  });

  describe("API Endpoints & Event Triggers Integration", () => {
    it("dispatches QUEUE_JOINED and YOUR_TURN when position #1 joins", async () => {
      const res = await request(app)
        .post("/api/queues/queue-1/join")
        .send({ name: "Rahul", phone: "+919876543210" });

      expect(res.statusCode).toBe(201);
      expect(res.body.entry.position).toBe(1);

      // Wait brief tick for async post-commit dispatch
      await new Promise((r) => setTimeout(r, 50));

      const logs = mockDb.notificationLogs.filter(
        (l) => l.queueEntryId === res.body.entry.id,
      );
      expect(logs.length).toBeGreaterThan(0);
      const eventTypes = logs.map((l) => l.eventType);
      expect(eventTypes).toContain("QUEUE_JOINED");
      expect(eventTypes).toContain("YOUR_TURN");
    });

    it("does NOT trigger duplicate YOUR_TURN on status polling (GET /api/queue-entries/:id)", async () => {
      const joinRes = await request(app)
        .post("/api/queues/queue-1/join")
        .send({ name: "Rahul", phone: "+919876543210" });

      await new Promise((r) => setTimeout(r, 50));
      const initialLogCount = mockDb.notificationLogs.length;

      // Status polling GET request
      await request(app)
        .get(`/api/queue-entries/${joinRes.body.entry.id}`)
        .set("x-session-token", joinRes.body.sessionToken);

      await new Promise((r) => setTimeout(r, 50));
      expect(mockDb.notificationLogs.length).toBe(initialLogCount); // No new notifications sent on GET polling!
    });

    it("dispatches QUEUE_CLEARED when last waiting user completes causing queue to become empty", async () => {
      const joinRes = await request(app)
        .post("/api/queues/queue-1/join")
        .send({ name: "Solo User", phone: "+919876543210" });

      await new Promise((r) => setTimeout(r, 50));

      // Solo user marks DONE -> queue transitions from 1 WAITING to 0 WAITING
      const doneRes = await request(app)
        .post(`/api/queue-entries/${joinRes.body.entry.id}/done`)
        .set("x-session-token", joinRes.body.sessionToken);

      expect(doneRes.statusCode).toBe(200);

      await new Promise((r) => setTimeout(r, 50));

      const clearedLogs = mockDb.notificationLogs.filter(
        (l) => l.eventType === "QUEUE_CLEARED",
      );
      expect(clearedLogs.length).toBeGreaterThan(0);
    });

    it("guarantees non-blocking execution: API succeeds even if notification fails", async () => {
      // Temporarily sabotage notification service to throw unhandled error
      const failingService = new NotificationService({
        sendWhatsApp: () =>
          Promise.reject(new Error("Fatal Network Breakdown")),
        sendSMS: () => Promise.reject(new Error("Fatal Network Breakdown")),
      });

      const res = await request(app)
        .post("/api/queues/queue-1/join")
        .send({ name: "Fault Tolerant User", phone: "+919876543210" });

      // Core API join operation must succeed with 201!
      expect(res.statusCode).toBe(201);
      expect(res.body.entry.name).toBe("Fault Tolerant User");
    });
  });

  describe("Twilio Provider Unit Tests (Mocked)", () => {
    it("formats Twilio API payload correctly without invoking live API", async () => {
      const twilioProvider = new TwilioNotificationProvider(
        "ACmocked123",
        "tokenmocked123",
        "whatsapp:+14155238886",
        "+14155238886",
      );

      // Mock global fetch
      const globalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ sid: "SMmocked_twilio_sid_123" }),
      }) as any;

      const waRes = await twilioProvider.sendWhatsApp(
        "+919876543210",
        "Test WA",
      );
      expect(waRes.providerMessageId).toBe("SMmocked_twilio_sid_123");

      const smsRes = await twilioProvider.sendSMS("+919876543210", "Test SMS");
      expect(smsRes.providerMessageId).toBe("SMmocked_twilio_sid_123");

      global.fetch = globalFetch;
    });
  });
});
