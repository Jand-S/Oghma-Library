"""Arquivos na conta: EPUBs importados e as capas deles, num bucket S3 privado.

O app nunca envia o arquivo por aqui: pede um link assinado (PUT), envia direto ao bucket e
confirma. O servidor confere o tamanho com um HEAD antes de dar o arquivo por guardado.
Chaves: `accounts/<user_id>/files/<sha>.<ext>` (EPUB) e `<sha>.cover.<ext>` (capa).
"""
from __future__ import annotations

import re
from datetime import timedelta
from typing import Any, Protocol

from fastapi import Depends, FastAPI, Query
from pydantic import BaseModel
from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .config import AccountSettings
from .errors import AccountError
from .models import AccountFile, AccountUser
from .service import utcnow

SHA_RE = re.compile(r"[0-9a-f]{64}")
EXTENSIONS = {"epub": {"epub"}, "cover": {"jpg", "png", "webp"}}
CONTENT_TYPES = {"epub": "application/epub+zip", "jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}
# Um envio pendente reserva a cota por 1 hora (depois o link já venceu há muito).
PENDING_HOLD = timedelta(hours=1)
MB = 1024 * 1024


class FileStore(Protocol):
    """O que o serviço usa do bucket (S3 de verdade em produção; moto ou falso nos testes)."""

    def presign_put(self, key: str, content_type: str, expires: int) -> str: ...
    def presign_get(self, key: str, expires: int) -> str: ...
    def size(self, key: str) -> int | None: ...
    def delete(self, key: str) -> None: ...
    def list_keys(self, prefix: str) -> list[str]: ...


class S3FileStore:
    """Bucket S3 (B2/R2) com as chaves `OGHMA_ACCOUNTS_S3_*`. boto3 é importado de forma tardia."""

    def __init__(self, settings: AccountSettings, client: Any = None) -> None:
        self.bucket = settings.files_bucket
        self._settings = settings
        self._client = client

    @property
    def client(self) -> Any:
        if self._client is None:
            import boto3  # import tardio, como no coldstore

            s = self._settings
            self._client = boto3.client(
                "s3",
                endpoint_url=s.s3_endpoint or None,
                region_name=s.s3_region or None,
                aws_access_key_id=s.s3_access_key_id or None,
                aws_secret_access_key=s.s3_secret_access_key or None,
            )
        return self._client

    def presign_put(self, key: str, content_type: str, expires: int) -> str:
        params = {"Bucket": self.bucket, "Key": key, "ContentType": content_type}
        return self.client.generate_presigned_url("put_object", Params=params, ExpiresIn=expires, HttpMethod="PUT")

    def presign_get(self, key: str, expires: int) -> str:
        return self.client.generate_presigned_url("get_object", Params={"Bucket": self.bucket, "Key": key}, ExpiresIn=expires)

    def size(self, key: str) -> int | None:
        from botocore.exceptions import ClientError

        try:
            return int(self.client.head_object(Bucket=self.bucket, Key=key)["ContentLength"])
        except ClientError as error:
            if str(error.response.get("Error", {}).get("Code")) in {"404", "NoSuchKey", "NotFound"}:
                return None
            raise

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)

    def list_keys(self, prefix: str) -> list[str]:
        """Todas as chaves sob `prefix` (a limpeza procura objetos de contas apagadas)."""
        pages = self.client.get_paginator("list_objects_v2").paginate(Bucket=self.bucket, Prefix=prefix)
        return [item["Key"] for page in pages for item in page.get("Contents", [])]


def object_key(user_id: int, sha256: str, kind: str, ext: str) -> str:
    name = f"{sha256}.{ext}" if kind == "epub" else f"{sha256}.cover.{ext}"
    return f"accounts/{user_id}/files/{name}"


def clean_sha(value: Any) -> str:
    if not isinstance(value, str) or not SHA_RE.fullmatch(value):
        raise AccountError("invalid_file")
    return value


def clean_kind(value: Any) -> str:
    if value not in EXTENSIONS:
        raise AccountError("invalid_file")
    return value


