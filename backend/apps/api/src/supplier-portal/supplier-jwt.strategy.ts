import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { PrismaService } from "../prisma/prisma.service";
import type { SupplierAuthUser } from "./supplier-auth.decorator";

interface JwtPayload {
  sub: string;
  email: string;
}

@Injectable()
export class SupplierJwtStrategy extends PassportStrategy(Strategy, "jwt-supplier") {
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

  async validate(payload: JwtPayload): Promise<SupplierAuthUser> {
    const supplier = await this.prisma.supplierUser.findUnique({
      where: { id: payload.sub },
    });
    if (!supplier || supplier.status !== "ACTIVE") {
      throw new Error("Supplier not found or inactive");
    }
    return {
      id: supplier.id,
      organizationId: supplier.organizationId,
      supplierId: supplier.supplierId,
      email: supplier.email,
      name: supplier.name,
    };
  }
}