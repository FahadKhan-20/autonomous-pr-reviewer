import json
import math
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import asyncpg
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class DatabaseManager:
    """Manages PostgreSQL + pgvector persistence with in-memory resilient fallback."""

    def __init__(self):
        self.pool: Optional[asyncpg.Pool] = None
        self.is_connected = False
        # In-memory storage for test isolation and fallback
        self._mem_reviews: Dict[str, Dict[str, Any]] = {}
        self._mem_agent_runs: Dict[str, List[Dict[str, Any]]] = {}
        self._mem_events: Dict[str, List[Dict[str, Any]]] = {}
        self._mem_chunks: List[Dict[str, Any]] = []

    async def connect(self):
        """Attempts connection to PostgreSQL pool; activates in-memory fallback on error."""
        try:
            # Strip '+asyncpg' prefix for native asyncpg client
            dsn = settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")
            self.pool = await asyncpg.create_pool(
                dsn,
                min_size=1,
                max_size=10,
                command_timeout=30,
            )
            self.is_connected = True
            logger.info("Connected to PostgreSQL database with pgvector successfully.")
        except Exception as exc:
            self.is_connected = False
            logger.warning(
                f"PostgreSQL connection unavailable ({exc}). Using in-memory database fallback for current session."
            )

    async def disconnect(self):
        """Closes the connection pool."""
        if self.pool and self.is_connected:
            await self.pool.close()
            self.is_connected = False
            logger.info("Closed PostgreSQL connection pool.")

    # -------------------------------------------------------------
    # Review Records
    # -------------------------------------------------------------

    async def save_review(self, review_data: Dict[str, Any]) -> str:
        """Creates or initializes a review record."""
        review_id = str(review_data.get("id") or uuid.uuid4())
        now = datetime.now(timezone.utc)
        record = {
            "id": review_id,
            "user_id": review_data.get("user_id"),
            "url": review_data["url"],
            "repo": review_data["repo"],
            "pr_number": int(review_data["pr_number"]),
            "title": review_data.get("title", ""),
            "head_sha": review_data["head_sha"],
            "base_sha": review_data.get("base_sha", ""),
            "status": review_data.get("status", "queued"),
            "severity_score": int(review_data.get("severity_score", 0)),
            "verdict": review_data.get("verdict"),
            "summary": review_data.get("summary", ""),
            "result_json": review_data.get("result_json", {}),
            "total_tokens_in": int(review_data.get("total_tokens_in", 0)),
            "total_tokens_out": int(review_data.get("total_tokens_out", 0)),
            "estimated_cost_usd": float(review_data.get("estimated_cost_usd", 0.0)),
            "total_latency_ms": int(review_data.get("total_latency_ms", 0)),
            "error_message": review_data.get("error_message"),
            "created_at": now,
            "updated_at": now,
        }

        if self.is_connected and self.pool:
            query = """
                INSERT INTO reviews (
                    id, user_id, url, repo, pr_number, title, head_sha, base_sha,
                    status, severity_score, verdict, summary, result_json,
                    total_tokens_in, total_tokens_out, estimated_cost_usd,
                    total_latency_ms, error_message, created_at, updated_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8,
                    $9, $10, $11, $12, $13,
                    $14, $15, $16,
                    $17, $18, $19, $20
                ) ON CONFLICT (id) DO UPDATE SET
                    status = EXCLUDED.status,
                    severity_score = EXCLUDED.severity_score,
                    verdict = EXCLUDED.verdict,
                    summary = EXCLUDED.summary,
                    result_json = EXCLUDED.result_json,
                    total_tokens_in = EXCLUDED.total_tokens_in,
                    total_tokens_out = EXCLUDED.total_tokens_out,
                    estimated_cost_usd = EXCLUDED.estimated_cost_usd,
                    total_latency_ms = EXCLUDED.total_latency_ms,
                    error_message = EXCLUDED.error_message,
                    updated_at = EXCLUDED.updated_at
            """
            async with self.pool.acquire() as conn:
                await conn.execute(
                    query,
                    uuid.UUID(review_id),
                    uuid.UUID(record["user_id"]) if record["user_id"] else None,
                    record["url"],
                    record["repo"],
                    record["pr_number"],
                    record["title"],
                    record["head_sha"],
                    record["base_sha"],
                    record["status"],
                    record["severity_score"],
                    record["verdict"],
                    record["summary"],
                    json.dumps(record["result_json"]),
                    record["total_tokens_in"],
                    record["total_tokens_out"],
                    record["estimated_cost_usd"],
                    record["total_latency_ms"],
                    record["error_message"],
                    record["created_at"],
                    record["updated_at"],
                )
        else:
            self._mem_reviews[review_id] = record

        return review_id

    async def get_review(self, review_id: str) -> Optional[Dict[str, Any]]:
        """Retrieves a single review record by ID."""
        if self.is_connected and self.pool:
            query = "SELECT * FROM reviews WHERE id = $1"
            async with self.pool.acquire() as conn:
                row = await conn.fetchrow(query, uuid.UUID(review_id))
                if row:
                    res = dict(row)
                    res["id"] = str(res["id"])
                    if res.get("result_json") and isinstance(res["result_json"], str):
                        res["result_json"] = json.loads(res["result_json"])
                    return res
                return None
        return self._mem_reviews.get(review_id)

    async def list_reviews(self, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
        """Lists reviews sorted by creation time descending."""
        if self.is_connected and self.pool:
            query = "SELECT * FROM reviews ORDER BY created_at DESC LIMIT $1 OFFSET $2"
            async with self.pool.acquire() as conn:
                rows = await conn.fetch(query, limit, offset)
                results = []
                for row in rows:
                    res = dict(row)
                    res["id"] = str(res["id"])
                    if res.get("result_json") and isinstance(res["result_json"], str):
                        res["result_json"] = json.loads(res["result_json"])
                    results.append(res)
                return results

        # In-memory listing
        sorted_revs = sorted(
            self._mem_reviews.values(),
            key=lambda x: x.get("created_at") or datetime.min,
            reverse=True,
        )
        return sorted_revs[offset : offset + limit]

    async def update_review_status(
        self,
        review_id: str,
        status: str,
        error_message: Optional[str] = None,
    ):
        """Updates the status and optional error message of a review."""
        now = datetime.now(timezone.utc)
        if self.is_connected and self.pool:
            query = """
                UPDATE reviews
                SET status = $1, error_message = $2, updated_at = $3
                WHERE id = $4
            """
            async with self.pool.acquire() as conn:
                await conn.execute(query, status, error_message, now, uuid.UUID(review_id))
        elif review_id in self._mem_reviews:
            self._mem_reviews[review_id]["status"] = status
            self._mem_reviews[review_id]["error_message"] = error_message
            self._mem_reviews[review_id]["updated_at"] = now

    async def update_review_result(
        self,
        review_id: str,
        status: str,
        result_json: Dict[str, Any],
        verdict: str,
        severity_score: int,
        summary: str,
        tokens_in: int,
        tokens_out: int,
        cost_usd: float,
        latency_ms: int,
    ):
        """Finalizes review execution with synthesized result and metrics."""
        now = datetime.now(timezone.utc)
        if self.is_connected and self.pool:
            query = """
                UPDATE reviews
                SET status = $1,
                    result_json = $2,
                    verdict = $3,
                    severity_score = $4,
                    summary = $5,
                    total_tokens_in = $6,
                    total_tokens_out = $7,
                    estimated_cost_usd = $8,
                    total_latency_ms = $9,
                    updated_at = $10
                WHERE id = $11
            """
            async with self.pool.acquire() as conn:
                await conn.execute(
                    query,
                    status,
                    json.dumps(result_json),
                    verdict,
                    severity_score,
                    summary,
                    tokens_in,
                    tokens_out,
                    cost_usd,
                    latency_ms,
                    now,
                    uuid.UUID(review_id),
                )
        elif review_id in self._mem_reviews:
            r = self._mem_reviews[review_id]
            r["status"] = status
            r["result_json"] = result_json
            r["verdict"] = verdict
            r["severity_score"] = severity_score
            r["summary"] = summary
            r["total_tokens_in"] = tokens_in
            r["total_tokens_out"] = tokens_out
            r["estimated_cost_usd"] = cost_usd
            r["total_latency_ms"] = latency_ms
            r["updated_at"] = now

    # -------------------------------------------------------------
    # Agent Runs
    # -------------------------------------------------------------

    async def save_agent_run(
        self,
        review_id: str,
        agent_name: str,
        tokens_in: int,
        tokens_out: int,
        latency_ms: int,
        status: str = "completed",
        error: Optional[str] = None,
    ):
        """Records observability metrics for an individual agent run."""
        now = datetime.now(timezone.utc)
        run_record = {
            "id": str(uuid.uuid4()),
            "review_id": review_id,
            "agent_name": agent_name,
            "tokens_in": tokens_in,
            "tokens_out": tokens_out,
            "latency_ms": latency_ms,
            "status": status,
            "error": error,
            "created_at": now,
        }
        if self.is_connected and self.pool:
            query = """
                INSERT INTO agent_runs (
                    id, review_id, agent_name, tokens_in, tokens_out,
                    latency_ms, status, error, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            """
            async with self.pool.acquire() as conn:
                await conn.execute(
                    query,
                    uuid.UUID(run_record["id"]),
                    uuid.UUID(review_id),
                    agent_name,
                    tokens_in,
                    tokens_out,
                    latency_ms,
                    status,
                    error,
                    now,
                )
        else:
            self._mem_agent_runs.setdefault(review_id, []).append(run_record)

    async def get_agent_runs(self, review_id: str) -> List[Dict[str, Any]]:
        """Returns all agent runs for a specific review."""
        if self.is_connected and self.pool:
            query = "SELECT * FROM agent_runs WHERE review_id = $1 ORDER BY created_at ASC"
            async with self.pool.acquire() as conn:
                rows = await conn.fetch(query, uuid.UUID(review_id))
                return [dict(r) for r in rows]
        return self._mem_agent_runs.get(review_id, [])

    # -------------------------------------------------------------
    # Review Events (Streaming & Replay)
    # -------------------------------------------------------------

    async def save_event(
        self,
        review_id: str,
        event_type: str,
        data: Dict[str, Any],
        sequence_id: int,
        agent: Optional[str] = None,
    ):
        """Persists a real-time SSE event for replay support."""
        now = datetime.now(timezone.utc)
        record = {
            "review_id": review_id,
            "event_type": event_type,
            "agent": agent,
            "data": data,
            "sequence_id": sequence_id,
            "created_at": now,
        }
        if self.is_connected and self.pool:
            query = """
                INSERT INTO review_events (
                    review_id, event_type, agent, data, sequence_id, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6)
            """
            async with self.pool.acquire() as conn:
                await conn.execute(
                    query,
                    uuid.UUID(review_id),
                    event_type,
                    agent,
                    json.dumps(data),
                    sequence_id,
                    now,
                )
        else:
            self._mem_events.setdefault(review_id, []).append(record)

    async def get_events(self, review_id: str) -> List[Dict[str, Any]]:
        """Retrieves all historical events for SSE replay."""
        if self.is_connected and self.pool:
            query = "SELECT * FROM review_events WHERE review_id = $1 ORDER BY sequence_id ASC"
            async with self.pool.acquire() as conn:
                rows = await conn.fetch(query, uuid.UUID(review_id))
                results = []
                for r in rows:
                    item = dict(r)
                    if isinstance(item.get("data"), str):
                        item["data"] = json.loads(item["data"])
                    results.append(item)
                return results
        return self._mem_events.get(review_id, [])

    # -------------------------------------------------------------
    # Repo Chunks & pgvector Search
    # -------------------------------------------------------------

    async def has_indexed_commit(self, repo: str, commit_sha: str) -> bool:
        """Checks if files for this repository and commit SHA are already embedded."""
        if self.is_connected and self.pool:
            query = "SELECT 1 FROM repo_chunks WHERE repo = $1 AND commit_sha = $2 LIMIT 1"
            async with self.pool.acquire() as conn:
                val = await conn.fetchval(query, repo, commit_sha)
                return val is not None
        return any(c["repo"] == repo and c["commit_sha"] == commit_sha for c in self._mem_chunks)

    async def store_repo_chunks(self, chunks: List[Dict[str, Any]]):
        """Stores code chunks with their embedding vectors."""
        if not chunks:
            return

        now = datetime.now(timezone.utc)
        if self.is_connected and self.pool:
            query = """
                INSERT INTO repo_chunks (
                    id, repo, commit_sha, path, chunk_index, content, language, embedding, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT (repo, commit_sha, path, chunk_index) DO NOTHING
            """
            async with self.pool.acquire() as conn:
                async with conn.transaction():
                    for chunk in chunks:
                        cid = uuid.uuid4()
                        # asyncpg accepts vector as string or list if pgvector extension is active
                        emb = chunk.get("embedding")
                        emb_str = f"[{','.join(str(x) for x in emb)}]" if emb else None
                        await conn.execute(
                            query,
                            cid,
                            chunk["repo"],
                            chunk["commit_sha"],
                            chunk["path"],
                            chunk["chunk_index"],
                            chunk["content"],
                            chunk["language"],
                            emb_str,
                            now,
                        )
        else:
            for chunk in chunks:
                record = dict(chunk)
                record["id"] = str(uuid.uuid4())
                record["created_at"] = now
                self._mem_chunks.append(record)

    async def similarity_search(
        self,
        repo: str,
        commit_sha: str,
        query_vector: List[float],
        top_k: int = 5,
    ) -> List[Dict[str, Any]]:
        """Retrieves top-k related chunks via cosine similarity."""
        if not query_vector:
            return []

        if self.is_connected and self.pool:
            emb_str = f"[{','.join(str(x) for x in query_vector)}]"
            query = """
                SELECT id, repo, commit_sha, path, chunk_index, content, language,
                       1 - (embedding <=> $1) AS similarity
                FROM repo_chunks
                WHERE repo = $2 AND commit_sha = $3
                ORDER BY embedding <=> $1
                LIMIT $4
            """
            async with self.pool.acquire() as conn:
                rows = await conn.fetch(query, emb_str, repo, commit_sha, top_k)
                return [dict(r) for r in rows]

        # In-memory cosine similarity calculation
        matching_chunks = [c for c in self._mem_chunks if c["repo"] == repo and c["commit_sha"] == commit_sha]
        if not matching_chunks:
            return []

        def cosine_sim(v1: List[float], v2: List[float]) -> float:
            if not v1 or not v2 or len(v1) != len(v2):
                return 0.0
            dot = sum(a * b for a, b in zip(v1, v2))
            norm1 = math.sqrt(sum(a * a for a in v1))
            norm2 = math.sqrt(sum(b * b for b in v2))
            if norm1 == 0 or norm2 == 0:
                return 0.0
            return dot / (norm1 * norm2)

        scored = []
        for c in matching_chunks:
            emb = c.get("embedding", [])
            sim = cosine_sim(query_vector, emb)
            scored.append({**c, "similarity": sim})

        scored.sort(key=lambda x: x["similarity"], reverse=True)
        return scored[:top_k]

    # -------------------------------------------------------------
    # Aggregated Metrics
    # -------------------------------------------------------------

    async def get_metrics_summary(self) -> Dict[str, Any]:
        """Calculates aggregated metrics across all completed reviews."""
        if self.is_connected and self.pool:
            query = """
                SELECT 
                    COUNT(*) as total_reviews,
                    COALESCE(AVG(total_latency_ms), 0) as avg_latency_ms,
                    COALESCE(AVG(total_tokens_in), 0) as avg_tokens_in,
                    COALESCE(AVG(total_tokens_out), 0) as avg_tokens_out,
                    COALESCE(SUM(estimated_cost_usd), 0) as total_cost_usd
                FROM reviews
                WHERE status = 'completed'
            """
            async with self.pool.acquire() as conn:
                row = await conn.fetchrow(query)
                base_metrics = dict(row)

                # Severity counts
                sev_query = """
                    SELECT 
                        jsonb_array_elements(result_json->'findings')->>'severity' as sev,
                        count(*) as count
                    FROM reviews
                    WHERE status = 'completed' AND result_json IS NOT NULL
                    GROUP BY sev
                """
                sev_rows = await conn.fetch(sev_query)
                severity_counts = {r["sev"]: r["count"] for r in sev_rows if r["sev"]}

                # Verdict counts
                ver_query = """
                    SELECT verdict, count(*) as count
                    FROM reviews
                    WHERE status = 'completed' AND verdict IS NOT NULL
                    GROUP BY verdict
                """
                ver_rows = await conn.fetch(ver_query)
                verdict_counts = {r["verdict"]: r["count"] for r in ver_rows}

                return {
                    "total_reviews": int(base_metrics["total_reviews"]),
                    "avg_latency_ms": float(base_metrics["avg_latency_ms"]),
                    "avg_tokens_in": float(base_metrics["avg_tokens_in"]),
                    "avg_tokens_out": float(base_metrics["avg_tokens_out"]),
                    "total_cost_usd": float(base_metrics["total_cost_usd"]),
                    "severity_counts": severity_counts,
                    "verdict_counts": verdict_counts,
                }

        # In-memory metrics
        completed = [r for r in self._mem_reviews.values() if r.get("status") == "completed"]
        total = len(completed)
        if total == 0:
            return {
                "total_reviews": 0,
                "avg_latency_ms": 0.0,
                "avg_tokens_in": 0.0,
                "avg_tokens_out": 0.0,
                "total_cost_usd": 0.0,
                "severity_counts": {},
                "verdict_counts": {},
            }

        avg_lat = sum(r.get("total_latency_ms", 0) for r in completed) / total
        avg_tin = sum(r.get("total_tokens_in", 0) for r in completed) / total
        avg_tout = sum(r.get("total_tokens_out", 0) for r in completed) / total
        tot_cost = sum(r.get("estimated_cost_usd", 0.0) for r in completed)

        sev_counts: Dict[str, int] = {}
        ver_counts: Dict[str, int] = {}

        for r in completed:
            v = r.get("verdict")
            if v:
                ver_counts[v] = ver_counts.get(v, 0) + 1
            res_json = r.get("result_json") or {}
            findings = res_json.get("findings", [])
            for f in findings:
                s = f.get("severity")
                if s:
                    sev_counts[s] = sev_counts.get(s, 0) + 1

        return {
            "total_reviews": total,
            "avg_latency_ms": round(avg_lat, 2),
            "avg_tokens_in": round(avg_tin, 2),
            "avg_tokens_out": round(avg_tout, 2),
            "total_cost_usd": round(tot_cost, 6),
            "severity_counts": sev_counts,
            "verdict_counts": ver_counts,
        }


# Global database manager instance
db = DatabaseManager()
