"""Database schema definitions and typed dictionary records."""
from typing import Any, Dict, List, Optional, TypedDict


class ReviewDBRecord(TypedDict):
    id: str
    user_id: Optional[str]
    url: str
    repo: str
    pr_number: int
    title: Optional[str]
    head_sha: str
    base_sha: Optional[str]
    status: str
    severity_score: int
    verdict: Optional[str]
    summary: Optional[str]
    result_json: Dict[str, Any]
    total_tokens_in: int
    total_tokens_out: int
    estimated_cost_usd: float
    total_latency_ms: int
    error_message: Optional[str]
    created_at: str
    updated_at: str


class AgentRunDBRecord(TypedDict):
    id: str
    review_id: str
    agent_name: str
    tokens_in: int
    tokens_out: int
    latency_ms: int
    status: str
    error: Optional[str]
    created_at: str


class RepoChunkDBRecord(TypedDict):
    id: str
    repo: str
    commit_sha: str
    path: str
    chunk_index: int
    content: str
    language: str
    embedding: Optional[List[float]]
    created_at: str
