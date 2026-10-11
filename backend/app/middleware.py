"""HTTP middleware: request IDs, access logging, simulated response delays, crash guard."""

import asyncio
import logging
import time
import uuid

from fastapi import FastAPI, Request

from app.errors import error_response
from app.simulation import simulation

access_logger = logging.getLogger("app.access")

API_PREFIX = "/api/v1"
# Never delay health checks or the dev controls; delaying them would hide what you're testing.
_NO_DELAY_PREFIXES = (f"{API_PREFIX}/health", f"{API_PREFIX}/dev")


def register_middleware(app: FastAPI) -> None:
    @app.middleware("http")
    async def request_context(request: Request, call_next):
        request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:16]
        request.state.request_id = request_id
        started = time.perf_counter()
        path = request.url.path

        delay_ms = 0
        if path.startswith(API_PREFIX) and not path.startswith(_NO_DELAY_PREFIXES) and request.method != "OPTIONS":
            delay_ms = simulation.response_delay_ms(
                request.method, path, request.headers.get("X-Simulate-Delay-Ms")
            )
            if delay_ms:
                await asyncio.sleep(delay_ms / 1000)

        try:
            response = await call_next(request)
        except Exception:  # noqa: BLE001 - last-resort guard so clients always get JSON
            access_logger.exception("unhandled error request_id=%s %s %s", request_id, request.method, path)
            response = error_response(request, 500, "INTERNAL_ERROR", "An unexpected error occurred.")

        duration_ms = (time.perf_counter() - started) * 1000
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Response-Time-Ms"] = f"{duration_ms:.1f}"
        if delay_ms:
            response.headers["X-Simulated-Delay-Ms"] = str(delay_ms)
        access_logger.info(
            "%s %s %s %.1fms request_id=%s",
            request.method, path, response.status_code, duration_ms, request_id,
        )
        return response
