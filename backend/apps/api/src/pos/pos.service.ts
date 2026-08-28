import { Injectable } from "@nestjs/common";
import { Prisma } from "@inv/database";
import type { PosProductsQueryInput } from "@inv/validation";
import { TenantService } from "../common/tenant.service";
import { PrismaService } from "../prisma/prisma.service";

export interface PosProductRow {
  id: string;
  sku: string;
  name: string;
  unit: string;
  sellingPrice: Prisma.Decimal;
  quantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  matchedCode: string | null;
  matchedCodeType: "SKU" | "BARCODE" | null;
}

@Injectable()
export class PosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
  ) {}

  async bootstrap(organizationId: string) {
    const stores = await this.prisma.location.findMany({
      where: { organizationId, type: "STORE", status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: {
        id: true,
        code: true,
        name: true,
        address: true,
        postTerminals: {
          where: { organizationId, status: "ACTIVE" },
          orderBy: { terminalCode: "asc" },
          select: { id: true, terminalCode: true },
        },
      },
    });
    return {
      stores: stores.map(({ postTerminals, ...store }) => ({
        ...store,
        terminals: postTerminals,
      })),
    };
  }

  async products(
    organizationId: string,
    input: PosProductsQueryInput,
  ): Promise<{ products: PosProductRow[] }> {
    await this.tenant.assertStore(organizationId, input.storeId);

    const query = input.q;
    const pattern = `%${query}%`;

    const products = await this.prisma.$queryRaw<PosProductRow[]>`
      SELECT
        p.id,
        p.sku,
        p.name,
        p.unit,
        p."sellingPrice",
        i.quantity,
        i."reservedQuantity",
        i.quantity - i."reservedQuantity" AS "availableQuantity",
        CASE
          WHEN lower(p.sku) = lower(${query}) THEN p.sku
          WHEN variant_match."matchedCode" IS NOT NULL THEN variant_match."matchedCode"
          WHEN p.sku ILIKE ${pattern} THEN p.sku
          ELSE NULL
        END AS "matchedCode",
        CASE
          WHEN lower(p.sku) = lower(${query}) THEN 'SKU'
          WHEN variant_match."matchedCode" IS NOT NULL THEN variant_match."matchedCodeType"
          WHEN p.sku ILIKE ${pattern} THEN 'SKU'
          ELSE NULL
        END AS "matchedCodeType"
      FROM "Product" p
      JOIN "Inventory" i
        ON i."productId" = p.id
        AND i."locationId" = ${input.storeId}
        AND i."organizationId" = ${organizationId}
      LEFT JOIN LATERAL (
        SELECT code AS "matchedCode", code_type AS "matchedCodeType", rank
        FROM (
          SELECT
            pv.sku AS code,
            'SKU' AS code_type,
            CASE WHEN lower(pv.sku) = lower(${query}) THEN 0 ELSE 1 END AS rank
          FROM "ProductVariant" pv
          WHERE pv."organizationId" = ${organizationId}
            AND pv."productId" = p.id
            AND ${query} <> ''
            AND pv.sku ILIKE ${pattern}
          UNION ALL
          SELECT
            pv.barcode AS code,
            'BARCODE' AS code_type,
            CASE WHEN lower(pv.barcode) = lower(${query}) THEN 0 ELSE 1 END AS rank
          FROM "ProductVariant" pv
          WHERE pv."organizationId" = ${organizationId}
            AND pv."productId" = p.id
            AND ${query} <> ''
            AND pv.barcode ILIKE ${pattern}
        ) variant_codes
        ORDER BY rank, code
        LIMIT 1
      ) variant_match ON true
      WHERE p."organizationId" = ${organizationId}
        AND p.status = 'ACTIVE'
        AND i.quantity > i."reservedQuantity"
        AND (
          ${query} = ''
          OR p.name ILIKE ${pattern}
          OR p.sku ILIKE ${pattern}
          OR variant_match."matchedCode" IS NOT NULL
        )
      ORDER BY
        CASE
          WHEN lower(p.sku) = lower(${query}) OR variant_match.rank = 0 THEN 0
          ELSE 1
        END,
        p.name,
        p.id
      LIMIT ${input.limit}
    `;
    return { products };
  }
}
