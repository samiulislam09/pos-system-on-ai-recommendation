"""Nightly retrain scheduler.

Runs inside the webapp process: a daemon thread sleeps until the configured
HH:MM (local time), triggers a pipeline run through the same code path as the
dashboard's Run Pipeline button, and repeats daily. If a run is already in
progress at fire time the trigger is skipped — the pipeline retrains from
scratch on every run, so the next night catches up.
"""
import threading
import time
from datetime import datetime, timedelta
from typing import Callable


def seconds_until(hhmm: str, now: datetime) -> float:
    """Seconds from `now` until the next occurrence of `hhmm` (today or tomorrow)."""
    hour, minute = (int(part) for part in hhmm.strip().split(":"))
    target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return (target - now).total_seconds()


def start_retrain_scheduler(hhmm: str, trigger: Callable[[], object]) -> threading.Thread:
    """Start a daemon thread that calls `trigger()` daily at `hhmm`."""
    seconds_until(hhmm, datetime.now())  # validate the format before starting

    def loop() -> None:
        while True:
            time.sleep(seconds_until(hhmm, datetime.now()))
            try:
                trigger()
            except Exception as exc:  # noqa: BLE001 — keep the schedule alive
                print(f"[scheduler] retrain trigger failed: {exc}", flush=True)

    thread = threading.Thread(target=loop, daemon=True, name="retrain-scheduler")
    thread.start()
    return thread
