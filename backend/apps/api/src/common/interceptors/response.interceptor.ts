import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { SSE_METADATA } from "@nestjs/common/constants";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, { success: true; data: T }> {
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<{ success: true; data: T }> {
    // Server-Sent Events must reach Nest as raw MessageEvents, not wrapped.
    if (isSseHandler(context)) return next.handle() as never;
    return next.handle().pipe(map((data) => ({ success: true, data })));
  }
}
export function isSseHandler(context: ExecutionContext): boolean {
  return Reflect.getMetadata(SSE_METADATA, context.getHandler()) === true;
}
