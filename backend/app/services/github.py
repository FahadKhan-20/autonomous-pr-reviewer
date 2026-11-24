import re
from typing import Any, Dict, List, Optional, Tuple
import httpx
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

# Files that should be excluded from semantic code review
IGNORED_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp",
    ".woff", ".woff2", ".ttf", ".eot",
    ".pdf", ".zip", ".tar", ".gz", ".7z",
    ".exe", ".dll", ".so", ".dylib",
    ".pyc", ".min.js", ".min.css", ".map",
}

IGNORED_FILENAMES = {
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "poetry.lock",
    "cargo.lock",
    "go.sum",
    "composer.lock",
    "gemfile.lock",
}


class GitHubError(Exception):
    """Base exception for GitHub API errors."""
    pass


class GitHubRateLimitError(GitHubError):
    """Raised when GitHub API rate limits are hit."""
    pass


class GitHubNotFoundError(GitHubError):
    """Raised when repo or PR is not found or is private."""
    pass


def parse_github_url(url: str) -> Tuple[str, str, Optional[int]]:
    """
    Parses a GitHub URL into (owner, repo, pr_number).
    Accepts:
      - https://github.com/owner/repo/pull/42
      - https://github.com/owner/repo/pulls/42
      - https://github.com/owner/repo
    """
    clean = url.strip().rstrip("/")
    # Pattern for PR URL
    pr_match = re.search(r"github\.com/([^/]+)/([^/]+)/pull(?:s)?/(\d+)", clean)
    if pr_match:
        owner, repo, pr_num = pr_match.groups()
        return owner, repo, int(pr_num)

    # Pattern for Repo URL
    repo_match = re.search(r"github\.com/([^/]+)/([^/]+)", clean)
    if repo_match:
        owner, repo = repo_match.groups()
        return owner, repo, None

    raise ValueError(f"Invalid GitHub URL format: {url}")


