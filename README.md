# Multi-Store POS & Inventory Platform

A full-stack point-of-sale and inventory platform with an AI-powered
inventory recommendation engine.

| Component | Stack | Where |
|---|---|---|
| Web app | Next.js 16, React Query, Tailwind | `frontend/` |
| API | NestJS, Prisma, PostgreSQL, Redis, JWT auth | `backend/apps/api` |
| Worker | Background jobs (BullMQ/Redis) | `backend/apps/worker` |
| AI/ML pipeline | Python ETL + Prophet (demand forecast) + LightGBM (shortage prediction) | `ml/` |
| Database | PostgreSQL 16 (single source of truth, ledger-based inventory) | docker volume |

The AI pipeline reads sales history from Postgres, builds a star-schema
warehouse, forecasts 30 days of demand per product/store, compares it with
current stock, and writes restock recommendations that show up in the web
app under **AI Insights**. See `ml/README.md` for the deep dive.

---

## Running on a new machine

### Prerequisites

- **Docker Desktop** (or Docker Engine + Compose v2) — this is the only hard
  requirement; every service runs in containers.
- ~6 GB free disk for images and volumes.
- Free ports: **3000/3001** (web), **4000** (API), **5001** (ML dashboard),
  **5432** (Postgres), **6379** (Redis). See "Changing ports" below if any
  are taken.

Optional (only for running pieces outside Docker): Node.js 20+, Python 3.12+.

### 1. Get the code

```bash
git clone <your-repo-url> pos
cd pos
```

(If you're copying the folder instead, skip anything named `node_modules`,
`.next`, `.turbo`, and `ml/.venv` — they are machine-specific and will be
rebuilt.)

### 2. Configure environment (optional)

The stack runs with safe development defaults out of the box. The root
`.env` supports overrides:

```bash
# .env (all optional in development)
WEB_PORT=3001                # host port for the web app (default 3000)
JWT_ACCESS_SECRET=...        # override in anything public-facing
JWT_REFRESH_SECRET=...
CORS_ORIGIN=http://localhost:3000,http://localhost:3001
```

For production you MUST set real JWT secrets and change the database
password (`backend/docker-compose.yml`).

### 3. Start everything

```bash
docker compose up --build -d
```

First start takes several minutes: it builds four images, installs
dependencies, then a one-shot `backend-init` container runs Prisma
migrations and seeds the database before the API starts.

Check that everything is healthy:

```bash
docker compose ps
curl http://localhost:4000/api/v1/health   # {"status":"ok","db":"ok","redis":"ok"}
```

### 4. Log in

Open **http://localhost:3001** (or 3000 if you didn't set `WEB_PORT`).

Seeded development login:

- **Email:** `admin@demo.com`
- **Password:** `admin123`

### 5. Generate AI recommendations

The AI models need sales history. On a fresh database, seed realistic demo
sales first (tagged `DEMO-`, removable at any time):

```bash
docker compose exec ml python seed_demo_data.py --days 180
```

Then either:

- **In the web app:** sidebar → **AI Insights** → **Run Pipeline**. Watch the
  live log; the table refreshes when the run finishes (~30–60 s), or
- **Standalone ML dashboard:** http://localhost:5001 → Run Pipeline, or
- **Terminal:** `docker compose exec ml python run_pipeline.py`

Remove the demo sales later with:

```bash
docker compose exec ml python seed_demo_data.py --clean
```

Once real sales accumulate (60+ days per product), stop seeding — the
models train on real data automatically. For automatic nightly retraining,
add a cron entry on the host:

```bash
0 2 * * * cd /path/to/pos && docker compose exec -T ml python run_pipeline.py >> ml/reports/pipeline.log 2>&1
```

---

## Day-to-day commands

```bash
docker compose up -d               # start the whole stack
docker compose down                # stop (keeps database data)
docker compose down -v             # stop AND WIPE all data (careful)
docker compose logs -f api web ml  # follow logs
docker compose up --build -d api   # rebuild one service after code changes
```

Hot reload: `backend/` and `frontend/` are bind-mounted into their
containers, so code edits reload automatically. The `ml` service bakes code
into its image — after editing `ml/`, run
`docker compose up --build -d ml`.

## URLs & ports

| URL | What |
|---|---|
| http://localhost:3001 | Web app (POS, inventory, reports, AI Insights) |
| http://localhost:4000/api/v1 | REST API (JWT auth) |
| http://localhost:5001 | Standalone ML dashboard |
| localhost:5432 | PostgreSQL (`inventory` / `inventory`, db `inventory_platform`) |
| localhost:6379 | Redis |

### Changing ports

- Web: set `WEB_PORT` in `.env`.
- Postgres/Redis/API/ML: edit the `ports:` mappings in
  `docker-compose.yml` / `backend/docker-compose.yml`. Only the host side
  (left of the `:`) should change.

---

## Running pieces outside Docker (optional)

Useful for debugging. Keep Postgres + Redis in Docker either way:

```bash
docker compose up -d postgres redis
```

**API + worker** (Node 20+):

```bash
cd backend
npm install
npm run dev:api      # http://localhost:4000
npm run dev:worker
```

**Frontend:**

```bash
cd frontend
npm install
npm run dev          # http://localhost:3000
```

**ML pipeline** (Python 3.12+):

```bash
cd ml
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
brew install libomp            # macOS only (LightGBM needs OpenMP)
.venv/bin/python run_pipeline.py     # one-shot run
.venv/bin/python webapp.py           # dashboard on :5001
.venv/bin/python -m pytest tests/ -q # unit tests
```

Host processes reach the databases at `localhost:5432` / `localhost:6379`
(the defaults in each component's config).

---

## Architecture notes

- **Inventory is ledger-based**: every stock change is an
  `InventoryMovement` row; `Inventory` holds the current balance per
  product/location.
- **The AI pipeline is read-only** toward operational tables. It writes to
  its own tables (`ai_demand_forecasts`, `ai_inventory_recommendations`,
  schema `warehouse.*`) plus Redis keys `ai:recommendations:latest` and
  `ai:alerts:low_stock`.
- **API endpoints for AI**: `GET /api/v1/ai/recommendations`,
  `POST /api/v1/ai/run`, `GET /api/v1/ai/run/status` — all org-scoped and
  permission-guarded; the run endpoints proxy to the `ml` service
  (`ML_SERVICE_URL`).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Cannot connect to the Docker daemon` | Start Docker Desktop and retry. |
| `port is already allocated` / `Address already in use` | Something owns the port — `lsof -ti:<port> \| xargs kill`, or change the port (see above). |
| Web app can't log in / API 502 | `docker compose ps` — wait until `inventory-backend-init` has exited `0` and `api` is healthy. |
| AI Insights says the ML service is unreachable | `docker compose up -d ml`, then check `docker compose logs ml`. |
| AI Insights table is empty | No pipeline run yet — seed demo data and click Run Pipeline (step 5). |
| `Importing plotly failed` in ml logs | Harmless — optional Prophet plotting dependency we don't use. |
