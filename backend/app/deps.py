"""Shared FastAPI dependencies."""

from dataclasses import dataclass

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.errors import ApiError
from app.models import AuthToken, Parent, utcnow
from app.security import hash_token

bearer_scheme = HTTPBearer(auto_error=False, description="Token returned by POST /api/v1/auth/login")

_WWW_AUTH = {"WWW-Authenticate": "Bearer"}


@dataclass
class AuthContext:
    parent: Parent
    token: AuthToken


def get_auth_context(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> AuthContext:
    if credentials is None or not credentials.credentials:
        raise ApiError(401, "UNAUTHORIZED", "Authentication is required.", headers=_WWW_AUTH)

    token = db.scalar(select(AuthToken).where(AuthToken.token_hash == hash_token(credentials.credentials)))
    if token is None or token.revoked_at is not None:
        raise ApiError(401, "INVALID_TOKEN", "The access token is invalid or has been revoked.", headers=_WWW_AUTH)
    if token.expires_at <= utcnow():
        raise ApiError(401, "TOKEN_EXPIRED", "The access token has expired. Please log in again.", headers=_WWW_AUTH)
    return AuthContext(parent=token.parent, token=token)


def get_current_parent(ctx: AuthContext = Depends(get_auth_context)) -> Parent:
    return ctx.parent