class GitHubService:
    """Async client for GitHub REST API interaction."""

    def __init__(self, token: Optional[str] = None):
        self.token = token or settings.GITHUB_TOKEN
        self.base_url = "https://api.github.com"

    def _get_headers(self, accept: str = "application/vnd.github.v3+json") -> Dict[str, str]:
        headers = {
            "Accept": accept,
            "User-Agent": "Autonomous-PR-Reviewer-Agent/1.0",
        }
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        return headers

    def _check_response_status(self, response: httpx.Response, context: str):
        if response.status_code == 404:
            raise GitHubNotFoundError(f"{context}: Repository or Pull Request not found (or requires private token).")
        if response.status_code in (403, 429):
            remaining = response.headers.get("x-ratelimit-remaining")
            if remaining == "0" or "rate limit" in response.text.lower():
                raise GitHubRateLimitError(
                    "GitHub API rate limit exceeded. Provide a valid GITHUB_TOKEN in .env to increase limits."
                )
            raise GitHubError(f"GitHub API access forbidden: {response.text}")
        if response.status_code >= 400:
            raise GitHubError(f"GitHub API error ({response.status_code}) during {context}: {response.text}")

    async def get_latest_open_pr(self, owner: str, repo: str) -> Dict[str, Any]:
        """Fetches the latest open pull request for a repository."""
        url = f"{self.base_url}/repos/{owner}/{repo}/pulls?state=open&sort=updated&direction=desc&per_page=1"
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
            resp = await client.get(url, headers=self._get_headers())
            self._check_response_status(resp, f"Listing open PRs for {owner}/{repo}")
            data = resp.json()
            if not data or not isinstance(data, list):
                raise GitHubNotFoundError(f"No open pull requests found in {owner}/{repo}.")
            return data[0]

    async def list_open_prs(self, owner: str, repo: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Lists recent open pull requests for a repository."""
        url = f"{self.base_url}/repos/{owner}/{repo}/pulls?state=open&sort=updated&direction=desc&per_page={limit}"
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
            resp = await client.get(url, headers=self._get_headers())
            self._check_response_status(resp, f"Listing PRs for {owner}/{repo}")
            return resp.json()

    async def get_pr_metadata(self, owner: str, repo: str, pr_number: int) -> Dict[str, Any]:
        """Retrieves metadata (title, body, base/head SHA, author) for a PR."""
        url = f"{self.base_url}/repos/{owner}/{repo}/pulls/{pr_number}"
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
            resp = await client.get(url, headers=self._get_headers())
            self._check_response_status(resp, f"Fetching PR metadata #{pr_number}")
            return resp.json()

    async def get_pr_diff(self, owner: str, repo: str, pr_number: int) -> str:
        """Retrieves the unified diff of a pull request."""
        url = f"{self.base_url}/repos/{owner}/{repo}/pulls/{pr_number}"
        headers = self._get_headers(accept="application/vnd.github.v3.diff")
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            resp = await client.get(url, headers=headers)
            self._check_response_status(resp, f"Fetching unified diff for PR #{pr_number}")
            diff_text = resp.text

            # Enforce size limits
            if len(diff_text.encode("utf-8")) > settings.MAX_DIFF_BYTES:
                logger.warning(f"Diff for {owner}/{repo}#{pr_number} exceeded max bytes. Truncating.")
                truncated = diff_text[: settings.MAX_DIFF_BYTES]
                diff_text = (
                    f"{truncated}\n\n"
                    f"# [NOTICE: Diff truncated after {settings.MAX_DIFF_BYTES} bytes due to safety cap]\n"
                )

            return diff_text

    async def get_pr_files(self, owner: str, repo: str, pr_number: int) -> List[Dict[str, Any]]:
        """Retrieves list of changed files with additions/deletions, filtering out binaries & lockfiles."""
        url = f"{self.base_url}/repos/{owner}/{repo}/pulls/{pr_number}/files?per_page=100"
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
            resp = await client.get(url, headers=self._get_headers())
            self._check_response_status(resp, f"Fetching files for PR #{pr_number}")
            raw_files = resp.json()

            if not isinstance(raw_files, list):
                logger.warning(f"Unexpected response format for PR files: {raw_files}")
                return []

            filtered: List[Dict[str, Any]] = []
            for file_info in raw_files:
                if not isinstance(file_info, dict):
                    continue
                filename = file_info.get("filename", "")
                lower = filename.lower()
                basename = lower.split("/")[-1]

                # Skip lockfiles and binaries
                if basename in IGNORED_FILENAMES:
                    continue
                if any(lower.endswith(ext) for ext in IGNORED_EXTENSIONS):
                    continue

                filtered.append(file_info)

            # Cap max files
            if len(filtered) > settings.MAX_DIFF_FILES:
                logger.warning(f"PR #{pr_number} has {len(filtered)} files. Capping to {settings.MAX_DIFF_FILES}.")
                filtered = filtered[: settings.MAX_DIFF_FILES]

            return filtered

    async def get_file_content(self, owner: str, repo: str, path: str, ref: str) -> Optional[str]:
        """Fetches raw text content of a file at a specific commit ref."""
        url = f"{self.base_url}/repos/{owner}/{repo}/contents/{path}?ref={ref}"
        headers = self._get_headers(accept="application/vnd.github.v3.raw")
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code == 200:
                return resp.text
            if resp.status_code in (404, 403):
                logger.debug(f"Could not fetch raw file content for {path} at {ref} (status {resp.status_code})")
                return None
            return None

    async def post_review_comment(
        self,
        owner: str,
        repo: str,
        pr_number: int,
        body: str,
        commit_id: str,
        path: Optional[str] = None,
        line: Optional[int] = None,
    ) -> Optional[Dict[str, Any]]:
        """Posts an issue or inline review comment to the GitHub PR (if enabled)."""
        if not settings.POST_GITHUB_COMMENTS or not self.token:
            logger.info("Posting GitHub comment skipped (POST_GITHUB_COMMENTS=false or no GITHUB_TOKEN)")
            return None

        async with httpx.AsyncClient(timeout=20.0) as client:
            if path and line:
                # Inline pull request review comment
                url = f"{self.base_url}/repos/{owner}/{repo}/pulls/{pr_number}/comments"
                payload = {
                    "body": body,
                    "commit_id": commit_id,
                    "path": path,
                    "line": line,
                    "side": "RIGHT",
                }
            else:
                # PR level comment
                url = f"{self.base_url}/repos/{owner}/{repo}/issues/{pr_number}/comments"
                payload = {"body": body}

            resp = await client.post(url, headers=self._get_headers(), json=payload)
            if resp.status_code in (200, 201):
                return resp.json()
            logger.warning(f"Failed to post comment to PR #{pr_number}: {resp.status_code} {resp.text}")
            return None
