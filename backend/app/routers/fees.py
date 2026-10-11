from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.deps import get_current_parent
from app.errors import ApiError
from app.models import Fee, Parent, Payment, PaymentStatus, Student
from app.schemas import (
    ErrorResponse,
    FeeDetail,
    OutstandingFeesResponse,
    fee_out,
    payment_summary,
)
from app.services.payments import resolve_due_payments

router = APIRouter(prefix="/fees", tags=["Fees"])

_UNAUTHORIZED = {401: {"model": ErrorResponse, "description": "Not authenticated"}}


@router.get(
    "/outstanding",
    response_model=OutstandingFeesResponse,
    summary="All unpaid fees across the parent's students",
    responses=_UNAUTHORIZED,
)
def outstanding_fees(
    student_id: str | None = Query(None, description="Only fees for this student"),
    overdue_only: bool = Query(False, description="Only fees past their due date"),
    parent: Parent = Depends(get_current_parent),
    db: Session = Depends(get_db),
):
    resolve_due_payments(db, parent.id)
    query = (
        select(Fee)
        .join(Student)
        .options(selectinload(Fee.student))
        .where(Student.parent_id == parent.id, Fee.amount_paid_cents < Fee.amount_cents)
        .order_by(Fee.due_date, Fee.id)
    )
    if student_id:
        query = query.where(Fee.student_id == student_id)
    items = [fee_out(f) for f in db.scalars(query)]
    if overdue_only:
        items = [f for f in items if f.is_overdue]
    return OutstandingFeesResponse(
        items=items,
        count=len(items),
        total_outstanding_cents=sum(f.balance_cents for f in items),
        overdue_cents=sum(f.balance_cents for f in items if f.is_overdue),
    )


@router.get(
    "/{fee_id}",
    response_model=FeeDetail,
    summary="Fee details including its payments",
    responses={**_UNAUTHORIZED, 404: {"model": ErrorResponse, "description": "Fee not found"}},
)
def get_fee(fee_id: str, parent: Parent = Depends(get_current_parent), db: Session = Depends(get_db)):
    resolve_due_payments(db, parent.id)
    fee = db.scalar(
        select(Fee)
        .join(Student)
        .options(selectinload(Fee.student))
        .where(Fee.id == fee_id, Student.parent_id == parent.id)
    )
    if fee is None:
        raise ApiError(404, "FEE_NOT_FOUND", f"Fee {fee_id} was not found.")
    payments = list(
        db.scalars(
            select(Payment)
            .options(selectinload(Payment.fee).selectinload(Fee.student), selectinload(Payment.student))
            .where(Payment.fee_id == fee.id)
            .order_by(Payment.created_at.desc())
        )
    )
    return FeeDetail(
        **fee_out(fee).model_dump(),
        payments=[payment_summary(p) for p in payments],
        has_payment_in_progress=any(p.status == PaymentStatus.PROCESSING for p in payments),
    )
