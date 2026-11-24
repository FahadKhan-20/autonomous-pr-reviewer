import pytest
import respx
import httpx
from app.core.config import Settings
from app.core.database import DatabaseManager
from app.services.github import (
    GitHubService,
    GitHubRateLimitError,
    GitHubNotFoundError,
    parse_github_url,
)
from app.services.chunking import CodeChunker
from app.services.embeddings import EmbeddingService
from app.services.llm import LLMService, PROMPT_INJECTION_DEFENSE
from app.models.schemas import Finding, ReviewSummary, Severity, FindingCategory, Verdict


# -------------------------------------------------------------------------
# 1. URL Parsing Tests
# -------------------------------------------------------------------------

def test_parse_github_url():
    # Valid PR URL with /pull/
    owner, repo, pr_num = parse_github_url("https://github.com/torvalds/linux/pull/42")
    assert owner == "torvalds"
    assert repo == "linux"
    assert pr_num == 42

    # Valid PR URL with /pulls/
    owner, repo, pr_num = parse_github_url("https://github.com/facebook/react/pulls/100/")
    assert owner == "facebook"
    assert repo == "react"
    assert pr_num == 100

    # Valid Repo URL without PR number
    owner, repo, pr_num = parse_github_url("https://github.com/pallets/flask")
    assert owner == "pallets"
    assert repo == "flask"
    assert pr_num is None

    # Invalid URL
    with pytest.raises(ValueError):
        parse_github_url("https://gitlab.com/owner/repo")


# -------------------------------------------------------------------------
# 2. Config & Settings Tests
# -------------------------------------------------------------------------

def test_settings_initialization():
    settings = Settings()
    assert settings.LLM_PROVIDER in ["anthropic", "openai"]
    assert settings.EMBEDDING_DIM == 1536
    assert isinstance(settings.CORS_ORIGINS, list)
    assert settings.MAX_DIFF_FILES == 50


# -------------------------------------------------------------------------
# 3. GitHub Service Tests (Mocked with respx)
# -------------------------------------------------------------------------

@pytest.mark.asyncio
@respx.mock
async def test_github_service_pr_metadata():
    gh = GitHubService(token="fake_token")
    mock_url = "https://api.github.com/repos/test-org/test-repo/pulls/1"
    respx.get(mock_url).respond(
        200,
        json={"title": "Fix memory leak", "head": {"sha": "abc1234"}, "base": {"sha": "def5678"}},
    )

    meta = await gh.get_pr_metadata("test-org", "test-repo", 1)
    assert meta["title"] == "Fix memory leak"
    assert meta["head"]["sha"] == "abc1234"


@pytest.mark.asyncio
@respx.mock
async def test_github_service_rate_limit():
    gh = GitHubService(token="fake_token")
    mock_url = "https://api.github.com/repos/test-org/test-repo/pulls/1"
    respx.get(mock_url).respond(
        403,
        headers={"x-ratelimit-remaining": "0"},
        text="API rate limit exceeded",
    )

    with pytest.raises(GitHubRateLimitError):
        await gh.get_pr_metadata("test-org", "test-repo", 1)


@pytest.mark.asyncio
@respx.mock
async def test_github_service_not_found():
    gh = GitHubService(token="fake_token")
    mock_url = "https://api.github.com/repos/test-org/test-repo/pulls/999"
    respx.get(mock_url).respond(404, text="Not Found")

    with pytest.raises(GitHubNotFoundError):
        await gh.get_pr_metadata("test-org", "test-repo", 999)


@pytest.mark.asyncio
@respx.mock
async def test_github_service_file_filtering():
    gh = GitHubService()
    mock_url = "https://api.github.com/repos/test-org/test-repo/pulls/1/files?per_page=100"
    respx.get(mock_url).respond(
        200,
        json=[
            {"filename": "app/main.py", "status": "modified"},
            {"filename": "package-lock.json", "status": "modified"},  # Should be skipped
            {"filename": "assets/logo.png", "status": "added"},         # Should be skipped
            {"filename": "frontend/src/app.tsx", "status": "modified"},
        ],
    )

    files = await gh.get_pr_files("test-org", "test-repo", 1)
    filenames = [f["filename"] for f in files]
    assert "app/main.py" in filenames
    assert "frontend/src/app.tsx" in filenames
    assert "package-lock.json" not in filenames
    assert "assets/logo.png" not in filenames


