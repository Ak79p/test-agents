"""FastAPI application factory and wiring."""

import logging
from contextlib import asynccontextmanager

import anyio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.utils import get_openapi
from fastapi.responses import RedirectResponse

from app.config import get_settings
from app.errors import register_exception_handlers
from app.middleware import API_PREFIX, register_middleware
from app.routers import auth, dashboard, dev, fees, health, payments, students, transactions
from app.schemas import ErrorDetail, ErrorResponse
from app.seed import init_database

settings = get_settings()

logging.basicConfig(
    level=settings.log_level.upper(),
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
)
logger = logging.getLogger("app")

DESCRIPTION = """
Simulated school-fee payment API for practising UI (Playwright) and load (k6) testing.

**No real payments are ever made.** Card outcomes are deterministic; see `GET /api/v1/dev/test-cards`.

* Authenticate with `POST /api/v1/auth/login`, then click **Authorize** and paste the `access_token`.
* All errors use the shape `{"error": {"code", "message", "details", "request_id"}}`.
* Add `X-Simulate-Delay-Ms: <ms>` to any request to slow it down (when enabled).
"""


@asynccontextmanager
async def lifespan(_app: FastAPI):
    anyio.to_thread.current_default_thread_limiter().total_tokens = settings.threadpool_size
    init_database(seed_if_empty=settings.seed_on_startup)
    logger.info(
        "%s v%s started env=%s db=%s dev_endpoints=%s",
        settings.app_name, settings.app_version, settings.app_env,
        settings.database_url, settings.dev_endpoints_enabled,
    )
    yield


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description=DESCRIPTION,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)

register_exception_handlers(app)
register_middleware(app)
# Added last so it is the outermost middleware and error responses also carry CORS headers.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "X-Request-ID", "X-Simulate-Delay-Ms"],
    expose_headers=["X-Request-ID", "X-Response-Time-Ms", "X-Simulated-Delay-Ms", "Idempotent-Replayed", "Location"],
)

for module in (health, auth, students, fees, payments, transactions, dashboard):
    app.include_router(module.router, prefix=API_PREFIX)
if settings.dev_endpoints_enabled:
    app.include_router(dev.router, prefix=API_PREFIX)


def custom_openapi() -> dict:
    """Document 422s with the real error envelope instead of FastAPI's default HTTPValidationError."""
    if app.openapi_schema:
        return app.openapi_schema
    schema = get_openapi(title=app.title, version=app.version, description=app.description, routes=app.routes)
    error_ref = {"$ref": "#/components/schemas/ErrorResponse"}
    schema["components"]["schemas"].setdefault("ErrorResponse", ErrorResponse.model_json_schema(
        ref_template="#/components/schemas/{model}"))
    schema["components"]["schemas"].setdefault("ErrorDetail", ErrorDetail.model_json_schema(
        ref_template="#/components/schemas/{model}"))
    for path in schema["paths"].values():
        for operation in path.values():
            resp = operation.get("responses", {}).get("422")
            if resp:
                resp["description"] = "Validation error"
                resp["content"] = {"application/json": {"schema": error_ref}}
    for name in ("HTTPValidationError", "ValidationError"):
        schema["components"]["schemas"].pop(name, None)
    app.openapi_schema = schema
    return schema


app.openapi = custom_openapi


@app.get("/", include_in_schema=False)
def root():
    return RedirectResponse(url="/docs")
