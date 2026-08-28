export const QUEUES = {
  TRANSACTIONS: "transactions",
  ANALYTICS: "analytics",
  NOTIFICATIONS: "notifications",
  REPORTS: "reports",
  SYNC: "sync",
  INVENTORY_RECONCILIATION: "inventory-reconciliation",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const JOB_NAMES = {
  PROCESS_EVENT: "process-event",
  AGGREGATE_DAILY_SALES: "aggregate-daily-sales",
  LOW_STOCK_ALERT: "low-stock-alert",
  GENERATE_REPORT: "generate-report",
  RECONCILE_INVENTORY: "reconcile-inventory",
} as const;

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];

export const EVENT_TYPES = {
  SALE: "SALE",
  RETURN: "RETURN",
  PURCHASE_RECEIVE: "PURCHASE_RECEIVE",
  TRANSFER_RECEIVE: "TRANSFER_RECEIVE",
  STOCK_ADJUSTMENT: "STOCK_ADJUSTMENT",
  STOCK_COUNT: "STOCK_COUNT",
} as const;

export type EventTypeName = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

export interface PosEventItem {
  sku: string;
  quantity: number;
  unitPrice: number;
}

export interface PosEvent {
  eventId: string;
  type: EventTypeName;
  storeId: string;
  terminalId?: string;
  timestamp: string;
  items: PosEventItem[];
  [key: string]: unknown;
}

export const BULLMQ_DEFAULT_OPTS = {
  attempts: 5,
  backoff: { type: "exponential" as const, delay: 2000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};