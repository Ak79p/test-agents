"""Deterministic demo data.

Due dates are relative to the day the database is seeded, so "overdue" and
"upcoming" fees stay meaningful whenever you reset.

CLI:  python -m app.seed            # create tables + seed if empty
      python -m app.seed --reset    # drop everything and re-seed
"""

import argparse
import logging
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import Base, SessionLocal, engine
from app.models import Fee, Parent, Payment, PaymentEvent, PaymentStatus, Student
from app.security import hash_password

logger = logging.getLogger("app.seed")

DEMO_PASSWORD = "Password123!"


@dataclass
class FeeSpec:
    description: str
    category: str
    term: str
    amount_cents: int
    due_in_days: int
    paid_cents: int = 0


@dataclass
class StudentSpec:
    first_name: str
    last_name: str
    grade: str
    school: str
    fees: list[FeeSpec] = field(default_factory=list)


@dataclass
class ParentSpec:
    id: str
    email: str
    full_name: str
    phone: str
    students: list[StudentSpec] = field(default_factory=list)


def _demo_parents() -> list[ParentSpec]:
    return [
        ParentSpec(
            "par_001", "thandi.mokoena@example.com", "Thandi Mokoena", "+27 82 555 0101",
            [
                StudentSpec("Lerato", "Mokoena", "Grade 5", "Greenwood Primary School", [
                    FeeSpec("Term 2 Tuition", "TUITION", "2026 Term 2", 845000, -80, paid_cents=845000),
                    FeeSpec("Term 3 Transport", "TRANSPORT", "2026 Term 3", 120000, -5),
                    FeeSpec("Term 3 Tuition", "TUITION", "2026 Term 3", 845000, 10),
                    FeeSpec("Science Centre Excursion", "EXCURSION", "2026 Term 3", 65000, 25, paid_cents=30000),
                ]),
                StudentSpec("Kabelo", "Mokoena", "Grade 9", "Riverside College", [
                    FeeSpec("Term 2 Tuition", "TUITION", "2026 Term 2", 1280000, -75, paid_cents=1280000),
                    FeeSpec("Grade 9 Exam Fee", "EXAM", "2026 Term 3", 45000, -12),
                    FeeSpec("Term 3 Tuition", "TUITION", "2026 Term 3", 1280000, 10),
                    FeeSpec("Soccer Academy", "EXTRAMURAL", "2026 Term 3", 95000, 40),
                ]),
            ],
        ),
        ParentSpec(
            "par_002", "john.smith@example.com", "John Smith", "+27 83 555 0202",
            [
                StudentSpec("Emma", "Smith", "Grade 2", "Sunrise Academy", [
                    FeeSpec("Term 2 Tuition", "TUITION", "2026 Term 2", 620000, -70, paid_cents=620000),
                    FeeSpec("Term 3 Tuition", "TUITION", "2026 Term 3", 620000, 5),
                    FeeSpec("Winter Uniform", "UNIFORM", "2026 Term 3", 185000, 20),
                ]),
            ],
        ),
        ParentSpec(
            "par_003", "priya.naidoo@example.com", "Priya Naidoo", "+27 84 555 0303",
            [
                StudentSpec("Arjun", "Naidoo", "Grade 11", "Westridge High School", [
                    FeeSpec("Term 3 Tuition", "TUITION", "2026 Term 3", 1450000, 7),
                    FeeSpec("Boarding Term 3", "BOARDING", "2026 Term 3", 2200000, 7),
                    FeeSpec("Robotics Club", "EXTRAMURAL", "2026 Term 3", 120000, -3),
                    FeeSpec("Matric Prep Exam", "EXAM", "2026 Term 3", 60000, 30),
                ]),
                StudentSpec("Meera", "Naidoo", "Grade 7", "Westridge Prep", [
                    FeeSpec("Term 3 Tuition", "TUITION", "2026 Term 3", 980000, 7),
                    FeeSpec("Bus Transport", "TRANSPORT", "2026 Term 3", 135000, -20),
                    FeeSpec("Camp Excursion", "EXCURSION", "2026 Term 3", 240000, 45),
                ]),
                StudentSpec("Dev", "Naidoo", "Grade R", "Little Acorns Pre-Primary", [
                    FeeSpec("Term 3 Tuition", "TUITION", "2026 Term 3", 540000, 7),
                    FeeSpec("Uniform Pack", "UNIFORM", "2026 Term 3", 95000, 15),
                ]),
            ],
        ),
        ParentSpec(
            "par_004", "sipho.dlamini@example.com", "Sipho Dlamini", "+27 85 555 0404",
            [
                StudentSpec("Nandi", "Dlamini", "Grade 8", "Riverside College", [
                    FeeSpec("Term 2 Tuition", "TUITION", "2026 Term 2", 1150000, -60, paid_cents=1150000),
                    FeeSpec("Term 3 Tuition", "TUITION", "2026 Term 3", 1150000, 12, paid_cents=1150000),
                ]),
            ],
        ),
        # A parent with no linked students (empty-state scenario)
        ParentSpec("par_005", "ayesha.patel@example.com", "Ayesha Patel", "+27 86 555 0505"),
    ]


