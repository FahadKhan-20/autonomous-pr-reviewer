import pytest
import asyncio
from typing import Any, Dict, List
from app.core.database import db
from app.graph.events import reset_sequence
from app.graph.state import ReviewState
from app.graph.workflow import run_review_workflow
from app.models.schemas import Verdict, Severity


FIXTURE_DIFF = """--- a/auth.py
+++ b/auth.py
@@ -10,3 +10,7 @@
 def find_user_by_id(user_id):
+    cursor = get_db_cursor()
+    query = f"SELECT * FROM users WHERE id = '{user_id}'"
+    cursor.execute(query)
+    return cursor.fetchone()
"""

FIXTURE_FILE_CONTENT = """
import sqlite3

def get_db_cursor():
    conn = sqlite3.connect(":memory:")
    return conn.cursor()

def find_user_by_id(user_id):
    cursor = get_db_cursor()
    query = f"SELECT * FROM users WHERE id = '{user_id}'"
    cursor.execute(query)
    return cursor.fetchone()
"""


@pytest.mark.asyncio
async def test_full_graph_integration():
    """Runs the full 4-node LangGraph workflow and verifies event ordering and schema compliance."""
    review_id = "test-review-graph-001"
    reset_sequence(review_id)
    emitted_events: List[Dict[str, Any]] = []

    async def mock_event_emitter(event: Dict[str, Any]):
        emitted_events.append(event)

    # 1. Initialize review in DB
    await db.save_review({
        "id": review_id,
        "url": "https://github.com/acme/auth-service/pull/12",
        "repo": "acme/auth-service",
        "pr_number": 12,
        "title": "Add find_user_by_id helper",
        "head_sha": "sha_head_test_123",
        "base_sha": "sha_base_test_000",
        "status": "queued",
    })

    # 2. Build initial workflow state
    initial_state: ReviewState = {
        "review_id": review_id,
        "repo": "acme/auth-service",
        "pr_number": 12,
        "title": "Add find_user_by_id helper",
        "head_sha": "sha_head_test_123",
        "base_sha": "sha_base_test_000",
        "diff": FIXTURE_DIFF,
        "changed_files": [{"filename": "auth.py", "status": "modified", "additions": 4, "deletions": 0}],
        "file_contents": {"auth.py": FIXTURE_FILE_CONTENT},
        "event_emitter": mock_event_emitter,
    }

    # 3. Execute workflow
    final_state = await run_review_workflow(initial_state)

    # 4. Assert Output State Schema
    assert "findings" in final_state
    assert len(final_state["findings"]) >= 1
    finding = final_state["findings"][0]
    assert finding["file"] in ["auth.py", "b/auth.py"]
    assert finding["severity"] in [s.value for s in Severity]
    assert finding["line_start"] >= 10
    assert "suggested_fix" in finding

    assert "generated_tests" in final_state
    assert len(final_state["generated_tests"]) >= 1
    test_entry = final_state["generated_tests"][0]
    assert test_entry["syntax_valid"] is True
    assert "def test_" in test_entry["test_code"]

    assert "summary" in final_state
    summary = final_state["summary"]
    assert "risk_score" in summary
    assert 0 <= summary["risk_score"] <= 100
    assert summary["verdict"] in [v.value for v in Verdict]
    assert len(summary["summary"]) > 10

    # 5. Assert Event Sequence & Granularity
    event_types = [e["event_type"] for e in emitted_events]
    assert "node_started" in event_types
    assert "reasoning" in event_types
    assert "tool_call" in event_types
    assert "finding" in event_types
    assert "test_generated" in event_types
    assert "node_finished" in event_types
    assert "done" in event_types

    # Ensure "done" is the terminal event
    assert event_types[-1] == "done"

    # Verify chronological sequence IDs are strictly monotonically increasing 1, 2, 3...
    seq_ids = [e["sequence_id"] for e in emitted_events]
    expected_seq_ids = list(range(1, len(emitted_events) + 1))
    assert seq_ids == expected_seq_ids

    # 6. Assert DB persistence and replay
    persisted_events = await db.get_events(review_id)
    assert len(persisted_events) == len(emitted_events)

    persisted_review = await db.get_review(review_id)
    assert persisted_review["status"] == "completed"
    assert persisted_review["severity_score"] == summary["risk_score"]
    assert persisted_review["verdict"] == summary["verdict"]

    agent_runs = await db.get_agent_runs(review_id)
    agents_run_names = {r["agent_name"] for r in agent_runs}
    assert "context_retriever" in agents_run_names
    assert "security_auditor" in agents_run_names
    assert "test_generator" in agents_run_names
    assert "synthesizer" in agents_run_names
