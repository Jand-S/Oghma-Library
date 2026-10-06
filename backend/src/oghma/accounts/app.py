"""API pública da conta Oghma (`uvicorn oghma.accounts.app:app`).

Só rotas de conta: nada dos crawlers nem da publicação passa por aqui. O app desktop chama
estas rotas pelo Rust, que guarda o token (ele nunca chega ao JavaScript).
"""
from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Depends, FastAPI, Header, Query, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from . import service, social
from .config import AccountSettings, get_account_settings
from .pages import BRAND_DIR, approval_page
from .mailer import LogMailer, Mailer, ResendMailer
from .models import AccountBase, AccountSession, AccountUser
from .ratelimit import SlidingWindow
from .service import AccountError

log = logging.getLogger("oghma.accounts")


class CodeIn(BaseModel):
    email: str = Field(max_length=320)
    deviceName: str = Field(default="", max_length=120)
    platform: str = Field(default="", max_length=32)


class PollIn(BaseModel):
    email: str = Field(max_length=320)
    loginId: str = Field(max_length=128)


class VerifyIn(BaseModel):
    email: str = Field(max_length=320)
    code: str = Field(max_length=16)
    deviceName: str = Field(default="", max_length=120)
    platform: str = Field(default="", max_length=32)


class ProfileIn(BaseModel):
    nickname: str | None = Field(default=None, max_length=64)
    avatarId: str | None = Field(default=None, max_length=32)
    avatarColor: str | None = Field(default=None, max_length=16)
    libraryVisible: bool | None = None
    activityVisible: bool | None = None


class ChangesIn(BaseModel):
    changes: list[dict[str, Any]]


class FriendRequestIn(BaseModel):
    nickname: str = Field(max_length=64)


class MessageIn(BaseModel):
    # O limite de 2000 caracteres é conferido no serviço (com erro próprio); aqui só barra o absurdo.
    body: str | None = Field(default=None, max_length=20000)
    novelId: str | None = Field(default=None, max_length=400)
    snapshot: dict[str, Any] | None = None


class NoteStatusIn(BaseModel):
    noteStatus: str = Field(max_length=16)


def make_mailer(settings: AccountSettings) -> Mailer:
    if settings.mailer == "resend":
        return ResendMailer(settings.resend_api_key, settings.mail_from, f"{settings.public_url.rstrip('/')}/marca/oghma.png")
    return LogMailer()


# Colunas acrescentadas depois da primeira versão (create_all não altera tabelas existentes).
ADDED_COLUMNS = {
    "account_login_code": {
        "login_id": "VARCHAR(64)",
        "link_hash": "VARCHAR(64)",
        "device_name": "VARCHAR(80)",
        "platform": "VARCHAR(16)",
        "approved_at": "TIMESTAMP WITH TIME ZONE",
    },
    "account_user": {
        "social_seq": "BIGINT NOT NULL DEFAULT 0",
        "library_visible": "BOOLEAN NOT NULL DEFAULT TRUE",
        "activity_visible": "BOOLEAN NOT NULL DEFAULT TRUE",
    },
}


def _add_missing_columns(sync_conn: Any) -> None:
    from sqlalchemy import inspect, text

    inspector = inspect(sync_conn)
    for table, columns in ADDED_COLUMNS.items():
        present = {column["name"] for column in inspector.get_columns(table)}
        for name, kind in columns.items():
            if name not in present:
                sync_conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {kind}"))
        if table == "account_login_code" and "link_hash" not in present:
            sync_conn.execute(text(f"CREATE INDEX IF NOT EXISTS ix_{table}_link_hash ON {table} (link_hash)"))
            sync_conn.execute(text(f"CREATE INDEX IF NOT EXISTS ix_{table}_login_id ON {table} (login_id)"))


async def create_schema(engine: AsyncEngine) -> None:
    async with engine.begin() as conn:
        await conn.run_sync(AccountBase.metadata.create_all)
        await conn.run_sync(_add_missing_columns)


