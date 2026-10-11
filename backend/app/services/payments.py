"""Payment lifecycle and state machine.

    POST /payments            ->  PENDING
    POST /payments/{id}/cancel    PENDING     -> CANCELLED
    POST /payments/{id}/confirm   PENDING     -> PROCESSING -> SUCCEEDED | FAILED
                                                           -> PENDING     (gateway error, retryable)
                                                           -> PROCESSING  (timeout / async; settles later)

Every transition is a single conditional UPDATE (``WHERE status = <expected>``),
so concurrent requests can never apply the same transition twice.
"""

import hashlib
import json
import logging
import re
import secrets
from datetime import date, datetime, timedelta

from sqlalchemy import and_, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.errors import ApiError
from app.models import Fee, Payment, PaymentEvent, PaymentStatus, Student, utcnow
from app.schemas import CardDetails, CreatePaymentRequest
from app.services import gateway
from app.services.gateway import DECLINE_CODES, FAILURE_MESSAGES, GatewayOutcome, GatewayResult
from app.simulation import simulation

logger = logging.getLogger("app.payments")

IDEMPOTENCY_KEY_RE = re.compile(r"^[A-Za-z0-9_\-:.]{8,255}$")
MIN_PARTIAL_AMOUNT_CENTS = 100


# --------------------------------------------------------------------------- helpers


def _payment_query():
    return select(Payment).options(
        selectinload(Payment.events),
        selectinload(Payment.fee).selectinload(Fee.student),
        selectinload(Payment.student),
    )


def _add_event(
    db: Session,
    payment_id: str,
    event_type: str,
    from_status: str | None,
    to_status: str | None,
    message: str | None = None,
    at: datetime | None = None,
) -> None:
    db.add(
        PaymentEvent(
            payment_id=payment_id,
            event_type=event_type,
            from_status=from_status,
            to_status=to_status,
            message=message,
            created_at=at or utcnow(),
        )
    )


def _transition(db: Session, payment_id: str, expected: PaymentStatus, **values) -> bool:
    """Atomically move a payment out of ``expected``. Returns False if another request got there first."""
    result = db.execute(
        update(Payment)
        .where(Payment.id == payment_id, Payment.status == expected)
        .values(updated_at=utcnow(), **values)
    )
    return result.rowcount == 1


def get_owned_payment(db: Session, parent_id: str, payment_id: str) -> Payment:
    payment = db.scalar(_payment_query().where(Payment.id == payment_id, Payment.parent_id == parent_id))
    if payment is None:
        raise ApiError(404, "PAYMENT_NOT_FOUND", f"Payment {payment_id} was not found.")
    return payment


def _reload(db: Session, payment_id: str) -> Payment:
    db.expire_all()
    return db.scalar(_payment_query().where(Payment.id == payment_id))


def _request_hash(req: CreatePaymentRequest) -> str:
    return hashlib.sha256(json.dumps(req.model_dump(), sort_keys=True).encode()).hexdigest()


def _new_reference() -> str:
    return f"SF-{utcnow():%Y%m%d}-{secrets.token_hex(3).upper()}"


# --------------------------------------------------------------------------- settlement


def _settle_success(db: Session, payment: Payment, gateway_reference: str | None, event_type: str, message: str) -> None:
    """PROCESSING -> SUCCEEDED and credit the fee, in one transaction.

    The fee update is conditional on there still being enough balance, so two
    payments racing for the same fee can never overpay it.
    """
    now = utcnow()
    claimed = _transition(
        db,
        payment.id,
        PaymentStatus.PROCESSING,
        status=PaymentStatus.SUCCEEDED,
        gateway_reference=gateway_reference or payment.gateway_reference,
        failure_code=None,
        failure_message=None,
        pending_outcome=None,
        pending_failure_code=None,
        resolves_at=None,
        completed_at=now,
    )
    if not claimed:
        db.rollback()
        return

    credited = db.execute(
        update(Fee)
        .where(Fee.id == payment.fee_id, Fee.amount_cents - Fee.amount_paid_cents >= payment.amount_cents)
        .values(amount_paid_cents=Fee.amount_paid_cents + payment.amount_cents)
    ).rowcount
    if credited:
        _add_event(db, payment.id, event_type, PaymentStatus.PROCESSING, PaymentStatus.SUCCEEDED, message, now)
    else:
        db.execute(
            update(Payment)
            .where(Payment.id == payment.id)
            .values(
                status=PaymentStatus.FAILED,
                failure_code="BALANCE_CHANGED",
                failure_message=FAILURE_MESSAGES["BALANCE_CHANGED"],
            )
        )
        _add_event(
            db, payment.id, "PAYMENT_FAILED", PaymentStatus.PROCESSING, PaymentStatus.FAILED,
            FAILURE_MESSAGES["BALANCE_CHANGED"], now,
        )
    db.commit()


