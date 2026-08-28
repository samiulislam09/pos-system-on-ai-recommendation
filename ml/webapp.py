"""Browser dashboard for the Inventory Recommendation Engine.

    .venv/bin/python webapp.py          # then open http://localhost:5001

- Shows the latest recommendations from ai_inventory_recommendations.
- "Run Pipeline" button executes run_pipeline.py in the background and
  streams its log to the page.
"""
import os
import subprocess
import sys
import threading

import pandas as pd
from flask import Flask, jsonify, render_template_string
from sqlalchemy import text

from etl.extract import get_engine

app = Flask(__name__)

_state = {"running": False, "log": "", "returncode": None}
_lock = threading.Lock()

STATUS_COLORS = {
    "OUT_OF_STOCK": "#dc2626",
    "URGENT_RESTOCK": "#ea580c",
    "RESTOCK_SOON": "#d97706",
    "OK": "#16a34a",
    "OVERSTOCKED": "#2563eb",
}

PAGE = """
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Inventory Recommendation Engine</title>
<style>
  body { font-family: -apple-system, Segoe UI, sans-serif; margin: 2rem; background:#f8fafc; color:#0f172a; }
  h1 { font-size: 1.4rem; }
  .muted { color:#64748b; font-size:.9rem; }
  table { border-collapse: collapse; width: 100%; background:#fff; margin-top:1rem; font-size:.9rem; }
  th, td { border:1px solid #e2e8f0; padding:.45rem .6rem; text-align:left; }
  th { background:#f1f5f9; }
  td.num { text-align:right; font-variant-numeric: tabular-nums; }
  .badge { color:#fff; padding:.15rem .5rem; border-radius:.4rem; font-size:.78rem; font-weight:600; }
  button { background:#2563eb; color:#fff; border:0; padding:.55rem 1.1rem; border-radius:.45rem;
           font-size:.95rem; cursor:pointer; }
  button:disabled { background:#94a3b8; cursor:wait; }
  pre { background:#0f172a; color:#e2e8f0; padding:1rem; border-radius:.5rem; max-height:260px;
        overflow:auto; font-size:.78rem; display:none; }
  .pill { display:inline-block; margin-right:.75rem; }
</style>
</head>
<body>
  <h1>📦 Inventory Recommendation Engine <span class="muted">(AI Forecast vs Current Stock)</span></h1>
  <p class="muted">Last pipeline run: {{ run_at or "never — click Run Pipeline" }}</p>
  <p>
    <button id="runBtn" onclick="runPipeline()">▶ Run Pipeline</button>
    <span id="runMsg" class="muted"></span>
  </p>
  <pre id="log"></pre>
  {% if summary %}
  <p>
    {% for status, count in summary.items() %}
      <span class="pill"><span class="badge" style="background:{{ colors[status] }}">{{ status }}</span> {{ count }}</span>
    {% endfor %}
  </p>
  {% endif %}
  {% if rows %}
  <table>
    <tr>
      <th>SKU</th><th>Product</th><th>Store</th><th>Available</th>
      <th>Avg daily forecast</th><th>Days of stock</th><th>Reorder point</th>
      <th>Shortage risk</th><th>Order qty</th><th>Status</th><th>Model</th>
    </tr>
    {% for r in rows %}
    <tr>
      <td>{{ r.sku }}</td><td>{{ r.name }}</td><td>{{ r.location_name }}</td>
      <td class="num">{{ r.available }}</td>
      <td class="num">{{ r.avg_daily_forecast }}</td>
      <td class="num">{{ r.days_of_stock }}</td>
      <td class="num">{{ r.reorder_point }}</td>
      <td class="num">{{ r.shortage_risk }}</td>
      <td class="num"><b>{{ r.recommended_order_qty }}</b></td>
      <td><span class="badge" style="background:{{ colors[r.status] }}">{{ r.status }}</span></td>
      <td>{{ r.method }}</td>
    </tr>
    {% endfor %}
  </table>
  {% else %}
  <p>No recommendations yet. Click <b>Run Pipeline</b> above.</p>
  {% endif %}

<script>
async function runPipeline() {
  const btn = document.getElementById('runBtn');
  btn.disabled = true;
  document.getElementById('runMsg').textContent = 'Pipeline running (Prophet training takes ~30s)...';
  document.getElementById('log').style.display = 'block';
  await fetch('/run', {method: 'POST'});
  poll();
}
async function poll() {
  const res = await fetch('/status');
  const s = await res.json();
  const log = document.getElementById('log');
  log.textContent = s.log;
  log.scrollTop = log.scrollHeight;
  if (s.running) { setTimeout(poll, 1500); }
  else { location.reload(); }
}
</script>
</body>
</html>
"""


def _table_exists(conn) -> bool:
    return conn.execute(
        text("SELECT to_regclass('ai_inventory_recommendations') IS NOT NULL")
    ).scalar()


def _load_recommendations():
    engine = get_engine()
    with engine.connect() as conn:
        if not _table_exists(conn):
            return None, []
        df = pd.read_sql(
            text(
                """
                SELECT run_at, sku, name, location_name, available,
                       avg_daily_forecast, days_of_stock, reorder_point,
                       shortage_risk, recommended_order_qty, status, method
                FROM ai_inventory_recommendations
                ORDER BY CASE status
                    WHEN 'OUT_OF_STOCK' THEN 0 WHEN 'URGENT_RESTOCK' THEN 1
                    WHEN 'RESTOCK_SOON' THEN 2 WHEN 'OVERSTOCKED' THEN 3
                    ELSE 4 END, days_of_stock
                """
            ),
            conn,
        )
    if df.empty:
        return None, []
    run_at = pd.to_datetime(df["run_at"].iloc[0]).strftime("%Y-%m-%d %H:%M UTC")
    return run_at, df.to_dict("records")


@app.get("/")
def index():
    run_at, rows = _load_recommendations()
    summary = {}
    for r in rows:
        summary[r["status"]] = summary.get(r["status"], 0) + 1
    return render_template_string(
        PAGE, run_at=run_at, rows=rows, summary=summary, colors=STATUS_COLORS
    )


def _run_pipeline_thread():
    proc = subprocess.Popen(
        [sys.executable, "run_pipeline.py"],
        cwd=os.path.dirname(os.path.abspath(__file__)),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    for line in proc.stdout:
        with _lock:
            _state["log"] += line
    proc.wait()
    with _lock:
        _state["running"] = False
        _state["returncode"] = proc.returncode


@app.post("/run")
def run():
    with _lock:
        if _state["running"]:
            return jsonify({"started": False, "reason": "already running"})
        _state.update(running=True, log="", returncode=None)
    threading.Thread(target=_run_pipeline_thread, daemon=True).start()
    return jsonify({"started": True})


@app.get("/status")
def status():
    with _lock:
        return jsonify(_state)


if __name__ == "__main__":
    port = int(os.getenv("WEBAPP_PORT", "5001"))
    # 0.0.0.0 inside Docker so the API container can reach us; localhost on host.
    host = os.getenv("WEBAPP_HOST", "127.0.0.1")
    print(f"Dashboard: http://localhost:{port}")
    app.run(host=host, port=port, debug=False)
