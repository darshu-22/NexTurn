import { PrismaClient } from "../../apps/api/node_modules/@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import fs from "fs";
import path from "path";

// 1. Read root .env.test.local safely without exposing secrets
const envTestPath = path.resolve(__dirname, "../../.env.test.local");
let localDbUrl = "";

if (fs.existsSync(envTestPath)) {
  const content = fs.readFileSync(envTestPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^DATABASE_URL=(.*)$/);
    if (match) {
      localDbUrl = match[1].trim().replace(/^["']|["']$/g, "");
      break;
    }
  }
}

if (!localDbUrl) {
  localDbUrl = process.env.DATABASE_URL || "";
}

if (!localDbUrl) {
  console.error("FATAL: DATABASE_URL is not defined.");
  process.exit(1);
}

// 2. Strict Safety Guard: Conclusively verify target database is local loopback test DB
try {
  const parsed = new URL(localDbUrl);
  const isLoopback =
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "localhost" ||
    parsed.hostname === "[::1]";

  const cleanPath = parsed.pathname.replace(/^\/+/, "");
  let dbName: string | null = null;
  if (cleanPath && !cleanPath.includes("/")) {
    try {
      dbName = decodeURIComponent(cleanPath);
    } catch {
      dbName = null;
    }
  }

  if (!isLoopback || dbName !== "nexturn_test") {
    console.error(
      `FATAL SAFETY VIOLATION: Cross-tenant fixture script can only run against a local test database (127.0.0.1/localhost with nexturn_test). Refusing to run against: ${parsed.hostname}/${cleanPath}`,
    );
    process.exit(1);
  }
} catch (e) {
  console.error("FATAL: Failed to validate DATABASE_URL format:", e);
  process.exit(1);
}

const prisma = new PrismaClient({
  datasources: {
    db: { url: localDbUrl },
  },
});

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function seedCrossTenantFixtures() {
  const passwordHash = await bcrypt.hash("password123", 10);

  // 1. Tenant A Fixtures
  const tenantA = await prisma.tenant.upsert({
    where: { id: "tenant-cross-a" },
    update: {
      name: "Tenant A Alpha",
      slug: "tenant-cross-a",
      status: "ACTIVE",
    },
    create: {
      id: "tenant-cross-a",
      name: "Tenant A Alpha",
      slug: "tenant-cross-a",
      status: "ACTIVE",
    },
  });

  const adminA = await prisma.user.upsert({
    where: { id: "admin-cross-a" },
    update: {
      tenantId: tenantA.id,
      name: "Admin Alpha",
      email: "admin-a@example.com",
      phone: "+15551110001",
      passwordHash,
      role: "ADMIN",
      status: "ACTIVE",
    },
    create: {
      id: "admin-cross-a",
      tenantId: tenantA.id,
      name: "Admin Alpha",
      email: "admin-a@example.com",
      phone: "+15551110001",
      passwordHash,
      role: "ADMIN",
      status: "ACTIVE",
    },
  });

  const userA = await prisma.user.upsert({
    where: { id: "user-cross-a" },
    update: {
      tenantId: tenantA.id,
      name: "User Alpha",
      email: "user-a@example.com",
      phone: "+15551110002",
      passwordHash,
      role: "USER",
      status: "ACTIVE",
    },
    create: {
      id: "user-cross-a",
      tenantId: tenantA.id,
      name: "User Alpha",
      email: "user-a@example.com",
      phone: "+15551110002",
      passwordHash,
      role: "USER",
      status: "ACTIVE",
    },
  });

  const queueA = await prisma.queue.upsert({
    where: { id: "queue-cross-a" },
    update: {
      tenantId: tenantA.id,
      name: "Queue Alpha",
      status: "ACTIVE",
      joinEnabled: true,
    },
    create: {
      id: "queue-cross-a",
      tenantId: tenantA.id,
      name: "Queue Alpha",
      status: "ACTIVE",
      joinEnabled: true,
    },
  });

  const entryA1 = await prisma.queueEntry.upsert({
    where: { id: "entry-cross-a1" },
    update: {
      tenantId: tenantA.id,
      queueId: queueA.id,
      userId: userA.id,
      name: "User Alpha",
      phone: "+15551110002",
      status: "WAITING",
      position: 1,
      sessionTokenHash: hashToken("token-cross-a1"),
    },
    create: {
      id: "entry-cross-a1",
      tenantId: tenantA.id,
      queueId: queueA.id,
      userId: userA.id,
      name: "User Alpha",
      phone: "+15551110002",
      status: "WAITING",
      position: 1,
      sessionTokenHash: hashToken("token-cross-a1"),
    },
  });

  const entryA2 = await prisma.queueEntry.upsert({
    where: { id: "entry-cross-a2" },
    update: {
      tenantId: tenantA.id,
      queueId: queueA.id,
      userId: userA.id,
      name: "User Alpha Two",
      phone: "+15551110003",
      status: "WAITING",
      position: 2,
      sessionTokenHash: hashToken("token-cross-a2"),
    },
    create: {
      id: "entry-cross-a2",
      tenantId: tenantA.id,
      queueId: queueA.id,
      userId: userA.id,
      name: "User Alpha Two",
      phone: "+15551110003",
      status: "WAITING",
      position: 2,
      sessionTokenHash: hashToken("token-cross-a2"),
    },
  });

  // 2. Tenant B Fixtures
  const tenantB = await prisma.tenant.upsert({
    where: { id: "tenant-cross-b" },
    update: { name: "Tenant B Beta", slug: "tenant-cross-b", status: "ACTIVE" },
    create: {
      id: "tenant-cross-b",
      name: "Tenant B Beta",
      slug: "tenant-cross-b",
      status: "ACTIVE",
    },
  });

  const adminB = await prisma.user.upsert({
    where: { id: "admin-cross-b" },
    update: {
      tenantId: tenantB.id,
      name: "Admin Beta",
      email: "admin-b@example.com",
      phone: "+15552220001",
      passwordHash,
      role: "ADMIN",
      status: "ACTIVE",
    },
    create: {
      id: "admin-cross-b",
      tenantId: tenantB.id,
      name: "Admin Beta",
      email: "admin-b@example.com",
      phone: "+15552220001",
      passwordHash,
      role: "ADMIN",
      status: "ACTIVE",
    },
  });

  const userB = await prisma.user.upsert({
    where: { id: "user-cross-b" },
    update: {
      tenantId: tenantB.id,
      name: "User Beta",
      email: "user-b@example.com",
      phone: "+15552220002",
      passwordHash,
      role: "USER",
      status: "ACTIVE",
    },
    create: {
      id: "user-cross-b",
      tenantId: tenantB.id,
      name: "User Beta",
      email: "user-b@example.com",
      phone: "+15552220002",
      passwordHash,
      role: "USER",
      status: "ACTIVE",
    },
  });

  const queueB = await prisma.queue.upsert({
    where: { id: "queue-cross-b" },
    update: {
      tenantId: tenantB.id,
      name: "Queue Beta",
      status: "ACTIVE",
      joinEnabled: true,
    },
    create: {
      id: "queue-cross-b",
      tenantId: tenantB.id,
      name: "Queue Beta",
      status: "ACTIVE",
      joinEnabled: true,
    },
  });

  const entryB1 = await prisma.queueEntry.upsert({
    where: { id: "entry-cross-b1" },
    update: {
      tenantId: tenantB.id,
      queueId: queueB.id,
      userId: userB.id,
      name: "User Beta",
      phone: "+15552220002",
      status: "WAITING",
      position: 1,
      sessionTokenHash: hashToken("token-cross-b1"),
    },
    create: {
      id: "entry-cross-b1",
      tenantId: tenantB.id,
      queueId: queueB.id,
      userId: userB.id,
      name: "User Beta",
      phone: "+15552220002",
      status: "WAITING",
      position: 1,
      sessionTokenHash: hashToken("token-cross-b1"),
    },
  });

  const entryB2 = await prisma.queueEntry.upsert({
    where: { id: "entry-cross-b2" },
    update: {
      tenantId: tenantB.id,
      queueId: queueB.id,
      userId: userB.id,
      name: "User Beta Two",
      phone: "+15552220003",
      status: "WAITING",
      position: 2,
      sessionTokenHash: hashToken("token-cross-b2"),
    },
    create: {
      id: "entry-cross-b2",
      tenantId: tenantB.id,
      queueId: queueB.id,
      userId: userB.id,
      name: "User Beta Two",
      phone: "+15552220003",
      status: "WAITING",
      position: 2,
      sessionTokenHash: hashToken("token-cross-b2"),
    },
  });

  return {
    tenantA,
    adminA,
    userA,
    queueA,
    entryA1,
    entryA2,
    tenantB,
    adminB,
    userB,
    queueB,
    entryB1,
    entryB2,
  };
}

// Execute standalone if called directly
if (require.main === module) {
  seedCrossTenantFixtures()
    .then((res) => {
      console.log("Cross-tenant fixtures successfully seeded:", {
        tenantA: res.tenantA.id,
        adminA: res.adminA.email,
        queueA: res.queueA.id,
        tenantB: res.tenantB.id,
        adminB: res.adminB.email,
        queueB: res.queueB.id,
      });
    })
    .catch((err) => {
      console.error("Failed to seed cross-tenant fixtures:", err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
