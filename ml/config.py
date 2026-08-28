"""Central configuration for the inventory recommendation pipeline."""
import os

from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://inventory:inventory@localhost:5432/inventory_platform",
)

# SQLAlchemy needs the psycopg2 dialect prefix.
SQLALCHEMY_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg2://", 1)

# --- Forecasting ---
FORECAST_HORIZON_DAYS = int(os.getenv("FORECAST_HORIZON_DAYS", "30"))
# Minimum days of history required to train the ML model for a product;
# below this the pipeline falls back to a moving-average forecast.
MIN_TRAIN_DAYS = int(os.getenv("MIN_TRAIN_DAYS", "60"))
MIN_SALE_DAYS = int(os.getenv("MIN_SALE_DAYS", "10"))

# --- Recommendation ---
LEAD_TIME_DAYS = int(os.getenv("LEAD_TIME_DAYS", "7"))
# z = 1.65 -> ~95% service level for safety stock.
SERVICE_LEVEL_Z = float(os.getenv("SERVICE_LEVEL_Z", "1.65"))
OVERSTOCK_DAYS = int(os.getenv("OVERSTOCK_DAYS", "90"))

REPORTS_DIR = os.path.join(os.path.dirname(__file__), "reports")
