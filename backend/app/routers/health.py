from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import utcnow
from app.schemas import HealthResponse

router = APIRouter(tags=["Health"])


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Health check",
    responses={503: {"model": HealthResponse, "description": "Database unavailable"}},
)
def health(db: Session = Depends(get_db)):
    """Liveness/readiness probe. Never delayed by the response-delay simulation."""
    settings = get_settings()
    try:
        db.execute(text("SELECT 1"))
        database = "ok"
    except Exception:  # noqa: BLE001
        database = "unavailable"
    body = HealthResponse(
        status="ok" if database == "ok" else "degraded",
        version=settings.app_version,
        environment=settings.app_env,
        database=database,
        timestamp=utcnow(),
    )
    return JSONResponse(status_code=200 if database == "ok" else 503, content=body.model_dump(mode="json"))
