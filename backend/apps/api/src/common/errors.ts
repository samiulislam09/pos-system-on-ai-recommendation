export const ErrorCodes = {
  INSUFFICIENT_STOCK: "INSUFFICIENT_STOCK",
  NOT_FOUND: "NOT_FOUND",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  CONFLICT: "CONFLICT",
  DUPLICATE_EVENT: "DUPLICATE_EVENT",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  TENANT_MISMATCH: "TENANT_MISMATCH",
  BAD_REQUEST: "BAD_REQUEST",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  INVALID_OPERATION: "INVALID_OPERATION",
  RATE_LIMITED: "RATE_LIMITED",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export class DomainException extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "DomainException";
  }
}

export function insufficientStock(productSku: string): DomainException {
  return new DomainException(
    ErrorCodes.INSUFFICIENT_STOCK,
    `Insufficient stock for product ${productSku}`,
    409,
  );
}

export function insufficientAvailableStock(productId: string): DomainException {
  return new DomainException(
    ErrorCodes.INSUFFICIENT_STOCK,
    `Insufficient available stock for product ${productId}; reserved inventory cannot be sold`,
    409,
  );
}

export function notFound(entity: string, id?: string): DomainException {
  return new DomainException(
    ErrorCodes.NOT_FOUND,
    id ? `${entity} ${id} not found` : `${entity} not found`,
    404,
  );
}

export function tenantMismatch(entity: string): DomainException {
  return new DomainException(
    ErrorCodes.TENANT_MISMATCH,
    `${entity} does not belong to the current organization`,
    403,
  );
}

export function invalidOperation(message: string): DomainException {
  return new DomainException(ErrorCodes.INVALID_OPERATION, message, 409);
}
