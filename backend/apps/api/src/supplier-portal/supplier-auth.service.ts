import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { randomUUID, createHash } from "crypto";
import { EntityStatus } from "@inv/database";
import { verifyPassword } from "@inv/database";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { SupplierLoginInput } from "@inv/validation";
import type { SupplierAuthUser } from "./supplier-auth.decorator";

@Injectable()
export class SupplierAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async login(input: SupplierLoginInput) {
    const supplier = await this.prisma.supplierUser.findUnique({
      where: { email: input.email.toLowerCase() },
      include: { supplier: true },
    });
    if (!supplier || supplier.status !== EntityStatus.ACTIVE) {
      throw new UnauthorizedException({
        code: "INVALID_CREDENTIALS",
        message: "Invalid email or password",
      });
    }
    const valid = await verifyPassword(input.password, supplier.passwordHash);
    if (!valid) {
      throw new UnauthorizedException({
        code: "INVALID_CREDENTIALS",
        message: "Invalid email or password",
      });
    }

    const tokens = await this.issueTokens(supplier.id);
    await this.audit.log(this.prisma, {
      organizationId: supplier.organizationId,
      userId: null,
      action: "SUPPLIER_LOGIN",
      entity: "SupplierUser",
      entityId: supplier.id,
      metadata: { email: supplier.email },
    });

    return {
      supplier: {
        id: supplier.id,
        name: supplier.name,
        email: supplier.email,
        phone: supplier.phone,
        organizationId: supplier.organizationId,
        supplierId: supplier.supplierId,
        supplierName: supplier.supplier?.name ?? null,
      },
      ...tokens,
    };
  }

  async refresh(refreshToken: string) {
    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.supplierRefreshToken.findUnique({
      where: { tokenHash },
      include: { supplierUser: true },
    });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException({
        code: "UNAUTHORIZED",
        message: "Invalid or expired refresh token",
      });
    }
    if (stored.supplierUser.status !== EntityStatus.ACTIVE) {
      throw new UnauthorizedException({
        code: "UNAUTHORIZED",
        message: "Account is inactive",
      });
    }

    await this.prisma.supplierRefreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(stored.supplierUserId);
  }

  async logout(supplier: SupplierAuthUser, refreshToken: string) {
    const tokenHash = this.hashToken(refreshToken);
    await this.prisma.supplierRefreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { success: true };
  }

  private async issueTokens(supplierUserId: string) {
    const accessSecret = this.config.getOrThrow<string>("JWT_ACCESS_SECRET");
    const accessTtl = parseInt(this.config.get<string>("JWT_ACCESS_TTL") ?? "900", 10);
    const refreshTtl = parseInt(this.config.get<string>("JWT_REFRESH_TTL") ?? "2592000", 10);

    const accessToken = await this.jwt.signAsync(
      {},
      { secret: accessSecret, expiresIn: accessTtl, subject: supplierUserId },
    );
    const refreshToken = randomUUID();
    await this.prisma.supplierRefreshToken.create({
      data: {
        supplierUserId,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: new Date(Date.now() + refreshTtl * 1000),
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: accessTtl,
    };
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
}