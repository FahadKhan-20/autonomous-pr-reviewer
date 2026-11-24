import time
from typing import Any, Dict, List
from app.core.database import db
from app.core.logging import get_logger
from app.graph.events import emit_event
from app.graph.state import ReviewState
from app.models.schemas import ReviewSummary, Severity, Verdict
from app.services.llm import llm_service

logger = get_logger(__name__)


def calculate_risk_score(findings: List[Dict[str, Any]]) -> int:
    score = 0
    weights = {
        Severity.CRITICAL.value: 35,
        Severity.HIGH.value: 20,
        Severity.MEDIUM.value: 10,
        Severity.LOW.value: 3,
        Severity.INFO.value: 0,
    }

    for f in findings:
        sev = (f.get("severity") or "info").lower()
        score += weights.get(sev, 5)

    return min(100, max(0, score))


def determine_verdict(risk_score: int, findings: List[Dict[str, Any]]) -> Verdict:
    has_critical = any((f.get("severity") or "").lower() == Severity.CRITICAL.value for f in findings)
    has_high = any((f.get("severity") or "").lower() == Severity.HIGH.value for f in findings)

    if has_critical or risk_score >= 60:
        return Verdict.REQUEST_CHANGES
    elif has_high or risk_score >= 20 or len(findings) > 0:
        return Verdict.COMMENT
    else:
        return Verdict.APPROVE


async def synthesizer_node(state: ReviewState) -> Dict[str, Any]:
    """
    Node 4: Synthesizer.
    Merges findings, context, and test suite into a cohesive final review.
    Calculates overall risk score (0-100), sets final verdict, and updates database.
    """
    start_time = time.perf_counter()
    review_id = state.get("review_id", "")
    diff = state.get("diff", "")
    findings = state.get("findings", [])
    generated_tests = state.get("generated_tests", [])

    await emit_event(
        state,
        event_type="node_started",
        data={"message": "Synthesizer initiated", "findings_count": len(findings)},
        agent="synthesizer",
    )

    tokens_in = 0
    tokens_out = 0

    calculated_risk = calculate_risk_score(findings)
    verdict = determine_verdict(calculated_risk, findings)

    await emit_event(
        state,
        event_type="reasoning",
        data={
            "step": f"Calculated baseline risk score: {calculated_risk}/100. Proposed verdict: {verdict.value}",
            "findings_count": len(findings),
            "generated_tests_count": len(generated_tests),
        },
        agent="synthesizer",
    )

    findings_summary = "\n".join(
        f"- [{f.get('severity')}] {f.get('title')} ({f.get('file')}:{f.get('line_start')})"
        for f in findings
    ) or "No security vulnerabilities detected."

    prompt = f"""
Synthesize the final code review assessment for this pull request.

<<<UNTRUSTED_CONTENT_START>>>
DIFF PREVIEW:
{diff[:2000]}

VALIDATED FINDINGS:
{findings_summary}

GENERATED TESTS COUNT: {len(generated_tests)}
PROPOSED RISK SCORE: {calculated_risk}
PROPOSED VERDICT: {verdict.value}
<<<UNTRUSTED_CONTENT_END>>>

REQUIREMENTS:
1. Provide a clear, constructive executive summary for the pull request author.
2. Highlight key strengths and critical areas of concern.
3. Align risk_score and verdict with the findings above.
"""

    system_prompt = (
        "You are an Engineering Director and Lead Architect. "
        "Synthesize the findings into an actionable, polite, and authoritative review."
    )

    try:
        summary_output, llm_metrics = await llm_service.generate_structured(
            prompt=prompt,
            response_model=ReviewSummary,
            system_prompt=system_prompt,
            agent_name="synthesizer",
        )

        tokens_in = llm_metrics.get("tokens_in", 0)
        tokens_out = llm_metrics.get("tokens_out", 0)
        summary_dict = summary_output.model_dump()
        summary_dict["risk_score"] = calculated_risk
        summary_dict["verdict"] = verdict.value

    except Exception as exc:
        logger.error(f"Error generating summary in synthesizer: {exc}", exc_info=True)
        summary_dict = {
            "risk_score": calculated_risk,
            "verdict": verdict.value,
            "summary": f"Review completed with {len(findings)} findings.",
            "key_strengths": ["Automated scan completed"],
            "key_concerns": [f"{len(findings)} issues require developer attention."],
        }

    latency_ms = int((time.perf_counter() - start_time) * 1000)

    all_metrics = state.setdefault("metrics", {})
    all_metrics["synthesizer"] = {
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
        "latency_ms": latency_ms,
    }

    total_tin = sum(m.get("tokens_in", 0) for m in all_metrics.values() if isinstance(m, dict))
    total_tout = sum(m.get("tokens_out", 0) for m in all_metrics.values() if isinstance(m, dict))
    total_lat = sum(m.get("latency_ms", 0) for m in all_metrics.values() if isinstance(m, dict))
    cost_usd = round((total_tin / 1000.0 * 0.003) + (total_tout / 1000.0 * 0.015), 6)

    final_result_json = {
        "findings": findings,
        "generated_tests": generated_tests,
        "summary": summary_dict,
        "metrics": all_metrics,
    }

    if review_id:
        await db.save_agent_run(
            review_id=review_id,
            agent_name="synthesizer",
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            latency_ms=latency_ms,
            status="completed",
        )

        await db.update_review_result(
            review_id=review_id,
            status="completed",
            result_json=final_result_json,
            verdict=verdict.value,
            severity_score=calculated_risk,
            summary=summary_dict.get("summary", ""),
            tokens_in=total_tin,
            tokens_out=total_tout,
            cost_usd=cost_usd,
            latency_ms=total_lat,
        )

    await emit_event(
        state,
        event_type="node_finished",
        data={"latency_ms": latency_ms, "verdict": verdict.value, "risk_score": calculated_risk},
        agent="synthesizer",
    )

    done_payload = {
        "verdict": verdict.value,
        "risk_score": calculated_risk,
        "summary": summary_dict.get("summary"),
        "total_findings": len(findings),
        "total_tests": len(generated_tests),
        "total_tokens_in": total_tin,
        "total_tokens_out": total_tout,
        "estimated_cost_usd": cost_usd,
        "total_latency_ms": total_lat,
    }
    await emit_event(
        state,
        event_type="done",
        data=done_payload,
        agent="system",
    )

    return {
        "summary": summary_dict,
        "events": state.get("events", []),
        "metrics": all_metrics,
    }
