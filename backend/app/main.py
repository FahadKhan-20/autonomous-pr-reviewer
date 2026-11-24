from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.api.metrics import router as metrics_router
from app.api.reviews import router as reviews_router
from app.api.webhooks import router as webhooks_router
from app.core.config import settings
from app.core.database import db
from app.core.logging import get_logger, setup_logging

logger = setup_logging(settings.LOG_LEVEL)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle manager handling database connection pool on startup and shutdown."""
    logger.info("Starting up PR Reviewer Agent backend...")
    await db.connect()
    yield
    logger.info("Shutting down PR Reviewer Agent backend...")
    await db.disconnect()


app = FastAPI(
    title="Autonomous GitHub PR & Code Reviewer Agent API",
    description="Multi-agent code review workflow engine powered by LangGraph, FastAPI, and pgvector.",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(reviews_router)
app.include_router(metrics_router)
app.include_router(webhooks_router)


@app.get("/health", tags=["system"])
async def healthcheck():
    """Healthcheck endpoint for container orchestration and status monitoring."""
    return {
        "status": "healthy",
        "database_connected": db.is_connected,
        "environment": settings.ENVIRONMENT,
        "llm_provider": settings.LLM_PROVIDER,
        "embedding_provider": settings.EMBEDDING_PROVIDER,
    }


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Global exception handler returning structured JSON errors."""
    logger.error(f"Unhandled exception on {request.method} {request.url.path}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"error": "InternalServerError", "message": str(exc)},
    )
