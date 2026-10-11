"""Application settings loaded from environment variables and backend/.env."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent

PaymentOutcomeOverride = Literal[
    "none",
    "success",
    "decline",
    "insufficient_funds",
    "expired_card",
    "gateway_error",
    "timeout",
    "pending",
]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "School Fees API"
    app_version: str = "1.0.0"
    app_env: Literal["development", "test", "production"] = "development"
    app_host: str = "127.0.0.1"
    app_port: int = 8000
    log_level: str = "INFO"

    database_url: str = "sqlite:///./data/app.db"
    seed_on_startup: bool = True
    seed_load_test_users: int = Field(default=50, ge=0, le=5000)

    # Kept as a raw string so a plain comma-separated value works in .env
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    token_ttl_minutes: int = Field(default=120, ge=1)
    enable_dev_endpoints: bool = True
    threadpool_size: int = Field(default=100, ge=1, le=1000)

    # Simulation defaults (mutable at runtime through app.simulation)
    sim_response_delay_ms: int = Field(default=0, ge=0)
    sim_response_jitter_ms: int = Field(default=0, ge=0)
    sim_random_seed: int = 42
    sim_endpoint_delays_ms: dict[str, int] = Field(default_factory=dict)
    sim_allow_delay_header: bool = True
    sim_max_delay_ms: int = Field(default=30000, ge=0)
    sim_gateway_latency_ms: int = Field(default=800, ge=0)
    sim_gateway_timeout_ms: int = Field(default=5000, ge=0)
    sim_pending_resolution_seconds: int = Field(default=8, ge=0)
    sim_payment_outcome_override: PaymentOutcomeOverride = "none"
    sim_gateway_error_every_n: int = Field(default=0, ge=0)

    @field_validator("database_url")
    @classmethod
    def _resolve_sqlite_path(cls, value: str) -> str:
        """Resolve relative SQLite paths against backend/ so the CWD doesn't matter."""
        prefix = "sqlite:///"
        if value.startswith(prefix) and not value.startswith(prefix + "/"):
            raw = value[len(prefix):]
            if raw != ":memory:" and not Path(raw).is_absolute():
                path = (BACKEND_DIR / raw).resolve()
                path.parent.mkdir(parents=True, exist_ok=True)
                return f"{prefix}{path.as_posix()}"
        return value

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def dev_endpoints_enabled(self) -> bool:
        return self.enable_dev_endpoints and self.app_env != "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