def _settle_failure(db: Session, payment: Payment, code: str, gateway_reference: str | None = None) -> None:
    now = utcnow()
    if _transition(
        db,
        payment.id,
        PaymentStatus.PROCESSING,
        status=PaymentStatus.FAILED,
        gateway_reference=gateway_reference or payment.gateway_reference,
        failure_code=code,
        failure_message=FAILURE_MESSAGES[code],
        pending_outcome=None,
        pending_failure_code=None,
        resolves_at=None,
        completed_at=now,
    ):
        _add_event(db, payment.id, "PAYMENT_FAILED", PaymentStatus.PROCESSING, PaymentStatus.FAILED,
                   FAILURE_MESSAGES[code], now)
        db.commit()
    else:
        db.rollback()


def resolve_due_payments(db: Session, parent_id: str, payment_id: str | None = None) -> None:
    """Settle PROCESSING payments whose simulated asynchronous outcome is due.

    Called lazily from read endpoints, which keeps the app free of background workers.
    """
    query = select(Payment).where(
        Payment.parent_id == parent_id,
        Payment.status == PaymentStatus.PROCESSING,
        Payment.resolves_at.is_not(None),
        Payment.resolves_at <= utcnow(),
    )
    if payment_id:
        query = query.where(Payment.id == payment_id)
    due = list(db.scalars(query))
    for payment in due:
        if payment.pending_outcome == PaymentStatus.SUCCEEDED:
            _settle_success(db, payment, None, "PAYMENT_SUCCEEDED", "Gateway confirmed the payment asynchronously.")
        else:
            _settle_failure(db, payment, payment.pending_failure_code or "CARD_DECLINED")
        logger.info("payment settled asynchronously payment_id=%s", payment.id)
    if due:
        db.expire_all()


# --------------------------------------------------------------------------- create


def validate_idempotency_key(key: str | None) -> str:
    if not key:
        raise ApiError(
            400, "IDEMPOTENCY_KEY_MISSING", "The Idempotency-Key header is required when creating a payment."
        )
    if not IDEMPOTENCY_KEY_RE.match(key):
        raise ApiError(
            400,
            "IDEMPOTENCY_KEY_INVALID",
            "Idempotency-Key must be 8-255 characters using letters, digits, '-', '_', ':' or '.'.",
        )
    return key


def _replay(existing: Payment, request_hash: str) -> tuple[Payment, bool]:
    if existing.request_hash != request_hash:
        raise ApiError(
            422,
            "IDEMPOTENCY_KEY_REUSED",
            "This Idempotency-Key was already used with a different request body.",
            {"payment_id": existing.id},
        )
    return existing, True


