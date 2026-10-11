from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.deps import get_current_parent
from app.errors import ApiError
from app.models import Fee, Parent, Student
from app.schemas import ErrorResponse, FeeOut, StudentSummary, fee_out, fee_status, student_summary

router = APIRouter(prefix="/students", tags=["Students"])

_ERRORS = {
    401: {"model": ErrorResponse, "description": "Not authenticated"},
    404: {"model": ErrorResponse, "description": "Student not found (or not linked to this parent)"},
}


def get_owned_student(db: Session, parent_id: str, student_id: str) -> Student:
    student = db.scalar(
        select(Student)
        .options(selectinload(Student.fees).selectinload(Fee.student))
        .where(Student.id == student_id, Student.parent_id == parent_id)
    )
    if student is None:
        raise ApiError(404, "STUDENT_NOT_FOUND", f"Student {student_id} was not found.")
    return student


@router.get("", response_model=list[StudentSummary], summary="List the parent's students",
            responses={401: _ERRORS[401]})
def list_students(parent: Parent = Depends(get_current_parent), db: Session = Depends(get_db)):
    students = db.scalars(
        select(Student)
        .options(selectinload(Student.fees))
        .where(Student.parent_id == parent.id)
        .order_by(Student.first_name)
    )
    return [student_summary(s) for s in students]


@router.get("/{student_id}", response_model=StudentSummary, summary="Get one student", responses=_ERRORS)
def get_student(student_id: str, parent: Parent = Depends(get_current_parent), db: Session = Depends(get_db)):
    return student_summary(get_owned_student(db, parent.id, student_id))


@router.get(
    "/{student_id}/fees",
    response_model=list[FeeOut],
    summary="List a student's fees",
    responses=_ERRORS,
)
def list_student_fees(
    student_id: str,
    status: Literal["OUTSTANDING", "PARTIALLY_PAID", "PAID", "UNPAID"] | None = Query(
        None, description="Filter by fee status. UNPAID = OUTSTANDING or PARTIALLY_PAID."
    ),
    parent: Parent = Depends(get_current_parent),
    db: Session = Depends(get_db),
):
    fees = get_owned_student(db, parent.id, student_id).fees
    if status == "UNPAID":
        fees = [f for f in fees if f.balance_cents > 0]
    elif status:
        fees = [f for f in fees if fee_status(f) == status]
    return [fee_out(f) for f in fees]