def _load_test_parents(count: int) -> list[ParentSpec]:
    """Identical accounts with very large balances so load tests can make many small payments."""
    return [
        ParentSpec(
            f"par_lt{i:04d}", f"loadtest{i:03d}@example.com", f"Load Test {i:03d}", f"+27 60 000 {i:04d}",
            [
                StudentSpec("Load", f"Student{i:03d}", "Grade 6", "Performance Primary", [
                    FeeSpec("Term 3 Tuition", "TUITION", "2026 Term 3", 50_000_000, 10),
                    FeeSpec("Term 3 Transport", "TRANSPORT", "2026 Term 3", 10_000_000, 20),
                    FeeSpec("Annual Excursions", "EXCURSION", "2026 Term 3", 5_000_000, 30),
                ]),
            ],
        )
        for i in range(1, count + 1)
    ]


def _at(day: date, hour: int) -> datetime:
    return datetime.combine(day, time(hour, 0), tzinfo=timezone.utc)


def _seed_payment(
    db: Session, seq: int, parent: Parent, fee: Fee, amount: int, status: PaymentStatus, when: datetime,
    failure_code: str | None = None, failure_message: str | None = None,
) -> None:
    pid = f"pay_seed_{seq:04d}"
    done = status in (PaymentStatus.SUCCEEDED, PaymentStatus.FAILED, PaymentStatus.CANCELLED)
    db.add(Payment(
        id=pid, reference=f"SF-SEED-{seq:04d}", parent_id=parent.id, student_id=fee.student_id, fee_id=fee.id,
        amount_cents=amount, currency=fee.currency, payment_method="CARD", status=status,
        idempotency_key=f"seed-{seq:04d}", request_hash="seed",
        card_brand=None if status == PaymentStatus.CANCELLED else "VISA",
        card_last4=None if status == PaymentStatus.CANCELLED else ("0002" if failure_code else "4242"),
        gateway_reference=None if status == PaymentStatus.CANCELLED else f"gw_seed_{seq:04d}",
        failure_code=failure_code, failure_message=failure_message,
        confirm_attempts=0 if status == PaymentStatus.CANCELLED else 1,
        created_at=when, updated_at=when + timedelta(seconds=2),
        completed_at=when + timedelta(seconds=2) if done else None,
    ))
    db.add(PaymentEvent(payment_id=pid, event_type="PAYMENT_CREATED", to_status="PENDING",
                        message="Payment created.", created_at=when))
    if status == PaymentStatus.CANCELLED:
        db.add(PaymentEvent(payment_id=pid, event_type="PAYMENT_CANCELLED", from_status="PENDING",
                            to_status="CANCELLED", message="Payment cancelled by parent.",
                            created_at=when + timedelta(seconds=2)))
        return
    db.add(PaymentEvent(payment_id=pid, event_type="CONFIRMATION_SUBMITTED", from_status="PENDING",
                        to_status="PROCESSING", message="Card submitted to gateway.",
                        created_at=when + timedelta(seconds=1)))
    db.add(PaymentEvent(
        payment_id=pid,
        event_type="PAYMENT_SUCCEEDED" if status == PaymentStatus.SUCCEEDED else "PAYMENT_FAILED",
        from_status="PROCESSING", to_status=status,
        message="Payment approved by gateway." if status == PaymentStatus.SUCCEEDED else failure_message,
        created_at=when + timedelta(seconds=2),
    ))


