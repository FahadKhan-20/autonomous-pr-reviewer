from typing import List, Optional
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application runtime configuration backed by environment variables."""

    # LLM Settings
    LLM_PROVIDER: str = Field(default="anthropic", description="LLM provider: 'anthropic' or 'openai'")
    ANTHROPIC_API_KEY: Optional[str] = Field(default=None, description="Anthropic API key")
    ANTHROPIC_MODEL: str = Field(default="claude-3-5-sonnet-20241022", description="Anthropic model name")
    OPENAI_API_KEY: Optional[str] = Field(default=None, description="OpenAI API key")
    OPENAI_MODEL: str = Field(default="gpt-4o", description="OpenAI model name")

    # Embedding Settings
    EMBEDDING_PROVIDER: str = Field(default="openai", description="Embedding provider: 'openai' or 'deterministic'")
    EMBEDDING_MODEL: str = Field(default="text-embedding-3-small", description="Model for vector embeddings")
    EMBEDDING_DIM: int = Field(default=1536, description="Dimension of output embeddings")

    # Database Settings
    DATABASE_URL: str = Field(
        default="postgresql+asyncpg://postgres:postgres@localhost:5432/pr_reviewer",
        description="Async PostgreSQL connection URI",
    )
    DATABASE_URL_SYNC: str = Field(
        default="postgresql://postgres:postgres@localhost:5432/pr_reviewer",
        description="Sync PostgreSQL connection URI for migrations/checkers",
    )

    # GitHub Settings
    GITHUB_TOKEN: Optional[str] = Field(default=None, description="GitHub personal access token for higher rate limits")
    GITHUB_WEBHOOK_SECRET: str = Field(
        default="development_webhook_secret_key_32_bytes_min",
        description="HMAC secret for verifying incoming GitHub webhooks",
    )
    POST_GITHUB_COMMENTS: bool = Field(default=False, description="Flag to post review comments back to GitHub PR")

    # Safety & Resource Caps
    MAX_DIFF_FILES: int = Field(default=50, description="Max files to process from diff before truncation")
    MAX_DIFF_BYTES: int = Field(default=500_000, description="Max bytes of unified diff before truncation")
    MAX_CONTEXT_CHUNKS: int = Field(default=8, description="Max context chunks to inject into agent prompt")

    # Observability & CORS
    LOG_LEVEL: str = Field(default="INFO", description="Application log level")
    CORS_ORIGINS: List[str] = Field(
        default=["http://localhost:3000", "http://127.0.0.1:3000"],
        description="Allowed CORS origins",
    )
    ENVIRONMENT: str = Field(default="development", description="Runtime environment")

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v):
        if isinstance(v, str):
            return [i.strip() for i in v.split(",") if i.strip()]
        return v

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=True,
    )


settings = Settings()
