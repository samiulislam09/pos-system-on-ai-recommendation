"""Recommendation engine: AI forecast vs current stock.

For each (product, location):
  available        = on-hand - reserved
  demand_lead      = forecast summed over the supplier lead time
  safety_stock     = z * std(daily demand) * sqrt(lead time)
  reorder_point    = demand_lead + safety_stock
  recommended_qty  = forecast over the full horizon + safety - available
"""
import math

import numpy as np
import pandas as pd

from config import (
    FORECAST_HORIZON_DAYS,
    LEAD_TIME_DAYS,
    OVERSTOCK_DAYS,
    SERVICE_LEVEL_Z,
)

STATUS_OUT = "OUT_OF_STOCK"
STATUS_URGENT = "URGENT_RESTOCK"
STATUS_SOON = "RESTOCK_SOON"
STATUS_OK = "OK"
STATUS_OVER = "OVERSTOCKED"


def classify(available: float, reorder_point: float, days_of_stock: float) -> str:
    if available <= 0:
        return STATUS_OUT
    if days_of_stock <= LEAD_TIME_DAYS or available <= reorder_point:
        return STATUS_URGENT
    if days_of_stock <= 2 * LEAD_TIME_DAYS:
        return STATUS_SOON
    if days_of_stock >= OVERSTOCK_DAYS:
        return STATUS_OVER
    return STATUS_OK


def build_recommendations(
    forecasts: pd.DataFrame,
    inventory: pd.DataFrame,
    products: pd.DataFrame,
    daily_demand: pd.DataFrame,
    locations: pd.DataFrame,
    shortage: pd.DataFrame | None = None,
) -> pd.DataFrame:
    if forecasts.empty:
        return pd.DataFrame()

    # Demand volatility per series drives safety stock.
    stds = (
        daily_demand.groupby(["product_id", "location_id"])["units_sold"]
        .std()
        .fillna(0)
        .rename("daily_std")
        .reset_index()
    )

    agg = (
        forecasts.sort_values("forecast_date")
        .groupby(["product_id", "location_id"])
        .agg(
            demand_lead=(
                "predicted_units",
                lambda s: float(s.head(LEAD_TIME_DAYS).sum()),
            ),
            demand_horizon=("predicted_units", "sum"),
            avg_daily_forecast=("predicted_units", "mean"),
            method=("method", "first"),
        )
        .reset_index()
    )

    df = (
        agg.merge(stds, on=["product_id", "location_id"], how="left")
        .merge(inventory, on=["product_id", "location_id"], how="left")
        .merge(products, on="product_id", how="inner", suffixes=("", "_p"))
        .merge(locations, on="location_id", how="left")
    )
    if shortage is not None and not shortage.empty:
        df = df.merge(shortage, on=["product_id", "location_id"], how="left")
    for col, default in [
        ("shortage_risk", 0.0),
        ("shortage_method", "n/a"),
        ("lead_demand_expected", 0.0),
        ("lead_demand_p90", 0.0),
    ]:
        if col not in df.columns:
            df[col] = default
    df["shortage_risk"] = df["shortage_risk"].fillna(0.0)
    df["quantity"] = df["quantity"].fillna(0).astype(int)
    df["reserved_quantity"] = df["reserved_quantity"].fillna(0).astype(int)
    df["daily_std"] = df["daily_std"].fillna(0)
    df["available"] = df["quantity"] - df["reserved_quantity"]

    df["safety_stock"] = (
        SERVICE_LEVEL_Z * df["daily_std"] * math.sqrt(LEAD_TIME_DAYS)
    ).round(2)
    df["reorder_point"] = (df["demand_lead"] + df["safety_stock"]).round(2)
    df["days_of_stock"] = np.where(
        df["avg_daily_forecast"] > 0,
        df["available"] / df["avg_daily_forecast"],
        np.inf,
    ).round(1)
    df["recommended_order_qty"] = (
        (df["demand_horizon"] + df["safety_stock"] - df["available"])
        .clip(lower=0)
        .apply(math.ceil)
    )
    # Respect the manually configured reorder level as a floor for urgency.
    df["status"] = [
        classify(a, max(rp, rl), d)
        for a, rp, rl, d in zip(
            df["available"], df["reorder_point"], df["reorder_level"], df["days_of_stock"]
        )
    ]
    # LightGBM shortage prediction can escalate an OK/SOON item to URGENT.
    escalate = (df["shortage_risk"] >= 0.5) & (df["status"].isin([STATUS_OK, STATUS_SOON]))
    df.loc[escalate & (df["available"] > 0), "status"] = STATUS_URGENT
    df.loc[df["status"].isin([STATUS_OK, STATUS_OVER]), "recommended_order_qty"] = 0

    cols = [
        "product_id",
        "sku",
        "name",
        "location_id",
        "location_name",
        "quantity",
        "reserved_quantity",
        "available",
        "avg_daily_forecast",
        "demand_lead",
        "demand_horizon",
        "safety_stock",
        "reorder_point",
        "days_of_stock",
        "recommended_order_qty",
        "status",
        "method",
        "lead_demand_expected",
        "lead_demand_p90",
        "shortage_risk",
        "shortage_method",
    ]
    out = df[cols].copy()
    out["avg_daily_forecast"] = out["avg_daily_forecast"].round(2)
    out["demand_lead"] = out["demand_lead"].round(2)
    out["demand_horizon"] = out["demand_horizon"].round(2)
    out["forecast_horizon_days"] = FORECAST_HORIZON_DAYS
    out["lead_time_days"] = LEAD_TIME_DAYS
    return out.sort_values(
        ["status", "days_of_stock"],
        key=lambda s: s.map(_status_rank) if s.name == "status" else s,
    ).reset_index(drop=True)


_STATUS_ORDER = {STATUS_OUT: 0, STATUS_URGENT: 1, STATUS_SOON: 2, STATUS_OVER: 3, STATUS_OK: 4}


def _status_rank(status: str) -> int:
    return _STATUS_ORDER.get(status, 99)
