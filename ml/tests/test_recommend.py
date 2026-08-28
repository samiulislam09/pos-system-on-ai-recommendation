import pandas as pd

from config import LEAD_TIME_DAYS
from recommend.engine import (
    STATUS_OK,
    STATUS_OUT,
    STATUS_OVER,
    STATUS_URGENT,
    build_recommendations,
    classify,
)


def test_classify_boundaries():
    assert classify(available=0, reorder_point=10, days_of_stock=0) == STATUS_OUT
    assert classify(available=5, reorder_point=10, days_of_stock=3) == STATUS_URGENT
    assert (
        classify(available=100, reorder_point=10, days_of_stock=30) == STATUS_OK
    )
    assert (
        classify(available=1000, reorder_point=10, days_of_stock=200) == STATUS_OVER
    )


def _fixture(available_qty):
    dates = pd.date_range("2026-02-01", periods=10, freq="D")
    forecasts = pd.DataFrame(
        {
            "product_id": "p1",
            "location_id": "l1",
            "forecast_date": dates,
            "predicted_units": [4.0] * 10,
            "method": "prophet",
        }
    )
    inventory = pd.DataFrame(
        [
            {
                "org_id": "o1",
                "product_id": "p1",
                "location_id": "l1",
                "quantity": available_qty,
                "reserved_quantity": 0,
            }
        ]
    )
    products = pd.DataFrame(
        [
            {
                "product_id": "p1",
                "org_id": "o1",
                "sku": "SKU1",
                "name": "Widget",
                "reorder_level": 5,
                "cost_price": 2,
                "selling_price": 5,
            }
        ]
    )
    daily = pd.DataFrame(
        {
            "product_id": "p1",
            "location_id": "l1",
            "sale_date": pd.date_range("2026-01-01", periods=30, freq="D"),
            "units_sold": [4] * 30,
        }
    )
    locations = pd.DataFrame(
        [{"location_id": "l1", "location_name": "Main", "location_code": "M1"}]
    )
    return forecasts, inventory, products, daily, locations


def test_low_stock_is_urgent_with_order_qty():
    recos = build_recommendations(*_fixture(available_qty=10))
    row = recos.iloc[0]
    # 10 units on hand vs 4/day demand -> stockout inside the lead time.
    assert row["days_of_stock"] <= LEAD_TIME_DAYS
    assert row["status"] == STATUS_URGENT
    assert row["recommended_order_qty"] > 0


def test_healthy_stock_is_ok_with_no_order():
    recos = build_recommendations(*_fixture(available_qty=150))
    row = recos.iloc[0]
    assert row["status"] == STATUS_OK
    assert row["recommended_order_qty"] == 0


def test_shortage_risk_escalates_status():
    forecasts, inventory, products, daily, locations = _fixture(available_qty=150)
    shortage = pd.DataFrame(
        [
            {
                "product_id": "p1",
                "location_id": "l1",
                "lead_demand_expected": 120.0,
                "lead_demand_p90": 200.0,
                "shortage_risk": 0.9,
                "shortage_method": "lightgbm",
            }
        ]
    )
    recos = build_recommendations(
        forecasts, inventory, products, daily, locations, shortage
    )
    assert recos.iloc[0]["status"] == STATUS_URGENT
