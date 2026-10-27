"""Offline unit tests (no BigQuery access needed)."""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
os.environ.setdefault("PROJECT_ID", "test-project")
os.environ.setdefault("DATASET", "test_dataset")

import queries  # noqa: E402


def test_events_cte_union_all_and_dedup():
  sql = queries.events_cte("my-proj", "my_ds", ["agent_a", "agent_b"])
  assert sql.count("UNION ALL") == 1
  assert "`my-proj.my_ds.agent_a`" in sql and "`my-proj.my_ds.agent_b`" in sql
  assert "QUALIFY ROW_NUMBER()" in sql
  # Explicit column list (no SELECT *), so tables with extra columns still union.
  assert "SELECT 'agent_a' AS source_table, timestamp, event_id" in sql


@pytest.mark.parametrize("table", ["bad`name", "x; DROP TABLE y", "a.b", "a b"])
def test_events_cte_rejects_unsafe_tables(table):
  with pytest.raises(ValueError):
    queries.events_cte("my-proj", "my_ds", [table])


@pytest.mark.parametrize("project,dataset", [("p`x", "ds"), ("proj", "ds-x"), ("proj", "ds`"), ("PROJ;", "ds")])
def test_events_cte_rejects_unsafe_project_dataset(project, dataset):
  with pytest.raises(ValueError):
    queries.events_cte(project, dataset, ["t"])


def test_domain_scoped_project_allowed():
  assert "`example.com:proj.ds.t`" in queries.events_cte("example.com:proj", "ds", ["t"])


@pytest.mark.parametrize("mode,needle", [
    ("session", "CONCAT(source_table, '|', session_id) AS conv_key"),
    ("thread", "CAST(thread_seq AS STRING)) AS conv_key"),
])
def test_grouped_cte_modes(mode, needle):
  assert needle in queries.grouped_cte(mode)


def test_every_flag_is_emitted_by_turns_cte():
  for flag in queries.ALL_FLAGS:
    assert f"'{flag}'" in queries.TURNS_CTE


def test_api_rejects_bad_inputs(monkeypatch):
  from fastapi.testclient import TestClient
  import main

  monkeypatch.setattr(main, "discover_tables", lambda: ["agent_a"])
  c = TestClient(main.app)
  assert c.get("/api/health").json() == {"ok": True}
  assert c.get("/api/conversations", params={"sort": "1; DROP"}).status_code == 400
  assert c.get("/api/conversations", params={"mode": "x"}).status_code == 400
  assert c.get("/api/conversations", params={"flags": "NOPE"}).status_code == 400
  assert c.get("/api/conversations", params={"start": "2026-01-02", "end": "2026-01-01"}).status_code == 400
  assert c.get("/api/conversation", params={"table": "not_listed", "sessions": "x"}).status_code == 404
