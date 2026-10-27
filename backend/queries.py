"""SQL builders for the BQCA audit UI.

All user-supplied values are passed as BigQuery query parameters. The only
values interpolated into SQL text are (a) table names discovered via the
BigQuery API and validated against a strict regex, and (b) whitelisted
identifiers (sort columns, grouping mode).
"""

from __future__ import annotations

import re

SAFE_IDENT = re.compile(r"^[A-Za-z0-9_\-]+$")
# Project IDs (incl. legacy domain-scoped "example.com:proj") and dataset IDs.
SAFE_PROJECT = re.compile(r"^[a-z0-9.\-]+(:[a-z0-9\-]+)?$")
SAFE_DATASET = re.compile(r"^[A-Za-z0-9_]+$")

# Columns of the ADK BigQuery Agent Analytics schema (v2) that we rely on.
REQUIRED_COLUMNS = (
    "timestamp", "event_id", "event_type", "agent", "session_id",
    "invocation_id", "user_id", "trace_id", "span_id", "parent_span_id",
    "content", "content_parts", "attributes", "latency_ms", "status",
    "error_message", "is_truncated",
)


def events_cte(project: str, dataset: str, tables: list[str]) -> str:
  """UNION ALL across discovered tables (CMEK forbids wildcard tables).

  Deduplicates on event_id (the plugin keeps event_id stable across Storage
  Write API retries).
  """
  for t in tables:
    if not SAFE_IDENT.match(t):
      raise ValueError(f"Unsafe table name: {t}")
  if not SAFE_PROJECT.match(project) or not SAFE_DATASET.match(dataset):
    raise ValueError(f"Unsafe project/dataset: {project}.{dataset}")
  cols = ", ".join(REQUIRED_COLUMNS)
  union = "\n    UNION ALL\n    ".join(
      f"SELECT '{t}' AS source_table, {cols} "
      f"FROM `{project}.{dataset}.{t}` "
      f"WHERE timestamp >= @start AND timestamp < @end"
      for t in tables
  )
  return f"""
raw_events AS (
    {union}
),
events AS (
  SELECT * FROM raw_events
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY source_table, COALESCE(event_id, GENERATE_UUID())
    ORDER BY timestamp) = 1
)"""


