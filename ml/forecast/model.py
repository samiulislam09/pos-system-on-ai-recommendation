"""AI/ML layer — demand forecasting.

Per (product, location) series, matching the architecture diagram:
  - Facebook Prophet         -> 30-day demand forecast (trend + weekly
                                seasonality), used when there is enough history
  - moving-average fallback  -> sparse series (new products, few sales)

LightGBM shortage prediction lives in forecast/shortage.py.
"""
import logging
import warnings

import numpy as np
import pandas as pd

from config import FORECAST_HORIZON_DAYS, MIN_SALE_DAYS, MIN_TRAIN_DAYS

logging.getLogger("prophet").setLevel(logging.WARNING)
logging.getLogger("cmdstanpy").setLevel(logging.WARNING)
# Prophet logs an ERROR about optional plotly support on import; we never use
# its plotting, so hide that noise.
logging.getLogger("prophet.plot").setLevel(logging.CRITICAL)

try:
    from prophet import Prophet

    HAS_PROPHET = True
except ImportError:  # pragma: no cover - environment dependent
    HAS_PROPHET = False


def _moving_average_forecast(series: pd.DataFrame, horizon: int) -> np.ndarray:
    """Weighted average of the last 14 days (recent days weigh more)."""
    y = series.sort_values("sale_date")["units_sold"].to_numpy()
    window = y[-14:]
    if len(window) == 0 or window.sum() == 0:
        return np.zeros(horizon)
    weights = np.arange(1, len(window) + 1)
    daily = float(np.average(window, weights=weights))
    return np.full(horizon, daily)


def _prophet_forecast(series: pd.DataFrame, horizon: int) -> np.ndarray:
    df = series.sort_values("sale_date")[["sale_date", "units_sold"]].rename(
        columns={"sale_date": "ds", "units_sold": "y"}
    )
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        model = Prophet(
            weekly_seasonality=True,
            yearly_seasonality=len(df) >= 365,
            daily_seasonality=False,
        )
        model.fit(df)
        future = model.make_future_dataframe(periods=horizon, freq="D")
        pred = model.predict(future).tail(horizon)
    return np.clip(pred["yhat"].to_numpy(), 0, None)


def forecast_all(daily_demand: pd.DataFrame) -> pd.DataFrame:
    """Forecast every (product, location) series.

    Returns one row per product/location/day with predicted units and the
    method used ('prophet' or 'moving_average').
    """
    horizon = FORECAST_HORIZON_DAYS
    results = []
    for (product_id, location_id), series in daily_demand.groupby(
        ["product_id", "location_id"]
    ):
        n_days = len(series)
        n_sale_days = int((series["units_sold"] > 0).sum())
        if HAS_PROPHET and n_days >= MIN_TRAIN_DAYS and n_sale_days >= MIN_SALE_DAYS:
            preds = _prophet_forecast(series, horizon)
            method = "prophet"
        else:
            preds = _moving_average_forecast(series, horizon)
            method = "moving_average"

        start = series["sale_date"].max() + pd.Timedelta(days=1)
        results.append(
            pd.DataFrame(
                {
                    "product_id": product_id,
                    "location_id": location_id,
                    "forecast_date": pd.date_range(start, periods=horizon, freq="D"),
                    "predicted_units": np.round(preds, 3),
                    "method": method,
                }
            )
        )

    if not results:
        return pd.DataFrame(
            columns=[
                "product_id",
                "location_id",
                "forecast_date",
                "predicted_units",
                "method",
            ]
        )
    return pd.concat(results, ignore_index=True)