def create_payment(db: Session, parent_id: str, req: CreatePaymentRequest, idempotency_key: str) -> tuple[Payment, bool]:
    """Returns (payment, replayed). ``replayed`` is True when the key was seen before."""
    request_hash = _request_hash(req)
    by_key = _payment_query().where(Payment.parent_id == parent_id, Payment.idempotency_key == idempotency_key)

    existing = db.scalar(by_key)
    if existing:
        return _replay(existing, request_hash)

    fee = db.scalar(
        select(Fee).join(Student).where(Fee.id == req.fee_id, Student.parent_id == parent_id)
    )
    if fee is None:
        raise ApiError(404, "FEE_NOT_FOUND", f"Fee {req.fee_id} was not found.")
    if fee.balance_cents == 0:
        raise ApiError(409, "FEE_ALREADY_PAID", "This fee has already been paid in full.", {"fee_id": fee.id})
    if req.amount_cents > fee.balance_cents:
        raise ApiError(
            422,
            "AMOUNT_EXCEEDS_BALANCE",
            "The payment amount exceeds the outstanding balance.",
            {"balance_cents": fee.balance_cents, "amount_cents": req.amount_cents},
        )
    if req.amount_cents < MIN_PARTIAL_AMOUNT_CENTS and req.amount_cents != fee.balance_cents:
        raise ApiError(
            422,
            "AMOUNT_TOO_SMALL",
            f"Partial payments must be at least {MIN_PARTIAL_AMOUNT_CENTS} cents.",
            {"minimum_cents": MIN_PARTIAL_AMOUNT_CENTS},
        )
    in_flight = db.scalar(
        select(Payment.id).where(Payment.fee_id == fee.id, Payment.status == PaymentStatus.PROCESSING).limit(1)
    )
    if in_flight:
        raise ApiError(
            409,
            "PAYMENT_IN_PROGRESS",
            "Another payment for this fee is currently being processed.",
            {"payment_id": in_flight},
        )

    now = utcnow()
    payment = Payment(
        id=f"pay_{secrets.token_hex(12)}",
        reference=_new_reference(),
        parent_id=parent_id,
        student_id=fee.student_id,
        fee_id=fee.id,
        amount_cents=req.amount_cents,
        currency=fee.currency,
        payment_method=req.payment_method,
        status=PaymentStatus.PENDING,
        idempotency_key=idempotency_key,
        request_hash=request_hash,
        created_at=now,
        updated_at=now,
    )
    db.add(payment)
    _add_event(db, payment.id, "PAYMENT_CREATED", None, PaymentStatus.PENDING, "Payment created.", now)
    try:
        db.commit()
    except IntegrityError:
        # A concurrent request with the same key won the insert; return its payment.
        db.rollback()
        existing = db.scalar(by_key)
        if existing is None:
            raise
        logger.info("idempotency race resolved key=%s payment_id=%s", idempotency_key, existing.id)
        return _replay(existing, request_hash)

    logger.info("payment created payment_id=%s fee_id=%s amount_cents=%s", payment.id, fee.id, req.amount_cents)
    return _reload(db, payment.id), False


# --------------------------------------------------------------------------- confirm


def begin_confirmation(db: Session, parent_id: str, payment_id: str, card: CardDetails) -> GatewayOutcome:
    """PENDING -> PROCESSING. Raises 409 if the payment is not awaiting confirmation."""
    payment = get_owned_payment(db, parent_id, payment_id)
    if payment.status != PaymentStatus.PENDING:
        raise ApiError(
            409,
            "INVALID_PAYMENT_STATE",
            f"Payment cannot be confirmed because it is {payment.status}.",
            {"payment_id": payment.id, "status": payment.status},
        )
    if payment.amount_cents > payment.fee.balance_cents:
        raise ApiError(
            409,
            "AMOUNT_EXCEEDS_BALANCE",
            "The fee balance is now lower than this payment amount. Cancel it and create a new payment.",
            {"balance_cents": payment.fee.balance_cents, "amount_cents": payment.amount_cents},
        )

    now = utcnow()
    claimed = _transition(
        db,
        payment.id,
        PaymentStatus.PENDING,
        status=PaymentStatus.PROCESSING,
        card_brand=gateway.card_brand(card.number),
        card_last4=card.number[-4:],
        confirm_attempts=Payment.confirm_attempts + 1,
        failure_code=None,
        failure_message=None,
    )
    if not claimed:
        db.rollback()
        raise ApiError(
            409,
            "INVALID_PAYMENT_STATE",
            "Payment is already being confirmed by another request.",
            {"payment_id": payment.id},
        )
    _add_event(db, payment.id, "CONFIRMATION_SUBMITTED", PaymentStatus.PENDING, PaymentStatus.PROCESSING,
               f"Card ending {card.number[-4:]} submitted to gateway.", now)
    db.commit()
    return gateway.decide_outcome(card.number)