def clean_request(body: dict[str, Any]) -> tuple[str, str, str, int]:
    sha256, kind = clean_sha(body.get("sha256")), clean_kind(body.get("kind"))
    ext, size = body.get("ext"), body.get("size")
    if ext not in EXTENSIONS[kind]:
        raise AccountError("invalid_file")
    if not isinstance(size, int) or isinstance(size, bool) or size <= 0:
        raise AccountError("invalid_file")
    return sha256, kind, ext, size


def counted():
    """Arquivos que pesam na cota: confirmados e não apagados, mais os pendentes da última hora."""
    return and_(
        AccountFile.deleted_at.is_(None),
        or_(AccountFile.confirmed_at.is_not(None), AccountFile.created_at > utcnow() - PENDING_HOLD),
    )


async def used_bytes(db: AsyncSession, user_id: int, *exclude: int) -> int:
    query = select(func.coalesce(func.sum(AccountFile.size), 0)).where(AccountFile.user_id == user_id, counted())
    if exclude:
        query = query.where(AccountFile.id.not_in(exclude))
    return int((await db.execute(query)).scalar_one())


async def find(db: AsyncSession, user_id: int, sha256: str, kind: str) -> AccountFile | None:
    query = select(AccountFile).where(AccountFile.user_id == user_id, AccountFile.sha256 == sha256, AccountFile.kind == kind)
    return (await db.execute(query)).scalar_one_or_none()


async def request_upload(
    db: AsyncSession, settings: AccountSettings, store: FileStore, user: AccountUser, body: dict[str, Any]
) -> dict[str, Any]:
    sha256, kind, ext, size = clean_request(body)
    if size > settings.max_file_mb * MB:
        raise AccountError("file_too_large", 413)
    user_id = user.id
    if await reserve(db, settings, store, user_id, sha256, kind, ext, size):
        return {"exists": True}
    content_type = CONTENT_TYPES[ext]
    url = store.presign_put(object_key(user_id, sha256, kind, ext), content_type, settings.file_url_seconds)
    return {
        "exists": False,
        "uploadUrl": url,
        "method": "PUT",
        "headers": {"Content-Type": content_type},
        "expiresIn": settings.file_url_seconds,
    }


async def reserve(
    db: AsyncSession,
    settings: AccountSettings,
    store: FileStore,
    user_id: int,
    sha256: str,
    kind: str,
    ext: str,
    size: int,
    retry: bool = True,
) -> bool:
    """Reserva a cota do envio. Devolve True quando o arquivo já está confirmado (não precisa enviar)."""
    row = await find(db, user_id, sha256, kind)
    if row is not None and row.confirmed_at is not None and row.deleted_at is None:
        return True
    used, quota = await used_bytes(db, user_id, *([row.id] if row else [])), settings.file_quota_mb * MB
    if used + size > quota:
        raise AccountError("quota_exceeded", 409, usedBytes=used, quotaBytes=quota)
    now = utcnow()
    if row is not None:
        if row.ext != ext:
            # A extensão mudou (capa png → jpg): o objeto antigo ficaria órfão no bucket.
            store.delete(object_key(user_id, sha256, kind, row.ext))
        # Novo pedido do mesmo arquivo (pendente vencido ou apagado): recomeça do zero.
        row.ext, row.size, row.created_at, row.confirmed_at, row.deleted_at = ext, size, now, None, None
        await db.flush()
        return False
    try:
        async with db.begin_nested():
            db.add(AccountFile(user_id=user_id, sha256=sha256, kind=kind, ext=ext, size=size, created_at=now))
    except IntegrityError:
        # Dois pedidos ao mesmo tempo do mesmo arquivo: o outro criou a linha. Relê e responde como de costume.
        if not retry:
            raise
        return await reserve(db, settings, store, user_id, sha256, kind, ext, size, retry=False)
    return False


