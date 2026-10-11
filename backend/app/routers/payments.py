import asyncio

from fastapi import APIRouter, Depends, Header
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.database import SessionLocal, get_db
from app.deps import get_current_parent
from app.errors import ApiError
from app.models import TERMINAL_STATUSES, Parent, PaymentStatus
from app.schemas import (
    CardDetails,
    ConfirmPaymentRequest,
    CreatePaymentRequest,
    ErrorResponse,
    PaymentOut,
    PaymentStatusOut,
    payment_out,
)
from app.services import gateway
from app.services import payments as service
from app.services.gateway import GatewayOutcome, GatewayResult

router = APIRouter(prefix="/payments", tags=["Payments"])

_401 = {401: {"model": ErrorResponse, "description": "Not authenticated"}}
_404 = {404: {"model": ErrorResponse, "description": "Payment not found"}}
_422 = {422: {"model": ErrorResponse, "description": "Validation error"}}

POLL_INTERVAL_MS = 1000


def _json(payment: PaymentOut, status_code: int, headers: dict | None = None) -> JSONResponse:
    return JSONResponse(status_code=status_code, content=payment.model_dump(mode="json"), headers=headers)


@router.post(
    "",
    status_code=201,
    response_model=PaymentOut,
    summary="Create a payment (idempotent)",
    responses={
        200: {"model": PaymentOut, "description": "Replay: a payment already exists for this Idempotency-Key"},
        400: {"model": ErrorResponse, "description": "Missing or malformed Idempotency-Key"},
        **_401,
        404: {"model": ErrorResponse, "description": "Fee not found"},
        409: {"model": ErrorResponse, "description": "Fee already paid / payment already in progress"},
        422: {"model": ErrorResponse, "description": "Validation error, amount exceeds balance, or key reused"},
    },
)
def create_payment(
    body: CreatePaymentRequest,
    idempotency_key: str | None = Header(
        None,
        alias="Idempotency-Key",
        description="Unique key per payment attempt (8-255 chars). Retrying with the same key and body "
        "returns the original payment instead of creating a duplicate.",
    ),
    parent: Parent = Depends(get_current_parent),
    db: Session = Depends(get_db),
):
    """Creates a payment in **PENDING** state for one fee. No money moves until it is confirmed.

    * First request for a key → **201 Created**.
    * Same key + same body → **200 OK** with header `Idempotent-Replayed: true` and the current state of
      the original payment (even under concurrent duplicate requests).
    * Same key + different body → **422 IDEMPOTENCY_KEY_REUSED**.
    """
    key = service.validate_idempotency_key(idempotency_key)
    payment, replayed = service.create_payment(db, parent.id, body, key)
    headers = {"Idempotency-Key": key, "Location": f"/api/v1/payments/{payment.id}"}
    if replayed:
        headers["Idempotent-Replayed"] = "true"
    return _json(payment_out(payment), 200 if replayed else 201, headers)


@router.get("/{payment_id}", response_model=PaymentOut, summary="Payment details", responses={**_401, **_404})
def get_payment(payment_id: str, parent: Parent = Depends(get_current_parent), db: Session = Depends(get_db)):
    service.resolve_due_payments(db, parent.id, payment_id)
    return payment_out(service.get_owned_payment(db, parent.id, payment_id))


@router.get(
    "/{payment_id}/status",
    response_model=PaymentStatusOut,
    summary="Lightweight payment status (for polling)",
    responses={**_401, **_404},
)
def get_payment_status(payment_id: str, parent: Parent = Depends(get_current_parent), db: Session = Depends(get_db)):
    service.resolve_due_payments(db, parent.id, payment_id)
    p = service.get_owned_payment(db, parent.id, payment_id)
    return PaymentStatusOut(
        id=p.id,
        reference=p.reference,
        status=p.status,
        is_final=PaymentStatus(p.status) in TERMINAL_STATUSES,
        failure_code=p.failure_code,
        failure_message=p.failure_message,
        updated_at=p.updated_at,
        retry_after_ms=POLL_INTERVAL_MS if p.status == PaymentStatus.PROCESSING else None,
    )


def _begin(parent_id: str, payment_id: str, card: CardDetails) -> GatewayOutcome:
    with SessionLocal() as db:
        return service.begin_confirmation(db, parent_id, payment_id, card)


def _complete(payment_id: str, result: GatewayResult) -> PaymentOut:
    with SessionLocal() as db:
        return payment_out(service.complete_confirmation(db, payment_id, result))


@router.post(
    "/{payment_id}/confirm",
    response_model=PaymentOut,
    summary="Confirm a payment with (simulated) card details",
    responses={
        200: {"model": PaymentOut, "description": "Final outcome: SUCCEEDED or FAILED (declined)"},
        202: {"model": PaymentOut, "description": "Accepted; PROCESSING asynchronously - poll the status"},
        **_401,
        **_404,
        409: {"model": ErrorResponse, "description": "Payment is not PENDING or balance changed"},
        **_422,
        502: {"model": ErrorResponse, "description": "Simulated gateway error; payment returns to PENDING"},
        504: {"model": ErrorResponse, "description": "Simulated gateway timeout; payment stays PROCESSING"},
    },
)
async def confirm_payment(
    payment_id: str,
    body: ConfirmPaymentRequest,
    parent: Parent = Depends(get_current_parent),
):
    """Moves a PENDING payment to PROCESSING, calls the simulated gateway and records the outcome.

    The outcome is chosen by the card number (see `GET /api/v1/dev/test-cards`) unless a simulation
    override is active. A declined card is a *successful API call* with a FAILED payment (200).
    """
    parent_id = parent.id
    outcome = await run_in_threadpool(_begin, parent_id, payment_id, body.card)

    async def finish() -> PaymentOut:
        result = await gateway.submit(outcome)
        return await run_in_threadpool(_complete, payment_id, result)

    # Shielded so a client disconnect can't leave the payment stuck mid-flight.
    payment = await asyncio.shield(asyncio.ensure_future(finish()))

    if outcome == GatewayOutcome.TIMEOUT:
        raise ApiError(
            504,
            "GATEWAY_TIMEOUT",
            "The payment gateway did not respond in time. The payment is still processing; poll its status.",
            {"payment_id": payment.id, "status": payment.status, "retry_after_ms": POLL_INTERVAL_MS},
        )
    if outcome == GatewayOutcome.GATEWAY_ERROR:
        raise ApiError(
            502,
            "GATEWAY_ERROR",
            "The payment gateway is temporarily unavailable. The payment was not charged; you can retry.",
            {"payment_id": payment.id, "status": payment.status, "retryable": True},
        )
    return _json(payment, 202 if payment.status == PaymentStatus.PROCESSING else 200)


@router.post(
    "/{payment_id}/cancel",
    response_model=PaymentOut,
    summary="Cancel a PENDING payment",
    responses={**_401, **_404, 409: {"model": ErrorResponse, "description": "Payment is not cancellable"}},
)
def cancel_payment(payment_id: str, parent: Parent = Depends(get_current_parent), db: Session = Depends(get_db)):
    return payment_out(service.cancel_payment(db, parent.id, payment_id))
