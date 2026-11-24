import py_compile
import tempfile
import time
from typing import Any, Dict, List, Optional, Tuple
from pydantic import BaseModel, Field
from app.core.database import db
from app.core.logging import get_logger
from app.graph.events import emit_event
from app.graph.state import ReviewState
from app.models.schemas import GeneratedTest
from app.services.llm import llm_service

logger = get_logger(__name__)


class TestGeneratorOutput(BaseModel):
    """Structured collection of generated test files."""
    tests: List[GeneratedTest] = Field(default_factory=list)


def syntax_check_python(code: str) -> Tuple[bool, Optional[str]]:
    """Safely syntax-checks Python code using compile() in isolated parse mode without execution."""
    try:
        compile(code, "<generated_test>", "exec")
        return True, None
    except SyntaxError as err:
        return False, f"SyntaxError at line {err.lineno}: {err.msg}"
    except Exception as exc:
        return False, str(exc)


def syntax_check_javascript(code: str) -> Tuple[bool, Optional[str]]:
    """Static syntax check for JS/TS code checking for balanced braces, brackets, and quotes."""
    stack = []
    pairs = {")": "(", "}": "{", "]": "["}
    in_string = None
    escaped = False

    for i, char in enumerate(code):
        if escaped:
            escaped = False
            continue
        if char == "\\":
            escaped = True
            continue
        if char in ("'", '"', "`"):
            if in_string == char:
                in_string = None
            elif in_string is None:
                in_string = char
            continue

        if in_string is not None:
            continue

        if char in pairs.values():
            stack.append(char)
        elif char in pairs.keys():
            if not stack or stack[-1] != pairs[char]:
                return False, f"Mismatched closing bracket '{char}' at character index {i}"
            stack.pop()

    if stack:
        return False, f"Unclosed delimiter '{stack[-1]}' in generated test code"

    return True, None


def validate_test_syntax(test: GeneratedTest) -> Tuple[bool, Optional[str]]:
    framework = (test.framework or "").lower()
    if framework == "pytest" or test.file.endswith(".py"):
        return syntax_check_python(test.test_code)
    else:
        return syntax_check_javascript(test.test_code)


async def test_generator_node(state: ReviewState) -> Dict[str, Any]:
    """
    Node 3: Test Generator.
    Generates runnable pytest (Python) or Jest (JS/TS) tests covering changed logic,
    happy paths, edge cases, and any bugs found by Node 2.
    """
    start_time = time.perf_counter()
    review_id = state.get("review_id", "")
    diff = state.get("diff", "")
    findings = state.get("findings", [])
    changed_files = state.get("changed_files", [])

    await emit_event(
        state,
        event_type="node_started",
        data={"message": "Test Generator initiated", "findings_to_cover": len(findings)},
        agent="test_generator",
    )

    generated_tests: List[Dict[str, Any]] = []
    tokens_in = 0
    tokens_out = 0

    try:
        has_python = any(f.get("filename", "").endswith(".py") for f in changed_files) or ".py" in diff
        default_framework = "pytest" if has_python else "jest"

        await emit_event(
            state,
            event_type="reasoning",
            data={
                "step": f"Generating regression & reproduction test suite using {default_framework}",
                "target_findings": [f.get("title") for f in findings[:3]],
            },
            agent="test_generator",
        )

        findings_summary = "\n".join(
            f"Finding #{i}: [{f.get('severity')}] {f.get('title')} in {f.get('file')}:{f.get('line_start')}\n"
            f"Explanation: {f.get('explanation')}\nSuggested fix: {f.get('suggested_fix')}"
            for i, f in enumerate(findings)
        )

        prompt = f"""
Write runnable unit tests using {default_framework} covering the modified code and reproducing/verifying fixes for any identified bugs.

<<<UNTRUSTED_CONTENT_START>>>
DIFF:
{diff}

IDENTIFIED FINDINGS / DEFECTS TO COVER:
{findings_summary}
<<<UNTRUSTED_CONTENT_END>>>

REQUIREMENTS:
1. Cover happy paths, boundary edge cases, and specifically write regression test cases for the findings above.
2. Ensure the code is self-contained with necessary imports and mock setups.
3. Choose the appropriate framework ('pytest' for Python, 'jest' for JavaScript/TypeScript).
"""

        system_prompt = (
            "You are a Principal Test Automation Engineer. "
            "Write robust, syntactically clean test cases. Never include prose outside the schema."
        )

        test_output, llm_metrics = await llm_service.generate_structured(
            prompt=prompt,
            response_model=TestGeneratorOutput,
            system_prompt=system_prompt,
            agent_name="test_generator",
        )

        tokens_in += llm_metrics.get("tokens_in", 0)
        tokens_out += llm_metrics.get("tokens_out", 0)

        for test in test_output.tests:
            is_valid, error_msg = validate_test_syntax(test)

            if not is_valid:
                await emit_event(
                    state,
                    event_type="reasoning",
                    data={"step": f"Syntax check failed for {test.file}: {error_msg}. Retrying once with error feedback..."},
                    agent="test_generator",
                )

                fix_prompt = f"""
The following generated test code had a syntax error:
ERROR: {error_msg}

BROKEN CODE:
{test.test_code}

Please fix the syntax error and return the valid test.
"""
                fixed_output, retry_metrics = await llm_service.generate_structured(
                    prompt=fix_prompt,
                    response_model=TestGeneratorOutput,
                    system_prompt="Fix the syntax error in the provided test code.",
                    agent_name="test_generator_repair",
                )
                tokens_in += retry_metrics.get("tokens_in", 0)
                tokens_out += retry_metrics.get("tokens_out", 0)

                if fixed_output.tests:
                    test = fixed_output.tests[0]
                    is_valid, error_msg = validate_test_syntax(test)

            test.syntax_valid = is_valid
            test_dict = test.model_dump()
            generated_tests.append(test_dict)

            await emit_event(
                state,
                event_type="test_generated",
                data={
                    "file": test.file,
                    "framework": test.framework,
                    "syntax_valid": test.syntax_valid,
                    "code_preview": test.test_code[:120] + "...",
                },
                agent="test_generator",
            )

    except Exception as exc:
        logger.error(f"Error in test_generator_node: {exc}", exc_info=True)
        state.setdefault("errors", []).append(f"TestGeneratorError: {str(exc)}")
        await emit_event(
            state,
            event_type="error",
            data={"error": str(exc)},
            agent="test_generator",
        )

    latency_ms = int((time.perf_counter() - start_time) * 1000)

    metrics = state.setdefault("metrics", {})
    metrics["test_generator"] = {
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
        "latency_ms": latency_ms,
        "tests_generated": len(generated_tests),
    }

    if review_id:
        await db.save_agent_run(
            review_id=review_id,
            agent_name="test_generator",
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            latency_ms=latency_ms,
            status="completed",
        )

    await emit_event(
        state,
        event_type="node_finished",
        data={"latency_ms": latency_ms, "tests_generated": len(generated_tests)},
        agent="test_generator",
    )

    return {
        "generated_tests": generated_tests,
        "events": state.get("events", []),
        "metrics": metrics,
    }
