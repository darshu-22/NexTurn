import express, { Request, Response, NextFunction } from "express";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
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
const httpServer = http.createServer(app);
export const io = new SocketIOServer(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const prisma = new PrismaClient();
const PORT = process.env.PORT || 4000;
const JWT_SECRET =
  process.env.JWT_SECRET || "fallback-secret-do-not-use-in-prod";

app.use(express.json());
app.use(cors());
app.use(helmet());

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
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

// Helper: Calculate Queue ETA and Average Service Duration
export async function calculateQueueETA(
  queueId: string,
  position: number,
  txClient: any = prisma,
) {
  const peopleAhead = Math.max(0, position - 1);

  const completedEntries = await txClient.queueEntry.findMany({
    where: {
      queueId,
      status: "COMPLETED",
      serviceStartedAt: { not: null },
      completedAt: { not: null },
    },
    select: { serviceStartedAt: true, completedAt: true },
  });

  if (completedEntries.length === 0) {
    return {
      averageServiceDurationMinutes: null,
      estimatedWaitMinutes: position === 1 ? 0 : null,
      peopleAhead,
    };
  }

  const totalDurationMinutes = completedEntries.reduce(
    (sum: number, e: any) => {
      const start = new Date(e.serviceStartedAt).getTime();
      const end = new Date(e.completedAt).getTime();
      const durationInMinutes = (end - start) / (1000 * 60);
      return sum + Math.max(0, durationInMinutes);
    },
    0,
  );

  const avgDuration = totalDurationMinutes / completedEntries.length;
  const averageServiceDurationMinutes = Math.round(avgDuration * 10) / 10;

  let estimatedWaitMinutes: number | null = null;
  if (position === 1) {
    estimatedWaitMinutes = 0;
  } else {
    estimatedWaitMinutes = Math.round(peopleAhead * avgDuration);
  }

  return {
    averageServiceDurationMinutes,
    estimatedWaitMinutes,
    peopleAhead,
  };
}

// Helper: Update front of queue serviceStartedAt timestamp
export async function updateFrontOfQueueServiceStart(
  queueId: string,
  txClient: any = prisma,
) {
  const frontEntry = await txClient.queueEntry.findFirst({
    where: { queueId, status: "WAITING", position: 1 },
  });

  if (frontEntry && !frontEntry.serviceStartedAt) {
    await txClient.queueEntry.update({
      where: { id: frontEntry.id },
      data: { serviceStartedAt: new Date() },
    });
  }
}

// Real-Time Event Broadcasting Engine
export async function broadcastQueueUpdate(queueId: string) {
  if (!io) return;

  try {
    const queue = await prisma.queue.findUnique({ where: { id: queueId } });
    if (!queue) return;

    const activeEntries = await prisma.queueEntry.findMany({
      where: { queueId, status: "WAITING" },
      orderBy: { position: "asc" },
      select: {
        id: true,
        queueId: true,
        tenantId: true,
        name: true,
        phone: true,
        status: true,
        position: true,
        createdAt: true,
        serviceStartedAt: true,
      },
    });

    // 1. Broadcast to Admin Room
    io.to(`queue:admin:${queueId}`).emit("queue:admin_updated", {
      queueId,
      entries: activeEntries,
      count: activeEntries.length,
    });

    // 2. Broadcast to Public Room / Individual Socket Rooms
    for (const entry of activeEntries) {
      const eta = await calculateQueueETA(queueId, entry.position);
      io.to(`entry:${entry.id}`).emit("queue:status_updated", {
        entry: {
          id: entry.id,
          queueId: entry.queueId,
          name: entry.name,
          phone: entry.phone,
          status: entry.status,
          position: entry.position,
          createdAt: entry.createdAt,
          serviceStartedAt: entry.serviceStartedAt,
        },
        peopleAhead: eta.peopleAhead,
        queueName: queue.name,
        averageServiceDurationMinutes: eta.averageServiceDurationMinutes,
        estimatedWaitMinutes: eta.estimatedWaitMinutes,
      });
    }
  } catch (err) {
    console.error("Real-time broadcast error:", err);
  }
}

// Socket.IO Connection & Room Security
io.on("connection", (socket) => {
  socket.on("join_admin_room", async ({ queueId, token }) => {
    try {
      if (!token || !queueId) return;
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      if (!decoded || !decoded.tenantId) return;

      const queue = await prisma.queue.findUnique({ where: { id: queueId } });
      if (!queue || queue.tenantId !== decoded.tenantId) {
        socket.emit("error", { message: "Cross-tenant access blocked" });
        return;
      }

      socket.join(`queue:admin:${queueId}`);

      const entries = await prisma.queueEntry.findMany({
        where: { queueId, tenantId: decoded.tenantId, status: "WAITING" },
        orderBy: { position: "asc" },
      });
      socket.emit("queue:admin_updated", {
        queueId,
        entries,
        count: entries.length,
      });
    } catch (err) {
      socket.emit("error", { message: "Unauthorized admin room join" });
    }
  });

  socket.on("join_public_room", async ({ entryId, sessionToken }) => {
    try {
      if (!entryId || !sessionToken) return;
      const tokenHash = hashToken(sessionToken);

      const entry = await prisma.queueEntry.findUnique({
        where: { id: entryId },
        include: { queue: { select: { name: true } } },
      });

      if (!entry || entry.sessionTokenHash !== tokenHash) {
        socket.emit("error", { message: "Unauthorized entry access" });
        return;
      }

      socket.join(`entry:${entry.id}`);

      const eta = await calculateQueueETA(entry.queueId, entry.position);
      socket.emit("queue:status_updated", {
        entry: {
          id: entry.id,
          queueId: entry.queueId,
          name: entry.name,
          phone: entry.phone,
          status: entry.status,
          position: entry.position,
          createdAt: entry.createdAt,
          serviceStartedAt: entry.serviceStartedAt,
        },
        peopleAhead: eta.peopleAhead,
        queueName: entry.queue.name,
        averageServiceDurationMinutes: eta.averageServiceDurationMinutes,
        estimatedWaitMinutes: eta.estimatedWaitMinutes,
      });
    } catch (err) {
      socket.emit("error", { message: "Unauthorized public room join" });
    }
  });

  socket.on(
    "request_sync",
    async ({ queueId, entryId, sessionToken, adminToken }) => {
      if (adminToken && queueId) {
        try {
          const decoded = jwt.verify(adminToken, JWT_SECRET) as any;
          const queue = await prisma.queue.findUnique({
            where: { id: queueId },
          });
          if (queue && queue.tenantId === decoded.tenantId) {
            const entries = await prisma.queueEntry.findMany({
              where: { queueId, tenantId: decoded.tenantId, status: "WAITING" },
              orderBy: { position: "asc" },
            });
            socket.emit("queue:admin_updated", {
              queueId,
              entries,
              count: entries.length,
            });
          }
        } catch (err) {}
      } else if (entryId && sessionToken) {
        try {
          const tokenHash = hashToken(sessionToken);
          const entry = await prisma.queueEntry.findUnique({
            where: { id: entryId },
            include: { queue: { select: { name: true } } },
          });
          if (entry && entry.sessionTokenHash === tokenHash) {
            const eta = await calculateQueueETA(entry.queueId, entry.position);
            socket.emit("queue:status_updated", {
              entry: {
                id: entry.id,
                queueId: entry.queueId,
                name: entry.name,
                phone: entry.phone,
                status: entry.status,
                position: entry.position,
                createdAt: entry.createdAt,
                serviceStartedAt: entry.serviceStartedAt,
              },
              peopleAhead: eta.peopleAhead,
              queueName: entry.queue.name,
              averageServiceDurationMinutes: eta.averageServiceDurationMinutes,
              estimatedWaitMinutes: eta.estimatedWaitMinutes,
            });
          }
        } catch (err) {}
      }
    },
  );
});

export interface AuthRequest extends Request {
  user?: {
    id: string;
    tenantId: string;
    role: string;
  };
}

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

// List Queues
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

// Create Queue
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

// Public Queue Info
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

    const result = await prisma.$transaction(async (tx) => {
      try {
        await tx.$executeRaw`SELECT id FROM queues WHERE id = ${queueId} FOR UPDATE`;
      } catch (err) {}

      const lastEntry = await tx.queueEntry.findFirst({
        where: { queueId, status: "WAITING" },
        orderBy: { position: "desc" },
        select: { position: true },
      });
      const nextPosition = (lastEntry?.position || 0) + 1;
      const serviceStartedAt = nextPosition === 1 ? new Date() : null;

      const newEntry = await tx.queueEntry.create({
        data: {
          tenantId: queue.tenantId,
          queueId,
          name: validatedData.name,
          phone: validatedData.phone || null,
          status: "WAITING",
          position: nextPosition,
          sessionTokenHash: tokenHash,
          serviceStartedAt,
        },
      });

      await tx.queueEvent.create({
        data: {
          tenantId: queue.tenantId,
          queueId,
          queueEntryId: newEntry.id,
          eventType: "QUEUE_JOINED",
          actorRole: "USER",
          payload: JSON.stringify({
            position: nextPosition,
            name: newEntry.name,
          }),
        },
      });

      const eta = await calculateQueueETA(queueId, nextPosition, tx);

      return {
        entry: {
          id: newEntry.id,
          queueId: newEntry.queueId,
          tenantId: newEntry.tenantId,
          name: newEntry.name,
          phone: newEntry.phone,
          status: newEntry.status,
          position: newEntry.position,
          createdAt: newEntry.createdAt,
          serviceStartedAt: newEntry.serviceStartedAt,
        },
        sessionToken: rawToken,
        peopleAhead: eta.peopleAhead,
        queueName: queue.name,
        averageServiceDurationMinutes: eta.averageServiceDurationMinutes,
        estimatedWaitMinutes: eta.estimatedWaitMinutes,
      };
    });

    // Broadcast real-time update
    broadcastQueueUpdate(queueId);

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

// Get User Queue Status
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

    const eta = await calculateQueueETA(entry.queueId, entry.position);

    res.json({
      entry: {
        id: entry.id,
        queueId: entry.queueId,
        name: entry.name,
        phone: entry.phone,
        status: entry.status,
        position: entry.position,
        createdAt: entry.createdAt,
        serviceStartedAt: entry.serviceStartedAt,
        completedAt: entry.completedAt,
        cancelledAt: entry.cancelledAt,
      },
      peopleAhead: eta.peopleAhead,
      queueName: entry.queue.name,
      averageServiceDurationMinutes: eta.averageServiceDurationMinutes,
      estimatedWaitMinutes: eta.estimatedWaitMinutes,
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

      const completed = await tx.queueEntry.update({
        where: { id: entry.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
        },
      });

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

      await updateFrontOfQueueServiceStart(entry.queueId, tx);

      await tx.queueEvent.create({
        data: {
          tenantId: entry.tenantId,
          queueId: entry.queueId,
          queueEntryId: entry.id,
          eventType: "QUEUE_COMPLETED",
          actorRole: "USER",
          payload: JSON.stringify({ previousPosition: entry.position }),
        },
      });

      return completed;
    });

    broadcastQueueUpdate(entry.queueId);

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

      await updateFrontOfQueueServiceStart(entry.queueId, tx);

      await tx.queueEvent.create({
        data: {
          tenantId: entry.tenantId,
          queueId: entry.queueId,
          queueEntryId: entry.id,
          eventType: "QUEUE_CANCELLED",
          actorRole: "USER",
          payload: JSON.stringify({ previousPosition: entry.position }),
        },
      });

      return cancelled;
    });

    broadcastQueueUpdate(entry.queueId);

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
          serviceStartedAt: true,
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

        await updateFrontOfQueueServiceStart(entry.queueId, tx);

        await tx.queueEvent.create({
          data: {
            tenantId: entry.tenantId,
            queueId: entry.queueId,
            queueEntryId: entry.id,
            eventType: "QUEUE_COMPLETED",
            actorId: req.user!.id,
            actorRole: req.user!.role,
            payload: JSON.stringify({ previousPosition: entry.position }),
          },
        });

        return updated;
      });

      broadcastQueueUpdate(entry.queueId);

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

        await updateFrontOfQueueServiceStart(entry.queueId, tx);

        await tx.queueEvent.create({
          data: {
            tenantId: entry.tenantId,
            queueId: entry.queueId,
            queueEntryId: entry.id,
            eventType: "QUEUE_REMOVED",
            actorId: req.user!.id,
            actorRole: req.user!.role,
            payload: JSON.stringify({ previousPosition: entry.position }),
          },
        });

        return cancelled;
      });

      broadcastQueueUpdate(entry.queueId);

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

        const [moved] = waitingEntries.splice(currentIndex, 1);
        waitingEntries.splice(validTargetIndex, 0, moved);

        for (let i = 0; i < waitingEntries.length; i++) {
          const newPos = i + 1;
          await tx.queueEntry.update({
            where: { id: waitingEntries[i].id },
            data: { position: newPos },
          });
        }

        await updateFrontOfQueueServiceStart(entry.queueId, tx);

        const newPos = validTargetIndex + 1;

        await tx.queueEvent.create({
          data: {
            tenantId: entry.tenantId,
            queueId: entry.queueId,
            queueEntryId: entry.id,
            eventType: "QUEUE_REORDERED",
            actorId: req.user!.id,
            actorRole: req.user!.role,
            payload: JSON.stringify({
              fromPosition: entry.position,
              toPosition: newPos,
            }),
          },
        });

        return {
          id: entry.id,
          previousPosition: entry.position,
          newPosition: newPos,
        };
      });

      broadcastQueueUpdate(entry.queueId);

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
  httpServer.listen(PORT, () => {
    console.log(`API server running on http://localhost:${PORT}`);
  });
}

export default app;
