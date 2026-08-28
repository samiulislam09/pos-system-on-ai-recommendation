"""LOAD step: star-schema warehouse, results tables, CSV report, Redis cache."""
import json
import os
from datetime import datetime, timezone

import pandas as pd
from sqlalchemy import text

from config import REPORTS_DIR
from etl.extract import get_engine

# ---------------------------------------------------------------------------
# Data warehouse (star schema) — schema `warehouse` in the same Postgres.
# fact_sales_daily references dim_date / dim_product / dim_location.
# ---------------------------------------------------------------------------
WAREHOUSE_DDL = """
CREATE SCHEMA IF NOT EXISTS warehouse;

CREATE TABLE IF NOT EXISTS warehouse.dim_date (
    date_key    INT PRIMARY KEY,          -- yyyymmdd
    full_date   DATE NOT NULL,
    day_of_week INT NOT NULL,
    is_weekend  BOOLEAN NOT NULL,
    month       INT NOT NULL,
    year        INT NOT NULL
);

CREATE TABLE IF NOT EXISTS warehouse.dim_product (
    product_id    TEXT PRIMARY KEY,
    sku           TEXT,
    name          TEXT,
    reorder_level INT,
    cost_price    NUMERIC(12,2),
    selling_price NUMERIC(12,2)
);

CREATE TABLE IF NOT EXISTS warehouse.dim_location (
    location_id   TEXT PRIMARY KEY,
    location_code TEXT,
    location_name TEXT
);

CREATE TABLE IF NOT EXISTS warehouse.fact_sales_daily (
    date_key    INT NOT NULL REFERENCES warehouse.dim_date(date_key),
    product_id  TEXT NOT NULL REFERENCES warehouse.dim_product(product_id),
    location_id TEXT NOT NULL REFERENCES warehouse.dim_location(location_id),
    units_sold  INT NOT NULL,
    PRIMARY KEY (date_key, product_id, location_id)
);
"""

RESULTS_DDL = """
CREATE TABLE IF NOT EXISTS ai_demand_forecasts (
    id              BIGSERIAL PRIMARY KEY,
    run_at          TIMESTAMPTZ NOT NULL,
    product_id      TEXT NOT NULL,
    location_id     TEXT NOT NULL,
    forecast_date   DATE NOT NULL,
    predicted_units DOUBLE PRECISION NOT NULL,
    method          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_forecasts_prod
    ON ai_demand_forecasts (product_id, location_id, forecast_date);

CREATE TABLE IF NOT EXISTS ai_inventory_recommendations (
    id                    BIGSERIAL PRIMARY KEY,
    run_at                TIMESTAMPTZ NOT NULL,
    product_id            TEXT NOT NULL,
    sku                   TEXT,
    name                  TEXT,
    location_id           TEXT NOT NULL,
    location_name         TEXT,
    quantity              INT,
    reserved_quantity     INT,
    available             INT,
    avg_daily_forecast    DOUBLE PRECISION,
    demand_lead           DOUBLE PRECISION,
    demand_horizon        DOUBLE PRECISION,
    safety_stock          DOUBLE PRECISION,
    reorder_point         DOUBLE PRECISION,
    days_of_stock         DOUBLE PRECISION,
    recommended_order_qty INT,
    status                TEXT NOT NULL,
    method                TEXT,
    lead_demand_expected  DOUBLE PRECISION,
    lead_demand_p90       DOUBLE PRECISION,
    shortage_risk         DOUBLE PRECISION,
    shortage_method       TEXT,
    forecast_horizon_days INT,
    lead_time_days        INT
);
CREATE INDEX IF NOT EXISTS idx_ai_recos_prod
    ON ai_inventory_recommendations (product_id, location_id, run_at);
"""


def _run_ddl(ddl: str) -> None:
    engine = get_engine()
    with engine.begin() as conn:
        for stmt in ddl.split(";"):
            if stmt.strip():
                conn.execute(text(stmt))


