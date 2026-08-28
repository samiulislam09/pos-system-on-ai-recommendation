import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { Prisma } from "@inv/database";
import { Response } from "express";
import { DomainException, ErrorCodes } from "../errors";

interface ApiErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("ExceptionFilter");

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    const body = this.toErrorBody(exception);
    const status = this.toStatus(exception);

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status} ${body.error.code}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(`${request.method} ${request.url} -> ${status} ${body.error.code}`);
    }

    response.status(status).json(body);
  }

  private toStatus(exception: unknown): number {
    if (exception instanceof DomainException) return exception.status;
    if (exception instanceof HttpException) return exception.getStatus();
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case "P2002":
          return 409;
        case "P2003":
          return 409;
        case "P2025":
          return 404;
        default:
          return 500;
      }
    }
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private toErrorBody(exception: unknown): ApiErrorBody {
    if (exception instanceof DomainException) {
      return {
        success: false,
        error: {
          code: exception.code,
          message: exception.message,
          ...(exception.details ? { details: exception.details } : {}),
        },
      };
    }

    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      const message =
        typeof res === "string"
          ? res
          : (res as { message?: string | string[] }).message ?? exception.message;
      return {
        success: false,
        error: {
          code: this.httpCode(exception.getStatus()),
          message: Array.isArray(message) ? message.join(", ") : message,
          ...(typeof res === "object" && res !== null
            ? { details: (res as { message?: unknown }).message }
            : {}),
        },
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case "P2002":
          return {
            success: false,
            error: {
              code: ErrorCodes.CONFLICT,
              message: "A record with the same unique value already exists",
              details: exception.meta,
            },
          };
        case "P2025":
          return {
            success: false,
            error: { code: ErrorCodes.NOT_FOUND, message: "Record not found" },
          };
        default:
          return {
            success: false,
            error: { code: ErrorCodes.INTERNAL_ERROR, message: "Database error" },
          };
      }
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        success: false,
        error: { code: ErrorCodes.VALIDATION_ERROR, message: "Invalid input" },
      };
    }

    return {
      success: false,
      error: { code: ErrorCodes.INTERNAL_ERROR, message: "Internal server error" },
    };
  }

  private httpCode(status: number): string {
    if (status === 400) return ErrorCodes.BAD_REQUEST;
    if (status === 401) return ErrorCodes.UNAUTHORIZED;
    if (status === 403) return ErrorCodes.FORBIDDEN;
    if (status === 404) return ErrorCodes.NOT_FOUND;
    if (status === 409) return ErrorCodes.CONFLICT;
    return ErrorCodes.INTERNAL_ERROR;
  }
}