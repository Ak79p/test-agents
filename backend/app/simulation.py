"""Runtime-mutable simulation settings (delays and gateway behaviour).

Initialised from SIM_* environment variables and changeable via
``PUT /api/v1/dev/simulation``. State lives in process memory, so run the API
with a single worker process when relying on runtime changes.
"""

import random
import threading

from pydantic import BaseModel, Field

from app.config import PaymentOutcomeOverride, Settings, get_settings


class SimulationConfig(BaseModel):
    response_delay_ms: int = Field(0, ge=0, description="Fixed delay added to every API response.")
    response_jitter_ms: int = Field(0, ge=0, description="Extra seeded-random delay of 0..N ms.")
    endpoint_delays_ms: dict[str, int] = Field(
        default_factory=dict,
        description='Extra delay per route: keys are "METHOD /path-prefix" or "/path-prefix".',
    )
    allow_delay_header: bool = Field(True, description="Honour the X-Simulate-Delay-Ms request header.")
    max_delay_ms: int = Field(30000, ge=0, description="Upper bound for any single simulated delay.")
    gateway_latency_ms: int = Field(800, ge=0, description="Gateway processing time for a confirmation.")
    gateway_timeout_ms: int = Field(5000, ge=0, description="Wait before the timeout scenario returns 504.")
    pending_resolution_seconds: int = Field(8, ge=0, description="Seconds before a PROCESSING payment settles.")
    payment_outcome_override: PaymentOutcomeOverride = Field(
        "none", description="Force one outcome for every confirmation ('none' = decide by card number)."
    )
    gateway_error_every_n: int = Field(0, ge=0, description="Fail every Nth confirmation with a gateway error.")
    random_seed: int = Field(42, description="Seed for the jitter generator (reset on update).")

    @classmethod
    def from_settings(cls, s: Settings) -> "SimulationConfig":
        return cls(
            response_delay_ms=s.sim_response_delay_ms,
            response_jitter_ms=s.sim_response_jitter_ms,
            endpoint_delays_ms=s.sim_endpoint_delays_ms,
            allow_delay_header=s.sim_allow_delay_header,
            max_delay_ms=s.sim_max_delay_ms,
            gateway_latency_ms=s.sim_gateway_latency_ms,
            gateway_timeout_ms=s.sim_gateway_timeout_ms,
            pending_resolution_seconds=s.sim_pending_resolution_seconds,
            payment_outcome_override=s.sim_payment_outcome_override,
            gateway_error_every_n=s.sim_gateway_error_every_n,
            random_seed=s.sim_random_seed,
        )


class SimulationState:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.reset()

    def reset(self) -> None:
        with self._lock:
            self._config = SimulationConfig.from_settings(get_settings())
            self._rng = random.Random(self._config.random_seed)
            self._confirmations = 0

    @property
    def config(self) -> SimulationConfig:
        return self._config

    def update(self, changes: dict) -> SimulationConfig:
        with self._lock:
            self._config = self._config.model_validate({**self._config.model_dump(), **changes})
            self._rng = random.Random(self._config.random_seed)
            self._confirmations = 0
            return self._config

    def jitter_ms(self) -> int:
        if self._config.response_jitter_ms <= 0:
            return 0
        with self._lock:
            return self._rng.randint(0, self._config.response_jitter_ms)

    def next_confirmation_number(self) -> int:
        with self._lock:
            self._confirmations += 1
            return self._confirmations

    def response_delay_ms(self, method: str, path: str, header_value: str | None) -> int:
        cfg = self._config
        delay = cfg.response_delay_ms + self.jitter_ms()
        for key, ms in cfg.endpoint_delays_ms.items():
            key_method, _, key_path = key.partition(" ") if " " in key else ("", "", key)
            if key_method and key_method.upper() != method.upper():
                continue
            if path.startswith(key_path):
                delay += ms
        if cfg.allow_delay_header and header_value:
            try:
                delay += max(int(header_value), 0)
            except ValueError:
                pass
        return min(delay, cfg.max_delay_ms)


simulation = SimulationState()