def load_warehouse(
    daily_demand: pd.DataFrame, products: pd.DataFrame, locations: pd.DataFrame
) -> None:
    """Rebuild the star schema from the freshly transformed data."""
    _run_ddl(WAREHOUSE_DDL)
    engine = get_engine()

    dates = pd.DataFrame({"full_date": daily_demand["sale_date"].drop_duplicates()})
    dates["date_key"] = dates["full_date"].dt.strftime("%Y%m%d").astype(int)
    dates["day_of_week"] = dates["full_date"].dt.dayofweek
    dates["is_weekend"] = dates["day_of_week"] >= 5
    dates["month"] = dates["full_date"].dt.month
    dates["year"] = dates["full_date"].dt.year

    facts = daily_demand.copy()
    facts["date_key"] = facts["sale_date"].dt.strftime("%Y%m%d").astype(int)
    facts = facts[["date_key", "product_id", "location_id", "units_sold"]]

    dim_products = products[
        ["product_id", "sku", "name", "reorder_level", "cost_price", "selling_price"]
    ]
    dim_locations = locations[["location_id", "location_code", "location_name"]]

    with engine.begin() as conn:
        conn.execute(text("DELETE FROM warehouse.fact_sales_daily"))
        conn.execute(text("DELETE FROM warehouse.dim_date"))
        conn.execute(text("DELETE FROM warehouse.dim_product"))
        conn.execute(text("DELETE FROM warehouse.dim_location"))

    dates.to_sql("dim_date", engine, schema="warehouse", if_exists="append", index=False)
    dim_products.to_sql(
        "dim_product", engine, schema="warehouse", if_exists="append", index=False
    )
    dim_locations.to_sql(
        "dim_location", engine, schema="warehouse", if_exists="append", index=False
    )
    facts.to_sql(
        "fact_sales_daily", engine, schema="warehouse", if_exists="append", index=False
    )


def load_results(
    forecasts: pd.DataFrame, recommendations: pd.DataFrame
) -> tuple[datetime, str]:
    """Replace previous results in Postgres and write a timestamped CSV report."""
    _run_ddl(RESULTS_DDL)
    run_at = datetime.now(timezone.utc)
    engine = get_engine()

    with engine.begin() as conn:
        # Keep only the latest run so consumers can `SELECT *` without filtering.
        conn.execute(text("DELETE FROM ai_demand_forecasts"))
        conn.execute(text("DELETE FROM ai_inventory_recommendations"))

    if not forecasts.empty:
        f = forecasts.copy()
        f["run_at"] = run_at
        f.to_sql("ai_demand_forecasts", engine, if_exists="append", index=False)

    if not recommendations.empty:
        r = recommendations.copy()
        r["run_at"] = run_at
        r.to_sql(
            "ai_inventory_recommendations", engine, if_exists="append", index=False
        )

    os.makedirs(REPORTS_DIR, exist_ok=True)
    csv_path = os.path.join(
        REPORTS_DIR, f"recommendations_{run_at.strftime('%Y%m%d_%H%M%S')}.csv"
    )
    recommendations.to_csv(csv_path, index=False)
    return run_at, csv_path


def cache_to_redis(recommendations: pd.DataFrame, run_at: datetime) -> bool:
    """Push the latest recommendations to Redis as hot data (best-effort)."""
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")
    try:
        import redis

        client = redis.from_url(redis_url, socket_connect_timeout=2)
        payload = {
            "run_at": run_at.isoformat(),
            "recommendations": json.loads(
                recommendations.to_json(orient="records")
            ),
        }
        client.set("ai:recommendations:latest", json.dumps(payload))
        alerts = recommendations[
            recommendations["status"].isin(["OUT_OF_STOCK", "URGENT_RESTOCK"])
        ]
        client.set(
            "ai:alerts:low_stock",
            json.dumps(json.loads(alerts.to_json(orient="records"))),
        )
        return True
    except Exception:
        return False
