"""Inventory Recommendation Engine — ETL pipeline entry point.

    python run_pipeline.py

EXTRACT   -> sales history, current stock, catalog from the operational DB
TRANSFORM -> zero-filled daily demand series per product/store
LOAD (DW) -> star-schema data warehouse (warehouse.fact_sales_daily + dims)
AI/ML     -> Prophet 30-day demand forecast + LightGBM shortage prediction
RECOMMEND -> AI forecast vs current stock -> restock recommendations
LOAD      -> ai_* result tables, CSV report, Redis hot cache
"""
import sys

from etl.extract import (
    extract_inventory,
    extract_locations,
    extract_products,
    extract_sales,
)
from etl.load import cache_to_redis, load_results, load_warehouse
from etl.transform import build_daily_demand
from forecast.model import forecast_all
from forecast.shortage import predict_shortage
from recommend.engine import build_recommendations


def main() -> int:
    print("[1/6] EXTRACT   — reading sales, inventory, products from Postgres...")
    sales = extract_sales()
    inventory = extract_inventory()
    products = extract_products()
    locations = extract_locations()
    print(
        f"          {len(sales)} daily sales rows, {len(inventory)} inventory rows, "
        f"{len(products)} products"
    )
    if sales.empty:
        print("No completed sales found — nothing to forecast. "
              "Run `python seed_demo_data.py` to generate demo history.")
        return 1

    print("[2/6] TRANSFORM — building daily demand time series...")
    daily = build_daily_demand(sales)
    n_series = daily.groupby(["product_id", "location_id"]).ngroups
    print(f"          {n_series} product/location series, {len(daily)} day-rows")

    print("[3/6] LOAD DW   — rebuilding star-schema warehouse...")
    load_warehouse(daily, products, locations)

    print("[4/6] AI/ML     — Prophet demand forecast + LightGBM shortage risk...")
    forecasts = forecast_all(daily)
    methods = forecasts.groupby("method")["product_id"].nunique().to_dict()
    shortage = predict_shortage(daily, inventory)
    print(f"          forecast methods: {methods}")

    print("[5/6] RECOMMEND — comparing AI forecast vs current stock...")
    recos = build_recommendations(
        forecasts, inventory, products, daily, locations, shortage
    )

    print("[6/6] LOAD      — writing results to Postgres, CSV, Redis...")
    run_at, csv_path = load_results(forecasts, recos)
    cached = cache_to_redis(recos, run_at)
    print(f"          run_at={run_at.isoformat()}")
    print(f"          report={csv_path}")
    print(f"          redis cache: {'ok' if cached else 'skipped (redis not reachable)'}\n")

    if recos.empty:
        print("No recommendations produced.")
        return 0

    display = recos[
        [
            "sku",
            "name",
            "location_name",
            "available",
            "avg_daily_forecast",
            "days_of_stock",
            "reorder_point",
            "shortage_risk",
            "recommended_order_qty",
            "status",
            "method",
        ]
    ]
    print(display.to_string(index=False))

    counts = recos["status"].value_counts().to_dict()
    print(f"\nSummary: {counts}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
