"""AI/ML layer — LightGBM shortage prediction.

For each (product, location) the model learns to predict total demand over
the next LEAD_TIME_DAYS from lag/rolling/calendar features. Two quantile
models (median + upper) give an expected and a pessimistic lead-time demand;
comparing those against available stock yields a shortage risk score.
"""
import numpy as np
import pandas as pd

from config import LEAD_TIME_DAYS, MIN_SALE_DAYS, MIN_TRAIN_DAYS
from etl.transform import FEATURE_COLS, add_features

try:
    import lightgbm as lgb

    HAS_LIGHTGBM = True
except ImportError:  # pragma: no cover - environment dependent
    HAS_LIGHTGBM = False

UPPER_QUANTILE = 0.9


def _training_frame(series: pd.DataFrame) -> pd.DataFrame:
    """Features per day + target = demand over the following LEAD_TIME_DAYS."""
    df = add_features(series)
    future_sum = (
        df["units_sold"][::-1]
        .rolling(LEAD_TIME_DAYS, min_periods=LEAD_TIME_DAYS)
        .sum()[::-1]
        .shift(-1)
    )
    df["target_lead_demand"] = future_sum
    return df.dropna(subset=["target_lead_demand"])


def _predict_quantile(train: pd.DataFrame, latest: pd.DataFrame, alpha: float) -> float:
    model = lgb.LGBMRegressor(
        objective="quantile",
        alpha=alpha,
        n_estimators=200,
        max_depth=4,
        learning_rate=0.05,
        min_child_samples=10,
        verbose=-1,
    )
    model.fit(train[FEATURE_COLS], train["target_lead_demand"])
    return max(0.0, float(model.predict(latest[FEATURE_COLS])[0]))


def predict_shortage(
    daily_demand: pd.DataFrame, inventory: pd.DataFrame
) -> pd.DataFrame:
    """Per (product, location): expected/worst-case lead-time demand + risk.

    shortage_risk: 0.0 = stock covers even the pessimistic (P90) demand,
    1.0 = stock cannot cover the median demand; linear in between.
    """
    avail = (
        inventory.assign(
            available=lambda d: d["quantity"].fillna(0) - d["reserved_quantity"].fillna(0)
        )
        .set_index(["product_id", "location_id"])["available"]
        .to_dict()
    )

    rows = []
    for (product_id, location_id), series in daily_demand.groupby(
        ["product_id", "location_id"]
    ):
        n_days = len(series)
        n_sale_days = int((series["units_sold"] > 0).sum())
        use_ml = (
            HAS_LIGHTGBM and n_days >= MIN_TRAIN_DAYS and n_sale_days >= MIN_SALE_DAYS
        )
        if use_ml:
            train = _training_frame(series)
            use_ml = len(train) >= 30
        if use_ml:
            latest = add_features(series).tail(1)
            expected = _predict_quantile(train, latest, 0.5)
            worst = max(
                expected, _predict_quantile(train, latest, UPPER_QUANTILE)
            )
            method = "lightgbm"
        else:
            daily_avg = float(series["units_sold"].tail(14).mean())
            daily_std = float(series["units_sold"].tail(28).std() or 0)
            expected = daily_avg * LEAD_TIME_DAYS
            worst = expected + 1.65 * daily_std * np.sqrt(LEAD_TIME_DAYS)
            method = "statistical"

        available = float(avail.get((product_id, location_id), 0))
        if available <= expected:
            risk = 1.0
        elif available >= worst or worst <= expected:
            risk = 0.0
        else:
            risk = (worst - available) / (worst - expected)

        rows.append(
            {
                "product_id": product_id,
                "location_id": location_id,
                "lead_demand_expected": round(expected, 2),
                "lead_demand_p90": round(worst, 2),
                "shortage_risk": round(float(np.clip(risk, 0, 1)), 3),
                "shortage_method": method,
            }
        )

    return pd.DataFrame(rows)
