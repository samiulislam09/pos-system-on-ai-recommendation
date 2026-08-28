# Inventory Platform — infrastructure

This directory holds infrastructure-related assets (Docker, nginx).

## Development database only

Run `docker-compose up -d postgres redis` from the backend project root to start
the development PostgreSQL and Redis instances, then run the apps on the host
with `npm run dev`.

## Full stack in Docker

`../../../docker-compose.yml` (repo root, one level above `backend/`) runs the
whole stack — postgres, redis, api, worker, and the Next.js web app — with the
source bind-mounted for hot reload. It `include`s this project's
`docker-compose.yml` for postgres/redis, so the two share container names and
must not be run at the same time.

    cd /Volumes/work/personal/pos
    docker compose up --build

`dev-init.sh` is the one-shot bootstrap that stack runs before starting api and
worker: `prisma generate` → build `packages/*` → `prisma migrate deploy` → seed.
It runs in its own container so api and worker never race each other writing to
`node_modules/` or `packages/*/dist`.

`Dockerfile.dev` lives at the backend project root (build context must be the
whole workspace, not a single app).
