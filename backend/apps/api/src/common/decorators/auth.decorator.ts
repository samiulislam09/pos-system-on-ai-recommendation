import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from "@nestjs/common";
import type { UserRole } from "@inv/database";
import type { Permission } from "@inv/config";

export interface AuthUser {
  id: string;
  organizationId: string | null;
  role: UserRole;
  email: string;
  name: string;
}

export const IS_PUBLIC_KEY = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const PERMISSIONS_KEY = "permissions";
export const RequirePermission = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);