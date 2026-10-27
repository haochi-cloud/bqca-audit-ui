"""BQCA Conversation Audit UI — FastAPI backend.

Serves a JSON API over the ADK BigQuery Agent Analytics tables in a dataset
and hosts the built React frontend. Designed to sit behind Cloud Run IAP.
"""

from __future__ import annotations

import concurrent.futures
import csv
import datetime as dt
import io
import json
import logging
import os
import pathlib
import threading
import time
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from google.cloud import bigquery

import queries

# Project that runs (and is billed for) BigQuery jobs.
PROJECT_ID = os.environ.get("PROJECT_ID") or os.environ.get("GOOGLE_CLOUD_PROJECT") or ""
# Project that owns the agent-analytics dataset (defaults to PROJECT_ID).
DATA_PROJECT_ID = os.environ.get("DATA_PROJECT_ID") or PROJECT_ID
DATASET = os.environ.get("DATASET", "")
BQ_LOCATION = os.environ.get("BQ_LOCATION", "US")
if not PROJECT_ID or not DATASET:
  raise RuntimeError("PROJECT_ID (or GOOGLE_CLOUD_PROJECT) and DATASET environment variables are required.")
MAX_BYTES_BILLED = int(os.environ.get("MAX_BYTES_BILLED", str(20 * 1024**3)))
SLOW_MS = int(os.environ.get("SLOW_MS", "15000"))
HIGH_TOKENS = int(os.environ.get("HIGH_TOKENS", "100000"))
TABLE_LABEL = os.environ.get("TABLE_LABEL", "adk_schema_version")
TABLE_CACHE_SECONDS = 300
STATIC_DIR = pathlib.Path(os.environ.get("STATIC_DIR", pathlib.Path(__file__).parent / "static"))

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("bqca-audit-ui")

app = FastAPI(title="BQCA Conversation Audit", docs_url="/api/docs", openapi_url="/api/openapi.json")
_client: bigquery.Client | None = None
_tables_lock = threading.Lock()
_tables_cache: tuple[float, list[str]] = (0.0, [])


def client() -> bigquery.Client:
  global _client
  if _client is None:
    _client = bigquery.Client(project=PROJECT_ID, location=BQ_LOCATION)
  return _client


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def viewer(request: Request) -> str:
  raw = request.headers.get("x-goog-authenticated-user-email", "")
  return raw.split(":", 1)[-1] if raw else "local-dev"


def audit_log(request: Request, action: str, **fields: Any) -> None:
  """Structured log line -> Cloud Logging (who looked at what)."""
  print(json.dumps({
      "severity": "NOTICE",
      "message": f"audit:{action}",
      "viewer": viewer(request),
      "action": action,
      "path": request.url.path,
      **fields,
  }, default=str), flush=True)


def discover_tables() -> list[str]:
  """Lists ADK analytics tables in the dataset (cached)."""
  global _tables_cache
  with _tables_lock:
    ts, tables = _tables_cache
    if tables and time.time() - ts < TABLE_CACHE_SECONDS:
      return tables
    found = []
    for item in client().list_tables(f"{DATA_PROJECT_ID}.{DATASET}"):
      if item.table_type != "TABLE":
        continue
      if TABLE_LABEL and TABLE_LABEL not in (item.labels or {}):
        continue
      t = client().get_table(item.reference)
      cols = {f.name for f in t.schema}
      missing = [c for c in queries.REQUIRED_COLUMNS if c not in cols]
      if missing:
        log.warning("Skipping %s: missing columns %s", item.table_id, missing)
        continue
      if queries.SAFE_IDENT.match(item.table_id):
        found.append(item.table_id)
    found.sort()
    _tables_cache = (time.time(), found)
    return found


def parse_range(start: str | None, end: str | None) -> tuple[dt.datetime, dt.datetime]:
  now = dt.datetime.now(dt.timezone.utc)
  try:
    e = dt.datetime.fromisoformat(end.replace("Z", "+00:00")) if end else now
    s = dt.datetime.fromisoformat(start.replace("Z", "+00:00")) if start else e - dt.timedelta(days=30)
  except ValueError as ex:
    raise HTTPException(400, f"Bad date: {ex}") from ex
  if s.tzinfo is None:
    s = s.replace(tzinfo=dt.timezone.utc)
  if e.tzinfo is None:
    e = e.replace(tzinfo=dt.timezone.utc)
  if s >= e:
    raise HTTPException(400, "start must be before end")
  if e - s > dt.timedelta(days=400):
    raise HTTPException(400, "Range too large (max 400 days)")
  return s, e


