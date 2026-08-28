import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { randomUUID } from "crypto";
import { UserRole, PrismaClient, Prisma } from "@inv/database";
import { hashPassword, verifyPassword } from "@inv/database";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../common/decorators/auth.decorator";
import {
  LoginInput,
  RegisterOrganizationInput,
} from "@inv/validation";

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async login(input: LoginInput, meta: { ip?: string; userAgent?: string }) {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
    });
    if (!user || user.status !== "ACTIVE") {
      throw new UnauthorizedException({
        code: "INVALID_CREDENTIALS",
        message: "Invalid email or password",
      });
    }
    const valid = await verifyPassword(input.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException({
        code: "INVALID_CREDENTIALS",
        message: "Invalid email or password",
      });
    }

    const tokens = await this.issueTokens(user.id, user.role as UserRole);

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    if (user.organizationId) {
      await this.audit.log(this.prisma, {
        organizationId: user.organizationId,
        userId: user.id,
        action: "USER_LOGIN",
        entity: "User",
        entityId: user.id,
        metadata: { email: user.email },
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
      });
    }

    return {
      user: this.sanitize(user),
      ...tokens,
    };
  }

  async registerOrganization(input: RegisterOrganizationInput) {
    const existingOrg = await this.prisma.organization.findUnique({
      where: { code: input.organizationCode },
    });
    if (existingOrg) {
      throw new ConflictException({
        code: "CONFLICT",
        message: `Organization code ${input.organizationCode} is already taken`,
      });
    }
    const existingUser = await this.prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
    });
    if (existingUser) {
      throw new ConflictException({
        code: "CONFLICT",
        message: "A user with this email already exists",
      });
    }

    const org = await this.prisma.$transaction(async (tx) => {
      const created = await tx.organization.create({
        data: {
          name: input.organizationName,
          code: input.organizationCode,
          settings: { currency: "BDT" },
        },
      });
      const user = await tx.user.create({
        data: {
          organizationId: created.id,
          name: input.name,
          email: input.email.toLowerCase(),
          passwordHash: await hashPassword(input.password),
          role: UserRole.ORGANIZATION_ADMIN,
        },
      });
      await this.audit.log(tx, {
        organizationId: created.id,
        userId: user.id,
        action: "ORGANIZATION_CREATED",
        entity: "Organization",
        entityId: created.id,
      });
      return created;
    });

    const admin = await this.prisma.user.findFirst({
      where: { organizationId: org.id, role: UserRole.ORGANIZATION_ADMIN },
    });
    if (!admin) throw new UnauthorizedException("registration failed");

    const tokens = await this.issueTokens(admin.id, admin.role as UserRole);

    return { organization: org, user: this.sanitize(admin), ...tokens };
  }

  async refresh(refreshToken: string, meta: { ip?: string; userAgent?: string }) {
    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException({
        code: "UNAUTHORIZED",
        message: "Invalid or expired refresh token",
      });
    }
    if (stored.user.status !== "ACTIVE") {
      throw new UnauthorizedException({
        code: "UNAUTHORIZED",
        message: "Account is inactive",
      });
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const tokens = await this.issueTokens(stored.user.id, stored.user.role as UserRole);
    if (stored.user.organizationId) {
      await this.audit.log(this.prisma, {
        organizationId: stored.user.organizationId,
        userId: stored.user.id,
        action: "TOKEN_REFRESHED",
        entity: "User",
        entityId: stored.user.id,
        metadata: {},
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
      });
    }

    return { ...tokens };
  }

  async logout(user: AuthUser, refreshToken: string) {
    const tokenHash = this.hashToken(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { success: true };
  }

  private async issueTokens(userId: string, role: UserRole): Promise<TokenPair> {
    const accessSecret = this.config.getOrThrow<string>("JWT_ACCESS_SECRET");
    const refreshSecret = this.config.getOrThrow<string>("JWT_REFRESH_SECRET");
    const accessTtl = parseInt(this.config.get<string>("JWT_ACCESS_TTL") ?? "900", 10);
    const refreshTtl = parseInt(this.config.get<string>("JWT_REFRESH_TTL") ?? "2592000", 10);

    const accessToken = await this.jwt.signAsync(
      {},
      { secret: accessSecret, expiresIn: accessTtl, subject: userId },
    );
    const refreshToken = randomUUID();
    await this.prisma.refreshToken.create({
      data: {
        userId,
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
    const { createHash } = require("crypto") as typeof import("crypto");
    return createHash("sha256").update(token).digest("hex");
  }

  private sanitize(user: {
    id: string;
    name: string;
    email: string;
    role: UserRole;
    organizationId: string | null;
  }) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
    };
  }
}