def seed(db: Session, load_test_users: int = 0, today: date | None = None) -> dict[str, int]:
    today = today or date.today()
    password_hash = hash_password(DEMO_PASSWORD)  # hashed once; every demo account shares the password
    counts = {"parents": 0, "students": 0, "fees": 0, "payments": 0}
    student_seq = fee_seq = pay_seq = 0

    for spec in _demo_parents() + _load_test_parents(load_test_users):
        parent = Parent(id=spec.id, email=spec.email, password_hash=password_hash,
                        full_name=spec.full_name, phone=spec.phone)
        db.add(parent)
        counts["parents"] += 1
        for s in spec.students:
            student_seq += 1
            student = Student(
                id=f"stu_{1000 + student_seq}", parent_id=parent.id,
                student_number=f"SN-{2026}-{student_seq:05d}",
                first_name=s.first_name, last_name=s.last_name, grade=s.grade, school_name=s.school,
            )
            db.add(student)
            counts["students"] += 1
            for f in s.fees:
                fee_seq += 1
                due = today + timedelta(days=f.due_in_days)
                fee = Fee(
                    id=f"fee_{1000 + fee_seq}", student_id=student.id, description=f.description,
                    category=f.category, term=f.term, amount_cents=f.amount_cents,
                    amount_paid_cents=f.paid_cents, currency="ZAR", due_date=due,
                    created_at=_at(today - timedelta(days=100), 6),
                )
                db.add(fee)
                counts["fees"] += 1
                if f.paid_cents:
                    paid_on = min(due - timedelta(days=3), today - timedelta(days=1))
                    if parent.id == "par_001" and f.category == "TUITION":
                        # Show a declined attempt before the successful one
                        pay_seq += 1
                        _seed_payment(db, pay_seq, parent, fee, f.paid_cents, PaymentStatus.FAILED,
                                      _at(paid_on, 7), "CARD_DECLINED",
                                      "The card was declined by the issuing bank.")
                    pay_seq += 1
                    _seed_payment(db, pay_seq, parent, fee, f.paid_cents, PaymentStatus.SUCCEEDED, _at(paid_on, 9))
                if parent.id == "par_001" and f.category == "TRANSPORT":
                    pay_seq += 1
                    _seed_payment(db, pay_seq, parent, fee, f.amount_cents, PaymentStatus.CANCELLED,
                                  _at(today - timedelta(days=8), 18))
        db.flush()

    counts["payments"] = pay_seq
    db.commit()
    return counts


def reset_database(load_test_users: int | None = None) -> dict[str, int]:
    if load_test_users is None:
        load_test_users = get_settings().seed_load_test_users
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        counts = seed(db, load_test_users)
    logger.warning("database reset and re-seeded counts=%s", counts)
    return counts


def init_database(seed_if_empty: bool = True) -> None:
    Base.metadata.create_all(bind=engine)
    if not seed_if_empty:
        return
    with SessionLocal() as db:
        if db.scalar(select(func.count()).select_from(Parent)) == 0:
            counts = seed(db, get_settings().seed_load_test_users)
            logger.info("seeded empty database counts=%s", counts)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    parser = argparse.ArgumentParser(description="Create and seed the School Fees database.")
    parser.add_argument("--reset", action="store_true", help="Drop all tables and re-seed.")
    args = parser.parse_args()
    if args.reset:
        print(reset_database())
    else:
        init_database(seed_if_empty=True)
        print("Database ready.")
