import { ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

@Injectable()
export class SupplierJwtAuthGuard extends AuthGuard("jwt-supplier") {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  handleRequest(err: unknown, user: any, _info: unknown) {
    if (err || !user) {
      throw new UnauthorizedException({ code: "UNAUTHORIZED", message: "Unauthorized" });
    }
    return user;
  }
}