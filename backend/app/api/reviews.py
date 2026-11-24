import asyncio
import json
import uuid
from typing import Any, AsyncGenerator, Dict, Set
from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, status
from sse_starlette.sse import EventSourceResponse
from app.core.database import db
from app.core.logging import get_logger
from app.graph.workflow import run_review_workflow
from app.models.schemas import ReviewRequest, ReviewResponse, ReviewStatus
from app.services.github import GitHubNotFoundError, GitHubRateLimitError, GitHubService, parse_github_url

logger = get_logger(__name__)
router = APIRouter(prefix="/api/reviews", tags=["reviews"])

# Active SSE listener queues by review_id
_live_subscribers: Dict[str, Set[asyncio.Queue]] = {}
_subscriber_lock = asyncio.Lock()


async def register_subscriber(review_id: str) -> asyncio.Queue:
    """Registers an active client SSE queue for live event broadcasting."""
    queue: asyncio.Queue = asyncio.Queue()
    async with _subscriber_lock:
        if review_id not in _live_subscribers:
            _live_subscribers[review_id] = set()
        _live_subscribers[review_id].add(queue)
    return queue


async def unregister_subscriber(review_id: str, queue: asyncio.Queue):
    """Unregisters a client SSE queue when connection closes."""
    async with _subscriber_lock:
        if review_id in _live_subscribers:
            _live_subscribers[review_id].discard(queue)
            if not _live_subscribers[review_id]:
                del _live_subscribers[review_id]


async def broadcast_event(event: Dict[str, Any]):
    """Broadcasts a live event to all connected subscriber queues for this review."""
    review_id = event.get("review_id", "")
    async with _subscriber_lock:
        subscribers = list(_live_subscribers.get(review_id, []))

    for queue in subscribers:
        try:
            queue.put_nowait(event)
        except Exception:
            pass


async def _execute_review_task(
    review_id: str,
    repo: str,
    pr_number: int,
    url: str,
    post_comment: bool,
):
    """Background task orchestrating ingestion and the LangGraph multi-agent review."""
    gh = GitHubService()
    try:
        await db.update_review_status(review_id, status="processing")

        # 1. Ingest metadata and diff from GitHub
        owner, repo_name = repo.split("/", 1)
        meta = await gh.get_pr_metadata(owner, repo_name, pr_number)
        diff_text = await gh.get_pr_diff(owner, repo_name, pr_number)
        changed_files = await gh.get_pr_files(owner, repo_name, pr_number)

        head_sha = meta.get("head", {}).get("sha", "head")
        base_sha = meta.get("base", {}).get("sha", "base")
        title = meta.get("title", f"PR #{pr_number}")

        # Fetch contents for changed files at head commit
        file_contents: Dict[str, str] = {}
        for f in changed_files[:10]:
            path = f.get("filename")
            if path:
                raw_content = await gh.get_file_content(owner, repo_name, path, head_sha)
                if raw_content:
                    file_contents[path] = raw_content

        # Update review record with real title & head SHA
        await db.save_review({
            "id": review_id,
            "url": url,
            "repo": repo,
            "pr_number": pr_number,
            "title": title,
            "head_sha": head_sha,
            "base_sha": base_sha,
            "status": "processing",
        })

        # 2. Run LangGraph workflow with live broadcasting callback
        initial_state = {
            "review_id": review_id,
            "repo": repo,
            "pr_number": pr_number,
            "title": title,
            "head_sha": head_sha,
            "base_sha": base_sha,
            "diff": diff_text,
            "changed_files": changed_files,
            "file_contents": file_contents,
            "event_emitter": broadcast_event,
        }

        final_state = await run_review_workflow(initial_state)

        # 3. Post review comment back to GitHub if requested
        if post_comment and final_state.get("summary"):
            summary_info = final_state["summary"]
            findings = final_state.get("findings", [])
            body = (
                f"### Autonomous Code Review Summary\n"
                f"**Verdict:** `{summary_info.get('verdict')}` | **Risk Score:** `{summary_info.get('risk_score')}/100`\n\n"
                f"{summary_info.get('summary')}\n\n"
                f"**Identified Findings:** {len(findings)}\n"
            )
            await gh.post_review_comment(owner, repo_name, pr_number, body, head_sha)

    except GitHubRateLimitError as rle:
        logger.error(f"Rate limit error during review {review_id}: {rle}")
        await db.update_review_status(review_id, status="failed", error_message=str(rle))
        await broadcast_event({
            "review_id": review_id,
            "event_type": "error",
            "agent": "system",
            "data": {"error": str(rle)},
            "sequence_id": 999,
            "timestamp": "",
        })
    except GitHubNotFoundError as nfe:
        logger.error(f"Not found error during review {review_id}: {nfe}")
        await db.update_review_status(review_id, status="failed", error_message=str(nfe))
        await broadcast_event({
            "review_id": review_id,
            "event_type": "error",
            "agent": "system",
            "data": {"error": str(nfe)},
            "sequence_id": 999,
            "timestamp": "",
        })
    except Exception as exc:
        logger.error(f"Review execution failure {review_id}: {exc}", exc_info=True)
        await db.update_review_status(review_id, status="failed", error_message=str(exc))
        await broadcast_event({
            "review_id": review_id,
            "event_type": "error",
            "agent": "system",
            "data": {"error": f"Internal execution failure: {str(exc)}"},
            "sequence_id": 999,
            "timestamp": "",
        })


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_review(payload: ReviewRequest, background_tasks: BackgroundTasks) -> Dict[str, Any]:
    """Creates a new PR review and launches multi-agent analysis in the background."""
    try:
        owner, repo_name, pr_num = parse_github_url(payload.url)
    except ValueError as val_err:
        raise HTTPException(status_code=400, detail=str(val_err))

    gh = GitHubService()

    # If repo URL mode without PR number, retrieve the latest open PR
    if pr_num is None:
        try:
            latest_pr = await gh.get_latest_open_pr(owner, repo_name)
            pr_num = int(latest_pr["number"])
            canonical_url = latest_pr.get("html_url", f"https://github.com/{owner}/{repo_name}/pull/{pr_num}")
        except GitHubNotFoundError:
            raise HTTPException(
                status_code=404,
                detail=f"No open pull requests found for repository '{owner}/{repo_name}'. Provide a direct PR URL.",
            )
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Failed to query repository open PRs: {str(exc)}")
    else:
        canonical_url = payload.url

    review_id = str(uuid.uuid4())
    repo_full = f"{owner}/{repo_name}"

    # Initialize review record
    await db.save_review({
        "id": review_id,
        "url": canonical_url,
        "repo": repo_full,
        "pr_number": pr_num,
        "head_sha": "pending",
        "status": "queued",
    })

    # Dispatch review workflow in background task
    background_tasks.add_task(
        _execute_review_task,
        review_id=review_id,
        repo=repo_full,
        pr_number=pr_num,
        url=canonical_url,
        post_comment=payload.post_github_comment,
    )

    return {
        "review_id": review_id,
        "status": "queued",
        "repo": repo_full,
        "pr_number": pr_num,
        "url": canonical_url,
    }


