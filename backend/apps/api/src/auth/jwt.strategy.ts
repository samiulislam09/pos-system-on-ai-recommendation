import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { PrismaService } from "../prisma/prisma.service";
import type { AuthUser } from "../common/decorators/auth.decorator";
import type { UserRole } from "@inv/database";

interface JwtPayload {
  sub: string;
  email: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>("JWT_ACCESS_SECRET"),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== "ACTIVE") {
      return Promise.reject(new Error("User not found or inactive"));
    }
    return {
      id: user.id,
      organizationId: user.organizationId,
      role: user.role as UserRole,
      email: user.email,
      name: user.name,
    };
  }
}
