import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { roleHasPermission, type Permission } from "@inv/config";
import { PERMISSIONS_KEY, type AuthUser } from "../decorators/auth.decorator";

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthUser | undefined;
    if (!user) {
      throw new ForbiddenException({ code: "FORBIDDEN", message: "Forbidden" });
    }

    for (const permission of required) {
      if (!roleHasPermission(user.role, permission)) {
        throw new ForbiddenException({
          code: "FORBIDDEN",
          message: `Missing permission: ${permission}`,
        });
      }
    }
    return true;
  }
}