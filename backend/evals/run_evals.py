import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List

# Ensure backend root is on Python path
CURRENT_DIR = Path(__file__).resolve().parent
BACKEND_ROOT = CURRENT_DIR.parent
sys.path.insert(0, str(BACKEND_ROOT))

from app.agents.security_auditor import security_auditor_node
from app.graph.state import ReviewState


async def evaluate_fixture(
    fixture_path: Path,
    expected_meta: Dict[str, Any],
) -> Dict[str, Any]:
    """Runs Security Auditor agent on a fixture diff and checks detection accuracy."""
    with open(fixture_path, "r", encoding="utf-8") as f:
        diff_text = f.read()

    state: ReviewState = {
        "review_id": f"eval-{fixture_path.stem}",
        "repo": "evals/fixture-test",
        "pr_number": 1,
        "head_sha": "eval_head_sha",
        "diff": diff_text,
        "context_chunks": [],
        "changed_files": [{"filename": "sample_file.py", "status": "modified"}],
        "file_contents": {},
        "events": [],
    }

    result = await security_auditor_node(state)
    findings: List[Dict[str, Any]] = result.get("findings", [])

    expected_category = expected_meta["expected_category"]
    detected = False
    detected_findings = []

    for f in findings:
        raw_cat = f.get("category")
        cat_str = getattr(raw_cat, "value", str(raw_cat or "")).lower()
        title_str = str(f.get("title", "")).lower()
        exp_str = str(f.get("explanation", "")).lower()

        if (
            cat_str == expected_category
            or expected_category in cat_str
            or expected_category in title_str
            or expected_category in exp_str
        ):
            detected = True
            detected_findings.append(f)

    return {
        "fixture": fixture_path.name,
        "description": expected_meta["description"],
        "expected_category": expected_category,
        "detected": detected,
        "findings_count": len(findings),
        "matching_findings": detected_findings,
    }


async def main():
    fixtures_dir = CURRENT_DIR / "fixtures"
    ground_truth_file = fixtures_dir / "ground_truth.json"

    if not ground_truth_file.exists():
        print(f"Ground truth file not found at {ground_truth_file}")
        sys.exit(1)

    with open(ground_truth_file, "r", encoding="utf-8") as f:
        ground_truth: Dict[str, Any] = json.load(f)

    print("======================================================================")
    print("      Autonomous PR Reviewer - Security Auditor Evaluation Suite      ")
    print("======================================================================")

    true_positives = 0
    false_negatives = 0
    false_positives = 0
    total_fixtures = len(ground_truth)

    results = []

    for fixture_name, meta in ground_truth.items():
        fixture_file = fixtures_dir / fixture_name
        if not fixture_file.exists():
            print(f"Skipping missing fixture: {fixture_name}")
            continue

        res = await evaluate_fixture(fixture_file, meta)
        results.append(res)

        status_str = "PASS [DETECTED]" if res["detected"] else "FAIL [MISSED]"
        print(f"\n- Fixture: {fixture_name}")
        print(f"  Description:       {meta['description']}")
        print(f"  Expected Category: {meta['expected_category']}")
        print(f"  Verdict:           {status_str} ({res['findings_count']} findings emitted)")

        if res["detected"]:
            true_positives += 1
            if res["findings_count"] > 1:
                false_positives += (res["findings_count"] - 1)
        else:
            false_negatives += 1

    precision = true_positives / (true_positives + false_positives) if (true_positives + false_positives) > 0 else 0.0
    recall = true_positives / (true_positives + false_negatives) if (true_positives + false_negatives) > 0 else 0.0
    f1_score = 2 * (precision * recall) / (precision + recall) if (precision + recall) > 0 else 0.0

    print("\n======================================================================")
    print("                        EVALUATION REPORT                             ")
    print("======================================================================")
    print(f"Total Test Fixtures:  {total_fixtures}")
    print(f"True Positives (TP):  {true_positives}")
    print(f"False Negatives (FN): {false_negatives}")
    print(f"False Positives (FP): {false_positives}")
    print("----------------------------------------------------------------------")
    print(f"Detection Recall:     {recall * 100:.1f}%")
    print(f"Detection Precision:  {precision * 100:.1f}%")
    print(f"F1-Score:             {f1_score:.2f}")
    print("======================================================================")


if __name__ == "__main__":
    asyncio.run(main())