def base_params(s: dt.datetime, e: dt.datetime, **extra: Any) -> list[bigquery.ScalarQueryParameter]:
  p = [
      bigquery.ScalarQueryParameter("start", "TIMESTAMP", s),
      bigquery.ScalarQueryParameter("end", "TIMESTAMP", e),
      bigquery.ScalarQueryParameter("slow_ms", "INT64", SLOW_MS),
      bigquery.ScalarQueryParameter("high_tokens", "INT64", HIGH_TOKENS),
      bigquery.ScalarQueryParameter("gap_minutes", "INT64", int(extra.pop("gap_minutes", 30))),
      bigquery.ScalarQueryParameter("q", "STRING", extra.pop("q", "") or ""),
  ]
  for k, v in extra.items():
    if isinstance(v, list):
      p.append(bigquery.ArrayQueryParameter(k, "STRING", v))
    elif isinstance(v, bool):
      p.append(bigquery.ScalarQueryParameter(k, "BOOL", v))
    elif isinstance(v, int):
      p.append(bigquery.ScalarQueryParameter(k, "INT64", v))
    else:
      p.append(bigquery.ScalarQueryParameter(k, "STRING", v or ""))
  return p


def _jsonable(v: Any) -> Any:
  if isinstance(v, (dt.datetime, dt.date)):
    return v.isoformat()
  if isinstance(v, list):
    return [_jsonable(x) for x in v]
  if isinstance(v, dict):
    return {k: _jsonable(x) for k, x in v.items()}
  if hasattr(v, "items"):
    return {k: _jsonable(x) for k, x in v.items()}
  return v


def run(sql: str, params: list) -> list[dict]:
  cfg = bigquery.QueryJobConfig(
      query_parameters=params,
      maximum_bytes_billed=MAX_BYTES_BILLED,
      labels={"app": "bqca-audit-ui"},
      use_query_cache=True,
  )
  try:
    rows = client().query(sql, job_config=cfg).result()
  except Exception as ex:  # surface BigQuery errors to the UI
    log.exception("Query failed")
    raise HTTPException(502, f"BigQuery error: {getattr(ex, 'message', str(ex))[:500]}") from ex
  return [_jsonable(dict(r.items())) for r in rows]


def with_prefix(tables: list[str]) -> str:
  return "WITH " + queries.events_cte(DATA_PROJECT_ID, DATASET, tables) + "," + queries.TURNS_CTE


TURN_FILTER = """
  (@f_table = '' OR source_table = @f_table)
  AND (@f_agent = '' OR data_agent_id = @f_agent)
  AND (@f_user = '' OR user_id = @f_user)"""


def require_tables() -> list[str]:
  tables = discover_tables()
  if not tables:
    raise HTTPException(404, f"No ADK analytics tables found in {DATA_PROJECT_ID}.{DATASET}")
  return tables


# --------------------------------------------------------------------------- #
# API
# --------------------------------------------------------------------------- #
@app.get("/api/health")
def health():
  return {"ok": True}


@app.get("/api/meta")
def meta(request: Request):
  return {
      "project": DATA_PROJECT_ID,
      "job_project": PROJECT_ID,
      "dataset": DATASET,
      "tables": discover_tables(),
      "flags": queries.ALL_FLAGS,
      "thresholds": {"slow_ms": SLOW_MS, "high_tokens": HIGH_TOKENS},
      "viewer": viewer(request),
  }


