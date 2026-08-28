import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

interface RecommendationRow {
  run_at: Date;
  product_id: string;
  sku: string | null;
  name: string | null;
  location_id: string;
  location_name: string | null;
  available: number | null;
  avg_daily_forecast: number | null;
  days_of_stock: number | null;
  safety_stock: number | null;
  reorder_point: number | null;
  shortage_risk: number | null;
  recommended_order_qty: number | null;
  status: string;
  method: string | null;
}

@Injectable()
export class AiService {
  private readonly mlServiceUrl =
    process.env.ML_SERVICE_URL ?? "http://localhost:5001";

  constructor(private readonly prisma: PrismaService) {}

  // Forward run/status to the Python ML service (docker service `ml`).
  async runPipeline(): Promise<{ started: boolean; reason?: string }> {
    return this.mlFetch("/run", "POST");
  }

  async runStatus(): Promise<{
    running: boolean;
    log: string;
    returncode: number | null;
  }> {
    return this.mlFetch("/status", "GET");
  }

  private async mlFetch<T>(path: string, method: string): Promise<T> {
    try {
      const res = await fetch(`${this.mlServiceUrl}${path}`, { method });
      if (!res.ok) throw new Error(`ML service returned ${res.status}`);
      return (await res.json()) as T;
    } catch {
      throw new ServiceUnavailableException(
        "ML pipeline service is not reachable. Is the `ml` docker service running?",
      );
    }
  }

  // The ai_* tables are created and populated by the Python pipeline in /ml,
  // so they may not exist yet on a fresh database.
  async recommendations(organizationId: string) {
    const exists = await this.prisma.$queryRaw<{ ok: boolean }[]>`
      SELECT to_regclass('ai_inventory_recommendations') IS NOT NULL AS ok
    `;
    if (!exists[0]?.ok) {
      return { runAt: null, items: [] };
    }

    const rows = await this.prisma.$queryRaw<RecommendationRow[]>`
      SELECT r.run_at, r.product_id, r.sku, r.name, r.location_id,
             r.location_name, r.available, r.avg_daily_forecast,
             r.days_of_stock, r.safety_stock, r.reorder_point,
             r.shortage_risk, r.recommended_order_qty, r.status, r.method
      FROM ai_inventory_recommendations r
      JOIN "Product" p ON p.id = r.product_id
      WHERE p."organizationId" = ${organizationId}
      ORDER BY CASE r.status
        WHEN 'OUT_OF_STOCK' THEN 0
        WHEN 'URGENT_RESTOCK' THEN 1
        WHEN 'RESTOCK_SOON' THEN 2
        WHEN 'OVERSTOCKED' THEN 3
        ELSE 4 END,
        r.days_of_stock ASC
    `;

    return {
      runAt: rows[0]?.run_at ?? null,
      items: rows.map((r) => ({
        productId: r.product_id,
        sku: r.sku,
        name: r.name,
        locationId: r.location_id,
        locationName: r.location_name,
        available: r.available ?? 0,
        avgDailyForecast: r.avg_daily_forecast ?? 0,
        // Infinity (zero forecast demand) is not JSON-serializable.
        daysOfStock: Number.isFinite(r.days_of_stock) ? r.days_of_stock : null,
        safetyStock: r.safety_stock ?? 0,
        reorderPoint: r.reorder_point ?? 0,
        shortageRisk: r.shortage_risk ?? 0,
        recommendedOrderQty: r.recommended_order_qty ?? 0,
        status: r.status,
        method: r.method,
      })),
    };
  }
}
