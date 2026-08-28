"""EXTRACT step: read raw data from the POS Postgres database."""
import pandas as pd
from sqlalchemy import create_engine, text

from config import SQLALCHEMY_URL

_engine = None


def get_engine():
    global _engine
    if _engine is None:
        _engine = create_engine(SQLALCHEMY_URL, pool_pre_ping=True)
    return _engine


def extract_sales() -> pd.DataFrame:
    """Daily units sold per product per store from completed sales."""
    sql = text(
        """
        SELECT
            s."organizationId"      AS org_id,
            s."storeId"             AS location_id,
            si."productId"          AS product_id,
            DATE(s."createdAt")     AS sale_date,
            SUM(si.quantity)::int   AS units_sold
        FROM "SaleItem" si
        JOIN "Sale" s ON s.id = si."saleId"
        WHERE s.status = 'COMPLETED'
        GROUP BY 1, 2, 3, 4
        ORDER BY 4
        """
    )
    return pd.read_sql(sql, get_engine(), parse_dates=["sale_date"])


def extract_inventory() -> pd.DataFrame:
    """Current stock balance per product per location."""
    sql = text(
        """
        SELECT
            i."organizationId"    AS org_id,
            i."productId"         AS product_id,
            i."locationId"        AS location_id,
            i.quantity            AS quantity,
            i."reservedQuantity"  AS reserved_quantity
        FROM "Inventory" i
        """
    )
    return pd.read_sql(sql, get_engine())


def extract_products() -> pd.DataFrame:
    sql = text(
        """
        SELECT
            p.id              AS product_id,
            p."organizationId" AS org_id,
            p.sku,
            p.name,
            p."reorderLevel"  AS reorder_level,
            p."costPrice"     AS cost_price,
            p."sellingPrice"  AS selling_price
        FROM "Product" p
        WHERE p.status = 'ACTIVE'
        """
    )
    return pd.read_sql(sql, get_engine())


def extract_locations() -> pd.DataFrame:
    sql = text(
        """
        SELECT l.id AS location_id, l.name AS location_name, l.code AS location_code
        FROM "Location" l
        """
    )
    return pd.read_sql(sql, get_engine())