@app.get("/api/dimensions")
def dimensions(start: str | None = None, end: str | None = None):
  s, e = parse_range(start, end)
  tables = require_tables()
  sql = with_prefix(tables) + """
  SELECT 'user' AS dim, user_id AS value, COUNT(*) AS n FROM turns_flagged WHERE user_id IS NOT NULL GROUP BY 2
  UNION ALL
  SELECT 'agent', data_agent_id, COUNT(*) FROM turns_flagged WHERE data_agent_id IS NOT NULL GROUP BY 2
  UNION ALL
  SELECT 'table', source_table, COUNT(*) FROM turns_flagged GROUP BY 2
  ORDER BY dim, n DESC"""
  rows = run(sql, base_params(s, e))
  out: dict[str, list] = {"user": [], "agent": [], "table": []}
  for r in rows:
    out[r["dim"]].append({"value": r["value"], "n": r["n"]})
  # Show all known tables even if idle in range.
  known = {x["value"] for x in out["table"]}
  out["table"] += [{"value": t, "n": 0} for t in tables if t not in known]
  return out


def _kpi_sql(tables: list[str]) -> str:
  return with_prefix(tables) + f"""
  SELECT
    COUNT(*) AS turns,
    COUNT(DISTINCT session_id) AS sessions,
    COUNT(DISTINCT user_id) AS users,
    COUNT(DISTINCT data_agent_id) AS agents,
    APPROX_QUANTILES(total_ms, 100)[SAFE_OFFSET(50)] AS p50_ms,
    APPROX_QUANTILES(total_ms, 100)[SAFE_OFFSET(95)] AS p95_ms,
    CAST(AVG(max_ttft_ms) AS INT64) AS avg_ttft_ms,
    SUM(total_tokens) AS total_tokens,
    CAST(AVG(total_tokens) AS INT64) AS avg_tokens_per_turn,
    SUM(cached_tokens) AS cached_tokens,
    SUM(prompt_tokens) AS prompt_tokens,
    COUNTIF(error_events > 0) AS error_turns,
    COUNTIF(ARRAY_LENGTH(flags) > 0) AS flagged_turns,
    COUNTIF(ARRAY_LENGTH(data_artifacts) > 0) AS data_result_turns,
    COUNTIF(clarifying_question IS NOT NULL) AS clarifying_turns,
    SUM(tool_events) AS tool_events
  FROM turns_flagged WHERE {TURN_FILTER}"""


