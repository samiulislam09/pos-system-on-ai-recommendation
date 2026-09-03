import { Injectable } from "@nestjs/common";
import { Prisma, SaleStatus } from "@inv/database";
import { PrismaService } from "../prisma/prisma.service";
import { notFound } from "../common/errors";
import { buildSalesCsv } from "./csv.util";

@Injectable()
export class SalesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    organizationId: string,
    page: number,
    limit: number,
    filters: { storeId?: string; status?: string; from?: string; to?: string },
  ) {
    const where: Prisma.SaleWhereInput = {
      organizationId,
      ...(filters.storeId ? { storeId: filters.storeId } : {}),
      ...(filters.status ? { status: filters.status as SaleStatus } : {}),
      ...(filters.from || filters.to
        ? {
            createdAt: {
              ...(filters.from ? { gte: new Date(filters.from) } : {}),
              ...(filters.to ? { lte: new Date(filters.to) } : {}),
            },
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.sale.findMany({
        where,
        include: {
          store: true,
          terminal: true,
          items: { include: { product: true } },
          payments: true,
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.sale.count({ where }),
    ]);

    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async exportCsv(
    organizationId: string,
    filters: { storeId?: string; from?: string; to?: string },
  ): Promise<string> {
    const sales = await this.prisma.sale.findMany({
      where: {
        organizationId,
        ...(filters.storeId ? { storeId: filters.storeId } : {}),
        ...(filters.from || filters.to
          ? {
              createdAt: {
                ...(filters.from ? { gte: new Date(filters.from) } : {}),
                ...(filters.to ? { lte: new Date(filters.to) } : {}),
              },
            }
          : {}),
      },
      include: {
        store: true,
        terminal: true,
        items: { include: { product: true } },
        payments: true,
      },
      orderBy: { createdAt: "asc" },
      // Safety cap — a store's date-range export; revisit if exports ever exceed this.
      take: 50_000,
    });
    return buildSalesCsv(sales);
  }

  async get(organizationId: string, id: string) {
    const sale = await this.prisma.sale.findFirst({
      where: { id, organizationId },
      include: {
        store: true,
        terminal: true,
        items: { include: { product: true } },
        payments: true,
        returns: { include: { items: true } },
      },
    });
    if (!sale) throw notFound("Sale", id);
    return sale;
  }
}