def complete_confirmation(db: Session, payment_id: str, result: GatewayResult) -> Payment:
    payment = db.get(Payment, payment_id)
    outcome = result.outcome
    now = utcnow()

    if outcome == GatewayOutcome.SUCCESS:
        _settle_success(db, payment, result.gateway_reference, "PAYMENT_SUCCEEDED", "Payment approved by gateway.")
    elif outcome in DECLINE_CODES:
        _settle_failure(db, payment, DECLINE_CODES[outcome], result.gateway_reference)
    elif outcome == GatewayOutcome.GATEWAY_ERROR:
        if _transition(
            db, payment.id, PaymentStatus.PROCESSING,
            status=PaymentStatus.PENDING,
            failure_code="GATEWAY_ERROR",
            failure_message=FAILURE_MESSAGES["GATEWAY_ERROR"],
        ):
            _add_event(db, payment.id, "GATEWAY_ERROR", PaymentStatus.PROCESSING, PaymentStatus.PENDING,
                       "Gateway error; the payment can be confirmed again.", now)
        db.commit()
    else:
        timed_out = outcome == GatewayOutcome.TIMEOUT
        settle_at = now + timedelta(seconds=simulation.config.pending_resolution_seconds)
        payment.gateway_reference = result.gateway_reference
        payment.pending_outcome = (
            PaymentStatus.SUCCEEDED if outcome == GatewayOutcome.PENDING_SUCCESS else PaymentStatus.FAILED
        )
        payment.pending_failure_code = (
            "GATEWAY_TIMEOUT" if timed_out else ("CARD_DECLINED" if outcome == GatewayOutcome.PENDING_FAILURE else None)
        )
        payment.resolves_at = settle_at
        payment.updated_at = now
        _add_event(
            db, payment.id, "GATEWAY_TIMEOUT" if timed_out else "PROCESSING_ASYNC",
            PaymentStatus.PROCESSING, PaymentStatus.PROCESSING,
            "Gateway did not respond in time; outcome pending reconciliation." if timed_out
            else "Gateway is processing the payment asynchronously.",
            now,
        )
        db.commit()

    logger.info("payment confirmation completed payment_id=%s outcome=%s", payment_id, outcome)
    return _reload(db, payment_id)


# --------------------------------------------------------------------------- cancel


def cancel_payment(db: Session, parent_id: str, payment_id: str) -> Payment:
    payment = get_owned_payment(db, parent_id, payment_id)
    now = utcnow()
    if not _transition(db, payment.id, PaymentStatus.PENDING, status=PaymentStatus.CANCELLED, completed_at=now):
        db.rollback()
        current = _reload(db, payment.id)
        raise ApiError(
            409,
            "PAYMENT_NOT_CANCELLABLE",
            f"Only PENDING payments can be cancelled; this payment is {current.status}.",
            {"payment_id": payment.id, "status": current.status},
        )
    _add_event(db, payment.id, "PAYMENT_CANCELLED", PaymentStatus.PENDING, PaymentStatus.CANCELLED,
               "Payment cancelled by parent.", now)
    db.commit()
    logger.info("payment cancelled payment_id=%s", payment.id)
    return _reload(db, payment.id)


# --------------------------------------------------------------------------- history


def list_payments(
    db: Session,
    parent_id: str,
    *,
    statuses: list[str] | None,
    student_id: str | None,
    fee_id: str | None,
    date_from: date | None,
    date_to: date | None,
    page: int,
    page_size: int,
) -> tuple[list[Payment], int]:
    conditions = [Payment.parent_id == parent_id]
    if statuses:
        conditions.append(Payment.status.in_(statuses))
    if student_id:
        conditions.append(Payment.student_id == student_id)
    if fee_id:
        conditions.append(Payment.fee_id == fee_id)
    if date_from:
        conditions.append(Payment.created_at >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        conditions.append(Payment.created_at < datetime.combine(date_to + timedelta(days=1), datetime.min.time()))

    where = and_(*conditions)
    total = db.scalar(select(func.count()).select_from(Payment).where(where)) or 0
    items = list(
        db.scalars(
            _payment_query()
            .where(where)
            .order_by(Payment.created_at.desc(), Payment.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    )
    return items, total
