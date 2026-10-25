import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

// Safety check: Ensure execution is strictly against local test database
const rawUrl = process.env.DATABASE_URL;
if (!rawUrl) {
  console.error("FATAL: DATABASE_URL is not defined.");
  process.exit(1);
}

try {
  const parsed = new URL(rawUrl);
  const isLoopback =
    parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  const isTestDb = parsed.pathname.includes("nexturn_test");

  if (!isLoopback || !isTestDb) {
    console.error(
      `FATAL SAFETY VIOLATION: Fixture script can only run against a local test database (127.0.0.1/localhost with nexturn_test). Refusing to run against: ${parsed.hostname}${parsed.pathname}`,
    );
    process.exit(1);
  }
} catch (e) {
  console.error("FATAL: Failed to validate DATABASE_URL format:", e);
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  const testPassword = process.env.LOCAL_TEST_PASSWORD || "password123";
  const passwordHash = await bcrypt.hash(testPassword, 10);

  // 1. Idempotent Tenant Creation / Update
  const tenant = await prisma.tenant.upsert({
    where: { slug: "nexturn-demo" },
    update: {
      name: "NexTurn Demo Store",
      status: "ACTIVE",
    },
    create: {
      id: "tenant-demo-1",
      name: "NexTurn Demo Store",
      slug: "nexturn-demo",
      status: "ACTIVE",
    },
  });

  // 2. Idempotent Super Admin Account Creation / Update
  const superAdmin = await prisma.user.upsert({
    where: { id: "superadmin-demo-1" },
    update: {
      tenantId: tenant.id,
      name: "Demo Super Admin",
      email: "superadmin@example.com",
      phone: "+15550000000",
      passwordHash,
      role: "SUPER_ADMIN",
      status: "ACTIVE",
    },
    create: {
      id: "superadmin-demo-1",
      tenantId: tenant.id,
      name: "Demo Super Admin",
      email: "superadmin@example.com",
      phone: "+15550000000",
      passwordHash,
      role: "SUPER_ADMIN",
      status: "ACTIVE",
    },
  });

  // 3. Idempotent Admin Account Creation / Update
  const admin = await prisma.user.upsert({
    where: { id: "admin-demo-1" },
    update: {
      tenantId: tenant.id,
      name: "Demo Admin",
      email: "admin@example.com",
      phone: "+15550001111",
      passwordHash,
      role: "ADMIN",
      status: "ACTIVE",
    },
    create: {
      id: "admin-demo-1",
      tenantId: tenant.id,
      name: "Demo Admin",
      email: "admin@example.com",
      phone: "+15550001111",
      passwordHash,
      role: "ADMIN",
      status: "ACTIVE",
    },
  });

  // 4. Idempotent Customer Account Creation / Update
  const user = await prisma.user.upsert({
    where: { id: "user-demo-1" },
    update: {
      tenantId: tenant.id,
      name: "Demo Customer User",
      email: "user@example.com",
      phone: "+15550002222",
      passwordHash,
      role: "USER",
      status: "ACTIVE",
    },
    create: {
      id: "user-demo-1",
      tenantId: tenant.id,
      name: "Demo Customer User",
      email: "user@example.com",
      phone: "+15550002222",
      passwordHash,
      role: "USER",
      status: "ACTIVE",
    },
  });

  // 5. Idempotent Baseline Demo Queue Creation / Update
  const queue = await prisma.queue.upsert({
    where: { id: "queue-demo-1" },
    update: {
      tenantId: tenant.id,
      name: "Express Counter",
      status: "ACTIVE",
      joinEnabled: true,
    },
    create: {
      id: "queue-demo-1",
      tenantId: tenant.id,
      name: "Express Counter",
      status: "ACTIVE",
      joinEnabled: true,
    },
  });

  console.log("Safe local test fixtures successfully synchronized:", {
    tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
    superAdmin: {
      id: superAdmin.id,
      email: superAdmin.email,
      role: superAdmin.role,
    },
    admin: { id: admin.id, email: admin.email, role: admin.role },
    user: { id: user.id, email: user.email, role: user.role },
    queue: { id: queue.id, name: queue.name, status: queue.status },
  });
}

main()
  .catch((e) => {
    console.error("Fixture creation failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