@app.get("/api/overview")
def overview(start: str | None = None, end: str | None = None,
             table: str = "", agent: str = "", user: str = ""):
  s, e = parse_range(start, end)
  tables = require_tables()
  span = e - s
  bucket = "HOUR" if span <= dt.timedelta(days=3) else "DAY"
  f = {"f_table": table, "f_agent": agent, "f_user": user}
  prefix = with_prefix(tables)

  jobs = {
      "kpis": (_kpi_sql(tables), base_params(s, e, **f)),
      "prev_kpis": (_kpi_sql(tables), base_params(s - span, s, **f)),
      "timeseries": (prefix + f"""
        SELECT TIMESTAMP_TRUNC(start_ts, {bucket}) AS bucket,
          COUNT(*) AS turns, COUNT(DISTINCT session_id) AS sessions,
          COUNT(DISTINCT user_id) AS users, SUM(total_tokens) AS tokens,
          APPROX_QUANTILES(total_ms, 100)[SAFE_OFFSET(50)] AS p50_ms,
          APPROX_QUANTILES(total_ms, 100)[SAFE_OFFSET(95)] AS p95_ms,
          COUNTIF(ARRAY_LENGTH(flags) > 0) AS flagged
        FROM turns_flagged WHERE {TURN_FILTER} GROUP BY 1 ORDER BY 1""", base_params(s, e, **f)),
      "by_agent": (prefix + f"""
        SELECT source_table, data_agent_id, COUNT(*) AS turns, COUNT(DISTINCT user_id) AS users,
          SUM(total_tokens) AS tokens, CAST(AVG(total_ms) AS INT64) AS avg_ms
        FROM turns_flagged WHERE {TURN_FILTER} GROUP BY 1, 2 ORDER BY turns DESC""", base_params(s, e, **f)),
      "by_user": (prefix + f"""
        SELECT user_id, COUNT(*) AS turns, COUNT(DISTINCT session_id) AS sessions,
          SUM(total_tokens) AS tokens, MAX(end_ts) AS last_seen
        FROM turns_flagged WHERE {TURN_FILTER} GROUP BY 1 ORDER BY turns DESC LIMIT 20""", base_params(s, e, **f)),
      "top_questions": (prefix + f"""
        SELECT LOWER(TRIM(question)) AS question, COUNT(*) AS n, COUNT(DISTINCT user_id) AS users,
          MAX(start_ts) AS last_asked
        FROM turns_flagged WHERE {TURN_FILTER} AND question IS NOT NULL
        GROUP BY 1 ORDER BY n DESC, last_asked DESC LIMIT 15""", base_params(s, e, **f)),
      "flags": (prefix + f"""
        SELECT flag, COUNT(*) AS n FROM turns_flagged, UNNEST(flags) flag
        WHERE {TURN_FILTER} GROUP BY 1 ORDER BY n DESC""", base_params(s, e, **f)),
      "heatmap": (prefix + f"""
        SELECT EXTRACT(DAYOFWEEK FROM start_ts) AS dow, EXTRACT(HOUR FROM start_ts) AS hour, COUNT(*) AS n
        FROM turns_flagged WHERE {TURN_FILTER} GROUP BY 1, 2""", base_params(s, e, **f)),
      "models": (prefix + f"""
        SELECT IFNULL(models, '(none)') AS model, COUNT(*) AS turns, SUM(total_tokens) AS tokens
        FROM turns_flagged WHERE {TURN_FILTER} GROUP BY 1 ORDER BY turns DESC""", base_params(s, e, **f)),
      "latency_hist": (prefix + f"""
        SELECT CAST(FLOOR(total_ms / 2000) * 2 AS INT64) AS bucket_s, COUNT(*) AS n
        FROM turns_flagged WHERE {TURN_FILTER} AND total_ms IS NOT NULL GROUP BY 1 ORDER BY 1""", base_params(s, e, **f)),
  }
  with concurrent.futures.ThreadPoolExecutor(max_workers=len(jobs)) as ex:
    futs = {k: ex.submit(run, sql, p) for k, (sql, p) in jobs.items()}
    res = {k: fut.result() for k, fut in futs.items()}
  res["kpis"] = res["kpis"][0] if res["kpis"] else {}
  res["prev_kpis"] = res["prev_kpis"][0] if res["prev_kpis"] else {}
  res["bucket"] = bucket
  return res


SORTABLE = {"start_ts", "end_ts", "turns", "total_tokens", "max_ms", "avg_ms", "error_events"}


def _conversation_query(tables, s, e, mode, gap, table, agent, user, flags, q,
                        min_ms, min_tokens, has_data, sort, direction, limit, offset):
  if mode not in ("session", "thread"):
    raise HTTPException(400, "mode must be session|thread")
  if sort not in SORTABLE:
    raise HTTPException(400, f"sort must be one of {sorted(SORTABLE)}")
  direction = "ASC" if direction.lower() == "asc" else "DESC"
  flag_list = [x for x in (flags or "").split(",") if x]
  bad = [x for x in flag_list if x not in queries.ALL_FLAGS]
  if bad:
    raise HTTPException(400, f"Unknown flags {bad}")
  sql = with_prefix(tables) + "," + queries.grouped_cte(mode) + f"""
  SELECT *, COUNT(*) OVER () AS total_count
  FROM conversations
  WHERE (@q = '' OR matches_q)
    AND (@f_table = '' OR source_table = @f_table)
    AND (@f_agent = '' OR data_agent_id = @f_agent)
    AND (@f_user = '' OR user_id = @f_user)
    AND (IFNULL(ARRAY_LENGTH(@f_flags), 0) = 0 OR EXISTS(SELECT 1 FROM UNNEST(flags) f WHERE f IN UNNEST(@f_flags)))
    AND (@f_min_ms = 0 OR max_ms >= @f_min_ms)
    AND (@f_min_tokens = 0 OR total_tokens >= @f_min_tokens)
    AND (NOT @f_has_data OR data_results > 0)
  ORDER BY {sort} {direction}, conv_key
  LIMIT @f_limit OFFSET @f_offset"""
  params = base_params(
      s, e, gap_minutes=gap, q=q.strip(), f_table=table, f_agent=agent, f_user=user,
      f_flags=flag_list, f_min_ms=int(min_ms), f_min_tokens=int(min_tokens),
      f_has_data=bool(has_data), f_limit=int(limit), f_offset=int(offset))
  return sql, params


