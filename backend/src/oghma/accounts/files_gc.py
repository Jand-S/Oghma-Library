"""Limpeza dos arquivos na conta (`oghma-accounts-files-gc`, uma vez por dia pelo timer do systemd).

Apaga do bucket e da tabela `account_file`:
- os arquivos cujo `import:<sha>` não tem entrada viva na biblioteca há mais de 30 dias
  (tombstone com `deleted_at` antigo, ou entrada ausente desde a confirmação);
- os pendentes não confirmados com mais de 1 dia (o link de envio venceu há muito);
- os objetos de contas que não existem mais (apagar a conta leva as linhas, não o bucket).

Uso: `python -m oghma.accounts.files_gc [--dry-run]` (lê as `OGHMA_ACCOUNTS_*` do ambiente).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import re
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta

from sqlalchemy import and_, literal, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from .files import FileStore, object_key
from .models import AccountFile, AccountLibraryEntry, AccountUser
from .service import utcnow

ORPHAN_AFTER = timedelta(days=30)
PENDING_AFTER = timedelta(days=1)
# Só as chaves deste recurso; qualquer outra coisa no bucket fica como está.
ACCOUNT_KEY_RE = re.compile(r"accounts/(\d+)/files/[^/]+")

log = logging.getLogger(__name__)


@dataclass
class GcResult:
    orphans: int = 0
    pending: int = 0
    gone_accounts: int = 0
    errors: int = 0


async def expired_files(db: AsyncSession, now: datetime) -> list[tuple[AccountFile, str]]:
    """Linhas a apagar, com o motivo (`orphans` ou `pending`, os campos do `GcResult`)."""
    orphan_cutoff = now - ORPHAN_AFTER
    orphan_cutoff_ms = int(orphan_cutoff.timestamp() * 1000)
    entry = AccountLibraryEntry
    query = (
        select(AccountFile, entry.id)
        .outerjoin(entry, and_(entry.user_id == AccountFile.user_id, entry.novel_id == literal("import:") + AccountFile.sha256))
        .where(
            or_(
                and_(AccountFile.confirmed_at.is_(None), AccountFile.created_at < now - PENDING_AFTER),
                and_(
                    AccountFile.confirmed_at.is_not(None),
                    or_(
                        # Entrada ausente: conta desde a confirmação do arquivo.
                        and_(entry.id.is_(None), AccountFile.confirmed_at < orphan_cutoff),
                        # Tombstone: o relógio da biblioteca é em ms (o do app).
                        and_(entry.deleted_at.is_not(None), entry.deleted_at < orphan_cutoff_ms),
                    ),
                ),
            )
        )
        .order_by(AccountFile.id)
    )
    rows = (await db.execute(query)).all()
    return [(row, "pending" if row.confirmed_at is None else "orphans") for row, _ in rows]


async def gone_account_keys(db: AsyncSession, store: FileStore) -> list[str]:
    """Objetos `accounts/<id>/files/…` de contas que já não existem."""
    by_user: dict[int, list[str]] = {}
    for key in store.list_keys("accounts/"):
        match = ACCOUNT_KEY_RE.fullmatch(key)
        if match:
            by_user.setdefault(int(match.group(1)), []).append(key)
    if not by_user:
        return []
    alive = set((await db.execute(select(AccountUser.id).where(AccountUser.id.in_(by_user)))).scalars())
    return [key for user_id, keys in sorted(by_user.items()) if user_id not in alive for key in keys]


async def collect_garbage(db: AsyncSession, store: FileStore, now: datetime | None = None, dry_run: bool = False) -> GcResult:
    """Apaga (ou só conta, com `dry_run`) os arquivos vencidos. Um erro no bucket mantém a linha para a próxima vez."""
    now = now or utcnow()
    result = GcResult()
    for row, reason in await expired_files(db, now):
        if not dry_run:
            try:
                store.delete(object_key(row.user_id, row.sha256, row.kind, row.ext))
            except Exception:
                log.exception("files-gc: falha ao apagar o arquivo %s do usuário %s", row.id, row.user_id)
                result.errors += 1
                continue
            await db.delete(row)
        setattr(result, reason, getattr(result, reason) + 1)
    for key in await gone_account_keys(db, store):
        if not dry_run:
            try:
                store.delete(key)
            except Exception:
                log.exception("files-gc: falha ao apagar %s", key)
                result.errors += 1
                continue
        result.gone_accounts += 1
    await db.flush()
    return result


async def run(dry_run: bool = False) -> GcResult:
    from sqlalchemy.ext.asyncio import create_async_engine

    from .config import get_account_settings
    from .files import S3FileStore

    settings = get_account_settings()
    if not settings.files_bucket:
        log.info("files-gc: OGHMA_ACCOUNTS_FILES_BUCKET vazio, nada a limpar")
        return GcResult()
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    try:
        async with AsyncSession(engine, expire_on_commit=False) as db:
            result = await collect_garbage(db, S3FileStore(settings), dry_run=dry_run)
            if dry_run:
                await db.rollback()
            else:
                await db.commit()
            return result
    finally:
        await engine.dispose()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m oghma.accounts.files_gc", description="Limpa os arquivos órfãos da conta.")
    parser.add_argument("--dry-run", action="store_true", help="só conta o que seria apagado")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    result = asyncio.run(run(dry_run=args.dry_run))
    print(json.dumps({"dryRun": args.dry_run, **asdict(result)}))
    return 1 if result.errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
