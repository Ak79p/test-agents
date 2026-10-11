"""Simulated payment gateway. Nothing here talks to a real payment provider.

The outcome of a confirmation is fully deterministic:

1. If ``gateway_error_every_n`` is N > 0, every Nth confirmation is a gateway error.
2. Otherwise, if ``payment_outcome_override`` is not ``none`` it decides the outcome.
3. Otherwise the card number decides (see TEST_CARDS); any other valid card succeeds.
"""

import asyncio
import secrets
from dataclasses import dataclass
from enum import StrEnum

from app.simulation import simulation


class GatewayOutcome(StrEnum):
    SUCCESS = "SUCCESS"
    DECLINE = "DECLINE"
    INSUFFICIENT_FUNDS = "INSUFFICIENT_FUNDS"
    EXPIRED_CARD = "EXPIRED_CARD"
    GATEWAY_ERROR = "GATEWAY_ERROR"
    TIMEOUT = "TIMEOUT"
    PENDING_SUCCESS = "PENDING_SUCCESS"
    PENDING_FAILURE = "PENDING_FAILURE"


TEST_CARDS: dict[str, GatewayOutcome] = {
    "4242424242424242": GatewayOutcome.SUCCESS,
    "5555555555554444": GatewayOutcome.SUCCESS,
    "4000000000000002": GatewayOutcome.DECLINE,
    "4000000000009995": GatewayOutcome.INSUFFICIENT_FUNDS,
    "4000000000000069": GatewayOutcome.EXPIRED_CARD,
    "4000000000000119": GatewayOutcome.GATEWAY_ERROR,
    "4000000000001018": GatewayOutcome.TIMEOUT,
    "4000000000002024": GatewayOutcome.PENDING_SUCCESS,
    "4000000000003030": GatewayOutcome.PENDING_FAILURE,
}

_OVERRIDES: dict[str, GatewayOutcome] = {
    "success": GatewayOutcome.SUCCESS,
    "decline": GatewayOutcome.DECLINE,
    "insufficient_funds": GatewayOutcome.INSUFFICIENT_FUNDS,
    "expired_card": GatewayOutcome.EXPIRED_CARD,
    "gateway_error": GatewayOutcome.GATEWAY_ERROR,
    "timeout": GatewayOutcome.TIMEOUT,
    "pending": GatewayOutcome.PENDING_SUCCESS,
}

FAILURE_MESSAGES: dict[str, str] = {
    "CARD_DECLINED": "The card was declined by the issuing bank.",
    "INSUFFICIENT_FUNDS": "The card has insufficient funds.",
    "EXPIRED_CARD": "The card has expired.",
    "GATEWAY_ERROR": "The payment gateway is temporarily unavailable. Please try again.",
    "GATEWAY_TIMEOUT": "The payment gateway did not respond in time.",
    "BALANCE_CHANGED": "The fee balance changed before this payment completed.",
}

DECLINE_CODES: dict[GatewayOutcome, str] = {
    GatewayOutcome.DECLINE: "CARD_DECLINED",
    GatewayOutcome.INSUFFICIENT_FUNDS: "INSUFFICIENT_FUNDS",
    GatewayOutcome.EXPIRED_CARD: "EXPIRED_CARD",
}


@dataclass(frozen=True)
class GatewayResult:
    outcome: GatewayOutcome
    gateway_reference: str


def card_brand(number: str) -> str:
    if number.startswith("4"):
        return "VISA"
    if number[:2] in {"51", "52", "53", "54", "55"} or 2221 <= int(number[:4]) <= 2720:
        return "MASTERCARD"
    if number[:2] in {"34", "37"}:
        return "AMEX"
    return "CARD"


def decide_outcome(card_number: str) -> GatewayOutcome:
    cfg = simulation.config
    n = simulation.next_confirmation_number()
    if cfg.gateway_error_every_n and n % cfg.gateway_error_every_n == 0:
        return GatewayOutcome.GATEWAY_ERROR
    if cfg.payment_outcome_override != "none":
        return _OVERRIDES[cfg.payment_outcome_override]
    return TEST_CARDS.get(card_number, GatewayOutcome.SUCCESS)


async def submit(outcome: GatewayOutcome) -> GatewayResult:
    """Simulate the network round-trip to the gateway without blocking the event loop."""
    cfg = simulation.config
    wait_ms = cfg.gateway_timeout_ms if outcome == GatewayOutcome.TIMEOUT else cfg.gateway_latency_ms
    if wait_ms:
        await asyncio.sleep(wait_ms / 1000)
    return GatewayResult(outcome=outcome, gateway_reference=f"gw_{secrets.token_hex(8)}")
