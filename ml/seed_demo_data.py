"""Generate realistic demo sales history so the forecasting model has data.

The live database only needs this while real sales volume is low. All demo
sales are tagged with a DEMO- transaction number prefix so they can be
removed cleanly:

    python seed_demo_data.py            # seed 180 days of history
    python seed_demo_data.py --days 365 # longer history
    python seed_demo_data.py --clean    # delete all demo sales again

Note: demo rows are Sale/SaleItem only (what the forecaster reads); they do
not create InventoryMovement ledger entries.
"""
import argparse
import math
import random
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from etl.extract import get_engine


def cuid() -> str:
    return "c" + secrets.token_hex(12)


def clean(engine) -> None:
    with engine.begin() as conn:
        res = conn.execute(
            text('DELETE FROM "Sale" WHERE "transactionNumber" LIKE \'DEMO-%\'')
        )
    print(f"Deleted {res.rowcount} demo sales (items cascade automatically).")


def seed(engine, days: int) -> None:
    with engine.connect() as conn:
        products = conn.execute(
            text(
                'SELECT id, "organizationId", "sellingPrice" FROM "Product" '
                "WHERE status = 'ACTIVE'"
            )
        ).fetchall()
        stores = conn.execute(
            text(
                "SELECT id, \"organizationId\" FROM \"Location\" "
                "WHERE type = 'STORE' AND status = 'ACTIVE'"
            )
        ).fetchall()

    if not products or not stores:
        raise SystemExit("Need at least one ACTIVE product and STORE in the DB.")

    rng = random.Random(42)
    # Per (product, store): base daily demand + growth trend + weekly pattern.
    profiles = {}
    for p in products:
        for s in stores:
            if s[1] != p[1]:
                continue
            profiles[(p[0], s[0], float(p[2]))] = {
                "base": rng.uniform(2, 12),
                "trend": rng.uniform(-0.2, 0.5),  # % growth over full period
                "weekend_boost": rng.uniform(1.2, 1.8),
            }

    today = datetime.now(timezone.utc).replace(hour=12, minute=0, second=0, microsecond=0)
    sales_rows, item_rows = [], []
    counter = 0

    for d in range(days, 0, -1):
        day = today - timedelta(days=d)
        dow = day.weekday()
        for (product_id, store_id, price), prof in profiles.items():
            progress = (days - d) / days
            demand = prof["base"] * (1 + prof["trend"] * progress)
            if dow >= 5:
                demand *= prof["weekend_boost"]
            demand *= 1 + 0.15 * math.sin(2 * math.pi * (days - d) / 30)  # monthly wave
            units = max(0, int(rng.gauss(demand, demand * 0.35)))
            if units == 0:
                continue

            # Split the day's units into 1-3 receipts for realism.
            n_txn = min(units, rng.randint(1, 3))
            per_txn = [units // n_txn] * n_txn
            per_txn[0] += units % n_txn
            org_id = next(p[1] for p in products if p[0] == product_id)
            for qty in per_txn:
                counter += 1
                sale_id = cuid()
                total = round(qty * price, 2)
                ts = day + timedelta(minutes=rng.randint(0, 600))
                sales_rows.append(
                    {
                        "id": sale_id,
                        "org": org_id,
                        "store": store_id,
                        "txn": f"DEMO-{ts.strftime('%Y%m%d')}-{counter:06d}",
                        "subtotal": total,
                        "total": total,
                        "created": ts,
                    }
                )
                item_rows.append(
                    {
                        "id": cuid(),
                        "sale": sale_id,
                        "product": product_id,
                        "qty": qty,
                        "price": price,
                        "total": total,
                    }
                )

    with engine.begin() as conn:
        conn.execute(
            text(
                'INSERT INTO "Sale" (id, "organizationId", "storeId", '
                '"transactionNumber", status, subtotal, discount, tax, total, '
                '"paymentStatus", "createdAt", "updatedAt") '
                "VALUES (:id, :org, :store, :txn, 'COMPLETED', :subtotal, 0, 0, "
                ":total, 'PAID', :created, :created)"
            ),
            sales_rows,
        )
        conn.execute(
            text(
                'INSERT INTO "SaleItem" (id, "saleId", "productId", quantity, '
                '"unitPrice", discount, tax, total) '
                "VALUES (:id, :sale, :product, :qty, :price, 0, 0, :total)"
            ),
            item_rows,
        )
    print(
        f"Seeded {len(sales_rows)} demo sales / {len(item_rows)} items "
        f"across {len(profiles)} product-store pairs over {days} days."
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--days", type=int, default=180)
    parser.add_argument("--clean", action="store_true", help="delete demo sales")
    args = parser.parse_args()

    engine = get_engine()
    if args.clean:
        clean(engine)
    else:
        seed(engine, args.days)


if __name__ == "__main__":
    main()
