# Inventory Recommendation Engine (AI Forecast vs Current Stock)

A Python ETL + ML pipeline that reads your POS Postgres database, forecasts
demand per product per store, compares it against current stock, and writes
restock recommendations back to Postgres, a CSV report, and Redis.

Maps to the architecture diagram like this:

| Diagram box | Implementation |
|---|---|
| ETL Pipeline (Extract → Transform → Load) | `etl/extract.py` → `etl/transform.py` → `etl/load.py` |
| Data Warehouse (star schema) | Postgres schema `warehouse` — `dim_date`, `dim_product`, `dim_location`, `fact_sales_daily` |
| Redis Cache (hot data) | keys `ai:recommendations:latest`, `ai:alerts:low_stock` |
| AI/ML — Facebook Prophet (demand forecasting) | `forecast/model.py` — 30-day forecast per product/store |
| AI/ML — LightGBM (shortage prediction) | `forecast/shortage.py` — quantile models → shortage risk score |
| MLOps nightly retrain | cron entry (see below) — models retrain on every run |
| Inventory Recommendation Engine | `recommend/engine.py` — forecast vs available stock |
| Management Dashboard data | tables `ai_inventory_recommendations`, `ai_demand_forecasts` |

## How it works

1. **EXTRACT** — pulls completed sales (`Sale` + `SaleItem`), current stock
   (`Inventory.quantity − reservedQuantity`), active products, and locations
   from the operational Postgres DB.
2. **TRANSFORM** — aggregates sales into a *daily demand time series* per
   (product, store), filling in explicit zero-sales days, and engineers
   features (lags, rolling means, day-of-week, month).
3. **LOAD (warehouse)** — rebuilds the star-schema warehouse
   (`warehouse.fact_sales_daily` + dimensions) that the models train from.
4. **AI/ML** —
   - **Prophet** fits each series (trend + weekly seasonality) and predicts
     the next 30 days of demand. Products with under ~60 days of history
     automatically fall back to a weighted moving average.
   - **LightGBM** trains quantile models (P50 + P90) that predict total
     demand over the supplier lead time; comparing those to available stock
     gives a `shortage_risk` score from 0 to 1.
5. **RECOMMEND** — for each product/store:
   - `safety_stock = 1.65 × std(daily demand) × √lead_time` (≈95% service level)
   - `reorder_point = forecast demand over lead time + safety stock`
   - `recommended_order_qty = 30-day forecast + safety stock − available`
   - status: `OUT_OF_STOCK` → `URGENT_RESTOCK` → `RESTOCK_SOON` → `OK` →
     `OVERSTOCKED`. A LightGBM `shortage_risk ≥ 0.5` escalates to urgent.
6. **LOAD (results)** — replaces `ai_demand_forecasts` and
   `ai_inventory_recommendations` in Postgres, writes a timestamped CSV to
   `reports/`, and caches the latest run in Redis for dashboards.

## Ways to run it

There are three front doors, all driving the same pipeline:

1. **POS frontend (recommended)** — log in at http://localhost:3001, open
   **AI Insights** in the sidebar, click **Run Pipeline**. The Next.js app
   calls `POST /api/v1/ai/run` on the NestJS API, which proxies to the `ml`
   docker service; results appear in the same page when the run finishes.
2. **Standalone dashboard** — http://localhost:5001 (the `ml` docker
   service, or `python webapp.py` on the host).
3. **Terminal / cron** — `python run_pipeline.py` (see below).

With docker: `docker compose up -d` now includes the `ml` service.

## How to run (host Python, without Docker)

```bash
# 0. Postgres (and optionally Redis) must be up
docker start inventory-postgres inventory-redis   # or: docker compose up -d

# 1. One-time setup
cd ml
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
# macOS only — LightGBM needs OpenMP:
brew install libomp

# 2. (Only while your DB has few real sales) seed demo history
.venv/bin/python seed_demo_data.py --days 180

# 3. Run the pipeline
.venv/bin/python run_pipeline.py
```

The console prints the recommendation table; the same data lands in:

- Postgres: `SELECT * FROM ai_inventory_recommendations ORDER BY status;`
- CSV: `ml/reports/recommendations_<timestamp>.csv`
- Redis: `GET ai:recommendations:latest` / `GET ai:alerts:low_stock`

### Configuration

Environment variables (or `ml/.env`):

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | `postgresql://inventory:inventory@localhost:5432/inventory_platform` | operational DB |
| `REDIS_URL` | `redis://localhost:6379` | hot cache (skipped if unreachable) |
| `FORECAST_HORIZON_DAYS` | 30 | days of demand to forecast |
| `LEAD_TIME_DAYS` | 7 | supplier delivery time |
| `SERVICE_LEVEL_Z` | 1.65 | safety-stock z-score (1.65 ≈ 95%) |
| `MIN_TRAIN_DAYS` | 60 | history needed before the ML models are used |
| `OVERSTOCK_DAYS` | 90 | days-of-stock above which an item is OVERSTOCKED |

### Nightly retrain (MLOps)

Models are retrained from scratch on every run, so a nightly cron is all you
need:

```bash
crontab -e
# retrain + refresh recommendations at 2 AM every day
0 2 * * * cd /Volumes/work/personal/pos/ml && .venv/bin/python run_pipeline.py >> reports/pipeline.log 2>&1
```

### Demo data

Your DB currently has very few real sales, which is not enough to train on.
`seed_demo_data.py` generates realistic history (weekly seasonality, trend,
noise) tagged with a `DEMO-` transaction prefix:

```bash
.venv/bin/python seed_demo_data.py --days 365   # seed more history
.venv/bin/python seed_demo_data.py --clean      # remove ALL demo sales
```

Notes: demo rows are `Sale`/`SaleItem` only — they do not create
`InventoryMovement` ledger entries, so don't mix them into a production DB.
Sale returns are not subtracted from demand (rare in this dataset); add a
returns join in `etl/extract.py` if that matters for you.

### Tests

```bash
.venv/bin/python -m pytest tests/ -q
```

## Reading the output

| Column | Meaning |
|---|---|
| `available` | on-hand minus reserved stock |
| `avg_daily_forecast` | mean AI-forecasted units/day (next 30 days) |
| `days_of_stock` | how many days current stock will last at forecast rate |
| `reorder_point` | stock level at which you should reorder |
| `shortage_risk` | LightGBM 0–1 risk of stockout within the lead time |
| `recommended_order_qty` | suggested purchase quantity now |
| `status` | `OUT_OF_STOCK` / `URGENT_RESTOCK` / `RESTOCK_SOON` / `OK` / `OVERSTOCKED` |
| `method` | `prophet` or `moving_average` (sparse-history fallback) |
