from typing import Any, Callable, Coroutine, Dict, List, Optional
from typing_extensions import TypedDict


class ReviewState(TypedDict, total=False):
    """Shared state dictionary traversed across all LangGraph nodes."""

    # PR Metadata
    review_id: str
    repo: str
    pr_number: int
    title: str
    base_sha: str
    head_sha: str

    # Diff & Files
    diff: str
    changed_files: List[Dict[str, Any]]
    file_contents: Dict[str, str]

    # Agent Outputs
    context_chunks: List[Dict[str, Any]]
    findings: List[Dict[str, Any]]
    generated_tests: List[Dict[str, Any]]
    summary: Dict[str, Any]

    # Observability & Metrics
    events: List[Dict[str, Any]]
    metrics: Dict[str, Any]
    errors: List[str]

    # Optional async emitter callback for live streaming SSE events
    event_emitter: Optional[Callable[[Dict[str, Any]], Coroutine[Any, Any, None]]]
