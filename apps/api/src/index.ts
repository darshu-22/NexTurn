import express, { Request, Response, NextFunction } from "express";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { PrismaClient, Prisma } from "@prisma/client";
import dotenv from "dotenv";
import crypto from "crypto";
import {
  LoginSchema,
  SignupSchema,
  CreateAdminSchema,
  QueueCreateSchema,
  JoinQueueSchema,
  ReorderQueueSchema,
} from "@nexturn/validation";

dotenv.config();

const DEFAULT_INSECURE_SECRETS = [
  "fallback-secret-do-not-use-in-prod",
  "dev-secret-key-12345",
  "your-super-secure-jwt-secret-key-change-in-production",
  "change-in-production",
  "secret",
  "123456",
];

if (process.env.NODE_ENV === "production") {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret || DEFAULT_INSECURE_SECRETS.includes(secret)) {
    console.error(
      "FATAL PRODUCTION CONFIGURATION ERROR: A secure, strong JWT_SECRET environment variable must be set in production mode!",
    );
    process.exit(1);
  }
}

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

export async function bootstrapSuperAdmin() {
  const email = process.env.SUPER_ADMIN_EMAIL?.trim();
  const password = process.env.SUPER_ADMIN_PASSWORD?.trim();

  try {
    const defaultTenant =
      (await prisma.tenant.findFirst({ where: { slug: "nexturn-demo" } })) ||
      (await prisma.tenant.findFirst({ where: { status: "ACTIVE" } }));

    if (!defaultTenant) return;

    const existingSuperAdmin = await prisma.user.findFirst({
      where: { tenantId: defaultTenant.id, role: "SUPER_ADMIN" },
    });

    if (!existingSuperAdmin) {
      const targetEmail = email || "superadmin@example.com";
      const targetPassword = password || "password123";
      const passwordHash = await bcrypt.hash(targetPassword, 10);

      await prisma.user.create({
        data: {
          tenantId: defaultTenant.id,
          name: "Super Admin",
          email: targetEmail,
          passwordHash,
          role: "SUPER_ADMIN",
          status: "ACTIVE",
        },
      });
    } else if (email && password) {
      const passwordHash = await bcrypt.hash(password, 10);
      await prisma.user.update({
        where: { id: existingSuperAdmin.id },
        data: {
          email,
          passwordHash,
        },
      });
    }
  } catch (err) {
    // Ignore initialization errors in mock environments
  }
}

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
  txClient: Prisma.TransactionClient | PrismaClient = prisma,
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
  txClient: Prisma.TransactionClient | PrismaClient = prisma,
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

// User Signup (Normal public user registration - ALWAYS forces role USER)
app.post("/api/auth/signup", async (req, res) => {
  try {
    const validatedData = SignupSchema.parse(req.body);
    const { name, email, phone, password, tenantSlug } = validatedData;

    const existingUser = await prisma.user.findFirst({ where: { email } });
    if (existingUser) {
      return res
        .status(400)
        .json({ error: "User with this email already exists" });
    }

    let tenant = null;
    if (tenantSlug) {
      tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    }
    if (!tenant) {
      tenant = await prisma.tenant.findFirst({ where: { status: "ACTIVE" } });
    }
    if (!tenant) {
      return res.status(400).json({ error: "No active tenant found" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // CRITICAL SECURITY ENFORCEMENT:
    // Normal signup MUST ALWAYS create role USER.
    // Client cannot override role to SUPER_ADMIN or ADMIN.
    const user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        name,
        email,
        phone,
        passwordHash,
        role: "USER",
        status: "ACTIVE",
      },
    });

    const token = jwt.sign(
      {
        id: user.id,
        tenantId: user.tenantId,
        role: user.role,
        name: user.name,
        email: user.email,
      },
      JWT_SECRET,
      { expiresIn: "8h" },
    );

    res.status(201).json({
      token,
      role: user.role,
      tenantId: user.tenantId,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || "Invalid signup request" });
  }
});

