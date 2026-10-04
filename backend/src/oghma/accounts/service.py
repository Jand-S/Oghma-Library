"""Regras da conta: códigos de login, sessões, perfil e a biblioteca sincronizada."""
from __future__ import annotations

import hashlib
import hmac
import re
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import AccountSettings
from .models import AccountLibraryEntry, AccountLoginCode, AccountSession, AccountUser
from .profile import AVATAR_COLORS, AVATAR_IDS, nickname_key, nickname_problem, nickname_suggestions

EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")
READING_STATUSES = {"unread", "reading", "paused", "completed", "dropped"}
MAX_TAGS = 30
MAX_TAG_LEN = 40
MAX_SNAPSHOT_TEXT = 600
NOVEL_KEY_PREFIX = "novel:"


class AccountError(Exception):
    """Erro com código estável (o app traduz) e status HTTP."""

    def __init__(self, code: str, status: int = 400, **extra: Any) -> None:
        super().__init__(code)
        self.code = code
        self.status = status
        self.extra = extra


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def aware(value: datetime) -> datetime:
    """SQLite devolve datas sem fuso; o Postgres, com. Tudo vira UTC."""
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def digest(secret: str, value: str) -> str:
    return hmac.new(secret.encode(), value.encode(), hashlib.sha256).hexdigest()


def normalize_email(raw: str) -> str:
    email = (raw or "").strip().lower()
    if len(email) > 254 or not EMAIL_RE.match(email):
        raise AccountError("invalid_email")
    return email


# ---------- Login por código ----------


@dataclass
class LoginRequest:
    email: str
    code: str
    # Segredo do app que pediu: ele consulta `poll_login` com isso enquanto espera.
    login_id: str
    # Vai no botão do e-mail.
    link_token: str


async def request_code(
    db: AsyncSession,
    settings: AccountSettings,
    raw_email: str,
    device_name: str = "",
    platform: str = "",
    now: datetime | None = None,
) -> LoginRequest:
    """Cria um código (e o link do botão) para o e-mail."""
    now = now or utcnow()
    email = normalize_email(raw_email)
    recent = (
        await db.execute(
            select(AccountLoginCode)
            .where(AccountLoginCode.email == email, AccountLoginCode.sent_at > now - timedelta(hours=1))
            .order_by(AccountLoginCode.sent_at.desc())
        )
    ).scalars().all()
    if recent and recent[0].used_at is None:
        # Reenvio só depois de um intervalo; um código já usado (login feito) não segura o próximo.
        wait = settings.code_resend_seconds - (now - aware(recent[0].sent_at)).total_seconds()
        if wait > 0:
            raise AccountError("too_soon", 429, retryAfter=int(wait) + 1)
    if len(recent) >= settings.codes_per_hour:
        raise AccountError("too_many_codes", 429, retryAfter=3600)
    code = f"{secrets.randbelow(1_000_000):06d}"
    login_id = secrets.token_urlsafe(24)
    link_token = secrets.token_urlsafe(32)
    # Um código vale por vez: os anteriores deixam de valer.
    for old in recent:
        if old.used_at is None:
            old.used_at = now
    db.add(
        AccountLoginCode(
            email=email,
            code_hash=digest(settings.secret, f"{email}:{code}"),
            attempts=0,
            sent_at=now,
            expires_at=now + timedelta(seconds=settings.code_ttl_seconds),
            login_id=digest(settings.secret, f"login:{login_id}"),
            link_hash=digest(settings.secret, f"link:{link_token}"),
            device_name=(device_name or "")[:80],
            platform=(platform or "")[:16],
        )
    )
    await db.flush()
    return LoginRequest(email=email, code=code, login_id=login_id, link_token=link_token)


def new_public_id() -> str:
    return secrets.token_urlsafe(12)[:16]


@dataclass
class LoginResult:
    token: str
    user: AccountUser
    created: bool


