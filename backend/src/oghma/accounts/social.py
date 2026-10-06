"""Rede social da conta: amigos, bloqueios, conversas, indicações de livros e o feed de atividade.

As pessoas se encontram pelo apelido exato e depois se referenciam pelo `public_id`. Quem bloqueia
some para o outro (e vice-versa): o apelido não é encontrado, a amizade acaba e as mensagens param.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import AccountActivity, AccountBlock, AccountFriendship, AccountLibraryEntry, AccountMessage, AccountUser
from .profile import nickname_key, nickname_problem
from .service import ACTIVITY_DAYS, AccountError, aware, bump_social, clean_snapshot, utcnow

MAX_BODY = 2000
NOTE_STATUSES = {"added", "dismissed"}


def iso(value: datetime | None) -> str | None:
    return aware(value).isoformat() if value is not None else None


def card(user: AccountUser) -> dict[str, Any]:
    return {"publicId": user.public_id, "nickname": user.nickname, "avatarId": user.avatar_id, "avatarColor": user.avatar_color}


def pair(a: int, b: int) -> tuple[int, int]:
    return (a, b) if a < b else (b, a)


async def blocked_between(db: AsyncSession, a: int, b: int) -> bool:
    row = (
        await db.execute(
            select(AccountBlock.id).where(
                or_(
                    and_(AccountBlock.user_id == a, AccountBlock.blocked_id == b),
                    and_(AccountBlock.user_id == b, AccountBlock.blocked_id == a),
                )
            ).limit(1)
        )
    ).scalar_one_or_none()
    return row is not None


async def friendship(db: AsyncSession, a: int, b: int) -> AccountFriendship | None:
    low, high = pair(a, b)
    return (
        await db.execute(select(AccountFriendship).where(AccountFriendship.user_low == low, AccountFriendship.user_high == high))
    ).scalar_one_or_none()


async def other_user(db: AsyncSession, me: AccountUser, public_id: str) -> AccountUser:
    """A outra pessoa pelo `public_id`: 404 se não existe ou se é a própria pessoa."""
    other = (await db.execute(select(AccountUser).where(AccountUser.public_id == public_id))).scalar_one_or_none()
    if other is None or other.id == me.id:
        raise AccountError("not_found", 404)
    return other


async def friend(db: AsyncSession, me: AccountUser, public_id: str) -> AccountUser:
    """A outra pessoa, que precisa ser amiga (403 not_friends)."""
    other = await other_user(db, me, public_id)
    link = await friendship(db, me.id, other.id)
    if link is None or link.status != "accepted":
        raise AccountError("not_friends", 403)
    return other


async def friend_ids(db: AsyncSession, me: AccountUser) -> list[int]:
    rows = (
        await db.execute(
            select(AccountFriendship.user_low, AccountFriendship.user_high).where(
                AccountFriendship.status == "accepted",
                or_(AccountFriendship.user_low == me.id, AccountFriendship.user_high == me.id),
            )
        )
    ).all()
    return [low if high == me.id else high for low, high in rows]


async def users_by_id(db: AsyncSession, ids: set[int]) -> dict[int, AccountUser]:
    if not ids:
        return {}
    return {user.id: user for user in (await db.execute(select(AccountUser).where(AccountUser.id.in_(ids)))).scalars()}


# ---------- Busca e amizade ----------


async def find_by_nickname(db: AsyncSession, me: AccountUser, nickname: str) -> AccountUser:
    """Só o apelido exato (sem acento nem caixa): nada de busca parcial para listar as pessoas."""
    nickname = (nickname or "").strip().lstrip("@")
    if nickname_problem(nickname):
        raise AccountError("not_found", 404)
    other = (await db.execute(select(AccountUser).where(AccountUser.nickname_key == nickname_key(nickname)))).scalar_one_or_none()
    if other is None or other.id == me.id or await blocked_between(db, me.id, other.id):
        raise AccountError("not_found", 404)
    return other


async def list_friends(db: AsyncSession, me: AccountUser) -> dict[str, Any]:
    rows = (
        await db.execute(
            select(AccountFriendship)
            .where(or_(AccountFriendship.user_low == me.id, AccountFriendship.user_high == me.id))
            .order_by(AccountFriendship.id.desc())
        )
    ).scalars().all()
    people = await users_by_id(db, {row.user_high if row.user_low == me.id else row.user_low for row in rows})
    friends: list[dict[str, Any]] = []
    incoming: list[dict[str, Any]] = []
    outgoing: list[dict[str, Any]] = []
    for row in rows:
        other = people.get(row.user_high if row.user_low == me.id else row.user_low)
        if other is None:
            continue
        if row.status == "accepted":
            friends.append({**card(other), "since": iso(row.accepted_at or row.created_at)})
        elif row.requester_id == me.id:
            outgoing.append({**card(other), "requestedAt": iso(row.created_at)})
        else:
            incoming.append({**card(other), "requestedAt": iso(row.created_at)})
    friends.sort(key=lambda item: (item["nickname"] or "").lower())
    return {"friends": friends, "incoming": incoming, "outgoing": outgoing}


async def request_friend(db: AsyncSession, me: AccountUser, nickname: str) -> dict[str, str]:
    other = await find_by_nickname(db, me, nickname)
    now = utcnow()
    link = await friendship(db, me.id, other.id)
    if link is not None and link.status == "accepted":
        raise AccountError("already_friends", 409)
    if link is not None and link.requester_id == me.id:
        return {"status": "pending"}  # pedido repetido
    if link is not None:
        # O outro já tinha pedido: os dois querem, vira amizade.
        link.status = "accepted"
        link.accepted_at = now
        await bump_social(db, me.id, other.id)
        await db.flush()
        return {"status": "accepted"}
    low, high = pair(me.id, other.id)
    db.add(AccountFriendship(user_low=low, user_high=high, requester_id=me.id, status="pending", created_at=now))
    await bump_social(db, me.id, other.id)
    await db.flush()
    return {"status": "pending"}


async def accept_friend(db: AsyncSession, me: AccountUser, public_id: str) -> dict[str, str]:
    other = await other_user(db, me, public_id)
    link = await friendship(db, me.id, other.id)
    if link is None:
        raise AccountError("not_found", 404)
    if link.status == "accepted":
        return {"status": "accepted"}
    if link.requester_id == me.id:
        # Quem pediu não aceita o próprio pedido.
        raise AccountError("not_found", 404)
    link.status = "accepted"
    link.accepted_at = utcnow()
    await bump_social(db, me.id, other.id)
    await db.flush()
    return {"status": "accepted"}


async def remove_friend(db: AsyncSession, me: AccountUser, public_id: str) -> None:
    """Recusa um pedido, cancela o seu ou desfaz a amizade."""
    other = await other_user(db, me, public_id)
    link = await friendship(db, me.id, other.id)
    if link is not None:
        await db.delete(link)
        await bump_social(db, me.id, other.id)
        await db.flush()


# ---------- Bloqueios ----------


async def list_blocks(db: AsyncSession, me: AccountUser) -> list[dict[str, Any]]:
    rows = (
        await db.execute(
            select(AccountUser)
            .join(AccountBlock, AccountBlock.blocked_id == AccountUser.id)
            .where(AccountBlock.user_id == me.id)
            .order_by(AccountBlock.id.desc())
        )
    ).scalars().all()
    return [card(user) for user in rows]


async def block(db: AsyncSession, me: AccountUser, public_id: str) -> None:
    other = await other_user(db, me, public_id)
    exists = (
        await db.execute(select(AccountBlock.id).where(AccountBlock.user_id == me.id, AccountBlock.blocked_id == other.id))
    ).scalar_one_or_none()
    if exists is None:
        db.add(AccountBlock(user_id=me.id, blocked_id=other.id, created_at=utcnow()))
    link = await friendship(db, me.id, other.id)
    if link is not None:
        await db.delete(link)
    await bump_social(db, me.id, other.id)
    await db.flush()


async def unblock(db: AsyncSession, me: AccountUser, public_id: str) -> None:
    other = await other_user(db, me, public_id)
    row = (
        await db.execute(select(AccountBlock).where(AccountBlock.user_id == me.id, AccountBlock.blocked_id == other.id))
    ).scalar_one_or_none()
    if row is not None:
        await db.delete(row)
        await bump_social(db, me.id)
        await db.flush()


# ---------- Estante do amigo ----------


async def friend_library(db: AsyncSession, me: AccountUser, public_id: str) -> dict[str, Any]:
    other = await friend(db, me, public_id)
    if other.library_visible is False:
        return {"hidden": True, "entries": []}
    rows = (
        await db.execute(
            select(AccountLibraryEntry)
            .where(AccountLibraryEntry.user_id == other.id, AccountLibraryEntry.deleted_at.is_(None))
            .order_by(AccountLibraryEntry.changed_at.desc())
        )
    ).scalars().all()
    entries = []
    for row in rows:
        data = row.data or {}
        if not data.get("onShelf") or data.get("private"):
            continue
        entries.append(
            {
                "novelId": row.novel_id,
                "favorite": bool(data.get("favorite")),
                "readingStatus": data.get("readingStatus") or "unread",
                "rating": data.get("rating"),
                "addedAt": data.get("addedAt"),
                "changedAt": row.changed_at,
                "snapshot": data.get("snapshot"),
            }
        )
    return {"hidden": False, "entries": entries}


# ---------- Mensagens e indicações ----------


def message_out(message: AccountMessage, people: dict[int, AccountUser]) -> dict[str, Any]:
    return {
        "id": message.id,
        "from": people[message.sender_id].public_id,
        "to": people[message.recipient_id].public_id,
        "body": message.body or "",
        "novelId": message.novel_id,
        "snapshot": message.snapshot,
        "noteStatus": message.note_status,
        "createdAt": iso(message.created_at),
        "readAt": iso(message.read_at),
    }


def between(a: int, b: int) -> Any:
    return or_(
        and_(AccountMessage.sender_id == a, AccountMessage.recipient_id == b),
        and_(AccountMessage.sender_id == b, AccountMessage.recipient_id == a),
    )


async def conversations(db: AsyncSession, me: AccountUser) -> list[dict[str, Any]]:
    """Uma linha por amigo com quem há mensagens: a última e quantas não foram lidas."""
    ids = await friend_ids(db, me)
    if not ids:
        return []
    partner = case((AccountMessage.sender_id == me.id, AccountMessage.recipient_id), else_=AccountMessage.sender_id)
    last_ids = (
        await db.execute(
            select(func.max(AccountMessage.id))
            .where(
                or_(
                    and_(AccountMessage.sender_id == me.id, AccountMessage.recipient_id.in_(ids)),
                    and_(AccountMessage.recipient_id == me.id, AccountMessage.sender_id.in_(ids)),
                )
            )
            .group_by(partner)
        )
    ).scalars().all()
    if not last_ids:
        return []
    lasts = (
        await db.execute(select(AccountMessage).where(AccountMessage.id.in_(last_ids)).order_by(AccountMessage.id.desc()))
    ).scalars().all()
    unread = dict(
        (
            await db.execute(
                select(AccountMessage.sender_id, func.count())
                .where(AccountMessage.recipient_id == me.id, AccountMessage.read_at.is_(None), AccountMessage.sender_id.in_(ids))
                .group_by(AccountMessage.sender_id)
            )
        ).all()
    )
    people = await users_by_id(db, set(ids))
    people[me.id] = me
    out = []
    for message in lasts:
        other_id = message.recipient_id if message.sender_id == me.id else message.sender_id
        out.append({"friend": card(people[other_id]), "last": message_out(message, people), "unread": int(unread.get(other_id, 0))})
    return out


async def messages(db: AsyncSession, me: AccountUser, public_id: str, before: int | None, limit: int) -> dict[str, Any]:
    other = await friend(db, me, public_id)
    query = select(AccountMessage).where(between(me.id, other.id))
    if before:
        query = query.where(AccountMessage.id < before)
    rows = (await db.execute(query.order_by(AccountMessage.id.desc()).limit(limit + 1))).scalars().all()
    more = len(rows) > limit
    people = {me.id: me, other.id: other}
    return {"messages": [message_out(row, people) for row in reversed(rows[:limit])], "more": more}


async def send_message(db: AsyncSession, me: AccountUser, public_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    other = await friend(db, me, public_id)
    body = str(payload.get("body") or "").strip()
    if len(body) > MAX_BODY:
        raise AccountError("message_too_long", 400)
    novel_id = str(payload.get("novelId") or "").strip().removeprefix("novel:") or None
    if novel_id is not None and len(novel_id) > 320:
        raise AccountError("invalid_novel", 400)
    if not body and novel_id is None:
        raise AccountError("empty_message", 400)
    message = AccountMessage(
        sender_id=me.id,
        recipient_id=other.id,
        body=body,
        novel_id=novel_id,
        snapshot=clean_snapshot(novel_id, payload.get("snapshot")) if novel_id else None,
        note_status="new" if novel_id else None,
        created_at=utcnow(),
    )
    db.add(message)
    await bump_social(db, me.id, other.id)
    await db.flush()
    return message_out(message, {me.id: me, other.id: other})


async def mark_read(db: AsyncSession, me: AccountUser, public_id: str) -> dict[str, int]:
    other = await other_user(db, me, public_id)
    rows = (
        await db.execute(
            select(AccountMessage).where(
                AccountMessage.sender_id == other.id, AccountMessage.recipient_id == me.id, AccountMessage.read_at.is_(None)
            )
        )
    ).scalars().all()
    if rows:
        now = utcnow()
        for row in rows:
            row.read_at = now
        # O outro vê o "lido"; meus outros dispositivos zeram o contador.
        await bump_social(db, me.id, other.id)
        await db.flush()
    return {"unread": 0}


async def recommendations(db: AsyncSession, me: AccountUser, only_new: bool, limit: int = 200) -> list[dict[str, Any]]:
    blocked = select(AccountBlock.blocked_id).where(AccountBlock.user_id == me.id).union(
        select(AccountBlock.user_id).where(AccountBlock.blocked_id == me.id)
    )
    query = select(AccountMessage).where(
        AccountMessage.recipient_id == me.id,
        AccountMessage.novel_id.is_not(None),
        AccountMessage.sender_id.not_in(blocked),
    )
    if only_new:
        query = query.where(AccountMessage.note_status == "new")
    rows = (await db.execute(query.order_by(AccountMessage.id.desc()).limit(limit))).scalars().all()
    people = await users_by_id(db, {row.sender_id for row in rows})
    people[me.id] = me
    return [{**message_out(row, people), "fromUser": card(people[row.sender_id])} for row in rows if row.sender_id in people]


async def set_note_status(db: AsyncSession, me: AccountUser, message_id: int, status: str) -> dict[str, Any]:
    if status not in NOTE_STATUSES:
        raise AccountError("invalid_note_status", 400)
    message = await db.get(AccountMessage, message_id)
    # Só quem recebeu muda; para os outros a mensagem "não existe".
    if message is None or message.recipient_id != me.id:
        raise AccountError("not_found", 404)
    if message.novel_id is None:
        raise AccountError("not_a_recommendation", 400)
    if message.note_status != status:
        message.note_status = status
        await bump_social(db, me.id, message.sender_id)
        await db.flush()
    people = await users_by_id(db, {message.sender_id})
    people[me.id] = me
    return message_out(message, people)


# ---------- Feed ----------


async def feed(db: AsyncSession, me: AccountUser, before: int | None, limit: int) -> dict[str, Any]:
    ids = await friend_ids(db, me)
    if not ids:
        return {"items": [], "more": False}
    query = (
        select(AccountActivity, AccountUser)
        .join(AccountUser, AccountUser.id == AccountActivity.user_id)
        .where(
            AccountActivity.user_id.in_(ids),
            AccountUser.activity_visible.is_not(False),
            AccountActivity.at >= utcnow() - timedelta(days=ACTIVITY_DAYS),
        )
    )
    if before:
        query = query.where(AccountActivity.id < before)
    rows = (await db.execute(query.order_by(AccountActivity.id.desc()).limit(limit + 1))).all()
    more = len(rows) > limit
    items = []
    for activity, user in rows[:limit]:
        item: dict[str, Any] = {
            "id": activity.id,
            "user": card(user),
            "kind": activity.kind,
            "novelId": activity.novel_id,
            "snapshot": activity.snapshot,
            "at": iso(activity.at),
        }
        if activity.rating is not None:
            item["rating"] = activity.rating
        items.append(item)
    return {"items": items, "more": more}
