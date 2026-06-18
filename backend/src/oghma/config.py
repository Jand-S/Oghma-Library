from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="OGHMA_", env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://oghma:oghma@localhost:5432/oghma"
    storage_root: str = "/srv/oghma"
    user_agent: str = "OghmaLibraryBot/0.1 (+preservacao/biblioteca pessoal)"
    default_rate_limit_seconds: float = 2.0
    request_timeout_seconds: float = 30.0
    publish_upload_concurrency: int = 4
    fts_language: str = "portuguese"
    house_saikai_bearer: str | None = None
    sky_demon_order_cookie: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