async def verify_code(
    db: AsyncSession,
    settings: AccountSettings,
    raw_email: str,
    code: str,
    device_name: str = "",
    platform: str = "",
    now: datetime | None = None,
) -> LoginResult:
    """Confere o código; cria a conta no primeiro login e abre uma sessão."""
    now = now or utcnow()
    email = normalize_email(raw_email)
    code = re.sub(r"\D", "", code or "")
    pending = (
        await db.execute(
            select(AccountLoginCode)
            .where(AccountLoginCode.email == email, AccountLoginCode.used_at.is_(None))
            .order_by(AccountLoginCode.sent_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if pending is None:
        raise AccountError("invalid_code")
    if aware(pending.expires_at) < now:
        raise AccountError("expired_code")
    if pending.attempts >= settings.code_max_attempts:
        raise AccountError("too_many_attempts", 429)
    if len(code) != 6 or not hmac.compare_digest(pending.code_hash, digest(settings.secret, f"{email}:{code}")):
        pending.attempts += 1
        await db.flush()
        left = settings.code_max_attempts - pending.attempts
        raise AccountError("invalid_code" if left > 0 else "too_many_attempts", 400 if left > 0 else 429, attemptsLeft=max(0, left))
    pending.used_at = now
    return await open_session(db, settings, email, device_name, platform, now)


async def open_session(
    db: AsyncSession, settings: AccountSettings, email: str, device_name: str, platform: str, now: datetime
) -> LoginResult:
    """Cria a conta no primeiro login e abre uma sessão para o dispositivo."""
    user = (await db.execute(select(AccountUser).where(AccountUser.email == email))).scalar_one_or_none()
    created = user is None
    if user is None:
        user = AccountUser(email=email, public_id=new_public_id(), created_at=now, library_seq=0)
        db.add(user)
        await db.flush()
    token = secrets.token_urlsafe(32)
    db.add(
        AccountSession(
            user_id=user.id,
            token_hash=digest(settings.secret, token),
            device_name=(device_name or "")[:80],
            platform=(platform or "")[:16],
            created_at=now,
            last_seen_at=now,
            expires_at=now + timedelta(days=settings.session_days),
        )
    )
    await db.flush()
    return LoginResult(token=token, user=user, created=created)


# ---------- Login pelo botão do e-mail ----------


async def _code_for_link(db: AsyncSession, settings: AccountSettings, link_token: str) -> AccountLoginCode | None:
    if not link_token or len(link_token) > 128:
        return None
    return (
        await db.execute(select(AccountLoginCode).where(AccountLoginCode.link_hash == digest(settings.secret, f"link:{link_token}")))
    ).scalar_one_or_none()


def link_state(row: AccountLoginCode | None, now: datetime) -> str:
    """"pending" (pode aprovar), "approved", "used" (login feito ou código trocado) ou "expired"."""
    if row is None:
        return "expired"
    if row.approved_at is not None:
        return "used" if row.used_at is not None else "approved"
    if row.used_at is not None:
        return "used"
    if aware(row.expires_at) < now:
        return "expired"
    return "pending"


async def link_info(db: AsyncSession, settings: AccountSettings, link_token: str, now: datetime | None = None) -> tuple[str, AccountLoginCode | None]:
    row = await _code_for_link(db, settings, link_token)
    return link_state(row, now or utcnow()), row


async def approve_link(db: AsyncSession, settings: AccountSettings, link_token: str, now: datetime | None = None) -> tuple[str, AccountLoginCode | None]:
    """O leitor confirmou no navegador: o app que está esperando entra no próximo `poll_login`."""
    now = now or utcnow()
    row = await _code_for_link(db, settings, link_token)
    state = link_state(row, now)
    if state == "pending" and row is not None:
        row.approved_at = now
        await db.flush()
        state = "approved"
    return state, row


async def poll_login(
    db: AsyncSession, settings: AccountSettings, raw_email: str, login_id: str, now: datetime | None = None
) -> LoginResult | None:
    """O app pergunta se o link do e-mail já foi aprovado. None = ainda esperando."""
    now = now or utcnow()
    email = normalize_email(raw_email)
    if not login_id or len(login_id) > 128:
        raise AccountError("invalid_login", 400)
    row = (
        await db.execute(
            select(AccountLoginCode).where(
                AccountLoginCode.email == email, AccountLoginCode.login_id == digest(settings.secret, f"login:{login_id}")
            )
        )
    ).scalar_one_or_none()
    state = link_state(row, now)
    if state == "pending":
        return None
    if state != "approved" or row is None:
        raise AccountError("expired_code" if state == "expired" else "invalid_login", 410)
    row.used_at = now
    return await open_session(db, settings, email, row.device_name or "", row.platform or "", now)


async def session_for_token(db: AsyncSession, settings: AccountSettings, token: str, now: datetime | None = None) -> AccountSession:
    now = now or utcnow()
    if not token:
        raise AccountError("unauthorized", 401)
    session = (
        await db.execute(select(AccountSession).where(AccountSession.token_hash == digest(settings.secret, token)))
    ).scalar_one_or_none()
    if session is None or aware(session.expires_at) < now:
        raise AccountError("unauthorized", 401)
    # Uso marcado no máximo uma vez por hora (sem uma escrita por chamada).
    if now - aware(session.last_seen_at) > timedelta(hours=1):
        session.last_seen_at = now
        session.expires_at = now + timedelta(days=settings.session_days)
    return session


# ---------- Perfil ----------


def user_out(user: AccountUser) -> dict[str, Any]:
    return {
        "publicId": user.public_id,
        "email": user.email,
        "nickname": user.nickname,
        "avatarId": user.avatar_id,
        "avatarColor": user.avatar_color,
        "createdAt": aware(user.created_at).isoformat(),
        # Conta criada agora: o app pede apelido e avatar.
        "needsProfile": not user.nickname or not user.avatar_id,
    }


async def nickname_availability(db: AsyncSession, nickname: str, user: AccountUser | None = None) -> dict[str, Any]:
    problem = nickname_problem(nickname)
    if problem:
        return {"available": False, "reason": problem, "suggestions": []}
    key = nickname_key(nickname)
    owner = (await db.execute(select(AccountUser.id).where(AccountUser.nickname_key == key))).scalar_one_or_none()
    if owner is None or (user is not None and owner == user.id):
        return {"available": True, "reason": None, "suggestions": []}
    prefix = key[:12]
    taken = set(
        (await db.execute(select(AccountUser.nickname_key).where(AccountUser.nickname_key.like(f"{prefix}%")))).scalars()
    )
    return {"available": False, "reason": "taken", "suggestions": nickname_suggestions(nickname, taken)}


async def update_profile(
    db: AsyncSession,
    settings: AccountSettings,
    user: AccountUser,
    patch: dict[str, Any],
    now: datetime | None = None,
) -> AccountUser:
    now = now or utcnow()
    if "nickname" in patch and patch["nickname"] is not None:
        nickname = str(patch["nickname"]).strip()
        if nickname != user.nickname:
            availability = await nickname_availability(db, nickname, user)
            if not availability["available"]:
                raise AccountError(f"nickname_{availability['reason']}", 409 if availability["reason"] == "taken" else 400,
                                   suggestions=availability["suggestions"])
            # O primeiro apelido é livre; trocar depois tem intervalo (amigos não se perdem).
            changing_case_only = user.nickname_key == nickname_key(nickname)
            if user.nickname and user.nickname_changed_at and not changing_case_only:
                next_change = aware(user.nickname_changed_at) + timedelta(days=settings.nickname_change_days)
                if next_change > now:
                    raise AccountError("nickname_cooldown", 429, availableAt=next_change.isoformat())
            if not changing_case_only or not user.nickname_changed_at:
                user.nickname_changed_at = now
            user.nickname = nickname
            user.nickname_key = nickname_key(nickname)
    if patch.get("avatarId") is not None:
        if patch["avatarId"] not in AVATAR_IDS:
            raise AccountError("invalid_avatar")
        user.avatar_id = patch["avatarId"]
    if patch.get("avatarColor") is not None:
        if patch["avatarColor"] not in AVATAR_COLORS:
            raise AccountError("invalid_avatar_color")
        user.avatar_color = patch["avatarColor"]
    await db.flush()
    return user


async def list_sessions(db: AsyncSession, user: AccountUser, current: AccountSession) -> list[dict[str, Any]]:
    rows = (
        await db.execute(
            select(AccountSession).where(AccountSession.user_id == user.id).order_by(AccountSession.last_seen_at.desc())
        )
    ).scalars().all()
    return [
        {
            "id": row.id,
            "deviceName": row.device_name,
            "platform": row.platform,
            "createdAt": aware(row.created_at).isoformat(),
            "lastSeenAt": aware(row.last_seen_at).isoformat(),
            "current": row.id == current.id,
        }
        for row in rows
    ]


async def delete_account(db: AsyncSession, user: AccountUser) -> None:
    """Apaga tudo da pessoa (LGPD): biblioteca, sessões, códigos e a conta."""
    await db.execute(delete(AccountLibraryEntry).where(AccountLibraryEntry.user_id == user.id))
    await db.execute(delete(AccountSession).where(AccountSession.user_id == user.id))
    await db.execute(delete(AccountLoginCode).where(AccountLoginCode.email == user.email))
    await db.delete(user)
    await db.flush()


# ---------- Biblioteca ----------


def _clean_text(value: Any, limit: int) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text[:limit] if text else None


def clean_entry(raw: dict[str, Any]) -> tuple[str, dict[str, Any], int, int | None]:
    """Valida uma linha vinda do app. Devolve (novel_id, dados, changed_at, deleted_at)."""
    key = str(raw.get("key") or "")
    if not key.startswith(NOVEL_KEY_PREFIX) or len(key) > 330:
        raise AccountError("invalid_entry")
    novel_id = key[len(NOVEL_KEY_PREFIX):]
    if not novel_id:
        raise AccountError("invalid_entry")
    try:
        changed_at = int(raw.get("changedAt") or 0)
    except (TypeError, ValueError):
        raise AccountError("invalid_entry") from None
    if changed_at <= 0:
        raise AccountError("invalid_entry")
    deleted_at = raw.get("deletedAt")
    deleted_at = int(deleted_at) if isinstance(deleted_at, (int, float)) and deleted_at > 0 else None
    status = raw.get("readingStatus") if raw.get("readingStatus") in READING_STATUSES else "unread"
    rating = raw.get("rating")
    rating = int(rating) if isinstance(rating, (int, float)) and 1 <= int(rating) <= 5 else None
    tags = [str(tag).strip()[:MAX_TAG_LEN] for tag in (raw.get("tags") or []) if str(tag).strip()][:MAX_TAGS]
    snapshot_raw = raw.get("snapshot") if isinstance(raw.get("snapshot"), dict) else None
    snapshot = None
    if snapshot_raw:
        snapshot = {
            "novelId": novel_id,
            "title": _clean_text(snapshot_raw.get("title"), 300) or novel_id,
            "author": _clean_text(snapshot_raw.get("author"), 200),
            "sourceId": _clean_text(snapshot_raw.get("sourceId"), 64),
            "sourceName": _clean_text(snapshot_raw.get("sourceName"), 120),
            "coverUrl": _clean_text(snapshot_raw.get("coverUrl"), 700) if str(snapshot_raw.get("coverUrl") or "").startswith("https://") else None,
            "chapters": int(snapshot_raw["chapters"]) if isinstance(snapshot_raw.get("chapters"), (int, float)) else None,
            "description": _clean_text(snapshot_raw.get("description"), MAX_SNAPSHOT_TEXT),
        }
        snapshot = {k: v for k, v in snapshot.items() if v is not None}
    added_at = raw.get("addedAt")
    data = {
        "favorite": bool(raw.get("favorite")) and deleted_at is None,
        "readingStatus": status if deleted_at is None else "unread",
        "rating": rating if deleted_at is None else None,
        "tags": tags if deleted_at is None else [],
        "onShelf": bool(raw.get("onShelf")) and deleted_at is None,
        "addedAt": int(added_at) if isinstance(added_at, (int, float)) and added_at > 0 else None,
        "snapshot": snapshot,
    }
    return novel_id, data, changed_at, deleted_at


def entry_out(entry: AccountLibraryEntry) -> dict[str, Any]:
    data = entry.data or {}
    return {
        "key": f"{NOVEL_KEY_PREFIX}{entry.novel_id}",
        "favorite": bool(data.get("favorite")),
        "readingStatus": data.get("readingStatus") or "unread",
        "rating": data.get("rating"),
        "tags": data.get("tags") or [],
        # Ocultar é por dispositivo: nunca vem da conta.
        "hidden": False,
        "onShelf": bool(data.get("onShelf")),
        "addedAt": data.get("addedAt"),
        "snapshot": data.get("snapshot"),
        "changedAt": entry.changed_at,
        "deletedAt": entry.deleted_at,
        "seq": entry.seq,
    }


async def pull_library(db: AsyncSession, user: AccountUser, since: int = 0, limit: int = 2000) -> dict[str, Any]:
    rows = (
        await db.execute(
            select(AccountLibraryEntry)
            .where(AccountLibraryEntry.user_id == user.id, AccountLibraryEntry.seq > since)
            .order_by(AccountLibraryEntry.seq)
            .limit(limit + 1)
        )
    ).scalars().all()
    more = len(rows) > limit
    rows = rows[:limit]
    cursor = rows[-1].seq if rows else max(since, 0)
    return {"entries": [entry_out(row) for row in rows], "cursor": cursor, "more": more}


async def push_library(
    db: AsyncSession, settings: AccountSettings, user: AccountUser, changes: list[dict[str, Any]]
) -> dict[str, Any]:
    """Aplica mudanças do app. A mais nova (`changedAt`) vence; as mais velhas voltam em `rejected`
    e o app recebe a versão do servidor no próximo pull."""
    if len(changes) > settings.max_batch:
        raise AccountError("batch_too_large", 413)
    cleaned = [clean_entry(raw) for raw in changes]
    # Trava a linha da pessoa: o cursor cresce sem buracos mesmo com dois dispositivos ao mesmo tempo.
    user = (
        await db.execute(select(AccountUser).where(AccountUser.id == user.id).with_for_update())
    ).scalar_one()
    ids = [novel_id for novel_id, *_ in cleaned]
    existing = {
        row.novel_id: row
        for row in (
            await db.execute(
                select(AccountLibraryEntry).where(AccountLibraryEntry.user_id == user.id, AccountLibraryEntry.novel_id.in_(ids))
            )
        ).scalars()
    }
    new_count = len({novel_id for novel_id in ids if novel_id not in existing})
    if new_count:
        total = (
            await db.execute(select(func.count()).select_from(AccountLibraryEntry).where(AccountLibraryEntry.user_id == user.id))
        ).scalar_one()
        if total + new_count > settings.max_library_entries:
            raise AccountError("library_full", 413)
    accepted: list[dict[str, Any]] = []
    rejected: list[str] = []
    for novel_id, data, changed_at, deleted_at in cleaned:
        key = f"{NOVEL_KEY_PREFIX}{novel_id}"
        row = existing.get(novel_id)
        if row is not None and row.changed_at >= changed_at:
            rejected.append(key)
            continue
        user.library_seq = (user.library_seq or 0) + 1
        if row is None:
            row = AccountLibraryEntry(user_id=user.id, novel_id=novel_id)
            db.add(row)
            existing[novel_id] = row
        elif data.get("snapshot") is None and row.data and row.data.get("snapshot"):
            data = {**data, "snapshot": row.data["snapshot"]}
        if data.get("addedAt") is None and row.data and row.data.get("addedAt"):
            data = {**data, "addedAt": row.data["addedAt"]}
        row.data = data
        row.changed_at = changed_at
        row.deleted_at = deleted_at
        row.seq = user.library_seq
        accepted.append({"key": key, "changedAt": changed_at})
    await db.flush()
    return {"accepted": accepted, "rejected": rejected, "cursor": user.library_seq}
