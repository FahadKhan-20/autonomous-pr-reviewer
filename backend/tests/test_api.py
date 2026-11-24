import hashlib
import hmac
import json
import pytest
from httpx import ASGITransport, AsyncClient
from app.core.config import settings
from app.core.database import db
from app.main import app


@pytest.mark.asyncio
async def test_health_endpoint():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "healthy"


@pytest.mark.asyncio
async def test_create_review_validation():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Invalid URL
        resp = await client.post("/api/reviews", json={"url": "https://invalid.com/foo"})
        assert resp.status_code == 422 or resp.status_code == 400

        # Valid PR URL format
        resp = await client.post("/api/reviews", json={"url": "https://github.com/acme/repo/pull/42"})
        assert resp.status_code == 201
        data = resp.json()
        assert "review_id" in data
        assert data["status"] == "queued"
        assert data["pr_number"] == 42


@pytest.mark.asyncio
async def test_webhook_hmac_verification():
    secret = settings.GITHUB_WEBHOOK_SECRET
    payload = {
        "action": "opened",
        "pull_request": {
            "html_url": "https://github.com/acme/repo/pull/77",
            "number": 77,
            "head": {"sha": "sha_webhook_123"},
        },
        "repository": {"full_name": "acme/repo"},
    }
    payload_bytes = json.dumps(payload).encode("utf-8")

    # Compute valid HMAC signature
    valid_sig = "sha256=" + hmac.new(secret.encode("utf-8"), payload_bytes, hashlib.sha256).hexdigest()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # 1. Reject invalid signature
        resp = await client.post(
            "/webhooks/github",
            content=payload_bytes,
            headers={"X-Hub-Signature-256": "sha256=invalidsignature00000000000000000000000000000000", "X-GitHub-Event": "pull_request"},
        )
        assert resp.status_code == 401

        # 2. Accept valid signature
        resp = await client.post(
            "/webhooks/github",
            content=payload_bytes,
            headers={"X-Hub-Signature-256": valid_sig, "X-GitHub-Event": "pull_request", "Content-Type": "application/json"},
        )
        assert resp.status_code == 202
        data = resp.json()
        assert data["status"] == "accepted"
        assert data["pr_number"] == 77


@pytest.mark.asyncio
async def test_sse_stream_replay_and_order():
    review_id = "test-stream-review-replay"
    # Seed review and events in DB
    await db.save_review({
        "id": review_id,
        "url": "https://github.com/acme/repo/pull/99",
        "repo": "acme/repo",
        "pr_number": 99,
        "head_sha": "head99",
        "status": "completed",
    })

    # Save ordered events
    await db.save_event(review_id, "node_started", {"agent": "retriever"}, sequence_id=1, agent="retriever")
    await db.save_event(review_id, "reasoning", {"step": "analyzing diff"}, sequence_id=2, agent="auditor")
    await db.save_event(review_id, "done", {"verdict": "approve"}, sequence_id=3, agent="system")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get(f"/api/reviews/{review_id}/stream")
        assert resp.status_code == 200
        text = resp.text

        # Verify SSE format
        assert "event: node_started" in text
        assert "event: reasoning" in text
        assert "event: done" in text
        assert "id: 1" in text
        assert "id: 2" in text
        assert "id: 3" in text


@pytest.mark.asyncio
async def test_metrics_endpoint():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/api/metrics")
        assert resp.status_code == 200
        data = resp.json()
        assert "total_reviews" in data
        assert "avg_latency_ms" in data
        assert "severity_counts" in data
