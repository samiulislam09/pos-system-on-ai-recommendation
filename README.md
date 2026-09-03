# Multi-Store POS & Inventory Platform

A full-stack, multi-tenant point-of-sale and inventory platform with an
AI-powered inventory recommendation engine. Inventory is ledger-based, POS
sales are idempotent end-to-end, and an ML pipeline turns sales history into
restock recommendations that surface in the web app.

| Component | Stack | Where |
|---|---|---|
| Web app | Next.js 16 (App Router), React 19, TanStack Query, Tailwind CSS v4 | `frontend/` |
| API | NestJS 11, Prisma, PostgreSQL 16, Redis, JWT auth, Zod | `backend/apps/api` |
| Worker | Background jobs — BullMQ/Redis (reconciliation, low-stock alerts, daily aggregates) | `backend/apps/worker` |
| Edge agent | Offline-first store/terminal agent — local SQLite event outbox, sync with backoff | `backend/apps/edge` |
| AI/ML pipeline | Python ETL + Prophet (demand forecast) + LightGBM (shortage risk) + Flask dashboard | `ml/` |
| Database | PostgreSQL 16 (single source of truth) | docker volume |

The AI pipeline reads sales history from Postgres, builds a star-schema
warehouse, forecasts 30 days of demand per product/store, compares it with
current stock, and writes restock recommendations that show up in the web
app under **AI Insights**. See `ml/README.md` for the deep dive.

## Features

- **Point of sale** — debounced product search, cart with stock-clamped
  quantities, and a reliable sale flow: each sale carries a client-generated
  `eventId`, so retries and flaky networks never double-charge
  (`editing → submitting → unknown → confirmed` with automatic reconciliation).
- **Inventory** — append-only `InventoryMovement` ledger with per-location
  balances, adjustments, inter-location transfers (approve/ship/receive),
  purchase orders with goods receipts, and returns with approval flow.
- **Multi-tenancy & RBAC** — organizations own everything; seven roles
  (SUPER_ADMIN → VIEWER) with a permission map enforced per endpoint;
  tenant isolation asserted on every org-owned resource.
- **Reports** — sales by day/store, top products, movements, adjustments,
  purchases, transfers, returns over any date range.
- **AI Insights** — per product/store: days of stock, safety stock, reorder
  point, shortage risk, recommended order quantity, with statuses from
  `OUT_OF_STOCK` to `OVERSTOCKED`; pipeline can be triggered from the UI
  with a live log.
- **Offline-capable stores** — the edge agent buffers POS events in local
  SQLite and syncs them to the central API with exponential backoff;
  duplicate events are treated as success.

## Repository layout

```
pos/
├── docker-compose.yml       # full dev stack (includes backend/docker-compose.yml)
├── frontend/                # Next.js web app (@inv/web)
├── backend/                 # npm workspaces + Turborepo
│   ├── apps/
│   │   ├── api/             # @inv/api    — NestJS REST API (port 4000, prefix /api/v1)
│   │   ├── worker/          # @inv/worker — BullMQ job consumers
│   │   └── edge/            # @inv/edge   — offline terminal agent (port 5100)
│   └── packages/
│       ├── database/        # @inv/database   — Prisma schema, client, seed
│       ├── config/          # @inv/config     — RBAC permissions per role
│       ├── events/          # @inv/events     — queue/job/event contracts
│       ├── validation/      # @inv/validation — shared Zod schemas (API + edge)
│       └── types/           # @inv/types      — shared TS types
└── ml/                      # Python pipeline: etl/, forecast/, recommend/, webapp.py
```

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
git clone git@github.com:samiulislam09/pos-system-on-ai-recommendation.git pos
cd pos
```

### 2. Configure environment (optional)

The stack runs with safe development defaults out of the box. The root
`.env` supports overrides:

```bash
# .env (all optional in development)
WEB_PORT=3001                # host port for the web app (default 3000)
JWT_ACCESS_SECRET=...        # override in anything public-facing (32+ chars)
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

Seeded development data: organization **DEMO** (currency BDT) with two
stores (Dhanmondi, Mirpur) and a central warehouse, plus an admin login:

