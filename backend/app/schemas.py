"""Pydantic request/response schemas and model -> schema builders."""

import re
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.config import PaymentOutcomeOverride
from app.models import TERMINAL_STATUSES, Fee, Payment, PaymentEvent, PaymentStatus, Student

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

FeeStatus = Literal["OUTSTANDING", "PARTIALLY_PAID", "PAID"]
PaymentStatusLiteral = Literal["PENDING", "PROCESSING", "SUCCEEDED", "FAILED", "CANCELLED"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


# --------------------------------------------------------------------------- errors


class ErrorDetail(BaseModel):
    code: str = Field(examples=["PAYMENT_NOT_FOUND"])
    message: str = Field(examples=["Payment pay_123 was not found."])
    details: Any = None
    request_id: str | None = Field(None, examples=["4f0c2a8e9b1d4e7a"])


class ErrorResponse(BaseModel):
    error: ErrorDetail


# --------------------------------------------------------------------------- health


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    version: str
    environment: str
    database: Literal["ok", "unavailable"]
    timestamp: datetime


# --------------------------------------------------------------------------- auth


class LoginRequest(StrictModel):
    email: str = Field(min_length=3, max_length=255, examples=["thandi.mokoena@example.com"])
    password: str = Field(min_length=1, max_length=128, examples=["Password123!"])

    @field_validator("email")
    @classmethod
    def _valid_email(cls, value: str) -> str:
        if not _EMAIL_RE.match(value):
            raise ValueError("Enter a valid email address.")
        return value.lower()


class ParentOut(BaseModel):
    id: str
    email: str
    full_name: str
    phone: str | None


class LoginResponse(BaseModel):
    access_token: str
    token_type: Literal["Bearer"] = "Bearer"
    expires_at: datetime
    parent: ParentOut


# --------------------------------------------------------------------------- students & fees


class StudentOut(BaseModel):
    id: str
    student_number: str
    first_name: str
    last_name: str
    full_name: str
    grade: str
    school_name: str


class StudentSummary(StudentOut):
    currency: str = "ZAR"
    outstanding_cents: int
    overdue_cents: int
    outstanding_fee_count: int
    next_due_date: date | None


class FeeOut(BaseModel):
    id: str
    student_id: str
    student_name: str
    description: str
    category: str
    term: str
    amount_cents: int
    amount_paid_cents: int
    balance_cents: int
    currency: str
    due_date: date
    status: FeeStatus
    is_overdue: bool
    days_until_due: int = Field(description="Negative when overdue.")


class OutstandingFeesResponse(BaseModel):
    items: list[FeeOut]
    count: int
    total_outstanding_cents: int
    overdue_cents: int
    currency: str = "ZAR"


# --------------------------------------------------------------------------- payments


def luhn_valid(number: str) -> bool:
    total = 0
    for i, ch in enumerate(reversed(number)):
        digit = int(ch)
        if i % 2:
            digit *= 2
            if digit > 9:
                digit -= 9
        total += digit
    return total % 10 == 0


class CreatePaymentRequest(StrictModel):
    fee_id: str = Field(min_length=1, max_length=40, examples=["fee_1001"])
    amount_cents: int = Field(
        gt=0, le=100_000_000, description="Amount in cents. Must not exceed the fee balance.", examples=[485000]
    )
    payment_method: Literal["CARD"] = "CARD"


class CardDetails(StrictModel):
    number: str = Field(examples=["4242424242424242"], description="Simulated card number (spaces allowed).")
    expiry_month: int = Field(ge=1, le=12, examples=[12])
    expiry_year: int = Field(ge=2000, le=2100, examples=[2030])
    cvc: str = Field(examples=["123"])
    holder_name: str = Field(min_length=2, max_length=100, examples=["Thandi Mokoena"])

    @field_validator("number")
    @classmethod
    def _valid_number(cls, value: str) -> str:
        digits = re.sub(r"[\s-]", "", value)
        if not digits.isdigit() or not 12 <= len(digits) <= 19:
            raise ValueError("Card number must contain 12 to 19 digits.")
        if not luhn_valid(digits):
            raise ValueError("Card number is invalid.")
        return digits

    @field_validator("cvc")
    @classmethod
    def _valid_cvc(cls, value: str) -> str:
        if not re.fullmatch(r"\d{3,4}", value):
            raise ValueError("CVC must be 3 or 4 digits.")
        return value

    @model_validator(mode="after")
    def _not_expired(self) -> "CardDetails":
        today = date.today()
        if (self.expiry_year, self.expiry_month) < (today.year, today.month):
            raise ValueError("Card has expired.")
        return self


class ConfirmPaymentRequest(StrictModel):
    card: CardDetails


class PaymentEventOut(BaseModel):
    type: str
    from_status: str | None
    to_status: str | None
    message: str | None
    created_at: datetime


class PaymentSummary(BaseModel):
    id: str
    reference: str
    status: PaymentStatusLiteral
    amount_cents: int
    currency: str
    fee_id: str
    fee_description: str
    student_id: str
    student_name: str
    payment_method: str
    card_brand: str | None
    card_last4: str | None
    failure_code: str | None
    failure_message: str | None
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None


class PaymentOut(PaymentSummary):
    idempotency_key: str
    gateway_reference: str | None
    confirm_attempts: int
    is_final: bool
    is_cancellable: bool
    events: list[PaymentEventOut]


class PaymentStatusOut(BaseModel):
    id: str
    reference: str
    status: PaymentStatusLiteral
    is_final: bool
    failure_code: str | None
    failure_message: str | None
    updated_at: datetime
    retry_after_ms: int | None = Field(None, description="Suggested polling interval while PROCESSING.")


class FeeDetail(FeeOut):
    payments: list[PaymentSummary]
    has_payment_in_progress: bool


class TransactionList(BaseModel):
    items: list[PaymentSummary]
    page: int
    page_size: int
    total: int
    total_pages: int


# --------------------------------------------------------------------------- dashboard


class DashboardSummary(BaseModel):
    currency: str = "ZAR"
    total_outstanding_cents: int
    overdue_cents: int
    overdue_count: int
    outstanding_count: int
    next_due_date: date | None
    paid_last_90_days_cents: int


class DashboardResponse(BaseModel):
    parent: ParentOut
    summary: DashboardSummary
    students: list[StudentSummary]
    upcoming_fees: list[FeeOut]
    recent_transactions: list[PaymentSummary]


# --------------------------------------------------------------------------- dev


class ResetResponse(BaseModel):
    status: Literal["ok"]
    message: str
    counts: dict[str, int]


class SimulationUpdate(StrictModel):
    response_delay_ms: int | None = Field(None, ge=0)
    response_jitter_ms: int | None = Field(None, ge=0)
    endpoint_delays_ms: dict[str, int] | None = None
    allow_delay_header: bool | None = None
    max_delay_ms: int | None = Field(None, ge=0)
    gateway_latency_ms: int | None = Field(None, ge=0)
    gateway_timeout_ms: int | None = Field(None, ge=0)
    pending_resolution_seconds: int | None = Field(None, ge=0)
    payment_outcome_override: PaymentOutcomeOverride | None = None
    gateway_error_every_n: int | None = Field(None, ge=0)
    random_seed: int | None = None


# --------------------------------------------------------------------------- builders


def student_out(student: Student) -> StudentOut:
    return StudentOut(
        id=student.id,
        student_number=student.student_number,
        first_name=student.first_name,
        last_name=student.last_name,
        full_name=student.full_name,
        grade=student.grade,
        school_name=student.school_name,
    )


def fee_status(fee: Fee) -> FeeStatus:
    if fee.balance_cents == 0:
        return "PAID"
    return "PARTIALLY_PAID" if fee.amount_paid_cents > 0 else "OUTSTANDING"


def fee_out(fee: Fee, today: date | None = None) -> FeeOut:
    today = today or date.today()
    status = fee_status(fee)
    return FeeOut(
        id=fee.id,
        student_id=fee.student_id,
        student_name=fee.student.full_name,
        description=fee.description,
        category=fee.category,
        term=fee.term,
        amount_cents=fee.amount_cents,
        amount_paid_cents=fee.amount_paid_cents,
        balance_cents=fee.balance_cents,
        currency=fee.currency,
        due_date=fee.due_date,
        status=status,
        is_overdue=status != "PAID" and fee.due_date < today,
        days_until_due=(fee.due_date - today).days,
    )


def student_summary(student: Student, today: date | None = None) -> StudentSummary:
    today = today or date.today()
    open_fees = [f for f in student.fees if f.balance_cents > 0]
    return StudentSummary(
        **student_out(student).model_dump(),
        outstanding_cents=sum(f.balance_cents for f in open_fees),
        overdue_cents=sum(f.balance_cents for f in open_fees if f.due_date < today),
        outstanding_fee_count=len(open_fees),
        next_due_date=min((f.due_date for f in open_fees), default=None),
    )


def payment_summary(payment: Payment) -> PaymentSummary:
    return PaymentSummary(
        id=payment.id,
        reference=payment.reference,
        status=payment.status,
        amount_cents=payment.amount_cents,
        currency=payment.currency,
        fee_id=payment.fee_id,
        fee_description=payment.fee.description,
        student_id=payment.student_id,
        student_name=payment.student.full_name,
        payment_method=payment.payment_method,
        card_brand=payment.card_brand,
        card_last4=payment.card_last4,
        failure_code=payment.failure_code,
        failure_message=payment.failure_message,
        created_at=payment.created_at,
        updated_at=payment.updated_at,
        completed_at=payment.completed_at,
    )


def _event_out(event: PaymentEvent) -> PaymentEventOut:
    return PaymentEventOut(
        type=event.event_type,
        from_status=event.from_status,
        to_status=event.to_status,
        message=event.message,
        created_at=event.created_at,
    )


def payment_out(payment: Payment) -> PaymentOut:
    return PaymentOut(
        **payment_summary(payment).model_dump(),
        idempotency_key=payment.idempotency_key,
        gateway_reference=payment.gateway_reference,
        confirm_attempts=payment.confirm_attempts,
        is_final=PaymentStatus(payment.status) in TERMINAL_STATUSES,
        is_cancellable=payment.status == PaymentStatus.PENDING,
        events=[_event_out(e) for e in payment.events],
    )
