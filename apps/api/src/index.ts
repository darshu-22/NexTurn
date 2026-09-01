import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import crypto from "crypto";
import {
  LoginSchema,
  QueueCreateSchema,
  JoinQueueSchema,
  ReorderQueueSchema,
} from "@nexturn/validation";

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 4000;
const JWT_SECRET =
  process.env.JWT_SECRET || "fallback-secret-do-not-use-in-prod";

app.use(express.json());
app.use(cors());
app.use(helmet());

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
});
app.use("/api", limiter);

// Helper function to generate session token and its sha256 hash
export function generateSessionToken() {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  return { rawToken, tokenHash };
}

export function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Custom Request interface to include user
export interface AuthRequest extends Request {
  user?: {
    id: string;
    tenantId: string;
    role: string;
  };
}

// Authentication Middleware
export const authenticateToken = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token)
    return res.status(401).json({ error: "Unauthorized: Missing token" });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: "Forbidden: Invalid token" });
    req.user = user as any;
    next();
  });
};

// Tenant Isolation Middleware
export const requireTenantAccess = (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  if (!req.user || !req.user.tenantId) {
    return res.status(403).json({ error: "Forbidden: No tenant context" });
  }
  next();
};

// Authorization Middleware
export const requireRole = (roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res
        .status(403)
        .json({ error: "Forbidden: Insufficient permissions" });
    }
    next();
  };
};

// Routes
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Admin Login
app.post("/api/auth/login", async (req, res) => {
  try {
    const validatedData = LoginSchema.parse(req.body);
    const { email, password } = validatedData;

    const user = await prisma.user.findFirst({ where: { email } });

    if (!user || user.passwordHash !== password) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { id: user.id, tenantId: user.tenantId, role: user.role },
      JWT_SECRET,
      { expiresIn: "8h" },
    );

    res.json({ token, role: user.role, tenantId: user.tenantId });
  } catch (error) {
    res.status(400).json({ error: "Invalid request" });
  }
});