@app.get("/api/conversations")
def conversations(request: Request,
                  start: str | None = None, end: str | None = None,
                  mode: str = "session", gap: int = Query(30, ge=1, le=1440),
                  table: str = "", agent: str = "", user: str = "", flags: str = "",
                  q: str = Query("", max_length=200),
                  min_ms: int = Query(0, ge=0), min_tokens: int = Query(0, ge=0),
                  has_data: bool = False,
                  sort: str = "start_ts", dir: str = "desc",
                  limit: int = Query(30, ge=1, le=500), offset: int = Query(0, ge=0)):
  s, e = parse_range(start, end)
  sql, params = _conversation_query(require_tables(), s, e, mode, gap, table, agent, user,
                                    flags, q, min_ms, min_tokens, has_data, sort, dir, limit, offset)
  rows = run(sql, params)
  total = rows[0]["total_count"] if rows else 0
  for r in rows:
    r.pop("total_count", None)
    r.pop("matches_q", None)
  if q:
    audit_log(request, "search", q=q)
  return {"total": total, "rows": rows}


@app.get("/api/conversations.csv")
def conversations_csv(request: Request,
                      start: str | None = None, end: str | None = None,
                      mode: str = "session", gap: int = 30,
                      table: str = "", agent: str = "", user: str = "", flags: str = "",
                      q: str = "", min_ms: int = 0, min_tokens: int = 0, has_data: bool = False,
                      sort: str = "start_ts", dir: str = "desc"):
  s, e = parse_range(start, end)
  sql, params = _conversation_query(require_tables(), s, e, mode, gap, table, agent, user,
                                    flags, q, min_ms, min_tokens, has_data, sort, dir, 10000, 0)
  rows = run(sql, params)
  audit_log(request, "export_csv", rows=len(rows), q=q, table=table, user=user)
  cols = ["start_ts", "end_ts", "source_table", "data_agent_id", "user_id", "turns",
          "session_ids", "first_question", "last_question", "last_answer", "total_tokens",
          "avg_ms", "max_ms", "error_events", "data_results", "models", "flags"]
  buf = io.StringIO()
  w = csv.writer(buf)
  w.writerow(cols)
  for r in rows:
    w.writerow([";".join(map(str, r[c])) if isinstance(r.get(c), list) else r.get(c) for c in cols])
  fname = f"bqca_conversations_{dt.datetime.utcnow():%Y%m%d_%H%M%S}.csv"
  return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                           headers={"Content-Disposition": f'attachment; filename="{fname}"'})


@app.get("/api/conversation")
def conversation_detail(request: Request, table: str, sessions: str,
                        start: str | None = None, end: str | None = None):
  tables = require_tables()
  if table not in tables:
    raise HTTPException(404, "Unknown table")
  session_ids = [x for x in sessions.split(",") if x][:200]
  if not session_ids:
    raise HTTPException(400, "sessions required")
  s, e = parse_range(start, end)
  # Pad so turns that straddle the window are still complete.
  s, e = s - dt.timedelta(days=1), e + dt.timedelta(days=1)
  prefix = with_prefix([table])
  p = base_params(s, e, f_sessions=session_ids)
  turns_sql = prefix + """
    SELECT * EXCEPT (response, response_json), response_json
    FROM turns_flagged WHERE session_id IN UNNEST(@f_sessions) ORDER BY start_ts"""
  events_sql = "WITH " + queries.events_cte(DATA_PROJECT_ID, DATASET, [table]) + """
    SELECT timestamp, event_id, event_type, agent, session_id, invocation_id, user_id,
      trace_id, span_id, parent_span_id,
      TO_JSON_STRING(content) AS content, content_parts,
      TO_JSON_STRING(attributes) AS attributes, TO_JSON_STRING(latency_ms) AS latency_ms,
      status, error_message, is_truncated
    FROM events WHERE session_id IN UNNEST(@f_sessions) ORDER BY timestamp, event_type"""
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
    ft, fe = ex.submit(run, turns_sql, p), ex.submit(run, events_sql, p)
    turns, events = ft.result(), fe.result()
  for t in turns:
    t["response"] = json.loads(t.pop("response_json")) if t.get("response_json") else None
    if t.get("security_checks_json"):
      t["security_checks"] = json.loads(t.pop("security_checks_json"))
  for ev in events:
    for k in ("content", "attributes", "latency_ms"):
      ev[k] = json.loads(ev[k]) if ev.get(k) not in (None, "null") else None
  audit_log(request, "view_conversation", table=table, sessions=session_ids)
  return {"table": table, "session_ids": session_ids, "turns": turns, "events": events}


