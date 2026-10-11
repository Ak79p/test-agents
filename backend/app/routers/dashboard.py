from datetime import date, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.deps import get_current_parent
from app.models import Fee, Parent, Payment, PaymentStatus, Student, utcnow
from app.routers.auth import parent_out
from app.schemas import (
    DashboardResponse,
    DashboardSummary,
    ErrorResponse,
    fee_out,
    payment_summary,
    student_summary,
)
from app.services.payments import list_payments, resolve_due_payments

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


@router.get(
    "",
    response_model=DashboardResponse,
    summary="Everything the parent dashboard needs in one call",
    responses={401: {"model": ErrorResponse, "description": "Not authenticated"}},
)
def dashboard(parent: Parent = Depends(get_current_parent), db: Session = Depends(get_db)):
    resolve_due_payments(db, parent.id)
    today = date.today()
    students = list(
        db.scalars(
            select(Student)
            .options(selectinload(Student.fees).selectinload(Fee.student))
            .where(Student.parent_id == parent.id)
            .order_by(Student.first_name)
        )
    )
    open_fees = sorted(
        (fee_out(f, today) for s in students for f in s.fees if f.balance_cents > 0),
        key=lambda f: (f.due_date, f.id),
    )
    paid_recently = db.scalar(
        select(func.coalesce(func.sum(Payment.amount_cents), 0)).where(
            Payment.parent_id == parent.id,
            Payment.status == PaymentStatus.SUCCEEDED,
            Payment.completed_at >= utcnow() - timedelta(days=90),
        )
    )
    recent, _ = list_payments(
        db, parent.id, statuses=None, student_id=None, fee_id=None,
        date_from=None, date_to=None, page=1, page_size=5,
    )
    return DashboardResponse(
        parent=parent_out(parent),
        summary=DashboardSummary(
            total_outstanding_cents=sum(f.balance_cents for f in open_fees),
            overdue_cents=sum(f.balance_cents for f in open_fees if f.is_overdue),
            overdue_count=sum(1 for f in open_fees if f.is_overdue),
            outstanding_count=len(open_fees),
            next_due_date=min((f.due_date for f in open_fees if not f.is_overdue), default=None),
            paid_last_90_days_cents=paid_recently or 0,
        ),
        students=[student_summary(s, today) for s in students],
        upcoming_fees=open_fees[:6],
        recent_transactions=[payment_summary(p) for p in recent],
    )
