import asyncio
import json
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.database import db
from app.graph.workflow import run_review_workflow
from app.services.github import GitHubService, parse_github_url


async def main():
    print(f"--- Running End-to-End Autonomous Review on Real Public GitHub PR ---")
    gh = GitHubService()

    # Query latest open PR from Flask repository
    owner = "pallets"
    repo_name = "flask"
    print(f"1. Querying repository {owner}/{repo_name} for latest open PR...")
    latest_pr = await gh.get_latest_open_pr(owner, repo_name)
    pr_number = int(latest_pr["number"])
    target_url = latest_pr.get("html_url", f"https://github.com/{owner}/{repo_name}/pull/{pr_number}")
    print(f"   Target PR: {target_url}")
    print(f"   PR Title:  {latest_pr.get('title')}")
    print(f"   Head SHA:  {latest_pr.get('head', {}).get('sha')}")

    print("2. Fetching real unified diff...")
    diff_text = await gh.get_pr_diff(owner, repo_name, pr_number)
    print(f"   Retrieved {len(diff_text)} bytes of unified diff.")

    print("3. Fetching changed files list...")
    files = await gh.get_pr_files(owner, repo_name, pr_number)
    print(f"   Found {len(files)} changed source files.")

    review_id = "real-e2e-verification-review"
    await db.save_review({
        "id": review_id,
        "url": target_url,
        "repo": f"{owner}/{repo_name}",
        "pr_number": pr_number,
        "title": latest_pr.get("title"),
        "head_sha": latest_pr.get("head", {}).get("sha", "head"),
        "status": "processing",
    })

    events_captured = []

    async def log_event(event):
        events_captured.append(event)
        print(f"   [STREAM EVENT] {event.get('event_type'):<15} (agent: {event.get('agent', 'system')})")

    state = {
        "review_id": review_id,
        "repo": f"{owner}/{repo_name}",
        "pr_number": pr_number,
        "title": latest_pr.get("title"),
        "head_sha": latest_pr.get("head", {}).get("sha", "head"),
        "base_sha": latest_pr.get("base", {}).get("sha", "base"),
        "diff": diff_text,
        "changed_files": files,
        "file_contents": {},
        "event_emitter": log_event,
    }

    print("4. Executing 4-agent LangGraph workflow...")
    final_state = await run_review_workflow(state)

    summary = final_state.get("summary", {})
    findings = final_state.get("findings", [])
    tests = final_state.get("generated_tests", [])

    print("\n=================== REVIEW RESULTS ===================")
    print(f"Verdict:             {summary.get('verdict')}")
    print(f"Risk Score:          {summary.get('risk_score')}/100")
    print(f"Summary:             {summary.get('summary')}")
    print(f"Findings Count:      {len(findings)}")
    print(f"Tests Generated:     {len(tests)}")
    print(f"Total Stream Events: {len(events_captured)}")
    print("======================================================")


if __name__ == "__main__":
    asyncio.run(main())