def create_app(
    settings: AccountSettings | None = None,
    mailer: Mailer | None = None,
    engine: AsyncEngine | None = None,
) -> FastAPI:
    settings = settings or get_account_settings()
    if not settings.secret or len(settings.secret) < 32:
        raise RuntimeError("OGHMA_ACCOUNTS_SECRET precisa de pelo menos 32 caracteres")
    engine = engine or create_async_engine(settings.database_url, pool_pre_ping=True)
    sessions = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    mailer = mailer or make_mailer(settings)
    ip_limit = SlidingWindow(settings.ip_requests_per_10min, 600)
    lookup_limit = SlidingWindow(settings.user_lookups_per_10min, 600)
    request_limit = SlidingWindow(settings.friend_requests_per_day, 86400)
    message_limit = SlidingWindow(settings.messages_per_minute, 60)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        await create_schema(engine)
        yield
        await engine.dispose()

    app = FastAPI(title="Oghma Conta", version="1.0.0", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.settings = settings
    app.state.mailer = mailer

    @app.exception_handler(AccountError)
    async def account_error(_: Request, error: AccountError) -> JSONResponse:
        return JSONResponse({"error": error.code, **error.extra}, status_code=error.status)

    async def get_db() -> AsyncIterator[AsyncSession]:
        async with sessions() as db:
            try:
                yield db
                await db.commit()
            except Exception:
                await db.rollback()
                raise

    def client_ip(request: Request) -> str:
        # Atrás do Caddy: o IP real vem no X-Forwarded-For.
        forwarded = request.headers.get("x-forwarded-for", "")
        return forwarded.split(",")[0].strip() or (request.client.host if request.client else "?")

    def limit_ip(request: Request) -> None:
        if not ip_limit.allow(client_ip(request)):
            raise AccountError("rate_limited", 429, retryAfter=600)

    def limit_user(window: SlidingWindow, user: AccountUser) -> None:
        if not window.allow(str(user.id)):
            raise AccountError("rate_limited", 429, retryAfter=int(window.window))

    async def current_session(
        authorization: str = Header(default=""), db: AsyncSession = Depends(get_db)
    ) -> AccountSession:
        token = authorization.removeprefix("Bearer ").strip() if authorization.startswith("Bearer ") else ""
        return await service.session_for_token(db, settings, token)

    async def current_user(session: AccountSession = Depends(current_session), db: AsyncSession = Depends(get_db)) -> AccountUser:
        user = await db.get(AccountUser, session.user_id)
        if user is None:
            raise AccountError("unauthorized", 401)
        return user

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/v1/auth/code", status_code=202)
    async def send_code(body: CodeIn, request: Request, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
        limit_ip(request)
        login = await service.request_code(db, settings, body.email, body.deviceName, body.platform)
        link = f"{settings.public_url.rstrip('/')}/entrar/{login.link_token}"
        # Envia antes de gravar: se o e-mail falhar, o código não fica valendo (nem bloqueia o reenvio).
        try:
            await mailer.send_code(login.email, login.code, link)
        except Exception:
            log.exception("Falha ao enviar o código")
            raise AccountError("mail_failed", 502) from None
        return {
            "email": login.email,
            "loginId": login.login_id,
            "expiresIn": settings.code_ttl_seconds,
            "resendIn": settings.code_resend_seconds,
        }

    @app.post("/v1/auth/poll")
    async def poll(body: PollIn, db: AsyncSession = Depends(get_db)) -> JSONResponse:
        # Sem limite por IP: o app pergunta a cada 2 s, e só quem pediu o código conhece o loginId.
        result = await service.poll_login(db, settings, body.email, body.loginId)
        if result is None:
            return JSONResponse({"status": "pending"}, status_code=202)
        return JSONResponse({"token": result.token, "user": service.user_out(result.user), "created": result.created})

    @app.get("/entrar/{link_token}", response_class=HTMLResponse)
    async def link_page(link_token: str, request: Request, db: AsyncSession = Depends(get_db)) -> HTMLResponse:
        limit_ip(request)
        state, row = await service.link_info(db, settings, link_token)
        return approval_page(state, row, link_token)

    @app.post("/entrar/{link_token}", response_class=HTMLResponse)
    async def link_confirm(link_token: str, request: Request, db: AsyncSession = Depends(get_db)) -> HTMLResponse:
        limit_ip(request)
        state, row = await service.approve_link(db, settings, link_token)
        return approval_page("done" if state == "approved" else state, row, link_token)

    @app.get("/marca/oghma.png")
    async def brand_logo() -> FileResponse:
        return FileResponse(BRAND_DIR / "oghma.png", media_type="image/png", headers={"Cache-Control": "public, max-age=604800"})

    @app.get("/marca/bimi.svg")
    async def brand_bimi() -> FileResponse:
        return FileResponse(BRAND_DIR / "bimi.svg", media_type="image/svg+xml", headers={"Cache-Control": "public, max-age=604800"})

    @app.post("/v1/auth/verify")
    async def verify(body: VerifyIn, request: Request, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
        limit_ip(request)
        try:
            result = await service.verify_code(db, settings, body.email, body.code, body.deviceName, body.platform)
        except AccountError:
            await db.commit()  # guarda a tentativa errada
            raise
        return {"token": result.token, "user": service.user_out(result.user), "created": result.created}

    @app.post("/v1/auth/logout", status_code=204)
    async def logout(session: AccountSession = Depends(current_session), db: AsyncSession = Depends(get_db)) -> None:
        await db.delete(session)

    @app.get("/v1/nicknames/{nickname}/available")
    async def nickname_available(
        nickname: str, request: Request, authorization: str = Header(default=""), db: AsyncSession = Depends(get_db)
    ) -> dict[str, Any]:
        limit_ip(request)
        user = None
        if authorization.startswith("Bearer "):
            try:
                session = await service.session_for_token(db, settings, authorization.removeprefix("Bearer ").strip())
                user = await db.get(AccountUser, session.user_id)
            except AccountError:
                user = None
        return await service.nickname_availability(db, nickname, user)

    @app.get("/v1/me")
    async def me(user: AccountUser = Depends(current_user)) -> dict[str, Any]:
        return service.user_out(user)

    @app.patch("/v1/me")
    async def update_me(body: ProfileIn, user: AccountUser = Depends(current_user), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
        user = await service.update_profile(db, settings, user, body.model_dump(exclude_unset=True))
        return service.user_out(user)

    @app.delete("/v1/me", status_code=204)
    async def delete_me(user: AccountUser = Depends(current_user), db: AsyncSession = Depends(get_db)) -> None:
        await service.delete_account(db, user)

    @app.get("/v1/me/sessions")
    async def my_sessions(
        session: AccountSession = Depends(current_session),
        user: AccountUser = Depends(current_user),
        db: AsyncSession = Depends(get_db),
    ) -> dict[str, Any]:
        return {"sessions": await service.list_sessions(db, user, session)}

    @app.delete("/v1/me/sessions/{session_id}", status_code=204)
    async def end_session(session_id: int, user: AccountUser = Depends(current_user), db: AsyncSession = Depends(get_db)) -> None:
        await db.execute(delete(AccountSession).where(AccountSession.id == session_id, AccountSession.user_id == user.id))

    @app.get("/v1/me/library")
    async def pull(
        since: int = Query(default=0, ge=0), user: AccountUser = Depends(current_user), db: AsyncSession = Depends(get_db)
    ) -> dict[str, Any]:
        return await service.pull_library(db, user, since)

    @app.get("/v1/me/library/wait")
    async def wait_for_changes(
        since: int = Query(default=0, ge=0),
        timeout: int = Query(default=25, ge=1, le=50),
        user: AccountUser = Depends(current_user),
    ) -> dict[str, Any]:
        """Long poll: answers as soon as the library changes after `since` (or after `timeout` s).
        The app keeps one open, so a change on one computer shows on the others within a second."""
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        while True:
            async with sessions() as db:
                cursor = await service.library_cursor(db, user.id)
            if cursor > since or loop.time() >= deadline:
                return {"changed": cursor > since, "cursor": cursor}
            await asyncio.sleep(1)

    @app.post("/v1/me/library/changes")
    async def push(body: ChangesIn, user: AccountUser = Depends(current_user), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
        return await service.push_library(db, settings, user, body.changes)

    @app.get("/v1/me/wait")
    async def wait_for_anything(
        library: int = Query(default=0, ge=0),
        social_since: int = Query(default=0, ge=0, alias="social"),
        timeout: int = Query(default=25, ge=1, le=50),
        user: AccountUser = Depends(current_user),
    ) -> dict[str, Any]:
        """Long poll for the library and the social side together: answers as soon as either cursor
        moves past the one the app has (or after `timeout` s)."""
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        while True:
            async with sessions() as db:
                library_cursor, social_cursor = (
                    await db.execute(select(AccountUser.library_seq, AccountUser.social_seq).where(AccountUser.id == user.id))
                ).one()
            library_cursor, social_cursor = int(library_cursor or 0), int(social_cursor or 0)
            if library_cursor > library or social_cursor > social_since or loop.time() >= deadline:
                return {
                    "library": {"changed": library_cursor > library, "cursor": library_cursor},
                    "social": {"changed": social_cursor > social_since, "cursor": social_cursor},
                }
            await asyncio.sleep(1)

    # ---------- Rede social ----------

    @app.get("/v1/users/{nickname}")
    async def find_user(nickname: str, user: AccountUser = Depends(current_user), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
        limit_user(lookup_limit, user)
        return social.card(await social.find_by_nickname(db, user, nickname))

    @app.get("/v1/friends")
    async def friends(user: AccountUser = Depends(current_user), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
        return await social.list_friends(db, user)

    @app.post("/v1/friends/requests")
    async def request_friend(
        body: FriendRequestIn, user: AccountUser = Depends(current_user), db: AsyncSession = Depends(get_db)
    ) -> dict[str, str]:
        limit_user(request_limit, user)
        return await social.request_friend(db, user, body.nickname)

    @app.post("/v1/friends/{public_id}/accept")
    async def accept_friend(public_id: str, user: AccountUser = Depends(current_user), db: AsyncSession = Depends(get_db)) -> dict[str, str]:
        return await social.accept_friend(db, user, public_id)

    @app.delete("/v1/friends/{public_id}", status_code=204)
    async def remove_friend(public_id: str, user: AccountUser = Depends(current_user), db: AsyncSession = Depends(get_db)) -> None:
        await social.remove_friend(db, user, public_id)

    @app.get("/v1/friends/{public_id}/library")
    async def friend_library(public_id: str, user: AccountUser = Depends(current_user), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
        return await social.friend_library(db, user, public_id)

    @app.get("/v1/blocks")
    async def blocks(user: AccountUser = Depends(current_user), db: AsyncSession = Depends(get_db)) -> list[dict[str, Any]]:
        return await social.list_blocks(db, user)

    @app.post("/v1/blocks/{public_id}", status_code=204)
    async def block(public_id: str, user: AccountUser = Depends(current_user), db: AsyncSession = Depends(get_db)) -> None:
        await social.block(db, user, public_id)

    @app.delete("/v1/blocks/{public_id}", status_code=204)
    async def unblock(public_id: str, user: AccountUser = Depends(current_user), db: AsyncSession = Depends(get_db)) -> None:
        await social.unblock(db, user, public_id)

    @app.get("/v1/conversations")
    async def conversations(user: AccountUser = Depends(current_user), db: AsyncSession = Depends(get_db)) -> list[dict[str, Any]]:
        return await social.conversations(db, user)

    @app.get("/v1/conversations/{public_id}/messages")
    async def conversation_messages(
        public_id: str,
        before: int | None = Query(default=None, ge=1),
        limit: int = Query(default=50, ge=1, le=100),
        user: AccountUser = Depends(current_user),
        db: AsyncSession = Depends(get_db),
    ) -> dict[str, Any]:
        return await social.messages(db, user, public_id, before, limit)

    @app.post("/v1/conversations/{public_id}/messages")
    async def send_message(
        public_id: str, body: MessageIn, user: AccountUser = Depends(current_user), db: AsyncSession = Depends(get_db)
    ) -> dict[str, Any]:
        limit_user(message_limit, user)
        return await social.send_message(db, user, public_id, body.model_dump())

    @app.post("/v1/conversations/{public_id}/read")
    async def mark_read(public_id: str, user: AccountUser = Depends(current_user), db: AsyncSession = Depends(get_db)) -> dict[str, int]:
        return await social.mark_read(db, user, public_id)

    @app.get("/v1/recommendations")
    async def recommendations(
        status: str = Query(default="all", pattern="^(new|all)$"),
        user: AccountUser = Depends(current_user),
        db: AsyncSession = Depends(get_db),
    ) -> list[dict[str, Any]]:
        return await social.recommendations(db, user, status == "new")

    @app.patch("/v1/messages/{message_id}")
    async def update_message(
        message_id: int, body: NoteStatusIn, user: AccountUser = Depends(current_user), db: AsyncSession = Depends(get_db)
    ) -> dict[str, Any]:
        return await social.set_note_status(db, user, message_id, body.noteStatus)

    @app.get("/v1/feed")
    async def feed(
        before: int | None = Query(default=None, ge=1),
        limit: int = Query(default=30, ge=1, le=100),
        user: AccountUser = Depends(current_user),
        db: AsyncSession = Depends(get_db),
    ) -> dict[str, Any]:
        return await social.feed(db, user, before, limit)

    return app


def __getattr__(name: str) -> Any:
    # `uvicorn oghma.accounts.app:app` cria o app com as variáveis de ambiente; importar o módulo
    # nos testes não exige configuração.
    if name == "app":
        return create_app()
    raise AttributeError(name)
