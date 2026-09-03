"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Empty,
  Input,
  Loading,
  PageHeader,
  Select,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  formatNumber,
} from "@/components/ui";

interface Recommendation {
  productId: string;
  sku: string | null;
  name: string | null;
  locationId: string;
  locationName: string | null;
  available: number;
  avgDailyForecast: number;
  daysOfStock: number | null;
  safetyStock: number;
  reorderPoint: number;
  shortageRisk: number;
  recommendedOrderQty: number;
  status: string;
  method: string | null;
}

interface RecommendationsResponse {
  runAt: string | null;
  items: Recommendation[];
}

const STATUS_COLORS: Record<string, "red" | "amber" | "blue" | "green" | "indigo"> = {
  OUT_OF_STOCK: "red",
  URGENT_RESTOCK: "amber",
  RESTOCK_SOON: "blue",
  OK: "green",
  OVERSTOCKED: "indigo",
};

const STATUSES = Object.keys(STATUS_COLORS);

interface RunStatus {
  running: boolean;
  log: string;
  returncode: number | null;
}

export default function AiInsightsPage() {
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [pipelineLog, setPipelineLog] = useState("");
  const [runError, setRunError] = useState("");
  const logRef = useRef<HTMLPreElement>(null);
  const queryClient = useQueryClient();

  const recommendations = useQuery({
    queryKey: ["ai-recommendations"],
    queryFn: () => apiFetch<RecommendationsResponse>("/ai/recommendations"),
  });

  useEffect(() => {
    if (!pipelineRunning) return;
    const timer = setInterval(async () => {
      try {
        const s = await apiFetch<RunStatus>("/ai/run/status");
        setPipelineLog(s.log);
        logRef.current?.scrollTo(0, logRef.current.scrollHeight);
        if (!s.running) {
          setPipelineRunning(false);
          if (s.returncode !== 0) {
            setRunError("Pipeline failed — see the log below.");
          }
          queryClient.invalidateQueries({ queryKey: ["ai-recommendations"] });
        }
      } catch {
        setPipelineRunning(false);
        setRunError("Lost connection to the ML service while polling.");
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [pipelineRunning, queryClient]);

  const runPipeline = async () => {
    setRunError("");
    setPipelineLog("");
    try {
      await apiFetch<{ started: boolean }>("/ai/run", { method: "POST" });
      setPipelineRunning(true);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Failed to start the pipeline.");
    }
  };

  const items = recommendations.data?.items ?? [];
  const filtered = items.filter(
    (r) =>
      (!status || r.status === status) &&
      (!search ||
        (r.name ?? "").toLowerCase().includes(search.toLowerCase()) ||
        (r.sku ?? "").toLowerCase().includes(search.toLowerCase())),
  );

  const counts = items.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  const runAt = recommendations.data?.runAt
    ? new Date(recommendations.data.runAt).toLocaleString()
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="AI forecast"
        title="AI Insights"
        description={
          runAt
            ? `Demand forecast vs current stock. Last pipeline run: ${runAt}.`
            : "Demand forecast vs current stock."
        }
        actions={
          <Button onClick={runPipeline} disabled={pipelineRunning}>
            {pipelineRunning ? "Running…" : "Run Pipeline"}
          </Button>
        }
      />

      {runError && (
        <Card>
          <CardContent className="pt-5 text-sm text-red-600">{runError}</CardContent>
        </Card>
      )}

      {(pipelineRunning || (runError && pipelineLog)) && (
        <Card>
          <CardHeader>
            <CardTitle>
              {pipelineRunning ? "Pipeline running — training models…" : "Pipeline log"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre
              ref={logRef}
              className="max-h-64 overflow-auto rounded-lg bg-zinc-900 p-4 text-xs text-zinc-200"
            >
              {pipelineLog || "Starting…"}
            </pre>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-5">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              placeholder="Search product / SKU..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-xs">
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
            <div className="ml-auto flex flex-wrap gap-2">
              {STATUSES.filter((s) => counts[s]).map((s) => (
                <span key={s} className="flex items-center gap-1.5 text-sm text-zinc-600">
                  <Badge color={STATUS_COLORS[s]}>{s}</Badge> {counts[s]}
                </span>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {recommendations.data ? `${filtered.length} recommendations` : "Recommendations"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recommendations.isLoading ? (
            <Loading />
          ) : filtered.length > 0 ? (
            <Table>
              <THead>
                <TR>
                  <TH>Product</TH>
                  <TH>SKU</TH>
                  <TH>Location</TH>
                  <TH className="text-right">Available</TH>
                  <TH className="text-right">Forecast / day</TH>
                  <TH className="text-right">Days of stock</TH>
                  <TH className="text-right">Reorder point</TH>
                  <TH className="text-right">Shortage risk</TH>
                  <TH className="text-right">Order qty</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((r) => (
                  <TR key={`${r.productId}-${r.locationId}`}>
                    <TD>
                      <div className="font-medium">{r.name ?? "—"}</div>
                      <div className="text-xs text-zinc-500">
                        model: {r.method ?? "—"}
                      </div>
                    </TD>
                    <TD className="font-mono text-xs">{r.sku ?? "—"}</TD>
                    <TD>{r.locationName ?? "—"}</TD>
                    <TD className="text-right">{formatNumber(r.available)}</TD>
                    <TD className="text-right">{r.avgDailyForecast.toFixed(1)}</TD>
                    <TD className="text-right">
                      {r.daysOfStock === null ? "∞" : r.daysOfStock.toFixed(1)}
                    </TD>
                    <TD className="text-right">{r.reorderPoint.toFixed(0)}</TD>
                    <TD className="text-right">{Math.round(r.shortageRisk * 100)}%</TD>
                    <TD className="text-right font-semibold">
                      {r.recommendedOrderQty > 0 ? formatNumber(r.recommendedOrderQty) : "—"}
                    </TD>
                    <TD>
                      <Badge color={STATUS_COLORS[r.status] ?? "zinc"}>{r.status}</Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <Empty label="No recommendations yet — run the ML pipeline (ml/run_pipeline.py) to generate them." />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
