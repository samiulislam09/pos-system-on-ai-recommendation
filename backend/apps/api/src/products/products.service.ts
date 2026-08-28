import { Injectable } from "@nestjs/common";
import { Prisma } from "@inv/database";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { DomainException, ErrorCodes, notFound } from "../common/errors";
import { CreateProductInput, UpdateProductInput } from "@inv/validation";
import type { AuthUser } from "../common/decorators/auth.decorator";

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    organizationId: string,
    page: number,
    limit: number,
    filters: { categoryId?: string; brandId?: string; search?: string; status?: string },
  ) {
    const where: Prisma.ProductWhereInput = {
      organizationId,
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      ...(filters.brandId ? { brandId: filters.brandId } : {}),
      ...(filters.status ? { status: filters.status as never } : {}),
      ...(filters.search
        ? {
            OR: [
              { name: { contains: filters.search, mode: "insensitive" } },
              { sku: { contains: filters.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: {
          category: true,
          brand: true,
          variants: true,
          inventory: true,
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async get(organizationId: string, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, organizationId },
      include: {
        category: true,
        brand: true,
        variants: true,
        inventory: { include: { location: true } },
        movements: { include: { location: true }, orderBy: { createdAt: "desc" }, take: 50 },
      },
    });
    if (!product) throw notFound("Product", id);
    return product;
  }

  async create(organizationId: string, input: CreateProductInput, actor: AuthUser) {
    if (input.categoryId) {
      await this.assertCategory(organizationId, input.categoryId);
    }
    if (input.brandId) {
      await this.assertBrand(organizationId, input.brandId);
    }

    const product = await this.prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          organizationId,
          sku: input.sku,
          name: input.name,
          description: input.description,
          categoryId: input.categoryId,
          brandId: input.brandId,
          unit: input.unit,
          costPrice: input.costPrice,
          sellingPrice: input.sellingPrice,
          reorderLevel: input.reorderLevel,
          variants: input.variants
            ? {
                create: input.variants.map((v) => ({
                  organizationId,
                  sku: v.sku,
                  barcode: v.barcode,
                  size: v.size,
                  color: v.color,
                })),
              }
            : undefined,
        },
        include: { variants: true },
      });
      return created;
    });

    await this.audit.log(this.prisma, {
      organizationId,
      userId: actor.id,
      action: "PRODUCT_CREATED",
      entity: "Product",
      entityId: product.id,
      newValue: { sku: product.sku, name: product.name },
    });
    return product;
  }

  async update(organizationId: string, id: string, input: UpdateProductInput, actor: AuthUser) {
    const product = await this.prisma.product.findFirst({ where: { id, organizationId } });
    if (!product) throw notFound("Product", id);
    if (input.categoryId !== undefined && input.categoryId) {
      await this.assertCategory(organizationId, input.categoryId);
    }
    if (input.brandId !== undefined && input.brandId) {
      await this.assertBrand(organizationId, input.brandId);
    }

    const updated = await this.prisma.product.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        categoryId: input.categoryId,
        brandId: input.brandId,
        unit: input.unit,
        costPrice: input.costPrice,
        sellingPrice: input.sellingPrice,
        reorderLevel: input.reorderLevel,
        status: input.status as never,
      },
      include: { variants: true },
    });

    await this.audit.log(this.prisma, {
      organizationId,
      userId: actor.id,
      action: "PRODUCT_UPDATED",
      entity: "Product",
      entityId: product.id,
      oldValue: { sku: product.sku, name: product.name, sellingPrice: product.sellingPrice },
      newValue: input,
    });
    return updated;
  }

  async listCategories(organizationId: string) {
    return this.prisma.category.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
    });
  }

  async createCategory(organizationId: string, name: string, parentId: string | undefined, actor: AuthUser) {
    if (parentId) await this.assertCategory(organizationId, parentId);
    const category = await this.prisma.category.create({
      data: { organizationId, name, parentId },
    });
    await this.audit.log(this.prisma, {
      organizationId,
      userId: actor.id,
      action: "CATEGORY_CREATED",
      entity: "Category",
      entityId: category.id,
      newValue: { name },
    });
    return category;
  }

  async listBrands(organizationId: string) {
    return this.prisma.brand.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
    });
  }

  async createBrand(organizationId: string, name: string, actor: AuthUser) {
    const brand = await this.prisma.brand.create({
      data: { organizationId, name },
    });
    await this.audit.log(this.prisma, {
      organizationId,
      userId: actor.id,
      action: "BRAND_CREATED",
      entity: "Brand",
      entityId: brand.id,
      newValue: { name },
    });
    return brand;
  }

  async findBySku(organizationId: string, sku: string) {
    return this.prisma.product.findFirst({ where: { organizationId, sku } });
  }

  private async assertCategory(organizationId: string, categoryId: string) {
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, organizationId },
    });
    if (!category) {
      throw new DomainException(ErrorCodes.TENANT_MISMATCH, "Category not found", 403);
    }
  }

  private async assertBrand(organizationId: string, brandId: string) {
    const brand = await this.prisma.brand.findFirst({
      where: { id: brandId, organizationId },
    });
    if (!brand) {
      throw new DomainException(ErrorCodes.TENANT_MISMATCH, "Brand not found", 403);
    }
  }
}