@app.get("/api/users")
def users(start: str | None = None, end: str | None = None, table: str = "", agent: str = ""):
  s, e = parse_range(start, end)
  sql = with_prefix(require_tables()) + f"""
  SELECT user_id,
    COUNT(*) AS turns, COUNT(DISTINCT session_id) AS sessions,
    COUNT(DISTINCT data_agent_id) AS agents,
    ARRAY_AGG(DISTINCT source_table) AS tables,
    MIN(start_ts) AS first_seen, MAX(end_ts) AS last_seen,
    SUM(total_tokens) AS tokens, CAST(AVG(total_ms) AS INT64) AS avg_ms,
    COUNTIF(ARRAY_LENGTH(flags) > 0) AS flagged_turns,
    COUNTIF(error_events > 0) AS error_turns,
    COUNTIF(clarifying_question IS NOT NULL) AS clarifying_turns,
    COUNT(DISTINCT DATE(start_ts)) AS active_days
  FROM turns_flagged WHERE {TURN_FILTER}
  GROUP BY user_id ORDER BY turns DESC"""
  return run(sql, base_params(s, e, f_table=table, f_agent=agent, f_user=""))


@app.get("/api/agents")
def agents(start: str | None = None, end: str | None = None, user: str = ""):
  s, e = parse_range(start, end)
  sql = with_prefix(require_tables()) + f"""
  SELECT source_table, data_agent_id, ANY_VALUE(app_name) AS app_name,
    ANY_VALUE(published_context) AS published_context,
    COUNT(*) AS turns, COUNT(DISTINCT session_id) AS sessions,
    COUNT(DISTINCT user_id) AS users,
    SUM(total_tokens) AS tokens, CAST(AVG(total_tokens) AS INT64) AS avg_tokens,
    SAFE_DIVIDE(SUM(cached_tokens), NULLIF(SUM(prompt_tokens), 0)) AS cache_ratio,
    APPROX_QUANTILES(total_ms, 100)[SAFE_OFFSET(50)] AS p50_ms,
    APPROX_QUANTILES(total_ms, 100)[SAFE_OFFSET(95)] AS p95_ms,
    STRING_AGG(DISTINCT models) AS models,
    COUNTIF(ARRAY_LENGTH(flags) > 0) AS flagged_turns,
    COUNTIF(clarifying_question IS NOT NULL) AS clarifying_turns,
    SAFE_DIVIDE(COUNTIF(ARRAY_LENGTH(data_artifacts) > 0), COUNT(*)) AS data_result_rate,
    SUM(tool_events) AS tool_events,
    MAX(end_ts) AS last_active
  FROM turns_flagged WHERE {TURN_FILTER}
  GROUP BY 1, 2 ORDER BY turns DESC"""
  return run(sql, base_params(s, e, f_table="", f_agent="", f_user=user))


# --------------------------------------------------------------------------- #
# Static frontend (SPA)
# --------------------------------------------------------------------------- #
if (STATIC_DIR / "assets").exists():
  app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")


@app.get("/{path:path}", include_in_schema=False)
def spa(path: str):
  if path.startswith("api/"):
    return JSONResponse({"detail": "Not found"}, status_code=404)
  candidate = STATIC_DIR / path
  if path and candidate.is_file() and STATIC_DIR in candidate.resolve().parents:
    return FileResponse(candidate)
  index = STATIC_DIR / "index.html"
  if index.exists():
    return FileResponse(index, headers={"Cache-Control": "no-cache"})
  return JSONResponse({"detail": "Frontend not built"}, status_code=404)