// Unified Login (For SUPER_ADMIN, ADMIN, and USER)
app.post("/api/auth/login", async (req, res) => {
  try {
    const validatedData = LoginSchema.parse(req.body);
    const { email, password } = validatedData;

    const user = await prisma.user.findFirst({ where: { email } });

    if (!user || !user.passwordHash) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    let isMatch = false;
    if (
      user.passwordHash.startsWith("$2a$") ||
      user.passwordHash.startsWith("$2b$")
    ) {
      isMatch = await bcrypt.compare(password, user.passwordHash);
    } else {
      isMatch = user.passwordHash === password;
    }

    if (!isMatch) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (user.status === "INACTIVE" || user.status === "SUSPENDED") {
      return res.status(403).json({ error: "Account is disabled" });
    }

    const token = jwt.sign(
      {
        id: user.id,
        tenantId: user.tenantId,
        role: user.role,
        name: user.name,
        email: user.email,
      },
      JWT_SECRET,
      { expiresIn: "8h" },
    );

    res.json({
      token,
      role: user.role,
      tenantId: user.tenantId,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (error) {
    res.status(400).json({ error: "Invalid request" });
  }
});

// Authenticated Profile Me Endpoint
app.get("/api/auth/me", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        tenantId: true,
        status: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// SUPER ADMIN: Create Admin Account
app.post(
  "/api/super-admin/admins",
  authenticateToken,
  requireTenantAccess,
  requireRole(["SUPER_ADMIN"]),
  async (req: AuthRequest, res) => {
    try {
      const validatedData = CreateAdminSchema.parse(req.body);
      const { name, email, phone, password } = validatedData;

      const existingUser = await prisma.user.findFirst({ where: { email } });
      if (existingUser) {
        return res
          .status(400)
          .json({ error: "User with this email already exists" });
      }

      const passwordHash = await bcrypt.hash(password, 10);

      // CRITICAL: Created account role MUST be ADMIN.
      // tenantId MUST come from the authenticated Super Admin's tenant context.
      const admin = await prisma.user.create({
        data: {
          tenantId: req.user!.tenantId,
          name,
          email,
          phone,
          passwordHash,
          role: "ADMIN",
          status: "ACTIVE",
        },
        select: {
          id: true,
          tenantId: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          status: true,
          createdAt: true,
        },
      });

      res.status(201).json(admin);
    } catch (error: any) {
      res
        .status(400)
        .json({ error: error?.message || "Invalid request to create admin" });
    }
  },
);

// SUPER ADMIN: List Admins
app.get(
  "/api/super-admin/admins",
  authenticateToken,
  requireTenantAccess,
  requireRole(["SUPER_ADMIN"]),
  async (req: AuthRequest, res) => {
    try {
      const admins = await prisma.user.findMany({
        where: {
          tenantId: req.user!.tenantId,
          role: "ADMIN",
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      });

      res.json(admins);
    } catch (error) {
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// SUPER ADMIN: Toggle Admin Account Status
app.patch(
  "/api/super-admin/admins/:id/status",
  authenticateToken,
  requireTenantAccess,
  requireRole(["SUPER_ADMIN"]),
  async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!status || !["ACTIVE", "INACTIVE", "SUSPENDED"].includes(status)) {
        return res.status(400).json({ error: "Invalid status value" });
      }

      const targetUser = await prisma.user.findUnique({ where: { id } });
      if (!targetUser || targetUser.tenantId !== req.user!.tenantId) {
        return res
          .status(403)
          .json({ error: "Forbidden: Target user not found or access denied" });
      }

      if (targetUser.role === "SUPER_ADMIN") {
        return res
          .status(400)
          .json({ error: "Cannot modify Super Admin account status" });
      }

      const updated = await prisma.user.update({
        where: { id },
        data: { status },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          status: true,
        },
      });

      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// USER: View Own Queue Entries
app.get(
  "/api/user/entries",
  authenticateToken,
  async (req: AuthRequest, res) => {
    try {
      const entries = await prisma.queueEntry.findMany({
        where: {
          userId: req.user!.id,
          status: "WAITING",
        },
        include: {
          queue: { select: { id: true, name: true, status: true } },
        },
        orderBy: { createdAt: "desc" },
      });

      res.json(entries);
    } catch (error) {
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

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

app.post(
  "/api/queues/:id/join",
  authenticateToken,
  requireRole(["USER"]),
  async (req: AuthRequest, res) => {
    try {
      const { id: queueId } = req.params;

      const userObj = await prisma.user.findUnique({
        where: { id: req.user!.id },
      });

      if (!userObj) {
        return res.status(401).json({ error: "User profile not found" });
      }

      // CRITICAL SECURITY & COMPLIANCE:
      // Name and phone are strictly taken from the authenticated user's saved account.
      // Request body values cannot override authenticated user identity.
      const name = userObj.name;
      const phone = userObj.phone || null;

      const queue = await prisma.queue.findUnique({
        where: { id: queueId },
      });

      if (!queue || queue.status !== "ACTIVE" || !queue.joinEnabled) {
        return res
          .status(400)
          .json({ error: "Queue is currently closed or unavailable" });
      }

      const { rawToken, tokenHash } = generateSessionToken();

      const result = await prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
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
              userId: userObj.id,
              name,
              phone,
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
            entry: newEntry,
            rawToken,
            peopleAhead: eta.peopleAhead,
            averageServiceDurationMinutes: eta.averageServiceDurationMinutes,
            estimatedWaitMinutes: eta.estimatedWaitMinutes,
          };
        },
      );

      // Realtime notifications
      io.to(`queue:${queueId}`).emit("queue:entry_joined", {
        queueId,
        entry: {
          id: result.entry.id,
          position: result.entry.position,
          status: result.entry.status,
        },
      });

      const updatedEntries = await prisma.queueEntry.findMany({
        where: { queueId, tenantId: queue.tenantId, status: "WAITING" },
        orderBy: { position: "asc" },
      });

      io.to(`queue:admin:${queueId}`).emit("queue:admin_updated", {
        queueId,
        entries: updatedEntries,
        count: updatedEntries.length,
      });

      res.status(201).json({
        entry: {
          id: result.entry.id,
          queueId: result.entry.queueId,
          name: result.entry.name,
          phone: result.entry.phone,
          status: result.entry.status,
          position: result.entry.position,
          createdAt: result.entry.createdAt,
          serviceStartedAt: result.entry.serviceStartedAt,
        },
        sessionToken: result.rawToken,
        queueName: queue.name,
        peopleAhead: result.peopleAhead,
        averageServiceDurationMinutes: result.averageServiceDurationMinutes,
        estimatedWaitMinutes: result.estimatedWaitMinutes,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to join queue" });
    }
  },
);

// Get User Queue Status (Supports Session Token or Authenticated User JWT)
app.get("/api/queue-entries/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const sessionToken =
      (req.headers["x-session-token"] as string) || (req.query.token as string);

    let authUser: any = null;
    const authHeader = req.headers["authorization"];
    if (authHeader && authHeader.startsWith("Bearer ")) {
      try {
        const token = authHeader.split(" ")[1];
        authUser = jwt.verify(token, JWT_SECRET);
      } catch (err) {}
    }

    if (!sessionToken && !authUser) {
      return res
        .status(401)
        .json({ error: "Unauthorized: Session token required" });
    }

    const entry = await prisma.queueEntry.findUnique({
      where: { id },
      include: { queue: { select: { name: true } } },
    });

    if (!entry) {
      return res.status(404).json({ error: "Queue entry not found" });
    }

    const isTokenMatch =
      sessionToken && entry.sessionTokenHash === hashToken(sessionToken);
    const isUserOwner = authUser && authUser.id === entry.userId;
    const isAdmin =
      authUser &&
      authUser.tenantId === entry.tenantId &&
      ["SUPER_ADMIN", "ADMIN", "ORGANIZATION_ADMIN", "QUEUE_OPERATOR"].includes(
        authUser.role,
      );

    if (!isTokenMatch && !isUserOwner && !isAdmin) {
      return res
        .status(403)
        .json({ error: "Forbidden: Access denied to this queue entry" });
    }

    const eta = await calculateQueueETA(entry.queueId, entry.position);

    res.json({
      entry: {
        id: entry.id,
        queueId: entry.queueId,
        userId: entry.userId,
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

    let authUser: any = null;
    const authHeader = req.headers["authorization"];
    if (authHeader && authHeader.startsWith("Bearer ")) {
      try {
        const token = authHeader.split(" ")[1];
        authUser = jwt.verify(token, JWT_SECRET);
      } catch (err) {}
    }

    const entry = await prisma.queueEntry.findUnique({ where: { id } });
    if (!entry) {
      return res.status(404).json({ error: "Queue entry not found" });
    }

    const isTokenMatch =
      sessionToken && entry.sessionTokenHash === hashToken(sessionToken);
    const isUserOwner = authUser && authUser.id === entry.userId;
    const isAdmin =
      authUser &&
      authUser.tenantId === entry.tenantId &&
      ["SUPER_ADMIN", "ADMIN", "ORGANIZATION_ADMIN", "QUEUE_OPERATOR"].includes(
        authUser.role,
      );

    if (!isTokenMatch && !isUserOwner && !isAdmin) {
      return res
        .status(403)
        .json({ error: "Forbidden: Access denied to complete this entry" });
    }

    if (entry.status !== "WAITING") {
      return res
        .status(400)
        .json({ error: `Cannot complete entry with status ${entry.status}` });
    }

    const updatedEntry = await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
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
            actorRole: authUser?.role || "USER",
            payload: JSON.stringify({ previousPosition: entry.position }),
          },
        });

        return completed;
      },
    );

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

    let authUser: any = null;
    const authHeader = req.headers["authorization"];
    if (authHeader && authHeader.startsWith("Bearer ")) {
      try {
        const token = authHeader.split(" ")[1];
        authUser = jwt.verify(token, JWT_SECRET);
      } catch (err) {}
    }

    const entry = await prisma.queueEntry.findUnique({ where: { id } });
    if (!entry) {
      return res.status(404).json({ error: "Queue entry not found" });
    }

    const isTokenMatch =
      sessionToken && entry.sessionTokenHash === hashToken(sessionToken);
    const isUserOwner = authUser && authUser.id === entry.userId;
    const isAdmin =
      authUser &&
      authUser.tenantId === entry.tenantId &&
      ["SUPER_ADMIN", "ADMIN", "ORGANIZATION_ADMIN", "QUEUE_OPERATOR"].includes(
        authUser.role,
      );

    if (!isTokenMatch && !isUserOwner && !isAdmin) {
      return res
        .status(403)
        .json({ error: "Forbidden: Access denied to cancel this entry" });
    }

    if (entry.status !== "WAITING") {
      return res
        .status(400)
        .json({ error: `Cannot cancel entry with status ${entry.status}` });
    }

    const cancelledEntry = await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
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
      },
    );

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

      const completedEntry = await prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
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
        },
      );

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

      const removedEntry = await prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
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
        },
      );

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

      const reorderedResult = await prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          try {
            await tx.$executeRaw`SELECT id FROM queues WHERE id = ${entry.queueId} FOR UPDATE`;
          } catch (err) {}

          const waitingEntries = await tx.queueEntry.findMany({
            where: { queueId: entry.queueId, status: "WAITING" },
            orderBy: [{ position: "asc" }, { createdAt: "asc" }],
          });

          const currentIndex = waitingEntries.findIndex(
            (e: { id: string }) => e.id === entry.id,
          );
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
        },
      );

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
    console.log(`API server running on port ${PORT}`);
    bootstrapSuperAdmin().catch((err) => {
      console.error("Super Admin bootstrap error:", err);
    });
  });
}

export default app;
