"""Convenience launcher: `python run.py` starts the API using settings from .env."""

import uvicorn

from app.config import get_settings

if __name__ == "__main__":
    settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host=settings.app_host,
        port=settings.app_port,
        reload=settings.app_env == "development",
        log_level=settings.log_level.lower(),
        access_log=False,  # the app logs its own access lines with request IDs and timings
    )