# One row per invocation (a single user turn).
TURNS_CTE = r"""
turns_raw AS (
  SELECT
    source_table,
    session_id,
    invocation_id,
    ANY_VALUE(user_id) AS user_id,
    ANY_VALUE(COALESCE(
      JSON_VALUE(attributes, '$.session_metadata.state."data-agent-id"'),
      REGEXP_EXTRACT(JSON_VALUE(attributes, '$.adk.app_name'), r'dataAgents/([^/]+)')
    )) AS data_agent_id,
    ANY_VALUE(JSON_VALUE(attributes, '$.adk.app_name')) AS app_name,
    ANY_VALUE(JSON_VALUE(attributes, '$.session_metadata.state.custom_labels.published_context')) AS published_context,
    ANY_VALUE(agent) AS agent,
    ANY_VALUE(trace_id) AS trace_id,
    MIN(timestamp) AS start_ts,
    MAX(timestamp) AS end_ts,
    COUNT(*) AS event_count,
    ARRAY_AGG(
      IF(event_type = 'USER_MESSAGE_RECEIVED',
         COALESCE(JSON_VALUE(content, '$.text_summary'),
                  (SELECT STRING_AGG(p.text, '\n' ORDER BY p.part_index) FROM UNNEST(content_parts) p)),
         NULL)
      IGNORE NULLS ORDER BY timestamp LIMIT 1)[SAFE_OFFSET(0)] AS question,
    ARRAY_AGG(IF(event_type = 'AGENT_RESPONSE', TO_JSON_STRING(content), NULL)
      IGNORE NULLS ORDER BY timestamp DESC LIMIT 1)[SAFE_OFFSET(0)] AS response_json,
    -- INVOCATION_COMPLETED is emitted twice per invocation; take MAX.
    MAX(IF(event_type = 'INVOCATION_COMPLETED', LAX_INT64(latency_ms.total_ms), NULL)) AS total_ms,
    MAX(IF(event_type = 'LLM_RESPONSE', LAX_INT64(latency_ms.time_to_first_token_ms), NULL)) AS max_ttft_ms,
    COUNTIF(event_type = 'LLM_RESPONSE') AS llm_calls,
    COUNTIF(event_type IN ('TOOL_STARTING', 'TOOL_COMPLETED', 'TOOL_CALL')) AS tool_events,
    SUM(IF(event_type = 'LLM_RESPONSE', LAX_INT64(attributes.usage_metadata.prompt_token_count), 0)) AS prompt_tokens,
    SUM(IF(event_type = 'LLM_RESPONSE', LAX_INT64(attributes.usage_metadata.candidates_token_count), 0)) AS completion_tokens,
    SUM(IF(event_type = 'LLM_RESPONSE', LAX_INT64(attributes.usage_metadata.thoughts_token_count), 0)) AS thought_tokens,
    SUM(IF(event_type = 'LLM_RESPONSE', LAX_INT64(attributes.usage_metadata.cached_content_token_count), 0)) AS cached_tokens,
    SUM(IF(event_type = 'LLM_RESPONSE', LAX_INT64(attributes.usage_metadata.total_token_count), 0)) AS total_tokens,
    STRING_AGG(DISTINCT JSON_VALUE(attributes, '$.model_version')) AS models,
    STRING_AGG(DISTINCT JSON_VALUE(attributes, '$.finish_reason')) AS finish_reasons,
    COUNTIF(status = 'ERROR' OR error_message IS NOT NULL) AS error_events,
    STRING_AGG(DISTINCT error_message, ' | ') AS error_messages,
    LOGICAL_OR(COALESCE(is_truncated, FALSE)) AS truncated,
    -- Tool-call security verdicts accumulate in session state; take the last.
    ARRAY_AGG(TO_JSON_STRING(attributes.session_metadata.state.orcas_tool_call_security_check_states)
      IGNORE NULLS ORDER BY timestamp DESC LIMIT 1)[SAFE_OFFSET(0)] AS security_checks_json
  FROM events
  GROUP BY source_table, session_id, invocation_id
),
turns AS (
  SELECT
    t.*,
    SAFE.PARSE_JSON(response_json) AS response,
    ARRAY_TO_STRING(ARRAY(
      SELECT COALESCE(JSON_VALUE(p, '$.markdown'), JSON_VALUE(p, '$.insight'), '')
      FROM UNNEST(JSON_QUERY_ARRAY(SAFE.PARSE_JSON(response_json), '$.response.parts')) p
    ), '\n') AS answer_text,
    ARRAY(
      SELECT JSON_VALUE(p, '$.data_result_artifact_name')
      FROM UNNEST(JSON_QUERY_ARRAY(SAFE.PARSE_JSON(response_json), '$.response.parts')) p
      WHERE JSON_VALUE(p, '$.data_result_artifact_name') IS NOT NULL
    ) AS data_artifacts,
    NULLIF(JSON_VALUE(SAFE.PARSE_JSON(response_json), '$.response.clarifying_question'), '') AS clarifying_question,
    LAX_BOOL(SAFE.PARSE_JSON(response_json).response.skip_data_queries) AS skip_data_queries,
    REGEXP_EXTRACT_ALL(COALESCE(security_checks_json, ''), r'"[^"]+":"([^"]+)"') AS security_verdicts
  FROM turns_raw t
),
turns_flagged AS (
  SELECT
    *,
    ARRAY_CONCAT(
      IF(error_events > 0, ['ERROR'], []),
      IF(truncated, ['TRUNCATED'], []),
      IF(total_ms >= @slow_ms, ['SLOW'], []),
      IF(total_tokens >= @high_tokens, ['HIGH_TOKENS'], []),
      IF(clarifying_question IS NOT NULL, ['CLARIFYING_Q'], []),
      IF(EXISTS(SELECT 1 FROM UNNEST(security_verdicts) v WHERE v != 'ALLOW'), ['TOOL_DENIED'], []),
      IF(COALESCE(skip_data_queries, FALSE)
         AND REGEXP_CONTAINS(answer_text, r'\|\s*:?-{3,}')
         AND REGEXP_CONTAINS(answer_text, r'\d'), ['UNGROUNDED_TABLE'], []),
      IF(response_json IS NULL OR TRIM(answer_text) = '', ['EMPTY_ANSWER'], [])
    ) AS flags
  FROM turns
)"""

