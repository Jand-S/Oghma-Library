from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class AccountSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="OGHMA_ACCOUNTS_", env_file=".env", extra="ignore")

    # Mesmo Postgres do backend por padrão; os testes usam SQLite.
    database_url: str = "postgresql+asyncpg://oghma:oghma@localhost:5432/oghma"
    # Chave do HMAC dos códigos e tokens (obrigatória em produção).
    secret: str = ""
    # Envio dos códigos: "resend" (produção) ou "log" (desenvolvimento: o código vai para o log).
    mailer: str = "log"
    resend_api_key: str = ""
    mail_from: str = "Oghma <noreply@oghma.dev>"
    # Endereço público deste serviço (link do botão do e-mail e o logo).
    public_url: str = "https://conta.oghma.dev"
    code_ttl_seconds: int = 600
    code_max_attempts: int = 5
    code_resend_seconds: int = 60
    codes_per_hour: int = 6
    # Por IP, nas rotas de login.
    ip_requests_per_10min: int = 30
    session_days: int = 365
    nickname_change_days: int = 30
    max_library_entries: int = 10000
    max_batch: int = 500
    # Rede social, por pessoa.
    friend_requests_per_day: int = 30
    user_lookups_per_10min: int = 60
    messages_per_minute: int = 30
    # Arquivos na conta (EPUBs importados e capas), num bucket S3 privado. Vazio desliga as rotas.
    files_bucket: str = ""
    s3_endpoint: str = ""
    s3_region: str = ""
    s3_access_key_id: str = ""
    s3_secret_access_key: str = ""
    file_quota_mb: int = 2048
    max_file_mb: int = 200
    # Validade dos links de envio e de download.
    file_url_seconds: int = 900


@lru_cache
def get_account_settings() -> AccountSettings:
    return AccountSettings()
