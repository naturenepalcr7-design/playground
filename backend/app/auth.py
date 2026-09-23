"""
KMC-GIS-SERVER Authentication & Authorization
JWT-based auth with role-based access control.
"""

from datetime import datetime, timedelta, timezone
from typing import Optional, List

from fastapi import Depends, HTTPException, status, Request, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import redis.asyncio as aioredis

from app.config import get_settings
from app.database import get_db
from app.models import User, UserRole

settings = get_settings()

# ---- Password Hashing ----
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=12)

# ---- JWT Bearer Scheme ----
security = HTTPBearer(auto_error=False)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plain-text password against a bcrypt hash."""
    return pwd_context.verify(plain_password, hashed_password)


def hash_password(password: str) -> str:
    """Hash a password with bcrypt (12 rounds)."""
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create a JWT access token."""
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire, "iat": datetime.now(timezone.utc), "type": "access"})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_refresh_token(data: dict) -> str:
    """Create a JWT refresh token with longer expiry."""
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire, "iat": datetime.now(timezone.utc), "type": "refresh"})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_token(token: str) -> dict:
    """Decode and validate a JWT token. Raises HTTPException on failure."""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        return payload
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def get_current_user(
    token_param: Optional[str] = Query(None, alias="token"),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    FastAPI dependency: Extract and validate JWT from Authorization header or ?token= query parameter,
    return the authenticated User ORM object.
    """
    raw_token = None
    if credentials is not None and credentials.credentials:
        raw_token = credentials.credentials
    elif token_param:
        raw_token = token_param

    if raw_token is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = decode_token(raw_token)

    if payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type — use an access token",
        )

    user_id = payload.get("sub")
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing subject claim",
        )

    result = await db.execute(select(User).where(User.id == int(user_id)))
    user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is deactivated",
        )

    return user


def require_role(*allowed_roles: UserRole):
    """
    FastAPI dependency factory: Returns a dependency that checks
    if the current user has one of the allowed roles.

    Usage:
        @app.get("/admin-only", dependencies=[Depends(require_role(UserRole.GisAdmin))])
    """
    async def role_checker(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required roles: {[r.value for r in allowed_roles]}",
            )
        return current_user
    return role_checker


# ---- Redis-based Login Rate Limiting ----

_redis_client: Optional[aioredis.Redis] = None


async def get_redis() -> aioredis.Redis:
    """Get or create the Redis client singleton."""
    global _redis_client
    if _redis_client is None:
        _redis_client = aioredis.from_url(
            settings.REDIS_URL,
            decode_responses=True,
            socket_connect_timeout=5,
        )
    return _redis_client


async def check_login_rate_limit(request: Request):
    """
    Rate limit login attempts: 5 attempts per 15 minutes per IP.
    Uses Redis INCR + TTL pattern.
    """
    try:
        redis_client = await get_redis()
        client_ip = request.client.host if request.client else "unknown"
        key = f"login_attempts:{client_ip}"

        attempts = await redis_client.get(key)
        if attempts and int(attempts) >= 5:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many login attempts. Try again in 15 minutes.",
            )

        pipe = redis_client.pipeline()
        pipe.incr(key)
        pipe.expire(key, 900)  # 15 minutes TTL
        await pipe.execute()
    except aioredis.ConnectionError:
        # If Redis is down, allow the login attempt (fail-open for availability)
        pass


async def clear_login_rate_limit(request: Request):
    """Clear rate limit counter on successful login."""
    try:
        redis_client = await get_redis()
        client_ip = request.client.host if request.client else "unknown"
        await redis_client.delete(f"login_attempts:{client_ip}")
    except aioredis.ConnectionError:
        pass