ALL_FLAGS = [
    "ERROR", "TRUNCATED", "SLOW", "HIGH_TOKENS", "CLARIFYING_Q",
    "TOOL_DENIED", "UNGROUNDED_TABLE", "EMPTY_ANSWER",
]


def grouped_cte(mode: str) -> str:
  """Assigns each turn a conversation key.

  mode='session': one conversation per session_id.
  mode='thread' : heuristic. Same table + user + data agent, new thread after
                  @gap_minutes of inactivity (BQCA currently issues a new
                  session_id for every turn).
  """
  if mode == "thread":
    key = ("CONCAT(source_table, '|', IFNULL(user_id, ''), '|', "
           "IFNULL(data_agent_id, ''), '|', CAST(thread_seq AS STRING))")
  else:
    key = "CONCAT(source_table, '|', session_id)"
  return f"""
turns_seq AS (
  SELECT *,
    SUM(new_thread) OVER (
      PARTITION BY source_table, user_id, data_agent_id ORDER BY start_ts
      ROWS UNBOUNDED PRECEDING) AS thread_seq
  FROM (
    SELECT *,
      IF(TIMESTAMP_DIFF(start_ts, LAG(end_ts) OVER (
            PARTITION BY source_table, user_id, data_agent_id ORDER BY start_ts),
         MINUTE) <= @gap_minutes, 0, 1) AS new_thread
    FROM turns_flagged)
),
turns_keyed AS (
  SELECT *, {key} AS conv_key FROM turns_seq
),
conversations_raw AS (
  SELECT
    conv_key,
    ANY_VALUE(source_table) AS source_table,
    ANY_VALUE(user_id) AS user_id,
    ANY_VALUE(data_agent_id) AS data_agent_id,
    MIN(start_ts) AS start_ts,
    MAX(end_ts) AS end_ts,
    COUNT(*) AS turns,
    ARRAY_AGG(DISTINCT session_id) AS session_ids,
    ARRAY_AGG(question IGNORE NULLS ORDER BY start_ts LIMIT 1)[SAFE_OFFSET(0)] AS first_question,
    ARRAY_AGG(question IGNORE NULLS ORDER BY start_ts DESC LIMIT 1)[SAFE_OFFSET(0)] AS last_question,
    ARRAY_AGG(answer_text IGNORE NULLS ORDER BY start_ts DESC LIMIT 1)[SAFE_OFFSET(0)] AS last_answer,
    SUM(total_tokens) AS total_tokens,
    SUM(llm_calls) AS llm_calls,
    MAX(total_ms) AS max_ms,
    CAST(AVG(total_ms) AS INT64) AS avg_ms,
    SUM(error_events) AS error_events,
    SUM(ARRAY_LENGTH(data_artifacts)) AS data_results,
    STRING_AGG(DISTINCT models) AS models,
    ARRAY_CONCAT_AGG(flags) AS all_flags,
    LOGICAL_OR(CONTAINS_SUBSTR(IFNULL(question, ''), @q)
               OR CONTAINS_SUBSTR(IFNULL(answer_text, ''), @q)
               OR CONTAINS_SUBSTR(IFNULL(session_id, ''), @q)
               OR CONTAINS_SUBSTR(IFNULL(user_id, ''), @q)) AS matches_q
  FROM turns_keyed
  GROUP BY conv_key
),
conversations AS (
  SELECT * EXCEPT (all_flags),
    ARRAY(SELECT DISTINCT f FROM UNNEST(all_flags) f ORDER BY f) AS flags
  FROM conversations_raw
)"""