- **Email:** `admin@demo.com`
- **Password:** `admin123`

### 5. Generate AI recommendations

The AI models need sales history. On a fresh database, seed realistic demo
sales first (tagged `DEMO-`, removable at any time — development databases
only, as demo rows skip the inventory ledger):

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
models retrain from scratch on real data every run. For automatic nightly
retraining, add a cron entry on the host:

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
npm install          # also runs prisma generate
npm run dev:api      # http://localhost:4000
npm run dev:worker
npm run dev:edge     # optional: offline terminal agent on :5100
```

Other useful backend scripts: `npm run db:migrate` / `db:seed` /
`db:studio` (Prisma Studio), `npm run test` / `lint` / `typecheck` (Turbo
across all workspaces).

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

## API overview

All routes live under `/api/v1` behind a global JWT guard (`@Public()`
exceptions: login, register, refresh, health) and per-endpoint permission
checks. Responses use a `{ success, data | error }` envelope.

| Group | Endpoints |
|---|---|
| `auth` | `login`, `register-organization`, `refresh`, `logout` |
| `organizations`, `users`, `stores` | CRUD, plus nested `stores/:id/terminals` |
| `products` | CRUD, plus `categories`, `brands` |
| `inventory` | list, `summary`, per-product balances & movements, `adjust` |
| `sales`, `returns` | list/detail; returns `approve`/`reject` |
| `purchases` | CRUD, `suppliers`, `:id/receive` (goods receipt) |
| `transfers` | `approve`/`ship`/`receive`/`cancel` |
| `events` | idempotent POS ingestion: `POST /events`, `/events/batch` |
| `pos` | `bootstrap`, `products` (terminal-facing) |
| `reports` | `overview`, `sales`, `stores`, `top-products`, `inventory`, `movements`, `adjustments`, `purchases`, `transfers`, `returns` |
| `ai` | `recommendations`, `POST run`, `run/status` (proxies the ML service) |
| `audit`, `health` | audit log, liveness |

Auth: short-lived JWT access tokens plus rotating refresh tokens stored
hashed server-side. The frontend keeps tokens in `localStorage` and
transparently refreshes on 401 (single-flight, then redirect to `/login`).

## Architecture notes

- **Inventory is ledger-based**: every stock change is an
  `InventoryMovement` row; `Inventory` holds the current balance per
  product/location. A worker job periodically reconciles balances against
  the ledger and audit-logs any mismatch.
- **POS sales are idempotent**: every sale/event carries a client-generated
  `eventId` (`TransactionEvent` table); replays return the original result,
  which is what makes both the web POS retry flow and the edge agent's
  at-least-once sync safe.
- **Critical writes are synchronous**: inventory-affecting operations run
  in the API's transaction path; only non-critical work (reconciliation,
  alerts, aggregates) goes through BullMQ, and the API degrades gracefully
  if Redis is down.
- **The AI pipeline is read-only** toward operational tables. It writes to
  its own tables (`ai_demand_forecasts`, `ai_inventory_recommendations`,
  schema `warehouse.*`) plus Redis keys `ai:recommendations:latest` and
  `ai:alerts:low_stock`. Forecasting uses Prophet (falling back to a moving
  average for short histories) and LightGBM quantile models for shortage
  risk.

## Testing

```bash
cd backend && npm run test               # Jest (via Turbo)
cd backend && npm run typecheck          # tsc across all workspaces
cd frontend && npm run lint
cd ml && .venv/bin/python -m pytest tests/ -q   # pure-function tests, no DB needed
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Cannot connect to the Docker daemon` | Start Docker Desktop and retry. |
| `port is already allocated` / `Address already in use` | Something owns the port — `lsof -ti:<port> \| xargs kill`, or change the port (see above). |
| Web app can't log in / API 502 | `docker compose ps` — wait until `inventory-backend-init` has exited `0` and `api` is healthy. |
| AI Insights says the ML service is unreachable | `docker compose up -d ml`, then check `docker compose logs ml`. |
| AI Insights table is empty | No pipeline run yet — seed demo data and click Run Pipeline (step 5). |
| `Importing plotly failed` in ml logs | Harmless — optional Prophet plotting dependency we don't use. |
