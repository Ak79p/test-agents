import math
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_parent
from app.errors import ApiError
from app.models import Parent
from app.schemas import ErrorResponse, PaymentStatusLiteral, TransactionList, payment_summary
from app.services.payments import list_payments, resolve_due_payments

router = APIRouter(prefix="/transactions", tags=["Transactions"])


@router.get(
    "",
    response_model=TransactionList,
    summary="Paginated payment history (newest first)",
    responses={
        401: {"model": ErrorResponse, "description": "Not authenticated"},
        422: {"model": ErrorResponse, "description": "Invalid filter or pagination values"},
    },
)
def list_transactions(
    status: list[PaymentStatusLiteral] | None = Query(
        None, description="Repeatable, e.g. ?status=SUCCEEDED&status=FAILED"
    ),
    student_id: str | None = Query(None),
    fee_id: str | None = Query(None),
    date_from: date | None = Query(None, description="Inclusive, YYYY-MM-DD (UTC)"),
    date_to: date | None = Query(None, description="Inclusive, YYYY-MM-DD (UTC)"),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    parent: Parent = Depends(get_current_parent),
    db: Session = Depends(get_db),
):
    if date_from and date_to and date_from > date_to:
        raise ApiError(
            422,
            "VALIDATION_ERROR",
            "date_from must be on or before date_to.",
            [{"location": "query", "field": "date_from", "message": "Must be on or before date_to."}],
        )
    resolve_due_payments(db, parent.id)
    items, total = list_payments(
        db,
        parent.id,
        statuses=status,
        student_id=student_id,
        fee_id=fee_id,
        date_from=date_from,
        date_to=date_to,
        page=page,
        page_size=page_size,
    )
    return TransactionList(
        items=[payment_summary(p) for p in items],
        page=page,
        page_size=page_size,
        total=total,
        total_pages=math.ceil(total / page_size) if total else 0,
    )
