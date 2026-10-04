"""Tabelas da conta. Tipos portáveis (Postgres em produção, SQLite nos testes)."""
from datetime import datetime

from sqlalchemy import JSON, BigInteger, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# BIGINT no Postgres, INTEGER no SQLite (para o autoincremento funcionar).
BigId = BigInteger().with_variant(Integer(), "sqlite")


class AccountBase(DeclarativeBase):
    pass


class AccountUser(AccountBase):
    __tablename__ = "account_user"

    id: Mapped[int] = mapped_column(BigId, primary_key=True, autoincrement=True)
    # Id público e estável (a futura rede social referencia a pessoa por ele, não pelo apelido).
    public_id: Mapped[str] = mapped_column(String(24), unique=True)
    email: Mapped[str] = mapped_column(String(320), unique=True)
    nickname: Mapped[str | None] = mapped_column(String(32))
    # Apelido sem acento e em minúsculas: "Jandson" e "jándson" são o mesmo.
    nickname_key: Mapped[str | None] = mapped_column(String(32), unique=True)
    nickname_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    avatar_id: Mapped[str | None] = mapped_column(String(32))
    avatar_color: Mapped[str | None] = mapped_column(String(16))
    # Cursor da biblioteca: cresce a cada escrita aceita.
    library_seq: Mapped[int] = mapped_column(BigInteger, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class AccountLoginCode(AccountBase):
    __tablename__ = "account_login_code"

    id: Mapped[int] = mapped_column(BigId, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(320), index=True)
    code_hash: Mapped[str] = mapped_column(String(64))
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Login pelo botão do e-mail: o app espera com `login_id`; o link traz `link_hash`.
    login_id: Mapped[str | None] = mapped_column(String(64), index=True)
    link_hash: Mapped[str | None] = mapped_column(String(64), index=True)
    device_name: Mapped[str | None] = mapped_column(String(80))
    platform: Mapped[str | None] = mapped_column(String(16))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AccountSession(AccountBase):
    __tablename__ = "account_session"

    id: Mapped[int] = mapped_column(BigId, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("account_user.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    device_name: Mapped[str] = mapped_column(String(80), default="")
    platform: Mapped[str] = mapped_column(String(16), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class AccountLibraryEntry(AccountBase):
    """Um livro da biblioteca do leitor: o que ele marcou (status, nota, favorito…) e um retrato da obra."""

    __tablename__ = "account_library_entry"
    __table_args__ = (
        UniqueConstraint("user_id", "novel_id", name="uq_account_library_user_novel"),
        Index("ix_account_library_user_seq", "user_id", "seq"),
    )

    id: Mapped[int] = mapped_column(BigId, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("account_user.id", ondelete="CASCADE"))
    novel_id: Mapped[str] = mapped_column(String(320))
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    # Relógio do app (ms) da última mudança: a mais nova vence.
    changed_at: Mapped[int] = mapped_column(BigInteger)
    deleted_at: Mapped[int | None] = mapped_column(BigInteger)
    seq: Mapped[int] = mapped_column(BigInteger)
