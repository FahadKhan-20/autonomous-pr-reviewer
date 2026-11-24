from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, HttpUrl, field_validator


class ReviewStatus(str, Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class Verdict(str, Enum):
    APPROVE = "approve"
    COMMENT = "comment"
    REQUEST_CHANGES = "request_changes"


class Severity(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"


class FindingCategory(str, Enum):
    SQL_INJECTION = "sql_injection"
    XSS = "xss"
    AUTH_FLAW = "auth_flaw"
    SECRETS_EXPOSURE = "secrets_exposure"
    RACE_CONDITION = "race_condition"
    NULL_OR_EDGE_CASE = "null_or_edge_case"
    UNSAFE_DESERIALIZATION = "unsafe_deserialization"
    OTHER = "other"


class Finding(BaseModel):
    """An anchored security, bug, or performance finding in the code diff."""

    file: str = Field(..., description="File path relative to repository root")
    line_start: int = Field(..., description="Start line in the new/modified file")
    line_end: int = Field(..., description="End line in the new/modified file")
    category: FindingCategory = Field(..., description="Vulnerability or defect category")
    severity: Severity = Field(..., description="Severity level")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Confidence score from 0.0 to 1.0")
    title: str = Field(..., description="Concise headline describing the finding")
    explanation: str = Field(..., description="Detailed explanation of the risk and mechanism")
    suggested_fix: str = Field(..., description="Concrete code or configuration fix snippet")


class GeneratedTest(BaseModel):
    """A runnable test case generated to cover modified functions and findings."""

    file: str = Field(..., description="Target file being tested")
    framework: str = Field(..., description="Test framework: 'pytest' or 'jest'")
    test_code: str = Field(..., description="Complete executable test suite code")
    syntax_valid: bool = Field(default=True, description="Whether code passed static syntax check")
    covers_finding_index: Optional[int] = Field(default=None, description="Index of finding covered by this test")


class ReviewSummary(BaseModel):
    """Synthesized final evaluation of the pull request."""

    risk_score: int = Field(..., ge=0, le=100, description="Overall risk score (0-100)")
    verdict: Verdict = Field(..., description="PR verdict: approve, comment, or request_changes")
    summary: str = Field(..., description="Executive summary of the changes and review verdict")
    key_strengths: List[str] = Field(default_factory=list, description="Positive aspects of the implementation")
    key_concerns: List[str] = Field(default_factory=list, description="Primary risks or deficiencies")


class ReviewRequest(BaseModel):
    """Input payload to initiate a pull request or repo review."""

    url: str = Field(..., description="GitHub PR URL (e.g. https://github.com/org/repo/pull/1) or Repo URL")
    post_github_comment: bool = Field(default=False, description="Whether to post review comments back to GitHub")

    @field_validator("url")
    @classmethod
    def validate_github_url(cls, v: str) -> str:
        clean = v.strip()
        if not clean.startswith("https://github.com/") and not clean.startswith("http://github.com/"):
            raise ValueError("URL must be a valid GitHub URL (https://github.com/owner/repo or /pull/n)")
        parts = clean.replace("https://github.com/", "").replace("http://github.com/", "").strip("/").split("/")
        if len(parts) < 2:
            raise ValueError("GitHub URL must include owner and repository name")
        return clean


class ReviewResponse(BaseModel):
    """Complete review record returned to API clients."""

    review_id: str
    status: ReviewStatus
    url: str
    repo: str
    pr_number: int
    title: Optional[str] = None
    head_sha: str
    base_sha: Optional[str] = None
    severity_score: int = 0
    verdict: Optional[Verdict] = None
    summary: Optional[str] = None
    findings: List[Finding] = Field(default_factory=list)
    generated_tests: List[GeneratedTest] = Field(default_factory=list)
    total_tokens_in: int = 0
    total_tokens_out: int = 0
    estimated_cost_usd: float = 0.0
    total_latency_ms: int = 0
    agent_metrics: Dict[str, Any] = Field(default_factory=dict)
    created_at: str
    error_message: Optional[str] = None


class AgentEvent(BaseModel):
    """Real-time event emitted during multi-agent graph execution."""

    review_id: str
    event_type: str  # node_started, reasoning, tool_call, finding, test_generated, node_finished, error, done
    agent: Optional[str] = None
    data: Dict[str, Any] = Field(default_factory=dict)
    sequence_id: int
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat() + "Z")


class MetricsSummary(BaseModel):
    """Aggregated system observability metrics."""

    total_reviews: int
    avg_latency_ms: float
    avg_tokens_in: float
    avg_tokens_out: float
    total_cost_usd: float
    severity_counts: Dict[str, int]
    verdict_counts: Dict[str, int]
