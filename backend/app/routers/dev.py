"""Development-only controls. Not mounted when APP_ENV=production or ENABLE_DEV_ENDPOINTS=false."""

import logging

from fastapi import APIRouter, Query
from fastapi.concurrency import run_in_threadpool

from app.schemas import ResetResponse, SimulationUpdate
from app.seed import DEMO_PASSWORD, reset_database
from app.services.gateway import TEST_CARDS
from app.simulation import SimulationConfig, simulation

logger = logging.getLogger("app.dev")
router = APIRouter(prefix="/dev", tags=["Development"])


@router.post("/reset", response_model=ResetResponse, summary="Drop, recreate and re-seed the database")
async def reset(
    load_test_users: int | None = Query(
        None, ge=0, le=5000, description="Override SEED_LOAD_TEST_USERS for this reset"
    ),
    reset_simulation: bool = Query(True, description="Also restore simulation settings to .env defaults"),
):
    """Destroys **all** data (including payments and sessions) and restores the seed data.
    Existing access tokens become invalid. Avoid calling it while other requests are in flight."""
    counts = await run_in_threadpool(reset_database, load_test_users)
    if reset_simulation:
        simulation.reset()
    return ResetResponse(
        status="ok",
        message=f"Database reset. All demo accounts use the password '{DEMO_PASSWORD}'.",
        counts=counts,
    )


@router.get("/simulation", response_model=SimulationConfig, summary="Current simulation settings")
def get_simulation():
    return simulation.config


@router.put("/simulation", response_model=SimulationConfig, summary="Change simulation settings at runtime")
def update_simulation(body: SimulationUpdate):
    """Partial update: only the fields you send are changed. Changes last until restart or reset."""
    changes = body.model_dump(exclude_none=True)
    config = simulation.update(changes)
    logger.warning("simulation updated %s", changes)
    return config


@router.delete("/simulation", response_model=SimulationConfig, summary="Restore simulation settings to .env defaults")
def reset_simulation_config():
    simulation.reset()
    return simulation.config


@router.get("/test-cards", summary="Simulated card numbers and their deterministic outcomes")
def test_cards() -> list[dict[str, str]]:
    return [{"number": number, "outcome": outcome} for number, outcome in TEST_CARDS.items()]
