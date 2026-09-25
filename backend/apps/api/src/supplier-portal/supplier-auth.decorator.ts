import { createParamDecorator, ExecutionContext } from "@nestjs/common";

export interface SupplierAuthUser {
  id: string;
  organizationId: string;
  supplierId: string | null;
  email: string;
  name: string;
}

export const CurrentSupplier = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SupplierAuthUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as SupplierAuthUser;
  },
);