def _serialize_event_data(ev: Dict[str, Any]) -> str:
    """Serializes event dictionary to JSON string handling datetime instances."""
    return json.dumps(ev, default=str)


@router.get("/{review_id}/stream")
async def stream_review_events(review_id: str) -> EventSourceResponse:
    """
    SSE stream endpoint with instantaneous replay of historical events,
    followed by real-time live events. Reconnection and page refresh safe.
    """
    review = await db.get_review(review_id)
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")

    async def event_generator() -> AsyncGenerator[Dict[str, Any], None]:
        # 1. Replay historical events from database
        historical_events = await db.get_events(review_id)
        last_seq = 0
        terminal_seen = False

        for ev in historical_events:
            last_seq = max(last_seq, ev.get("sequence_id", 0))
            if ev.get("event_type") in ("done", "error"):
                terminal_seen = True

            yield {
                "event": ev.get("event_type", "message"),
                "data": _serialize_event_data(ev),
                "id": str(ev.get("sequence_id", "")),
            }

        # If review is already terminal, end stream immediately after replay
        if terminal_seen or review.get("status") in ("completed", "failed"):
            return

        # 2. Subscribe to live queue for ongoing events
        queue = await register_subscriber(review_id)
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=25.0)
                    # Deduplicate if event was already replayed
                    if event.get("sequence_id", 0) <= last_seq:
                        continue

                    last_seq = event.get("sequence_id", 0)
                    yield {
                        "event": event.get("event_type", "message"),
                        "data": _serialize_event_data(event),
                        "id": str(last_seq),
                    }

                    if event.get("event_type") in ("done", "error"):
                        break
                except asyncio.TimeoutError:
                    # Keep-alive heartbeat comment
                    yield {"comment": "keep-alive"}

                    # Double check if review completed in background
                    current_rev = await db.get_review(review_id)
                    if current_rev and current_rev.get("status") in ("completed", "failed"):
                        break
        finally:
            await unregister_subscriber(review_id, queue)

    return EventSourceResponse(event_generator(), ping=15)


@router.get("/{review_id}")
async def get_review_detail(review_id: str) -> Dict[str, Any]:
    """Returns the complete review record with findings, tests, summary, and observability metrics."""
    review = await db.get_review(review_id)
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")

    result_json = review.get("result_json") or {}
    findings = result_json.get("findings", [])
    tests = result_json.get("generated_tests", [])
    agent_metrics = result_json.get("metrics", {})

    return {
        "review_id": review["id"],
        "status": review["status"],
        "url": review["url"],
        "repo": review["repo"],
        "pr_number": review["pr_number"],
        "title": review.get("title"),
        "head_sha": review["head_sha"],
        "base_sha": review.get("base_sha"),
        "severity_score": review.get("severity_score", 0),
        "verdict": review.get("verdict"),
        "summary": review.get("summary"),
        "findings": findings,
        "generated_tests": tests,
        "total_tokens_in": review.get("total_tokens_in", 0),
        "total_tokens_out": review.get("total_tokens_out", 0),
        "estimated_cost_usd": review.get("estimated_cost_usd", 0.0),
        "total_latency_ms": review.get("total_latency_ms", 0),
        "agent_metrics": agent_metrics,
        "created_at": review["created_at"].isoformat() if hasattr(review["created_at"], "isoformat") else str(review["created_at"]),
        "error_message": review.get("error_message"),
    }


@router.get("")
async def list_reviews(
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> Dict[str, Any]:
    """Returns paginated review history."""
    reviews = await db.list_reviews(limit=limit, offset=offset)
    formatted = []
    for r in reviews:
        formatted.append({
            "review_id": r["id"],
            "url": r["url"],
            "repo": r["repo"],
            "pr_number": r["pr_number"],
            "title": r.get("title"),
            "status": r["status"],
            "severity_score": r.get("severity_score", 0),
            "verdict": r.get("verdict"),
            "summary": r.get("summary"),
            "created_at": r["created_at"].isoformat() if hasattr(r["created_at"], "isoformat") else str(r["created_at"]),
        })
    return {"reviews": formatted, "count": len(formatted), "limit": limit, "offset": offset}
