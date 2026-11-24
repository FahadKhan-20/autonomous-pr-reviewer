import time
from typing import Any, Dict, List, Optional, Set
from pydantic import BaseModel, Field
from unidiff import PatchSet
from app.core.database import db
from app.core.logging import get_logger
from app.graph.events import emit_event
from app.graph.state import ReviewState
from app.models.schemas import Finding, FindingCategory, Severity
from app.services.llm import llm_service

logger = get_logger(__name__)


class AuditorOutput(BaseModel):
    """Structured list of security and defect findings returned by the model."""
    findings: List[Finding] = Field(default_factory=list)


def parse_diff_valid_lines(diff_text: str) -> Dict[str, Set[int]]:
    """
    Parses unified diff using unidiff to determine valid added/modified line numbers
    in the target file.
    """
    valid_lines_by_file: Dict[str, Set[int]] = {}
    try:
        patch = PatchSet(diff_text)
        for patched_file in patch:
            filepath = patched_file.path
            if filepath.startswith("b/"):
                filepath = filepath[2:]

            valid_lines: Set[int] = set()
            for hunk in patched_file:
                for line in hunk:
                    if line.target_line_no is not None:
                        valid_lines.add(line.target_line_no)

            valid_lines_by_file[filepath] = valid_lines
            basename = filepath.split("/")[-1]
            if basename not in valid_lines_by_file:
                valid_lines_by_file[basename] = valid_lines
    except Exception as exc:
        logger.warning(f"Unidiff parsing failed ({exc}); diff line validation relaxed.")
    return valid_lines_by_file


def anchor_and_validate_finding(
    finding: Finding,
    valid_lines_by_file: Dict[str, Set[int]],
) -> Optional[Finding]:
    """Validates that the finding's file and line range exist in the diff."""
    if not valid_lines_by_file:
        return finding

    filepath = finding.file
    if filepath.startswith("b/"):
        filepath = filepath[2:]

    valid_lines = valid_lines_by_file.get(filepath)
    if not valid_lines:
        basename = filepath.split("/")[-1]
        valid_lines = valid_lines_by_file.get(basename)

    if not valid_lines:
        logger.info(f"Dropping hallucinated finding in file not in diff: {filepath}")
        return None

    finding_range = set(range(finding.line_start, finding.line_end + 1))
    intersection = finding_range.intersection(valid_lines)

    if intersection:
        return finding

    closest_line = min(valid_lines, key=lambda l: abs(l - finding.line_start))
    if abs(closest_line - finding.line_start) <= 5:
        offset = closest_line - finding.line_start
        finding.line_start = closest_line
        finding.line_end = max(closest_line, finding.line_end + offset)
        return finding

    logger.info(f"Dropping unanchored finding at {filepath}:{finding.line_start}-{finding.line_end}")
    return None


async def security_auditor_node(state: ReviewState) -> Dict[str, Any]:
    """
    Node 2: Security & Bug Auditor.
    Scans the unified diff and retrieved context for vulnerabilities and bugs,
    anchoring findings strictly to actual diff line coordinates.
    """
    start_time = time.perf_counter()
    review_id = state.get("review_id", "")
    diff = state.get("diff", "")
    context_chunks = state.get("context_chunks", [])

    await emit_event(
        state,
        event_type="node_started",
        data={"message": "Security & Bug Auditor initiated", "diff_length": len(diff)},
        agent="security_auditor",
    )

    validated_findings: List[Dict[str, Any]] = []
    tokens_in = 0
    tokens_out = 0

    try:
        valid_lines_by_file = parse_diff_valid_lines(diff)

        await emit_event(
            state,
            event_type="reasoning",
            data={
                "step": "Analyzing diff hunks for SQLi, XSS, auth/authz flaws, secrets exposure, and race conditions",
                "audited_files": list(valid_lines_by_file.keys())[:10],
            },
            agent="security_auditor",
        )

        context_str = "\n\n".join(
            f"--- Context File: {c.get('path')} (Chunk {c.get('chunk_index')}) ---\n{c.get('content')}"
            for c in context_chunks[:5]
        )

        user_prompt = f"""
Please audit the following pull request code diff and associated context for:
1. SQL Injection / Query tampering
2. Cross-Site Scripting (XSS) / Unsafe DOM insertion
3. Broken Authentication / Authorization checks
4. Hardcoded Secrets, tokens, or credentials
5. Race conditions, concurrence flaws, and deadlock potentials
6. Unhandled null/None pointer or boundary edge-case crashes
7. Unsafe deserialization or command execution

<<<UNTRUSTED_CONTENT_START>>>
DIFF TO AUDIT:
{diff}

RETRIEVED CONTEXT FILES:
{context_str}
<<<UNTRUSTED_CONTENT_END>>>

CRITICAL INSTRUCTIONS:
- You must anchor each finding to the exact file path and line numbers present in the diff.
- Do NOT make up or guess line numbers.
- Provide a clear, actionable suggested fix for every finding.
"""

        system_prompt = (
            "You are an elite application security engineer and code auditor. "
            "Output strictly verified, high-precision security vulnerabilities."
        )

        auditor_output, llm_metrics = await llm_service.generate_structured(
            prompt=user_prompt,
            response_model=AuditorOutput,
            system_prompt=system_prompt,
            agent_name="security_auditor",
        )

        tokens_in = llm_metrics.get("tokens_in", 0)
        tokens_out = llm_metrics.get("tokens_out", 0)

        for raw_finding in auditor_output.findings:
            anchored = anchor_and_validate_finding(raw_finding, valid_lines_by_file)
            if anchored:
                finding_dict = anchored.model_dump()
                validated_findings.append(finding_dict)
                await emit_event(
                    state,
                    event_type="finding",
                    data=finding_dict,
                    agent="security_auditor",
                )

        await emit_event(
            state,
            event_type="reasoning",
            data={
                "step": f"Completed audit: {len(validated_findings)} verified findings anchored to diff",
                "severities": [f["severity"] for f in validated_findings],
            },
            agent="security_auditor",
        )

    except Exception as exc:
        logger.error(f"Error in security_auditor_node: {exc}", exc_info=True)
        state.setdefault("errors", []).append(f"SecurityAuditorError: {str(exc)}")
        await emit_event(
            state,
            event_type="error",
            data={"error": str(exc)},
            agent="security_auditor",
        )

    latency_ms = int((time.perf_counter() - start_time) * 1000)

    metrics = state.setdefault("metrics", {})
    metrics["security_auditor"] = {
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
        "latency_ms": latency_ms,
        "findings_count": len(validated_findings),
    }

    if review_id:
        await db.save_agent_run(
            review_id=review_id,
            agent_name="security_auditor",
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            latency_ms=latency_ms,
            status="completed",
        )

    await emit_event(
        state,
        event_type="node_finished",
        data={"latency_ms": latency_ms, "findings_count": len(validated_findings)},
        agent="security_auditor",
    )

    return {
        "findings": validated_findings,
        "events": state.get("events", []),
        "metrics": metrics,
    }
