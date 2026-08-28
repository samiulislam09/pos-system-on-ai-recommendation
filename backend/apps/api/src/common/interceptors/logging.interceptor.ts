import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";

interface RequestMeta {
  requestId: string;
  userId?: string;
  organizationId?: string;
}

export function getRequestMeta(request: Record<string, any>): RequestMeta {
  const requestId =
    request.headers?.["x-request-id"] ?? (request.requestId as string | undefined) ?? randomUUID();
  return {
    requestId,
    userId: request.user?.id,
    organizationId: request.user?.organizationId,
  };
}

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger("HTTP");

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<Record<string, any>>();
    const { method, originalUrl, headers } = request;
    const requestId = headers?.["x-request-id"] ?? randomUUID();
    request.requestId = requestId;
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - start;
          const meta = getRequestMeta(request);
          this.logger.log(
            JSON.stringify({
              requestId,
              method,
              route: originalUrl,
              statusCode: ctx.getResponse().statusCode,
              duration,
              userId: meta.userId,
              organizationId: meta.organizationId,
            }),
          );
        },
        error: () => {
          const duration = Date.now() - start;
          this.logger.log(
            JSON.stringify({
              requestId,
              method,
              route: originalUrl,
              statusCode: ctx.getResponse().statusCode ?? 500,
              duration,
            }),
          );
        },
      }),
    );
  }
}