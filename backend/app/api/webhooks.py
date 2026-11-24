import hashlib
import hmac
import uuid
from typing import Any, Dict
from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Request, status
from app.core.config import settings
from app.core.logging import get_logger
from app.api.reviews import _execute_review_task
from app.core.database import db

logger = get_logger(__name__)
router = APIRouter(prefix="/webhooks", tags=["webhooks"])


def verify_github_signature(payload_bytes: bytes, signature_header: str, secret: str) -> bool:
    """Verifies that the webhook payload was signed using GITHUB_WEBHOOK_SECRET."""
    if not signature_header or not signature_header.startswith("sha256="):
        return False

    expected_sig = signature_header.split("sha256=")[-1].strip()
    mac = hmac.new(secret.encode("utf-8"), msg=payload_bytes, digestmod=hashlib.sha256)
    computed_sig = mac.hexdigest()
    return hmac.compare_digest(computed_sig, expected_sig)


@router.post("/github", status_code=status.HTTP_202_ACCEPTED)
async def github_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    x_hub_signature_256: str = Header(default=""),
    x_github_event: str = Header(default=""),
) -> Dict[str, Any]:
    """
    Receives GitHub repository webhooks, verifies HMAC signature,
    and triggers automated multi-agent reviews for pull_request events.
    """
    payload_bytes = await request.body()

    # 1. Verify HMAC SHA-256 signature
    is_valid = verify_github_signature(payload_bytes, x_hub_signature_256, settings.GITHUB_WEBHOOK_SECRET)
    if not is_valid:
        logger.warning("Rejected webhook: Invalid or missing X-Hub-Signature-256")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid webhook HMAC signature (X-Hub-Signature-256)",
        )

    # 2. Only process pull_request events
    if x_github_event != "pull_request":
        return {"status": "ignored", "reason": f"Event '{x_github_event}' is not 'pull_request'"}

    data = await request.json()
    action = data.get("action")
    pr_data = data.get("pull_request", {})

    # Trigger review on opened or synchronize (commit pushed)
    if action not in ("opened", "synchronize", "reopened"):
        return {"status": "ignored", "action": action, "reason": "Action does not trigger review"}

    pr_url = pr_data.get("html_url")
    pr_number = pr_data.get("number")
    repo_data = data.get("repository", {})
    repo_full = repo_data.get("full_name")

    if not pr_url or not pr_number or not repo_full:
        raise HTTPException(status_code=400, detail="Incomplete pull_request payload data")

    review_id = str(uuid.uuid4())
    logger.info(f"Webhook triggered review {review_id} for {repo_full}#{pr_number} (action: {action})")

    # Initialize review record
    await db.save_review({
        "id": review_id,
        "url": pr_url,
        "repo": repo_full,
        "pr_number": pr_number,
        "head_sha": pr_data.get("head", {}).get("sha", "head"),
        "status": "queued",
    })

    # Dispatch review in background
    background_tasks.add_task(
        _execute_review_task,
        review_id=review_id,
        repo=repo_full,
        pr_number=pr_number,
        url=pr_url,
        post_comment=settings.POST_GITHUB_COMMENTS,
    )

    return {
        "status": "accepted",
        "review_id": review_id,
        "action": action,
        "repo": repo_full,
        "pr_number": pr_number,
    }
