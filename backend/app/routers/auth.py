import logging
from datetime import timedelta

from fastapi import APIRouter, Depends, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.deps import AuthContext, get_auth_context, get_current_parent
from app.errors import ApiError
from app.models import AuthToken, Parent, utcnow
from app.schemas import ErrorResponse, LoginRequest, LoginResponse, ParentOut
from app.security import generate_token, hash_token, verify_password

logger = logging.getLogger("app.auth")
router = APIRouter(prefix="/auth", tags=["Authentication"])

_UNAUTHORIZED = {401: {"model": ErrorResponse, "description": "Missing, invalid or expired token"}}


def parent_out(parent: Parent) -> ParentOut:
    return ParentOut(id=parent.id, email=parent.email, full_name=parent.full_name, phone=parent.phone)


@router.post(
    "/login",
    response_model=LoginResponse,
    summary="Log in with a seeded parent account",
    responses={
        401: {"model": ErrorResponse, "description": "Invalid email or password"},
        422: {"model": ErrorResponse, "description": "Validation error"},
    },
)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    parent = db.scalar(select(Parent).where(Parent.email == body.email))
    if parent is None or not verify_password(body.password, parent.password_hash):
        logger.info("login failed email=%s", body.email)
        raise ApiError(401, "INVALID_CREDENTIALS", "Invalid email or password.")

    token = generate_token()
    expires_at = utcnow() + timedelta(minutes=get_settings().token_ttl_minutes)
    db.add(AuthToken(token_hash=hash_token(token), parent_id=parent.id, expires_at=expires_at))
    db.commit()
    logger.info("login succeeded parent_id=%s", parent.id)
    return LoginResponse(access_token=token, expires_at=expires_at, parent=parent_out(parent))


@router.post("/logout", status_code=204, summary="Revoke the current access token", responses=_UNAUTHORIZED)
def logout(ctx: AuthContext = Depends(get_auth_context), db: Session = Depends(get_db)):
    token = db.get(AuthToken, ctx.token.id)
    token.revoked_at = utcnow()
    db.commit()
    return Response(status_code=204)


@router.get("/me", response_model=ParentOut, summary="Current parent profile", responses=_UNAUTHORIZED)
def me(parent: Parent = Depends(get_current_parent)):
    return parent_out(parent)
