import pandas as pd

from etl.transform import add_features, build_daily_demand


def _sales(rows):
    return pd.DataFrame(rows, columns=["product_id", "location_id", "sale_date", "units_sold"])


def test_build_daily_demand_zero_fills_gaps():
    sales = _sales(
        [
            ("p1", "l1", "2026-01-01", 5),
            ("p1", "l1", "2026-01-04", 3),
        ]
    )
    out = build_daily_demand(sales)
    assert len(out) == 4  # Jan 1..4 inclusive
    by_date = out.set_index("sale_date")["units_sold"]
    assert by_date[pd.Timestamp("2026-01-02")] == 0
    assert by_date[pd.Timestamp("2026-01-04")] == 3


def test_build_daily_demand_separate_series():
    sales = _sales(
        [
            ("p1", "l1", "2026-01-01", 5),
            ("p2", "l1", "2026-01-03", 2),
        ]
    )
    out = build_daily_demand(sales)
    # p1 grid runs to the global max date (Jan 3), p2 starts at its own first sale.
    assert len(out[out["product_id"] == "p1"]) == 3
    assert len(out[out["product_id"] == "p2"]) == 1


def test_add_features_lags_and_calendar():
    dates = pd.date_range("2026-01-01", periods=30, freq="D")
    series = pd.DataFrame(
        {
            "product_id": "p1",
            "location_id": "l1",
            "sale_date": dates,
            "units_sold": range(30),
        }
    )
    out = add_features(series)
    assert not out.empty
    row = out.iloc[-1]
    assert row["lag_1"] == 28
    assert row["lag_7"] == 22
    assert row["day_of_week"] == pd.Timestamp(row["sale_date"]).dayofweek
