from fastapi import APIRouter
from app.core.database import db

router = APIRouter(prefix="/api/metrics", tags=["metrics"])


@router.get("")
async def get_metrics():
    """Returns aggregated system observability metrics across all reviews."""
    return await db.get_metrics_summary()
