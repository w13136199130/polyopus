"""Usage pricing + summary (W11 batch 3).

docs/02 §5.1: the gateway bills through the versioned model_prices table;
each upsert bumps the version, historical rows keep the price_version they
were charged under. Price unit is per million tokens; one micro of CNY per
token therefore equals price x tokens micros.
"""

from __future__ import annotations

import sqlite3
import time
from dataclasses import dataclass

TENANT = "default"
UNPRICED = "unpriced"


@dataclass(frozen=True)
class Cost:
    cost_micros: int
    currency: str
    price_version: str


def upsert_price(
    conn: sqlite3.Connection,
    *,
    model: str,
    currency: str,
    input_per_mtok: float,
    output_per_mtok: float,
    cached_per_mtok: float = 0.0,
) -> int:
    """Insert the next price version for a model; history is never mutated."""
    if currency not in ("CNY", "USD"):
        raise ValueError("currency must be CNY or USD")
    row = conn.execute(
        "SELECT COALESCE(MAX(version), 0) FROM model_prices WHERE model = ?",
        (model,),
    ).fetchone()
    version = int(row[0]) + 1
    now = int(time.time())
    conn.execute(
        """
        INSERT INTO model_prices
          (model, currency, input_per_mtok, output_per_mtok, cached_per_mtok,
           version, effective_from, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (model, currency, input_per_mtok, output_per_mtok, cached_per_mtok,
         version, now, now),
    )
    conn.commit()
    return version


def price_for(conn: sqlite3.Connection, model: str) -> sqlite3.Row | None:
    row = conn.execute(
        "SELECT * FROM model_prices WHERE model = ? ORDER BY version DESC LIMIT 1",
        (model,),
    ).fetchone()
    return row  # type: ignore[no-any-return]


def price_usage(
    conn: sqlite3.Connection, *, model: str, input_tokens: int,
    output_tokens: int, cached_tokens: int = 0,
) -> Cost:
    """price x tokens = micros (per_mtok is per 1e6 tokens; 1 micro = 1e-6 CNY)."""
    row = price_for(conn, model)
    if row is None:
        return Cost(0, "CNY", UNPRICED)
    micros = (
        round(row["input_per_mtok"] * input_tokens)
        + round(row["output_per_mtok"] * output_tokens)
        + round(row["cached_per_mtok"] * cached_tokens)
    )
    return Cost(micros, str(row["currency"]), f"v{row['version']}")


# ---- summary (USE-001/USE-002) -----------------------------------------------


def _window_start(window: str, now: int) -> int:
    day = 86400
    if window == "day":
        return now - now % day
    if window == "week":
        return now - now % (7 * day)
    if window == "month":
        import calendar
        import datetime

        current = datetime.datetime.fromtimestamp(now, tz=datetime.UTC)
        start = datetime.datetime(
            current.year, current.month, 1, tzinfo=datetime.UTC
        )
        return calendar.timegm(start.utctimetuple())
    raise ValueError(f"unknown window {window}")


def summary(
    conn: sqlite3.Connection,
    *,
    window: str = "day",
    as_user: str | None = None,
    agent_id: str | None = None,
    now: int | None = None,
) -> dict[str, object]:
    ts = now or int(time.time())
    start = _window_start(window, ts)
    where = "created_at >= ? AND created_at < ?"
    args: list[object] = [start, ts + 86400]
    if as_user:
        where += " AND user_id = ?"
        args.append(as_user)
    if agent_id:
        where += " AND agent_id = ?"
        args.append(agent_id)

    rows = conn.execute(
        f"""
        SELECT model,
               count(DISTINCT turn_id) AS turns,
               SUM(input_tokens) AS input_tokens,
               SUM(output_tokens) AS output_tokens,
               SUM(cache_read) AS cached_tokens,
               SUM(cost_micros) AS cost_micros,
               MAX(currency) AS currency
        FROM usage_ledger WHERE {where}
        GROUP BY model ORDER BY cost_micros DESC
        """,
        args,
    ).fetchall()
    items = [
        {
            "bucket": window,
            "model": r["model"],
            "turns": int(r["turns"] or 0),
            "inputTokens": int(r["input_tokens"] or 0),
            "outputTokens": int(r["output_tokens"] or 0),
            "cachedTokens": int(r["cached_tokens"] or 0),
            "costMicros": int(r["cost_micros"] or 0),
            "currency": r["currency"] or "CNY",
        }
        for r in rows
    ]
    return {
        "window": window,
        "startTs": start,
        "endTs": ts,
        "items": items,
        "totalCostMicros": sum(item["costMicros"] for item in items),
    }


def export_csv(rows: list[dict[str, object]]) -> str:
    header = ("bucket", "model", "turns", "inputTokens", "outputTokens",
              "cachedTokens", "costMicros", "currency")
    lines = [",".join(header)]
    for item in rows:
        lines.append(",".join(str(item.get(col, "")) for col in header))
    return "\n".join(lines) + "\n"
