import { PrismaClient, UserRole } from "@prisma/client";
import { hashPassword } from "./password";

const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organization.upsert({
    where: { code: "DEMO" },
    update: {},
    create: {
      name: "Demo Organization",
      code: "DEMO",
      settings: { currency: "BDT" },
    },
  });

  const adminEmail = "admin@demo.com";
  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!existing) {
    await prisma.user.create({
      data: {
        organizationId: org.id,
        name: "Demo Admin",
        email: adminEmail,
        passwordHash: await hashPassword("admin123"),
        role: UserRole.ORGANIZATION_ADMIN,
      },
    });
  }

  const locations = [
    { name: "Dhanmondi Store", code: "DHK-DHN" },
    { name: "Mirpur Store", code: "DHK-MIR" },
    { name: "Central Warehouse", code: "WH-01" },
  ];

  for (const loc of locations) {
    await prisma.location.upsert({
      where: { organizationId_code: { organizationId: org.id, code: loc.code } },
      update: {},
      create: {
        organizationId: org.id,
        name: loc.name,
        code: loc.code,
        type: loc.code.startsWith("WH") ? "WAREHOUSE" : "STORE",
      },
    });
  }

  console.log("Seed complete.");
  console.log("Organization:", org.code, org.id);
  console.log("Login: admin@demo.com / admin123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });