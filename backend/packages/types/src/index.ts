export interface PaginatedResult<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export interface AuthenticatedUser {
  id: string;
  organizationId: string | null;
  role: string;
  email: string;
  name: string;
}

export interface EdgeSyncStatus {
  pendingEvents: number;
  syncedEvents: number;
  failedEvents: number;
  lastSuccessfulSync: string | null;
  lastAttempt: string | null;
}