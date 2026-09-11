import type { UserRole } from "@inv/database";

export const PERMISSIONS = {
  products_read: "products.read",
  products_create: "products.create",
  products_update: "products.update",
  inventory_read: "inventory.read",
  inventory_adjust: "inventory.adjust",
  sales_read: "sales.read",
  sales_create: "sales.create",
  returns_create: "returns.create",
  returns_approve: "returns.approve",
  transfers_create: "transfers.create",
  transfers_approve: "transfers.approve",
  transfers_ship: "transfers.ship",
  transfers_receive: "transfers.receive",
  purchases_create: "purchases.create",
  purchases_receive: "purchases.receive",
  suppliers_manage: "suppliers.manage",
  supplier_uploads_manage: "supplier-uploads.manage",
  reports_read: "reports.read",
  users_manage: "users.manage",
  stores_manage: "stores.manage",
  audit_read: "audit.read",
  settings_manage: "settings.manage",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const ALL_PERMISSIONS = Object.values(PERMISSIONS);

export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  SUPER_ADMIN: ALL_PERMISSIONS,
  ORGANIZATION_ADMIN: ALL_PERMISSIONS,
  MANAGER: [
    PERMISSIONS.products_read,
    PERMISSIONS.products_create,
    PERMISSIONS.products_update,
    PERMISSIONS.inventory_read,
    PERMISSIONS.inventory_adjust,
    PERMISSIONS.sales_read,
    PERMISSIONS.sales_create,
    PERMISSIONS.returns_create,
    PERMISSIONS.returns_approve,
    PERMISSIONS.transfers_create,
    PERMISSIONS.transfers_approve,
    PERMISSIONS.transfers_ship,
    PERMISSIONS.transfers_receive,
    PERMISSIONS.purchases_create,
    PERMISSIONS.purchases_receive,
    PERMISSIONS.suppliers_manage,
    PERMISSIONS.supplier_uploads_manage,
    PERMISSIONS.reports_read,
    PERMISSIONS.stores_manage,
  ],
  STORE_MANAGER: [
    PERMISSIONS.products_read,
    PERMISSIONS.inventory_read,
    PERMISSIONS.inventory_adjust,
    PERMISSIONS.sales_read,
    PERMISSIONS.sales_create,
    PERMISSIONS.returns_create,
    PERMISSIONS.returns_approve,
    PERMISSIONS.transfers_create,
    PERMISSIONS.transfers_receive,
    PERMISSIONS.purchases_create,
    PERMISSIONS.purchases_receive,
    PERMISSIONS.supplier_uploads_manage,
    PERMISSIONS.reports_read,
  ],
  INVENTORY_MANAGER: [
    PERMISSIONS.products_read,
    PERMISSIONS.products_create,
    PERMISSIONS.products_update,
    PERMISSIONS.inventory_read,
    PERMISSIONS.inventory_adjust,
    PERMISSIONS.transfers_create,
    PERMISSIONS.transfers_approve,
    PERMISSIONS.transfers_ship,
    PERMISSIONS.transfers_receive,
    PERMISSIONS.purchases_create,
    PERMISSIONS.purchases_receive,
    PERMISSIONS.suppliers_manage,
    PERMISSIONS.supplier_uploads_manage,
    PERMISSIONS.reports_read,
  ],
  CASHIER: [
    PERMISSIONS.products_read,
    PERMISSIONS.inventory_read,
    PERMISSIONS.sales_read,
    PERMISSIONS.sales_create,
    PERMISSIONS.returns_create,
  ],
  VIEWER: [
    PERMISSIONS.products_read,
    PERMISSIONS.inventory_read,
    PERMISSIONS.sales_read,
    PERMISSIONS.reports_read,
  ],
};

export function roleHasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export const RETRY_BACKOFF_SCHEDULE_SECONDS = [
  1, 2, 4, 8, 16, 30, 60, 120, 300,
] as const;

export const LOW_STOCK_ALERT_PADDING = 0.1;

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;