import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Clear old entries
  await prisma.queueEntry.deleteMany({});
  await prisma.queueEvent.deleteMany({});
  await prisma.queue.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.tenant.deleteMany({});

  // 1. Create Demo Tenant
  const tenant = await prisma.tenant.create({
    data: {
      id: "tenant-demo-1",
      name: "NexTurn Demo Store",
      slug: "nexturn-demo",
      status: "ACTIVE",
    },
  });

  // 2. Create Demo Admin User
  const admin = await prisma.user.create({
    data: {
      id: "admin-demo-1",
      tenantId: tenant.id,
      name: "Demo Admin",
      email: "admin@example.com",
      passwordHash: "password123",
      role: "ORGANIZATION_ADMIN",
      status: "ACTIVE",
    },
  });

  // 3. Create Initial Demo Queue
  const queue = await prisma.queue.create({
    data: {
      id: "queue-demo-1",
      tenantId: tenant.id,
      name: "Express Counter",
      status: "ACTIVE",
      joinEnabled: true,
    },
  });

  console.log("Seed completed successfully:", {
    tenant: tenant.name,
    admin: admin.email,
    queue: queue.name,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
