from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    APP_NAME: str = "金生链——花生全产业链溯源平台"
    APP_VERSION: str = "1.0.0"
    DATABASE_URL: Optional[str] = None
    SECRET_KEY: Optional[str] = None
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    DEBUG: bool = False
    BLOCKCHAIN_ENABLED: bool = True
    IPFS_ENABLED: bool = True
    GANACHE_URL: str = "http://localhost:7545"
    GANACHE_PRIVATE_KEY: Optional[str] = None
    IPFS_GATEWAY: str = "http://localhost:8080"
    IPFS_API_URL: str = "http://localhost:5001/api/v0"
    FRONTEND_URL: str = "http://localhost:5173"

    model_config = {"extra": "ignore", "env_file": ".env"}


settings = Settings()