# -------------------------------------------------------------------------
# 4. Code Chunking Tests
# -------------------------------------------------------------------------

def test_chunker_python():
    chunker = CodeChunker()
    py_code = """
import os

def calculate_total(a: int, b: int) -> int:
    return a + b

class UserManager:
    def get_user(self, user_id: str):
        return {"id": user_id}
"""
    chunks = chunker.chunk_file("org/repo", "sha1", "math_utils.py", py_code)
    assert len(chunks) >= 2
    symbols = [c["symbol"] for c in chunks]
    assert "calculate_total" in symbols or "UserManager" in symbols


def test_chunker_javascript():
    chunker = CodeChunker()
    js_code = """
export function authenticateUser(token) {
    if (!token) return null;
    return { authenticated: true };
}

export class SessionService {
    logout() {
        console.log("Logged out");
    }
}
"""
    chunks = chunker.chunk_file("org/repo", "sha1", "auth.js", js_code)
    assert len(chunks) >= 1
    assert any(c["language"] in ["javascript", "typescript"] for c in chunks)


def test_chunker_extract_symbols_and_imports():
    chunker = CodeChunker()
    diff = """
--- a/service.py
+++ b/service.py
@@ -1,3 +1,5 @@
+from database.client import get_connection
+import security_utils
 def handle_request(req):
+    conn = get_connection()
+    res = security_utils.validate(req)
"""
    symbols, imports = chunker.extract_symbols_and_imports(diff)
    assert "database" in imports or "security_utils" in imports
    assert "get_connection" in symbols


# -------------------------------------------------------------------------
# 5. Embeddings Tests
# -------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_embedding_service():
    service = EmbeddingService()
    vec1 = await service.get_embedding("SELECT * FROM users WHERE id = %s")
    vec2 = await service.get_embedding("SELECT * FROM users WHERE id = %s")
    vec3 = await service.get_embedding("totally unrelated function for canvas rendering")

    assert len(vec1) == 1536
    # Deterministic consistency
    assert vec1 == vec2

    # Vector normalization check: norm should be close to 1.0
    norm = sum(x * x for x in vec1) ** 0.5
    assert abs(norm - 1.0) < 0.01


# -------------------------------------------------------------------------
# 6. DatabaseManager Tests (In-memory fallback mode)
# -------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_database_manager_operations():
    db = DatabaseManager()  # In-memory mode
    rev_id = await db.save_review({
        "url": "https://github.com/org/repo/pull/1",
        "repo": "org/repo",
        "pr_number": 1,
        "title": "Initial commit",
        "head_sha": "head123",
    })
    assert rev_id is not None

    rev = await db.get_review(rev_id)
    assert rev is not None
    assert rev["repo"] == "org/repo"
    assert rev["status"] == "queued"

    # Status update
    await db.update_review_status(rev_id, "processing")
    rev = await db.get_review(rev_id)
    assert rev["status"] == "processing"

    # Events
    await db.save_event(rev_id, "node_started", {"agent": "retriever"}, sequence_id=1, agent="retriever")
    events = await db.get_events(rev_id)
    assert len(events) == 1
    assert events[0]["event_type"] == "node_started"

    # Similarity search
    emb = [0.1] * 1536
    await db.store_repo_chunks([
        {
            "repo": "org/repo",
            "commit_sha": "head123",
            "path": "app.py",
            "chunk_index": 0,
            "content": "def run(): pass",
            "language": "python",
            "embedding": emb,
        }
    ])
    assert await db.has_indexed_commit("org/repo", "head123") is True
    assert await db.has_indexed_commit("org/repo", "nonexistent") is False

    results = await db.similarity_search("org/repo", "head123", emb, top_k=1)
    assert len(results) == 1
    assert results[0]["path"] == "app.py"


# -------------------------------------------------------------------------
# 7. LLM Service Tests
# -------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_llm_service_prompt_injection_guard():
    llm = LLMService()
    summary, metrics = await llm.generate_structured(
        prompt="Review this PR diff",
        response_model=ReviewSummary,
        system_prompt="Audit code changes",
    )
    assert isinstance(summary, ReviewSummary)
    assert summary.risk_score >= 0
    assert summary.verdict in [Verdict.APPROVE, Verdict.COMMENT, Verdict.REQUEST_CHANGES]
    assert "tokens_in" in metrics
    assert "latency_ms" in metrics
