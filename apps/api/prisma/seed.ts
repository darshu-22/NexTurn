import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // Clear old entries
  await prisma.queueEntry.deleteMany({});
  await prisma.queueEvent.deleteMany({});
  await prisma.queue.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.tenant.deleteMany({});

  const passwordHash = bcrypt.hashSync("password123", 10);

  // 1. Create Demo Tenant
  const tenant = await prisma.tenant.create({
    data: {
      id: "tenant-demo-1",
      name: "NexTurn Demo Store",
      slug: "nexturn-demo",
      status: "ACTIVE",
    },
  });

  // 2. Create Initial Super Admin User (1 per tenant)
  const superAdmin = await prisma.user.create({
    data: {
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

  // 3. Create Initial Admin User
  const admin = await prisma.user.create({
    data: {
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

  // 4. Create Initial Normal User
  const user = await prisma.user.create({
    data: {
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

  // 5. Create Initial Demo Queue
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
    superAdmin: superAdmin.email,
    admin: admin.email,
    user: user.email,
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
