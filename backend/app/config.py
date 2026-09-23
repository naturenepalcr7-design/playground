"""
KMC-GIS-SERVER Configuration
Loads environment variables with validation via pydantic-settings.
"""

from pydantic_settings import BaseSettings
from pydantic import Field
from typing import List, Optional
from functools import lru_cache


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # ---- Database ----
    POSTGRES_DB: str = "kmc_gis"
    POSTGRES_USER: str = "kmc_user"
    POSTGRES_PASSWORD: str = "KmcP0stGr3s!Secure2024"
    POSTGRES_HOST: str = "postgres"
    POSTGRES_PORT: int = 5432

    @property
    def DATABASE_URL(self) -> str:
        return (
            f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    @property
    def DATABASE_URL_SYNC(self) -> str:
        return (
            f"postgresql://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    # ---- Redis ----
    REDIS_URL: str = "redis://redis:6379/0"

    # ---- JWT / Auth ----
    SECRET_KEY: str = "kmc-gis-server-jwt-secret-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24 hours
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # ---- Default Admin ----
    ADMIN_USERNAME: str = "KmcSuperUser2083"
    ADMIN_EMAIL: str = "admin@kmc.gov.np"
    ADMIN_PASSWORD: str = "KmcAdmin@2024!"
    ADMIN_FULL_NAME: str = "KMC GIS Administrator"

    # ---- TileServer ----
    TILESERVER_INTERNAL_URL: str = "http://tileserver:8080"
    TILESERVER_DATA_DIR: str = "/tileserver-data"

    # ---- Upload ----
    MAX_UPLOAD_SIZE_MB: int = 8192
    UPLOAD_DIR: str = "/app/uploads"

    # ---- CORS ----
    CORS_ORIGINS: str = (
        "http://103.69.126.226,http://103.69.126.226:80,http://localhost,http://localhost:80,"
        "http://localhost:8090,http://127.0.0.1:8090"
    )

    @property
    def cors_origin_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    # ---- Application ----
    APP_NAME: str = "KMC-GIS-SERVER"
    DEBUG: bool = False
    PUBLIC_SERVER_URL: Optional[str] = "http://103.69.126.226"

    # ---- Geofence ----
    GEOFENCE_RADIUS_METERS: float = 50.0

    model_config = {"env_file": ".env", "case_sensitive": True}


@lru_cache
def get_settings() -> Settings:
    return Settings()
