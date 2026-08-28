import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { notFound } from "../common/errors";
import { Prisma } from "@inv/database";

@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    organizationId: string,
    query: { page: number; limit: number; type?: "SALE" | "RETURN"; status?: "RECEIVED" | "PROCESSED" | "FAILED" },
  ) {
    const { page, limit, type, status } = query;
    const where: Prisma.TransactionEventWhereInput = { organizationId, type, status };
    const [data, total] = await Promise.all([
      this.prisma.transactionEvent.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.transactionEvent.count({ where }),
    ]);

    // Resolve transaction documents (sales / returns) for the event list.
    const enriched = await Promise.all(
      data.map(async (event) => {
        if (event.transactionId) {
          if (event.type === "SALE") {
            const sale = await this.prisma.sale.findUnique({
              where: { id: event.transactionId },
              include: {
                items: { include: { product: true } },
                store: true,
                payments: true,
              },
            });
            return { event, transaction: sale };
          }
          if (event.type === "RETURN") {
            const saleReturn = await this.prisma.saleReturn.findUnique({
              where: { id: event.transactionId },
              include: { items: { include: { product: true } }, store: true },
            });
            return { event, transaction: saleReturn };
          }
        }
        return { event, transaction: null };
      }),
    );

    return { data: enriched, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async get(organizationId: string, id: string) {
    const event = await this.prisma.transactionEvent.findFirst({
      where: { organizationId, eventId: id },
    });
    if (!event) throw notFound("Transaction", id);

    if (event.transactionId) {
      if (event.type === "SALE") {
        const sale = await this.prisma.sale.findUnique({
          where: { id: event.transactionId },
          include: { items: { include: { product: true } }, store: true, payments: true },
        });
        return { event, transaction: sale };
      }
      if (event.type === "RETURN") {
        const saleReturn = await this.prisma.saleReturn.findUnique({
          where: { id: event.transactionId },
          include: { items: { include: { product: true } }, store: true },
        });
        return { event, transaction: saleReturn };
      }
    }
    return { event, transaction: null };
  }
}
