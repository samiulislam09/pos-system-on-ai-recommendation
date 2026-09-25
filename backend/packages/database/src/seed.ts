import { PrismaClient, UserRole } from "@prisma/client";
import { hashPassword } from "./password";

const prisma = new PrismaClient();

const DEMO_CSV_HEADER =
  "po_number,vendor_id,vendor_name,sku,item_description,category,order_qty,unit_price_bdt,total_amount_bdt,order_date,delivery_date,status";

async function seedDemoSupplierPortal(orgId: string) {
  const supplier = await prisma.supplier.upsert({
    where: { organizationId_name: { organizationId: orgId, name: "Aarong Dairy & FMCG Logistics" } },
    update: {},
    create: {
      organizationId: orgId,
      name: "Aarong Dairy & FMCG Logistics",
      contactName: "Supplier Ops",
      phone: "+8801711111111",
      email: "supplier@demo.com",
      address: "Dhaka, Bangladesh",
    },
  });

  const supplierUser = await prisma.supplierUser.upsert({
    where: { email: "supplier@demo.com" },
    update: {},
    create: {
      organizationId: orgId,
      supplierId: supplier.id,
      name: "Aarong Supply",
      email: "supplier@demo.com",
      passwordHash: await hashPassword("supplier123"),
      phone: "+8801711111111",
    },
  });

  const pendingUpload = await prisma.supplierUpload.findFirst({
    where: { supplierUserId: supplierUser.id, status: "PENDING" },
  });
  if (!pendingUpload) {
    const fileContent = [
      DEMO_CSV_HEADER,
      "PO-BD-2026-1001,VEND_BD_001,Aarong Dairy & FMCG Logistics,SKU_MILK_1L,Aarong Liquid Milk 1L,Dairy,1000,90.0,90000.0,2026-07-15,2026-07-17,Pending",
      "PO-BD-2026-1002,VEND_BD_001,Aarong Dairy & FMCG Logistics,SKU_BUTTER_200G,Aarong Salted Butter 200g,Dairy,500,240.0,120000.0,2026-07-30,2026-08-02,Delivered",
      "PO-BD-2026-1003,VEND_BD_001,Aarong Dairy & FMCG Logistics,SKU_GHEE_500G,Aarong Premium Ghee 500g,Dairy,500,680.0,340000.0,2026-07-22,2026-07-24,In Transit",
    ].join("\n");

    const created = await prisma.supplierUpload.create({
      data: {
        organizationId: orgId,
        supplierUserId: supplierUser.id,
        originalName: "aarong_july_deliveries.csv",
        mimeType: "text/csv",
        fileSize: fileContent.length,
        fileContent,
        rowCount: 3,
        status: "PENDING",
        items: {
          create: [
            {
              poNumber: "PO-BD-2026-1001",
              vendorId: "VEND_BD_001",
              vendorName: "Aarong Dairy & FMCG Logistics",
              sku: "SKU_MILK_1L",
              itemDescription: "Aarong Liquid Milk 1L",
              category: "Dairy",
              orderQty: 1000,
              unitPriceBdt: 90,
              totalAmountBdt: 90000,
              orderDate: "2026-07-15",
              deliveryDate: "2026-07-17",
              status: "Pending",
            },
            {
              poNumber: "PO-BD-2026-1002",
              vendorId: "VEND_BD_001",
              vendorName: "Aarong Dairy & FMCG Logistics",
              sku: "SKU_BUTTER_200G",
              itemDescription: "Aarong Salted Butter 200g",
              category: "Dairy",
              orderQty: 500,
              unitPriceBdt: 240,
              totalAmountBdt: 120000,
              orderDate: "2026-07-30",
              deliveryDate: "2026-08-02",
              status: "Delivered",
            },
            {
              poNumber: "PO-BD-2026-1003",
              vendorId: "VEND_BD_001",
              vendorName: "Aarong Dairy & FMCG Logistics",
              sku: "SKU_GHEE_500G",
              itemDescription: "Aarong Premium Ghee 500g",
              category: "Dairy",
              orderQty: 500,
              unitPriceBdt: 680,
              totalAmountBdt: 340000,
              orderDate: "2026-07-22",
              deliveryDate: "2026-07-24",
              status: "In Transit",
            },
          ],
        },
      },
    });
    await prisma.supplierNotification.create({
      data: {
        organizationId: orgId,
        supplierUserId: supplierUser.id,
        uploadId: created.id,
        type: "UPLOAD_RECEIVED",
        message: `Your file "${created.originalName}" was uploaded and sent to the vendor for review.`,
      },
    });
  }

  const rejectedUpload = await prisma.supplierUpload.findFirst({
    where: { supplierUserId: supplierUser.id, status: "REJECTED" },
  });
  if (!rejectedUpload) {
    const fileContent = [
      DEMO_CSV_HEADER,
      "PO-BD-2026-1050,VEND_BD_001,Aarong Dairy & FMCG Logistics,SKU_SEMIA_200G,Aarong Vermicelli Shemai 200g,Bakery,1000,40.0,40000.0,2026-07-12,2026-07-15,Delivered",
      "PO-BD-2026-1051,VEND_BD_001,Aarong Dairy & FMCG Logistics,SKU_LACCCHA_SHEMAI_200G,,Bakery,800,110.0,88000.0,2026-08-25,2026-08-27,Delivered",
    ].join("\n");

    const created = await prisma.supplierUpload.create({
      data: {
        organizationId: orgId,
        supplierUserId: supplierUser.id,
        originalName: "bakery_items_aug.csv",
        mimeType: "text/csv",
        fileSize: fileContent.length,
        fileContent,
        rowCount: 2,
        status: "REJECTED",
        issues: [
          { row: 2, field: "item_description", message: "item_description is missing" },
        ],
        vendorNote:
          "Row 2 is missing the item description. Please fill in the missing data and resubmit so we can review it again.",
        items: {
          create: [
            {
              poNumber: "PO-BD-2026-1050",
              vendorId: "VEND_BD_001",
              vendorName: "Aarong Dairy & FMCG Logistics",
              sku: "SKU_SEMIA_200G",
              itemDescription: "Aarong Vermicelli Shemai 200g",
              category: "Bakery",
              orderQty: 1000,
              unitPriceBdt: 40,
              totalAmountBdt: 40000,
              orderDate: "2026-07-12",
              deliveryDate: "2026-07-15",
              status: "Delivered",
            },
            {
              poNumber: "PO-BD-2026-1051",
              vendorId: "VEND_BD_001",
              vendorName: "Aarong Dairy & FMCG Logistics",
              sku: "SKU_LACCCHA_SHEMAI_200G",
              itemDescription: "",
              category: "Bakery",
              orderQty: 800,
              unitPriceBdt: 110,
              totalAmountBdt: 88000,
              orderDate: "2026-08-25",
              deliveryDate: "2026-08-27",
              status: "Delivered",
            },
          ],
        },
      },
    });
    await prisma.supplierNotification.create({
      data: {
        organizationId: orgId,
        supplierUserId: supplierUser.id,
        uploadId: created.id,
        type: "REJECTED",
        message: created.vendorNote ?? "",
      },
    });
  }

  console.log("Supplier portal: supplier@demo.com / supplier123");
}

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

  await seedDemoSupplierPortal(org.id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });