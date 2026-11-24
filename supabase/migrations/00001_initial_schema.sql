-- Supabase & PostgreSQL Migration with pgvector
-- Migration: 00001_initial_schema.sql

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- 1. Reviews Table
CREATE TABLE IF NOT EXISTS reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NULL, -- Nullable for anonymous reviews, ready for Supabase Auth
    url TEXT NOT NULL,
    repo TEXT NOT NULL,
    pr_number INTEGER NOT NULL,
    title TEXT,
    head_sha TEXT NOT NULL,
    base_sha TEXT,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
    severity_score INTEGER DEFAULT 0 CHECK (severity_score >= 0 AND severity_score <= 100),
    verdict TEXT CHECK (verdict IS NULL OR verdict IN ('approve', 'comment', 'request_changes')),
    summary TEXT,
    result_json JSONB,
    total_tokens_in INTEGER NOT NULL DEFAULT 0,
    total_tokens_out INTEGER NOT NULL DEFAULT 0,
    estimated_cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0.000000,
    total_latency_ms INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Agent Runs Table (Observability per agent)
CREATE TABLE IF NOT EXISTS agent_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    agent_name TEXT NOT NULL,
    tokens_in INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    latency_ms INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Review Events Table (SSE Replay storage)
CREATE TABLE IF NOT EXISTS review_events (
    id BIGSERIAL PRIMARY KEY,
    review_id UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    agent TEXT,
    data JSONB NOT NULL,
    sequence_id INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Repo Chunks Table (pgvector storage with HNSW index)
CREATE TABLE IF NOT EXISTS repo_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repo TEXT NOT NULL,
    commit_sha TEXT NOT NULL,
    path TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    language TEXT NOT NULL,
    embedding vector(1536),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (repo, commit_sha, path, chunk_index)
);

-- Indexes for high performance
CREATE INDEX IF NOT EXISTS idx_reviews_repo_pr ON reviews(repo, pr_number);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status);
CREATE INDEX IF NOT EXISTS idx_reviews_created_at ON reviews(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_review ON agent_runs(review_id);
CREATE INDEX IF NOT EXISTS idx_review_events_review_seq ON review_events(review_id, sequence_id ASC);
CREATE INDEX IF NOT EXISTS idx_repo_chunks_repo_sha ON repo_chunks(repo, commit_sha);

-- HNSW Vector Index for Cosine Similarity Search
CREATE INDEX IF NOT EXISTS idx_repo_chunks_embedding 
ON repo_chunks USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
