"""ORM models. Money is stored as integer minor units (cents)."""

from datetime import date, datetime, timezone
from enum import StrEnum

from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    TypeDecorator,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class UTCDateTime(TypeDecorator):
    """Stores naive UTC in SQLite, always returns timezone-aware UTC datetimes."""

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).replace(tzinfo=None)

    def process_result_value(self, value: datetime | None, dialect):
        if value is None:
            return None
        return value.replace(tzinfo=timezone.utc)


class PaymentStatus(StrEnum):
    PENDING = "PENDING"  # created, awaiting confirmation (cancellable)
    PROCESSING = "PROCESSING"  # submitted to gateway, outcome not yet known
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


TERMINAL_STATUSES = {PaymentStatus.SUCCEEDED, PaymentStatus.FAILED, PaymentStatus.CANCELLED}


class FeeCategory(StrEnum):
    TUITION = "TUITION"
    TRANSPORT = "TRANSPORT"
    BOARDING = "BOARDING"
    EXTRAMURAL = "EXTRAMURAL"
    UNIFORM = "UNIFORM"
    EXAM = "EXAM"
    EXCURSION = "EXCURSION"


class Parent(Base):
    __tablename__ = "parents"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(200))
    phone: Mapped[str | None] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    students: Mapped[list["Student"]] = relationship(back_populates="parent", order_by="Student.first_name")


class AuthToken(Base):
    __tablename__ = "auth_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    parent_id: Mapped[str] = mapped_column(ForeignKey("parents.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime)

    parent: Mapped[Parent] = relationship()


class Student(Base):
    __tablename__ = "students"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    parent_id: Mapped[str] = mapped_column(ForeignKey("parents.id", ondelete="CASCADE"), index=True)
    student_number: Mapped[str] = mapped_column(String(40), unique=True)
    first_name: Mapped[str] = mapped_column(String(100))
    last_name: Mapped[str] = mapped_column(String(100))
    grade: Mapped[str] = mapped_column(String(40))
    school_name: Mapped[str] = mapped_column(String(200))

    parent: Mapped[Parent] = relationship(back_populates="students")
    fees: Mapped[list["Fee"]] = relationship(back_populates="student", order_by="Fee.due_date")

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}"


class Fee(Base):
    __tablename__ = "fees"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    description: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(20))
    term: Mapped[str] = mapped_column(String(40))
    amount_cents: Mapped[int] = mapped_column(Integer)
    amount_paid_cents: Mapped[int] = mapped_column(Integer, default=0)
    currency: Mapped[str] = mapped_column(String(3), default="ZAR")
    due_date: Mapped[date] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    student: Mapped[Student] = relationship(back_populates="fees")

    @property
    def balance_cents(self) -> int:
        return max(self.amount_cents - self.amount_paid_cents, 0)


class Payment(Base):
    __tablename__ = "payments"
    __table_args__ = (
        # The database is the final arbiter of idempotency: two concurrent requests
        # with the same key can never both insert a row.
        UniqueConstraint("parent_id", "idempotency_key", name="uq_payment_parent_idempotency_key"),
        Index("ix_payments_parent_created", "parent_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    reference: Mapped[str] = mapped_column(String(40), unique=True)
    parent_id: Mapped[str] = mapped_column(ForeignKey("parents.id", ondelete="CASCADE"))
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), index=True)
    fee_id: Mapped[str] = mapped_column(ForeignKey("fees.id", ondelete="CASCADE"), index=True)
    amount_cents: Mapped[int] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(3))
    payment_method: Mapped[str] = mapped_column(String(20), default="CARD")
    status: Mapped[str] = mapped_column(String(20), default=PaymentStatus.PENDING, index=True)

    idempotency_key: Mapped[str] = mapped_column(String(255))
    request_hash: Mapped[str] = mapped_column(String(64))

    card_brand: Mapped[str | None] = mapped_column(String(20))
    card_last4: Mapped[str | None] = mapped_column(String(4))
    gateway_reference: Mapped[str | None] = mapped_column(String(64))
    failure_code: Mapped[str | None] = mapped_column(String(50))
    failure_message: Mapped[str | None] = mapped_column(String(255))
    confirm_attempts: Mapped[int] = mapped_column(Integer, default=0)

    # Set while PROCESSING for asynchronous outcomes (pending / timeout scenarios)
    pending_outcome: Mapped[str | None] = mapped_column(String(20))
    pending_failure_code: Mapped[str | None] = mapped_column(String(50))
    resolves_at: Mapped[datetime | None] = mapped_column(UTCDateTime)

    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)

    fee: Mapped[Fee] = relationship()
    student: Mapped[Student] = relationship()
    events: Mapped[list["PaymentEvent"]] = relationship(
        back_populates="payment", order_by="PaymentEvent.id", cascade="all, delete-orphan"
    )


class PaymentEvent(Base):
    __tablename__ = "payment_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    payment_id: Mapped[str] = mapped_column(ForeignKey("payments.id", ondelete="CASCADE"), index=True)
    event_type: Mapped[str] = mapped_column(String(40))
    from_status: Mapped[str | None] = mapped_column(String(20))
    to_status: Mapped[str | None] = mapped_column(String(20))
    message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    payment: Mapped[Payment] = relationship(back_populates="events")
