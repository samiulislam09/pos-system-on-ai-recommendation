"""TRANSFORM step: turn raw sales rows into model-ready time series."""
import pandas as pd


def build_daily_demand(sales: pd.DataFrame) -> pd.DataFrame:
    """Zero-fill a complete daily grid per (product, location).

    Sales data only has rows for days with sales; the model needs explicit
    zero-demand days too.
    """
    if sales.empty:
        return pd.DataFrame(
            columns=["product_id", "location_id", "sale_date", "units_sold"]
        )

    sales = sales.copy()
    sales["sale_date"] = pd.to_datetime(sales["sale_date"])
    end = sales["sale_date"].max()

    frames = []
    for (product_id, location_id), grp in sales.groupby(["product_id", "location_id"]):
        start = grp["sale_date"].min()
        grid = pd.DataFrame({"sale_date": pd.date_range(start, end, freq="D")})
        grid["product_id"] = product_id
        grid["location_id"] = location_id
        merged = grid.merge(
            grp[["sale_date", "units_sold"]], on="sale_date", how="left"
        )
        merged["units_sold"] = merged["units_sold"].fillna(0).astype(int)
        frames.append(merged)

    return pd.concat(frames, ignore_index=True)[
        ["product_id", "location_id", "sale_date", "units_sold"]
    ]


FEATURE_COLS = [
    "lag_1",
    "lag_7",
    "lag_14",
    "rolling_mean_7",
    "rolling_mean_14",
    "day_of_week",
    "is_weekend",
    "month",
]


def add_features(series: pd.DataFrame) -> pd.DataFrame:
    """Feature-engineer one (product, location) daily series.

    Expects `series` sorted by sale_date with a complete daily grid.
    Rows whose lag/rolling windows reach before the series start are dropped.
    """
    df = series.sort_values("sale_date").copy()
    y = df["units_sold"]
    df["lag_1"] = y.shift(1)
    df["lag_7"] = y.shift(7)
    df["lag_14"] = y.shift(14)
    df["rolling_mean_7"] = y.shift(1).rolling(7).mean()
    df["rolling_mean_14"] = y.shift(1).rolling(14).mean()
    df["day_of_week"] = df["sale_date"].dt.dayofweek
    df["is_weekend"] = (df["day_of_week"] >= 5).astype(int)
    df["month"] = df["sale_date"].dt.month
    return df.dropna(subset=FEATURE_COLS).reset_index(drop=True)
