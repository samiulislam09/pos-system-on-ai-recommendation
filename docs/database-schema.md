# Database schema

The source of truth is [`backend/packages/database/prisma/schema.prisma`](../backend/packages/database/prisma/schema.prisma)
(PostgreSQL). This document diagrams it. Update it whenever the schema changes.

The diagrams are Mermaid, which renders on GitHub and in most Markdown viewers. For a
simplified version that is easy to draw by hand, see
[database-schema-simple.md](database-schema-simple.md).

**Legend:** `PK` primary key, `FK` foreign key (enforced by the database), `UK` unique.
Cardinality: `||--o{` one to zero-or-many, `|o--o{` zero-or-one to zero-or-many (the
foreign key is nullable).

- [1. ER diagram](#1-er-diagram)
- [2. Schema diagrams](#2-schema-diagrams)
- [3. Enums](#3-enums)
- [4. References without a foreign key](#4-references-without-a-foreign-key)

---

## 1. ER diagram

### 1.1 Tenancy

Every business table belongs to one `Organization`. The exceptions are the token tables and
the child line-item tables (`*Item`, `Payment`), which belong to it through their parent.
Deleting an organization cascades to all of them except `User`: `User.organizationId` is
nullable and set to null instead, so a user (such as a `SUPER_ADMIN`) can exist without an
organization.

```mermaid
erDiagram
    direction LR
    Organization |o--o{ User : "has staff"
    Organization ||--o{ Location : ""
    Organization ||--o{ PostTerminal : ""
    Organization ||--o{ Category : ""
    Organization ||--o{ Brand : ""
    Organization ||--o{ Product : ""
    Organization ||--o{ ProductVariant : ""
    Organization ||--o{ Supplier : ""
    Organization ||--o{ PurchaseOrder : ""
    Organization ||--o{ GoodsReceipt : ""
    Organization ||--o{ Sale : ""
    Organization ||--o{ SaleReturn : ""
    Organization ||--o{ Inventory : ""
    Organization ||--o{ InventoryMovement : ""
    Organization ||--o{ StockTransfer : ""
    Organization ||--o{ StockAdjustment : ""
    Organization ||--o{ TransactionEvent : ""
    Organization ||--o{ AuditLog : ""
    Organization ||--o{ SupplierUser : ""
    Organization ||--o{ SupplierUpload : ""
    Organization ||--o{ SupplierNotification : ""
    Organization ||--o{ VendorNotification : ""
```

### 1.2 Relationships between business tables

All foreign keys except the `Organization` ones above.

```mermaid
erDiagram
    direction LR
    %% Identity
    User ||--o{ RefreshToken : "signs in with"
    User |o--o{ StockAdjustment : "created"
    User |o--o{ AuditLog : "performed"
    User ||--o{ VendorNotification : "receives"

    %% Locations and POS
    Location ||--o{ PostTerminal : "hosts"
    PostTerminal |o--o{ Sale : "rang up"

    %% Catalog
    Category |o--o{ Category : "parent of"
    Category |o--o{ Product : "classifies"
    Brand |o--o{ Product : "brands"
    Product ||--o{ ProductVariant : "has"

    %% Purchasing
    Supplier ||--o{ PurchaseOrder : "supplies"
    Location |o--o{ PurchaseOrder : "delivers to"
    PurchaseOrder ||--o{ PurchaseOrderItem : "contains"
    Product ||--o{ PurchaseOrderItem : ""
    PurchaseOrder ||--o{ GoodsReceipt : "received as"
    Location ||--o{ GoodsReceipt : "received at"
    GoodsReceipt ||--o{ GoodsReceiptItem : "contains"
    PurchaseOrderItem ||--o{ GoodsReceiptItem : "fulfilled by"
    Product ||--o{ GoodsReceiptItem : ""

    %% Sales and returns
    Location ||--o{ Sale : "sold at"
    Sale ||--o{ SaleItem : "contains"
    Product ||--o{ SaleItem : ""
    Sale ||--o{ Payment : "paid by"
    Location ||--o{ SaleReturn : "returned at"
    Sale |o--o{ SaleReturn : "returned via"
    SaleReturn ||--o{ SaleReturnItem : "contains"
    SaleItem |o--o{ SaleReturnItem : "returned as"
    Product ||--o{ SaleReturnItem : ""

    %% Inventory
    Product ||--o{ Inventory : "stocked as"
    Location ||--o{ Inventory : "holds"
    Product ||--o{ InventoryMovement : "moved"
    Location ||--o{ InventoryMovement : "at"

    %% Transfers and adjustments
    Location ||--o{ StockTransfer : "source"
    Location ||--o{ StockTransfer : "destination"
    StockTransfer ||--o{ StockTransferItem : "contains"
    Product ||--o{ StockTransferItem : ""
    Location ||--o{ StockAdjustment : "adjusted at"
    StockAdjustment ||--o{ StockAdjustmentItem : "contains"
    Product ||--o{ StockAdjustmentItem : ""

    %% Supplier portal
    Supplier |o--o{ SupplierUser : "portal login for"
    SupplierUser ||--o{ SupplierRefreshToken : "signs in with"
    SupplierUser ||--o{ SupplierUpload : "uploads"
    Location |o--o{ SupplierUpload : "last stocked to"
    SupplierUpload ||--o{ SupplierUploadItem : "contains"
    Location |o--o{ SupplierUploadItem : "stocked to"
    SupplierUser ||--o{ SupplierNotification : "receives"
    SupplierUpload ||--o{ SupplierNotification : "about"
    SupplierUpload ||--o{ VendorNotification : "about"
```

---

## 2. Schema diagrams

Every column, grouped by domain. Nullable columns are marked `null` in the comment, and
money columns are `decimal(12,2)`. Tables from another domain appear as bare boxes where
a foreign key points to them. `Organization` is left out after 2.1; see [1.1](#11-tenancy).

### 2.1 Tenancy and identity

```mermaid
erDiagram
    Organization {
        string id PK "cuid"
        string name
        string code UK
        json settings "null"
        datetime createdAt
        datetime updatedAt
    }
    User {
        string id PK "cuid"
        string organizationId FK "null, on delete set null"
        string name
        string email UK
        string passwordHash
        UserRole role "default VIEWER"
        EntityStatus status "default ACTIVE"
        datetime createdAt
        datetime updatedAt
        datetime lastLoginAt "null"
    }
    RefreshToken {
        string id PK "cuid"
        string userId FK "on delete cascade"
        string tokenHash UK
        datetime expiresAt
        datetime revokedAt "null"
        datetime createdAt
    }
    AuditLog {
        string id PK "cuid"
        string organizationId FK
        string userId FK "null, on delete set null"
        string action
        string entity
        string entityId
        json oldValue "null"
        json newValue "null"
        json metadata "null"
        string ipAddress "null"
        string userAgent "null"
        datetime createdAt
    }
    TransactionEvent {
        string id PK "cuid"
        string eventId UK "client idempotency key"
        string organizationId FK
        string storeId "Location.id, no FK"
        string terminalId "null, PostTerminal.id, no FK"
        EventType type
        json payload
        EventProcessingStatus status "default RECEIVED"
        string transactionId "null"
        string error "null"
        datetime createdAt
        datetime processedAt "null"
    }

    Organization |o--o{ User : ""
    User ||--o{ RefreshToken : ""
    Organization ||--o{ AuditLog : ""
    User |o--o{ AuditLog : ""
    Organization ||--o{ TransactionEvent : ""
```

### 2.2 Locations and catalog

```mermaid
erDiagram
    Location {
        string id PK "cuid"
        string organizationId FK "UK with code"
        string name
        string code "UK per organization"
        LocationType type "default STORE"
        string address "null"
        EntityStatus status "default ACTIVE"
        json settings "null"
        datetime createdAt
        datetime updatedAt
    }
    PostTerminal {
        string id PK "cuid"
        string organizationId FK
        string storeId FK "Location, on delete cascade"
        string terminalCode "UK per organization"
        EntityStatus status "default ACTIVE"
        datetime lastSyncAt "null"
        datetime createdAt
        datetime updatedAt
    }
    Category {
        string id PK "cuid"
        string organizationId FK
        string name "UK per organization"
        string parentId FK "null, self reference"
        datetime createdAt
        datetime updatedAt
    }
    Brand {
        string id PK "cuid"
        string organizationId FK
        string name "UK per organization"
        datetime createdAt
        datetime updatedAt
    }
    Product {
        string id PK "cuid"
        string organizationId FK
        string sku "UK per organization"
        string name
        string description "null"
        string categoryId FK "null, on delete set null"
        string brandId FK "null, on delete set null"
        string unit "default pcs"
        decimal costPrice
        decimal sellingPrice
        int reorderLevel "default 0"
        EntityStatus status "default ACTIVE"
        datetime createdAt
        datetime updatedAt
    }
    ProductVariant {
        string id PK "cuid"
        string organizationId FK
        string productId FK "on delete cascade"
        string sku "UK per organization"
        string barcode UK "null"
        string size "null"
        string color "null"
        datetime createdAt
        datetime updatedAt
    }

    Location ||--o{ PostTerminal : ""
    Category |o--o{ Category : "parent"
    Category |o--o{ Product : ""
    Brand |o--o{ Product : ""
    Product ||--o{ ProductVariant : ""
```

### 2.3 Purchasing

```mermaid
erDiagram
    Supplier {
        string id PK "cuid"
        string organizationId FK
        string name "UK per organization"
        string contactName "null"
        string phone "null"
        string email "null"
        string address "null"
        EntityStatus status "default ACTIVE"
        datetime createdAt
        datetime updatedAt
    }
    PurchaseOrder {
        string id PK "cuid"
        string organizationId FK
        string poNumber UK
        string supplierId FK "on delete restrict"
        string locationId FK "default empty string, on delete restrict"
        PurchaseOrderStatus status "default DRAFT"
        datetime expectedAt "null"
        decimal totalAmount "default 0"
        string notes "null"
        string createdById "null, User.id, no FK"
        datetime createdAt
        datetime updatedAt
    }
    PurchaseOrderItem {
        string id PK "cuid"
        string purchaseOrderId FK "on delete cascade"
        string productId FK "on delete restrict"
        int quantity
        int receivedQuantity "default 0"
        decimal unitCost
        decimal total
    }
    GoodsReceipt {
        string id PK "cuid"
        string organizationId FK
        string purchaseOrderId FK "on delete restrict"
        string locationId FK "on delete restrict"
        string receiptNumber UK
        string receivedById "null, User.id, no FK"
        string notes "null"
        datetime createdAt
    }
    GoodsReceiptItem {
        string id PK "cuid"
        string goodsReceiptId FK "on delete cascade"
        string purchaseOrderItemId FK "on delete restrict"
        string productId FK "on delete restrict"
        int quantity
        decimal unitCost
        decimal total
    }

    Supplier ||--o{ PurchaseOrder : ""
    Location |o--o{ PurchaseOrder : ""
    PurchaseOrder ||--o{ PurchaseOrderItem : ""
    Product ||--o{ PurchaseOrderItem : ""
    PurchaseOrder ||--o{ GoodsReceipt : ""
    Location ||--o{ GoodsReceipt : ""
    GoodsReceipt ||--o{ GoodsReceiptItem : ""
    PurchaseOrderItem ||--o{ GoodsReceiptItem : ""
    Product ||--o{ GoodsReceiptItem : ""
```

### 2.4 Sales, payments and returns

```mermaid
erDiagram
    Sale {
        string id PK "cuid"
        string organizationId FK
        string storeId FK "Location, on delete restrict"
        string terminalId FK "null, on delete set null"
        string transactionNumber UK
        SaleStatus status "default COMPLETED"
        decimal subtotal
        decimal discount "default 0"
        decimal tax "default 0"
        decimal total
        PaymentStatus paymentStatus "default PAID"
        string createdById "null, User.id, no FK"
        datetime createdAt
        datetime updatedAt
    }
    SaleItem {
        string id PK "cuid"
        string saleId FK "on delete cascade"
        string productId FK "on delete restrict"
        string variantId "null, ProductVariant.id, no FK"
        int quantity
        decimal unitPrice
        decimal discount "default 0"
        decimal tax "default 0"
        decimal total
    }
    Payment {
        string id PK "cuid"
        string saleId FK "on delete cascade"
        PaymentMethod method "default CASH"
        decimal amount
        string reference "null"
        PaymentStatus status "default PAID"
        datetime createdAt
    }
    SaleReturn {
        string id PK "cuid"
        string organizationId FK
        string storeId FK "Location, on delete restrict"
        string saleId FK "null, on delete set null"
        string returnNumber UK
        SaleReturnStatus status "default REQUESTED"
        string reason "null"
        decimal total "default 0"
        string createdById "null, User.id, no FK"
        string approvedById "null, User.id, no FK"
        datetime approvedAt "null"
        datetime createdAt
        datetime updatedAt
    }
    SaleReturnItem {
        string id PK "cuid"
        string returnId FK "on delete cascade"
        string saleItemId FK "null, on delete set null"
        string productId FK "on delete restrict"
        int quantity
        decimal unitPrice
        decimal total
    }

    Location ||--o{ Sale : ""
    PostTerminal |o--o{ Sale : ""
    Sale ||--o{ SaleItem : ""
    Product ||--o{ SaleItem : ""
    Sale ||--o{ Payment : ""
    Location ||--o{ SaleReturn : ""
    Sale |o--o{ SaleReturn : ""
    SaleReturn ||--o{ SaleReturnItem : ""
    SaleItem |o--o{ SaleReturnItem : ""
    Product ||--o{ SaleReturnItem : ""
```

### 2.5 Inventory, transfers and adjustments

`Inventory` is the current balance per product and location. `InventoryMovement` is the
append-only ledger behind it. Every stock change writes a movement whose `referenceType`
and `referenceId` point to the document that caused it (a sale, a transfer, a supplier
upload, and so on).

```mermaid
erDiagram
    Inventory {
        string id PK "cuid"
        string organizationId FK
        string productId FK "UK with locationId, on delete restrict"
        string locationId FK "on delete cascade"
        int quantity "default 0"
        int reservedQuantity "default 0"
        datetime updatedAt
    }
    InventoryMovement {
        string id PK "cuid"
        string organizationId FK
        string productId FK "on delete restrict"
        string locationId FK "on delete cascade"
        MovementType type
        int quantity "signed"
        string referenceType "source document type"
        string referenceId "source document id, no FK"
        json metadata "null"
        string createdById "null, User.id, no FK"
        datetime createdAt
    }
    StockTransfer {
        string id PK "cuid"
        string organizationId FK
        string transferNumber UK
        string sourceLocationId FK "on delete restrict"
        string destinationLocationId FK "on delete restrict"
        TransferStatus status "default DRAFT"
        string createdById "null, User.id, no FK"
        string approvedById "null, User.id, no FK"
        string shippedById "null, User.id, no FK"
        string receivedById "null, User.id, no FK"
        string notes "null"
        datetime createdAt
        datetime updatedAt
        datetime approvedAt "null"
        datetime shippedAt "null"
        datetime receivedAt "null"
        datetime cancelledAt "null"
    }
    StockTransferItem {
        string id PK "cuid"
        string transferId FK "on delete cascade"
        string productId FK "on delete restrict"
        int quantity
        int receivedQuantity "default 0"
    }
    StockAdjustment {
        string id PK "cuid"
        string organizationId FK
        string locationId FK "on delete restrict"
        AdjustmentReason reason "default MANUAL_CORRECTION"
        EntityStatus status "default ACTIVE"
        string createdById FK "null, User, on delete set null"
        string notes "null"
        datetime createdAt
        datetime updatedAt
    }
    StockAdjustmentItem {
        string id PK "cuid"
        string adjustmentId FK "on delete cascade"
        string productId FK "on delete restrict"
        int quantity
        AdjustmentReason reason "default MANUAL_CORRECTION"
    }

    Product ||--o{ Inventory : ""
    Location ||--o{ Inventory : ""
    Product ||--o{ InventoryMovement : ""
    Location ||--o{ InventoryMovement : ""
    Location ||--o{ StockTransfer : "source"
    Location ||--o{ StockTransfer : "destination"
    StockTransfer ||--o{ StockTransferItem : ""
    Product ||--o{ StockTransferItem : ""
    Location ||--o{ StockAdjustment : ""
    User |o--o{ StockAdjustment : "created by"
    StockAdjustment ||--o{ StockAdjustmentItem : ""
    Product ||--o{ StockAdjustmentItem : ""
```

### 2.6 Supplier portal

Suppliers sign in separately from staff (`SupplierUser`, not `User`). They upload CSV files
(`SupplierUpload`), one `SupplierUploadItem` per row. The vendor runs ETL over the rows and
stocks the good ones into a location. Notifications go both ways: `SupplierNotification`
to the supplier, and `VendorNotification` to each staff reviewer.

```mermaid
erDiagram
    SupplierUser {
        string id PK "cuid"
        string organizationId FK
        string supplierId FK "null, on delete set null"
        string name
        string email UK
        string passwordHash
        string phone "null"
        EntityStatus status "default ACTIVE"
        datetime createdAt
        datetime updatedAt
    }
    SupplierRefreshToken {
        string id PK "cuid"
        string supplierUserId FK "on delete cascade"
        string tokenHash UK
        datetime expiresAt
        datetime revokedAt "null"
        datetime createdAt
    }
    SupplierUpload {
        string id PK "cuid"
        string organizationId FK
        string supplierUserId FK "on delete cascade"
        string originalName
        string mimeType "default text/csv"
        int fileSize "default 0"
        string fileContent "raw CSV"
        int rowCount "default 0"
        SupplierUploadStatus status "default PENDING"
        int submissionCount "default 1"
        json issues "null, parse issues"
        string vendorNote "null"
        string locationId FK "null, last stocked location, on delete restrict"
        string acceptedById "null, User.id, no FK"
        datetime acceptedAt "null"
        datetime rejectedAt "null"
        datetime createdAt
        datetime updatedAt
    }
    SupplierUploadItem {
        string id PK "cuid"
        string uploadId FK "on delete cascade"
        string poNumber
        string vendorId "default empty"
        string vendorName "default empty"
        string sku
        string itemDescription
        string category "default empty"
        int orderQty "default 0"
        decimal unitPriceBdt "default 0"
        decimal totalAmountBdt "default 0"
        string orderDate "null"
        string deliveryDate "null"
        string status "null, supplier's own status text"
        json missingFields "null, CSV columns flagged by ETL"
        SupplierItemEtlStatus etlStatus "default NEW"
        string stockedLocationId FK "null, on delete restrict"
        datetime stockedAt "null"
        datetime createdAt
    }
    SupplierNotification {
        string id PK "cuid"
        string organizationId FK
        string supplierUserId FK "on delete cascade"
        string uploadId FK "on delete cascade"
        SupplierNotificationType type "default UPLOAD_RECEIVED"
        string message "default empty"
        datetime readAt "null"
        datetime resolvedAt "null"
        datetime createdAt
    }
    VendorNotification {
        string id PK "cuid"
        string organizationId FK
        string userId FK "staff recipient, on delete cascade"
        string uploadId FK "on delete cascade"
        VendorNotificationType type
        string message
        datetime readAt "null"
        datetime createdAt
    }

    Supplier |o--o{ SupplierUser : ""
    SupplierUser ||--o{ SupplierRefreshToken : ""
    SupplierUser ||--o{ SupplierUpload : ""
    Location |o--o{ SupplierUpload : ""
    SupplierUpload ||--o{ SupplierUploadItem : ""
    Location |o--o{ SupplierUploadItem : "stocked to"
    SupplierUser ||--o{ SupplierNotification : ""
    SupplierUpload ||--o{ SupplierNotification : ""
    User ||--o{ VendorNotification : ""
    SupplierUpload ||--o{ VendorNotification : ""
```

#### Supplier upload lifecycle

Upload status is derived from its rows' `etlStatus`, except `REJECTED`, which the vendor
sets for the whole file.

```mermaid
stateDiagram-v2
    direction LR
    state "Row (SupplierUploadItem.etlStatus)" as row {
        [*] --> NEW : uploaded or resubmitted
        NEW --> GOOD : ETL passes
        NEW --> INCOMPLETE : ETL finds empty values or a duplicate SKU
        GOOD --> STOCKED : vendor adds to a location
        INCOMPLETE --> RETURNED : vendor sends back
        RETURNED --> NEW : supplier fixes and resubmits
    }
```

| Upload status | When |
|---|---|
| `PENDING` | Any row is `NEW`, `GOOD` or `INCOMPLETE` (the vendor has work to do) |
| `INCOMPLETE` | No vendor work left, and some rows are `RETURNED` (waiting on the supplier) |
| `ACCEPTED` | Every row is `STOCKED` |
| `REJECTED` | Set by the vendor for the whole file, only while no row is `STOCKED` |

---

## 3. Enums

| Enum | Values | Used by |
|---|---|---|
| `UserRole` | `SUPER_ADMIN`, `ORGANIZATION_ADMIN`, `MANAGER`, `STORE_MANAGER`, `INVENTORY_MANAGER`, `CASHIER`, `VIEWER` | `User.role` |
| `LocationType` | `STORE`, `WAREHOUSE` | `Location.type` |
| `EntityStatus` | `ACTIVE`, `INACTIVE`, `DISCONTINUED` | `status` on `User`, `Location`, `PostTerminal`, `Product`, `Supplier`, `StockAdjustment`, `SupplierUser` |
| `SaleStatus` | `COMPLETED`, `CANCELLED`, `REFUNDED` | `Sale.status` |
| `PaymentStatus` | `PENDING`, `PAID`, `PARTIALLY_PAID`, `REFUNDED`, `CANCELLED` | `Sale.paymentStatus`, `Payment.status` |
| `PaymentMethod` | `CASH`, `CARD`, `MOBILE_PAYMENT`, `BANK_TRANSFER`, `CREDIT`, `OTHER` | `Payment.method` |
| `SaleReturnStatus` | `REQUESTED`, `APPROVED`, `REJECTED` | `SaleReturn.status` |
| `TransferStatus` | `DRAFT`, `PENDING`, `APPROVED`, `IN_TRANSIT`, `RECEIVED`, `CANCELLED` | `StockTransfer.status` |
| `AdjustmentReason` | `DAMAGED`, `LOST`, `STOCK_COUNT_VARIANCE`, `FOUND`, `MANUAL_CORRECTION`, `OTHER` | `StockAdjustment.reason`, `StockAdjustmentItem.reason` |
| `PurchaseOrderStatus` | `DRAFT`, `ORDERED`, `PARTIALLY_RECEIVED`, `RECEIVED`, `CANCELLED` | `PurchaseOrder.status` |
| `MovementType` | `PURCHASE`, `SALE`, `RETURN`, `TRANSFER_IN`, `TRANSFER_OUT`, `ADJUSTMENT`, `DAMAGE`, `STOCK_COUNT` | `InventoryMovement.type` |
| `EventType` | `SALE`, `RETURN`, `PURCHASE_RECEIVE`, `TRANSFER_RECEIVE`, `STOCK_ADJUSTMENT`, `STOCK_COUNT` | `TransactionEvent.type` |
| `EventProcessingStatus` | `RECEIVED`, `PROCESSED`, `FAILED`, `DUPLICATE` | `TransactionEvent.status` |
| `SupplierUploadStatus` | `PENDING`, `REJECTED`, `ACCEPTED`, `INCOMPLETE` | `SupplierUpload.status` |
| `SupplierItemEtlStatus` | `NEW`, `GOOD`, `INCOMPLETE`, `RETURNED`, `STOCKED` | `SupplierUploadItem.etlStatus` |
| `SupplierNotificationType` | `UPLOAD_RECEIVED`, `REJECTED`, `ACCEPTED` | `SupplierNotification.type` |
| `VendorNotificationType` | `UPLOAD_SUBMITTED`, `UPLOAD_RESUBMITTED`, `ROWS_RESUBMITTED` | `VendorNotification.type` |

---

## 4. References without a foreign key

These columns hold another table's id, but the database does not enforce it (no foreign
key, no cascade). The diagrams show them as plain columns.

| Column | Points to |
|---|---|
| `PurchaseOrder.createdById` | `User.id` |
| `GoodsReceipt.receivedById` | `User.id` |
| `Sale.createdById` | `User.id` |
| `SaleItem.variantId` | `ProductVariant.id` |
| `SaleReturn.createdById`, `SaleReturn.approvedById` | `User.id` |
| `InventoryMovement.createdById` | `User.id` |
| `InventoryMovement.referenceType` + `referenceId` | The source document, e.g. `SupplierUpload` + its id |
| `StockTransfer.createdById`, `approvedById`, `shippedById`, `receivedById` | `User.id` |
| `TransactionEvent.storeId` | `Location.id` |
| `TransactionEvent.terminalId` | `PostTerminal.id` |
| `TransactionEvent.transactionId` | The `Sale` or other record created from the event |
| `SupplierUpload.acceptedById` | `User.id` |
