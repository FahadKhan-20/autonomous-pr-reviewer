from typing import Any, Dict
from langgraph.graph import END, START, StateGraph
from app.agents.context_retriever import context_retriever_node
from app.agents.security_auditor import security_auditor_node
from app.agents.synthesizer import synthesizer_node
from app.agents.test_generator import test_generator_node
from app.core.database import db
from app.core.logging import get_logger
from app.graph.state import ReviewState

logger = get_logger(__name__)


def build_review_graph() -> StateGraph:
    """Constructs and compiles the multi-agent LangGraph workflow."""
    workflow = StateGraph(ReviewState)

    # 1. Add agent nodes
    workflow.add_node("context_retriever", context_retriever_node)
    workflow.add_node("security_auditor", security_auditor_node)
    workflow.add_node("test_generator", test_generator_node)
    workflow.add_node("synthesizer", synthesizer_node)

    # 2. Add sequential execution edges
    workflow.add_edge(START, "context_retriever")
    workflow.add_edge("context_retriever", "security_auditor")
    workflow.add_edge("security_auditor", "test_generator")
    workflow.add_edge("test_generator", "synthesizer")
    workflow.add_edge("synthesizer", END)

    return workflow.compile()


review_graph = build_review_graph()


async def run_review_workflow(initial_state: ReviewState) -> Dict[str, Any]:
    """
    Executes the multi-agent workflow for a review with resilient top-level error handling.
    """
    review_id = initial_state.get("review_id", "")
    logger.info(f"Starting review workflow for #{initial_state.get('pr_number')} ({initial_state.get('repo')})")

    try:
        final_state = await review_graph.ainvoke(initial_state)
        return final_state
    except Exception as exc:
        logger.error(f"Fatal error in review workflow {review_id}: {exc}", exc_info=True)
        if review_id:
            await db.update_review_status(review_id, status="failed", error_message=str(exc))
            # Emit error event if emitter present
            emitter = initial_state.get("event_emitter")
            if emitter and callable(emitter):
                try:
                    await emitter({
                        "review_id": review_id,
                        "event_type": "error",
                        "agent": "system",
                        "data": {"error": f"Workflow execution halted: {str(exc)}"},
                        "sequence_id": 999,
                        "timestamp": "",
                    })
                except Exception:
                    pass
        raise