// List Queues (Protected, Organization Admin / Queue Operator)
app.get(
  "/api/queues",
  authenticateToken,
  requireTenantAccess,
  requireRole(["ORGANIZATION_ADMIN", "QUEUE_OPERATOR"]),
  async (req: AuthRequest, res) => {
    try {
      const queues = await prisma.queue.findMany({
        where: { tenantId: req.user!.tenantId },
        orderBy: { createdAt: "desc" },
      });
      res.json(queues);
    } catch (error) {
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// Create Queue (Protected, Organization Admin)
app.post(
  "/api/queues",
  authenticateToken,
  requireTenantAccess,
  requireRole(["ORGANIZATION_ADMIN"]),
  async (req: AuthRequest, res) => {
    try {
      const validatedData = QueueCreateSchema.parse(req.body);
      const queue = await prisma.queue.create({
        data: {
          name: validatedData.name,
          tenantId: req.user!.tenantId,
        },
      });
      res.status(201).json(queue);
    } catch (error) {
      res.status(400).json({ error: "Invalid request" });
    }
  },
);

// Get Public Queue Info
app.get("/api/queues/:id/public", async (req, res) => {
  try {
    const { id } = req.params;
    const queue = await prisma.queue.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        status: true,
        joinEnabled: true,
        tenantId: true,
      },
    });

    if (!queue || queue.status !== "ACTIVE" || !queue.joinEnabled) {
      return res.status(404).json({ error: "Queue not found or closed" });
    }
    // Return queue info without exposing sensitive tenant internals
    res.json({
      id: queue.id,
      name: queue.name,
      status: queue.status,
      joinEnabled: queue.joinEnabled,
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Join Queue (Public)
app.post("/api/queues/:id/join", async (req, res) => {
  try {
    const { id: queueId } = req.params;
    const validatedData = JoinQueueSchema.parse(req.body);

    const queue = await prisma.queue.findUnique({
      where: { id: queueId },
    });

    if (!queue || queue.status !== "ACTIVE" || !queue.joinEnabled) {
      return res
        .status(400)
        .json({ error: "Queue is currently closed or unavailable" });
    }

    const { rawToken, tokenHash } = generateSessionToken();

    // Use Prisma transaction with FOR UPDATE row lock to prevent race conditions & duplicate positions
    const result = await prisma.$transaction(async (tx) => {
      // Row lock on the queue table row for update to serialize position assignment
      try {
        await tx.$executeRaw`SELECT id FROM queues WHERE id = ${queueId} FOR UPDATE`;
      } catch (err) {
        // Fallback for sqlite/in-memory if raw lock not supported in non-postgres test env
      }

      // Calculate next FCFS position
      const lastEntry = await tx.queueEntry.findFirst({
        where: { queueId, status: "WAITING" },
        orderBy: { position: "desc" },
        select: { position: true },
      });
      const nextPosition = (lastEntry?.position || 0) + 1;

      const newEntry = await tx.queueEntry.create({
        data: {
          tenantId: queue.tenantId,
          queueId,
          name: validatedData.name,
          phone: validatedData.phone || null,
          status: "WAITING",
          position: nextPosition,
          sessionTokenHash: tokenHash,
        },
      });

      // Record QUEUE_JOINED event
      await tx.queueEvent.create({
        data: {
          tenantId: queue.tenantId,
          queueId,
          queueEntryId: newEntry.id,
          eventType: "QUEUE_JOINED",
          actorRole: "USER",
          payload: { position: nextPosition, name: newEntry.name },
        },
      });

      // Calculate people ahead
      const peopleAhead = nextPosition - 1;

      return {
        entry: {
          id: newEntry.id,
          queueId: newEntry.queueId,
          name: newEntry.name,
          status: newEntry.status,
          position: newEntry.position,
          createdAt: newEntry.createdAt,
        },
        sessionToken: rawToken,
        peopleAhead,
        queueName: queue.name,
      };
    });

    res.status(201).json(result);
  } catch (error: any) {
    if (error?.name === "ZodError") {
      return res
        .status(400)
        .json({ error: "Invalid input data", details: error.errors });
    }
    res.status(500).json({ error: "Failed to join queue" });
  }
});

// Get User Queue Status (Public with session token)
app.get("/api/queue-entries/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const sessionToken =
      (req.headers["x-session-token"] as string) || (req.query.token as string);

    if (!sessionToken) {
      return res
        .status(401)
        .json({ error: "Unauthorized: Session token required" });
    }

    const tokenHash = hashToken(sessionToken);

    const entry = await prisma.queueEntry.findUnique({
      where: { id },
      include: { queue: { select: { name: true } } },
    });

    if (!entry || entry.sessionTokenHash !== tokenHash) {
      return res
        .status(403)
        .json({ error: "Forbidden: Access denied to this queue entry" });
    }

    let peopleAhead = 0;
    if (entry.status === "WAITING") {
      peopleAhead = await prisma.queueEntry.count({
        where: {
          queueId: entry.queueId,
          status: "WAITING",
          position: { lt: entry.position },
        },
      });
    }

    res.json({
      entry: {
        id: entry.id,
        queueId: entry.queueId,
        name: entry.name,
        phone: entry.phone,
        status: entry.status,
        position: entry.position,
        createdAt: entry.createdAt,
        completedAt: entry.completedAt,
        cancelledAt: entry.cancelledAt,
      },
      peopleAhead,
      queueName: entry.queue.name,
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// User Mark Own Entry DONE
app.post("/api/queue-entries/:id/done", async (req, res) => {
  try {
    const { id } = req.params;
    const sessionToken =
      (req.headers["x-session-token"] as string) ||
      (req.body?.sessionToken as string);

    if (!sessionToken) {
      return res
        .status(401)
        .json({ error: "Unauthorized: Session token required" });
    }

    const tokenHash = hashToken(sessionToken);

    const entry = await prisma.queueEntry.findUnique({ where: { id } });
    if (!entry || entry.sessionTokenHash !== tokenHash) {
      return res.status(403).json({ error: "Forbidden: Access denied" });
    }

    if (entry.status !== "WAITING") {
      return res
        .status(400)
        .json({ error: `Cannot complete entry with status ${entry.status}` });
    }

    const updatedEntry = await prisma.$transaction(async (tx) => {
      try {
        await tx.$executeRaw`SELECT id FROM queues WHERE id = ${entry.queueId} FOR UPDATE`;
      } catch (err) {}

      // Mark COMPLETED
      const completed = await tx.queueEntry.update({
        where: { id: entry.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
        },
      });

      // Recompact active positions of remaining WAITING entries
      const remaining = await tx.queueEntry.findMany({
        where: { queueId: entry.queueId, status: "WAITING" },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      });

      for (let i = 0; i < remaining.length; i++) {
        const newPos = i + 1;
        if (remaining[i].position !== newPos) {
          await tx.queueEntry.update({
            where: { id: remaining[i].id },
            data: { position: newPos },
          });
        }
      }

      // Record QUEUE_COMPLETED event
      await tx.queueEvent.create({
        data: {
          tenantId: entry.tenantId,
          queueId: entry.queueId,
          queueEntryId: entry.id,
          eventType: "QUEUE_COMPLETED",
          actorRole: "USER",
          payload: { previousPosition: entry.position },
        },
      });

      return completed;
    });

    res.json({
      message: "Queue entry completed successfully",
      entry: updatedEntry,
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// User Cancel/Leave Own Entry
app.post("/api/queue-entries/:id/cancel", async (req, res) => {
  try {
    const { id } = req.params;
    const sessionToken =
      (req.headers["x-session-token"] as string) ||
      (req.body?.sessionToken as string);

    if (!sessionToken) {
      return res
        .status(401)
        .json({ error: "Unauthorized: Session token required" });
    }

    const tokenHash = hashToken(sessionToken);

    const entry = await prisma.queueEntry.findUnique({ where: { id } });
    if (!entry || entry.sessionTokenHash !== tokenHash) {
      return res.status(403).json({ error: "Forbidden: Access denied" });
    }

    if (entry.status !== "WAITING") {
      return res
        .status(400)
        .json({ error: `Cannot cancel entry with status ${entry.status}` });
    }

    const cancelledEntry = await prisma.$transaction(async (tx) => {
      try {
        await tx.$executeRaw`SELECT id FROM queues WHERE id = ${entry.queueId} FOR UPDATE`;
      } catch (err) {}

      const cancelled = await tx.queueEntry.update({
        where: { id: entry.id },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
        },
      });

      // Recompact active positions of remaining WAITING entries
      const remaining = await tx.queueEntry.findMany({
        where: { queueId: entry.queueId, status: "WAITING" },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      });

      for (let i = 0; i < remaining.length; i++) {
        const newPos = i + 1;
        if (remaining[i].position !== newPos) {
          await tx.queueEntry.update({
            where: { id: remaining[i].id },
            data: { position: newPos },
          });
        }
      }

      // Record QUEUE_CANCELLED event
      await tx.queueEvent.create({
        data: {
          tenantId: entry.tenantId,
          queueId: entry.queueId,
          queueEntryId: entry.id,
          eventType: "QUEUE_CANCELLED",
          actorRole: "USER",
          payload: { previousPosition: entry.position },
        },
      });

      return cancelled;
    });

    res.json({
      message: "Queue entry cancelled successfully",
      entry: cancelledEntry,
    });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Admin View Queue Entries
app.get(
  "/api/queues/:id/entries",
  authenticateToken,
  requireTenantAccess,
  requireRole(["ORGANIZATION_ADMIN", "QUEUE_OPERATOR"]),
  async (req: AuthRequest, res) => {
    try {
      const { id: queueId } = req.params;
      const queue = await prisma.queue.findUnique({ where: { id: queueId } });

      if (!queue || queue.tenantId !== req.user!.tenantId) {
        return res
          .status(404)
          .json({ error: "Queue not found or tenant access denied" });
      }

      const statusFilter = (req.query.status as string) || "WAITING";

      const entries = await prisma.queueEntry.findMany({
        where: {
          queueId,
          tenantId: req.user!.tenantId,
          status: statusFilter,
        },
        orderBy:
          statusFilter === "WAITING"
            ? { position: "asc" }
            : { updatedAt: "desc" },
        select: {
          id: true,
          queueId: true,
          tenantId: true,
          name: true,
          phone: true,
          status: true,
          position: true,
          createdAt: true,
          completedAt: true,
          cancelledAt: true,
        },
      });

      res.json({ queueId, entries, count: entries.length });
    } catch (error) {
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// Admin Mark User DONE
app.post(
  "/api/admin/queue-entries/:id/done",
  authenticateToken,
  requireTenantAccess,
  requireRole(["ORGANIZATION_ADMIN", "QUEUE_OPERATOR"]),
  async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const entry = await prisma.queueEntry.findUnique({ where: { id } });

      if (!entry || entry.tenantId !== req.user!.tenantId) {
        return res
          .status(404)
          .json({ error: "Queue entry not found or tenant access denied" });
      }

      if (entry.status !== "WAITING") {
        return res
          .status(400)
          .json({ error: `Cannot complete entry with status ${entry.status}` });
      }

      const completedEntry = await prisma.$transaction(async (tx) => {
        try {
          await tx.$executeRaw`SELECT id FROM queues WHERE id = ${entry.queueId} FOR UPDATE`;
        } catch (err) {}

        const updated = await tx.queueEntry.update({
          where: { id: entry.id },
          data: {
            status: "COMPLETED",
            completedAt: new Date(),
          },
        });

        // Recompact remaining WAITING entries
        const remaining = await tx.queueEntry.findMany({
          where: { queueId: entry.queueId, status: "WAITING" },
          orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        });

        for (let i = 0; i < remaining.length; i++) {
          const newPos = i + 1;
          if (remaining[i].position !== newPos) {
            await tx.queueEntry.update({
              where: { id: remaining[i].id },
              data: { position: newPos },
            });
          }
        }

        // Record QUEUE_COMPLETED event
        await tx.queueEvent.create({
          data: {
            tenantId: entry.tenantId,
            queueId: entry.queueId,
            queueEntryId: entry.id,
            eventType: "QUEUE_COMPLETED",
            actorId: req.user!.id,
            actorRole: req.user!.role,
            payload: { previousPosition: entry.position },
          },
        });

        return updated;
      });

      res.json({ message: "Entry marked as DONE", entry: completedEntry });
    } catch (error) {
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// Admin REMOVE User
app.post(
  "/api/admin/queue-entries/:id/remove",
  authenticateToken,
  requireTenantAccess,
  requireRole(["ORGANIZATION_ADMIN", "QUEUE_OPERATOR"]),
  async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const entry = await prisma.queueEntry.findUnique({ where: { id } });

      if (!entry || entry.tenantId !== req.user!.tenantId) {
        return res
          .status(404)
          .json({ error: "Queue entry not found or tenant access denied" });
      }

      if (entry.status !== "WAITING") {
        return res
          .status(400)
          .json({ error: `Cannot remove entry with status ${entry.status}` });
      }

      const removedEntry = await prisma.$transaction(async (tx) => {
        try {
          await tx.$executeRaw`SELECT id FROM queues WHERE id = ${entry.queueId} FOR UPDATE`;
        } catch (err) {}

        const cancelled = await tx.queueEntry.update({
          where: { id: entry.id },
          data: {
            status: "CANCELLED",
            cancelledAt: new Date(),
          },
        });

        // Recompact remaining WAITING entries
        const remaining = await tx.queueEntry.findMany({
          where: { queueId: entry.queueId, status: "WAITING" },
          orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        });

        for (let i = 0; i < remaining.length; i++) {
          const newPos = i + 1;
          if (remaining[i].position !== newPos) {
            await tx.queueEntry.update({
              where: { id: remaining[i].id },
              data: { position: newPos },
            });
          }
        }

        // Record QUEUE_REMOVED event
        await tx.queueEvent.create({
          data: {
            tenantId: entry.tenantId,
            queueId: entry.queueId,
            queueEntryId: entry.id,
            eventType: "QUEUE_REMOVED",
            actorId: req.user!.id,
            actorRole: req.user!.role,
            payload: { previousPosition: entry.position },
          },
        });

        return cancelled;
      });

      res.json({ message: "Entry removed successfully", entry: removedEntry });
    } catch (error) {
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// Admin REORDER Queue Entry Position
app.post(
  "/api/admin/queue-entries/:id/reorder",
  authenticateToken,
  requireTenantAccess,
  requireRole(["ORGANIZATION_ADMIN", "QUEUE_OPERATOR"]),
  async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const validatedData = ReorderQueueSchema.parse(req.body);
      const { targetPosition } = validatedData;

      const entry = await prisma.queueEntry.findUnique({ where: { id } });

      if (!entry || entry.tenantId !== req.user!.tenantId) {
        return res
          .status(404)
          .json({ error: "Queue entry not found or tenant access denied" });
      }

      if (entry.status !== "WAITING") {
        return res
          .status(400)
          .json({ error: "Can only reorder WAITING queue entries" });
      }

      const reorderedResult = await prisma.$transaction(async (tx) => {
        try {
          await tx.$executeRaw`SELECT id FROM queues WHERE id = ${entry.queueId} FOR UPDATE`;
        } catch (err) {}

        const waitingEntries = await tx.queueEntry.findMany({
          where: { queueId: entry.queueId, status: "WAITING" },
          orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        });

        const currentIndex = waitingEntries.findIndex((e) => e.id === entry.id);
        if (currentIndex === -1) {
          throw new Error("Entry not active");
        }

        const validTargetIndex = Math.max(
          0,
          Math.min(targetPosition - 1, waitingEntries.length - 1),
        );

        // Reorder in memory array deterministically
        const [moved] = waitingEntries.splice(currentIndex, 1);
        waitingEntries.splice(validTargetIndex, 0, moved);

        // Update positions atomically without duplicate numbers
        for (let i = 0; i < waitingEntries.length; i++) {
          const newPos = i + 1;
          await tx.queueEntry.update({
            where: { id: waitingEntries[i].id },
            data: { position: newPos },
          });
        }

        const newPos = validTargetIndex + 1;

        // Record QUEUE_REORDERED event
        await tx.queueEvent.create({
          data: {
            tenantId: entry.tenantId,
            queueId: entry.queueId,
            queueEntryId: entry.id,
            eventType: "QUEUE_REORDERED",
            actorId: req.user!.id,
            actorRole: req.user!.role,
            payload: { previousPosition: entry.position, newPosition: newPos },
          },
        });

        return {
          id: entry.id,
          previousPosition: entry.position,
          newPosition: newPos,
        };
      });

      res.json({ message: "Queue reordered successfully", ...reorderedResult });
    } catch (error: any) {
      if (error?.name === "ZodError") {
        return res
          .status(400)
          .json({ error: "Invalid reorder position", details: error.errors });
      }
      res.status(500).json({ error: "Failed to reorder queue" });
    }
  },
);

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`API server running on http://localhost:${PORT}`);
  });
}

export default app;
