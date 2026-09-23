"""
KMC-GIS-SERVER — Auth Router
Login, token refresh, and current user endpoints.
"""

from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from app.database import get_db
from app.models import User, UserRole
from app.schemas import LoginRequest, TokenResponse, RefreshRequest, UserResponse
from app.auth import (
    verify_password, create_access_token, create_refresh_token,
    decode_token, get_current_user,
    check_login_rate_limit, clear_login_rate_limit,
)
from app.helpers import log_audit

router = APIRouter(prefix="/api/auth", tags=["Auth"])


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)):
    """Authenticate user and return JWT tokens."""
    await check_login_rate_limit(request)

    result = await db.execute(
        select(User).where(
            and_(User.username == body.username, User.is_active == True)
        )
    )
    user = result.scalar_one_or_none()

    if user is None or not verify_password(body.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    await clear_login_rate_limit(request)

    access_token = create_access_token({"sub": str(user.id), "role": user.role.value})
    refresh_token = create_refresh_token({"sub": str(user.id), "role": user.role.value})

    await log_audit(db, user.id, "LOGIN", "User", user.id,
                    ip=request.client.host if request.client else None)

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        role=user.role.value,
        user_id=user.id,
        username=user.username,
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    """Refresh an expired access token using a valid refresh token."""
    payload = decode_token(body.refresh_token)

    if payload.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")

    user_id = payload.get("sub")
    result = await db.execute(select(User).where(User.id == int(user_id)))
    user = result.scalar_one_or_none()

    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

    access_token = create_access_token({"sub": str(user.id), "role": user.role.value})
    new_refresh = create_refresh_token({"sub": str(user.id), "role": user.role.value})

    return TokenResponse(
        access_token=access_token,
        refresh_token=new_refresh,
        role=user.role.value,
        user_id=user.id,
        username=user.username,
    )


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    """Get current authenticated user profile."""
    return current_user
