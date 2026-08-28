#!/bin/sh
# One-shot bootstrap for the dev stack. Runs in its own container so that the
# api and worker containers never race each other writing to node_modules/
# or packages/*/dist.
set -e

echo "==> Generating Prisma client (linux engine)"
npm run db:generate

echo "==> Building shared packages"
npx turbo run build --filter='./packages/*'

echo "==> Applying database migrations"
npm run db:deploy

echo "==> Seeding demo data (idempotent)"
npm run db:seed

echo "==> Backend init complete"