async def confirm_upload(
    db: AsyncSession, settings: AccountSettings, store: FileStore, user: AccountUser, sha256: Any, kind: Any
) -> dict[str, bool]:
    row = await find(db, user.id, clean_sha(sha256), clean_kind(kind))
    if row is None or row.deleted_at is not None:
        raise AccountError("upload_missing", 409)
    if row.confirmed_at is not None:
        return {"ok": True}
    key = object_key(user.id, row.sha256, row.kind, row.ext)
    size = store.size(key)
    if size is None:
        raise AccountError("upload_missing", 409)
    if size != row.size:
        store.delete(key)
        raise AccountError("size_mismatch", 409)
    # A reserva do pedido vale só 1 hora: confere a cota de novo com o que já está confirmado.
    used, quota = await confirmed_bytes(db, row.user_id, row.id), settings.file_quota_mb * MB
    if used + size > quota:
        store.delete(key)
        raise AccountError("quota_exceeded", 409, usedBytes=used, quotaBytes=quota)
    row.confirmed_at = utcnow()
    return {"ok": True}


async def confirmed_bytes(db: AsyncSession, user_id: int, exclude: int) -> int:
    query = select(func.coalesce(func.sum(AccountFile.size), 0)).where(
        AccountFile.user_id == user_id,
        AccountFile.id != exclude,
        AccountFile.confirmed_at.is_not(None),
        AccountFile.deleted_at.is_(None),
    )
    return int((await db.execute(query)).scalar_one())


async def download(
    db: AsyncSession, settings: AccountSettings, store: FileStore, user: AccountUser, sha256: Any, kind: Any
) -> dict[str, Any]:
    row = await find(db, user.id, clean_sha(sha256), clean_kind(kind))
    if row is None or row.confirmed_at is None or row.deleted_at is not None:
        raise AccountError("file_not_found", 404)
    url = store.presign_get(object_key(user.id, row.sha256, row.kind, row.ext), settings.file_url_seconds)
    return {"downloadUrl": url, "size": row.size, "ext": row.ext}


async def usage(db: AsyncSession, settings: AccountSettings, user: AccountUser) -> dict[str, int]:
    """`usedBytes` é a mesma conta da cota; `files`, só os confirmados."""
    files = (
        await db.execute(
            select(func.count()).where(
                AccountFile.user_id == user.id, AccountFile.confirmed_at.is_not(None), AccountFile.deleted_at.is_(None)
            )
        )
    ).scalar_one()
    return {"usedBytes": await used_bytes(db, user.id), "quotaBytes": settings.file_quota_mb * MB, "files": int(files)}


class FileIn(BaseModel):
    # Tipos soltos de propósito: o serviço confere e responde `invalid_file` (não o 422 do FastAPI).
    sha256: Any = None
    kind: Any = None
    ext: Any = None
    size: Any = None


class ConfirmIn(BaseModel):
    kind: Any = None


def register_routes(app: FastAPI, settings: AccountSettings, store: FileStore | None, current_user: Any, get_db: Any) -> None:
    """Rotas `/v1/me/files` (sessão obrigatória). Sem bucket configurado, todas dão 503 `files_disabled`."""

    def enabled() -> FileStore:
        if store is None:
            raise AccountError("files_disabled", 503)
        return store

    @app.post("/v1/me/files")
    async def request_file(body: FileIn, user: AccountUser = Depends(current_user), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
        return await request_upload(db, settings, enabled(), user, body.model_dump())

    @app.get("/v1/me/files/usage")
    async def files_usage(user: AccountUser = Depends(current_user), db: AsyncSession = Depends(get_db)) -> dict[str, int]:
        enabled()
        return await usage(db, settings, user)

    @app.post("/v1/me/files/{sha256}/confirm")
    async def confirm_file(
        sha256: str, body: ConfirmIn, user: AccountUser = Depends(current_user), db: AsyncSession = Depends(get_db)
    ) -> dict[str, bool]:
        return await confirm_upload(db, settings, enabled(), user, sha256, body.kind)

    @app.get("/v1/me/files/{sha256}")
    async def get_file(
        sha256: str,
        # Sem `max_length`: kind inválido (ou longo) dá `invalid_file`, como nas outras rotas, e não o 422.
        kind: str = Query(default="epub"),
        user: AccountUser = Depends(current_user),
        db: AsyncSession = Depends(get_db),
    ) -> dict[str, Any]:
        return await download(db, settings, enabled(), user, sha256, kind)
