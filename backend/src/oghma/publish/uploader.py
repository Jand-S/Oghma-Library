"""Upload S3-compativel (R2/B2). boto3 e importado de forma tardia."""
from __future__ import annotations

import os
from pathlib import Path

IMMUTABLE = "public, max-age=31536000, immutable"


def cache_control_for(key: str) -> str | None:
    """Cache-Control de cada objeto publicado.

    index.json muda a cada publicacao (o app precisa ver a versao nova na hora); catalogos,
    bundles, icones e parecidos tem chave versionada (timestamp, .vN, sha) e nunca mudam; capas mantem
    o nome quando sao trocadas, entao ficam no cache so por um dia.
    """
    if key == "index.json":
        return "no-cache"
    if key.startswith(("catalog/", "content/", "sources/", "discovery/")):
        return IMMUTABLE
    if key.startswith("covers/"):
        return "public, max-age=86400"
    return None


class DryRunUploader:
    def __init__(self) -> None:
        self.ops: list[str] = []

    def put_file(self, local: str, key: str, content_type: str) -> None:
        self.ops.append(f"PUT {key}  <- {local} ({content_type}; {cache_control_for(key) or 'sem cache-control'})")

    def put_bytes(self, data: bytes, key: str, content_type: str) -> None:
        self.ops.append(f"PUT {key}  <- {len(data)} bytes ({content_type}; {cache_control_for(key) or 'sem cache-control'})")

    def delete_keys(self, keys: list[str]) -> int:
        self.ops.extend(f"DELETE {k}" for k in keys)
        return len(keys)


class S3Uploader:
    def __init__(self) -> None:
        import boto3  # import tardio

        self.bucket = os.environ["OGHMA_S3_BUCKET"]
        self.client = boto3.client(
            "s3",
            endpoint_url=os.environ["OGHMA_S3_ENDPOINT"],
            region_name=os.environ.get("OGHMA_S3_REGION"),
            aws_access_key_id=os.environ["OGHMA_S3_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["OGHMA_S3_SECRET_ACCESS_KEY"],
        )

    @staticmethod
    def _headers(key: str, content_type: str) -> dict:
        headers = {"ContentType": content_type}
        cache = cache_control_for(key)
        if cache:
            headers["CacheControl"] = cache
        return headers

    def put_file(self, local: str, key: str, content_type: str) -> None:
        with open(local, "rb") as fh:
            self.client.put_object(Bucket=self.bucket, Key=key, Body=fh, **self._headers(key, content_type))

    def put_bytes(self, data: bytes, key: str, content_type: str) -> None:
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data, **self._headers(key, content_type))

    def list_keys(self, prefixes=("content/", "catalog/")) -> dict[str, int]:
        out: dict[str, int] = {}
        paginator = self.client.get_paginator("list_objects_v2")
        for prefix in prefixes:
            for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
                for obj in page.get("Contents", []) or []:
                    out[obj["Key"]] = int(obj.get("Size", 0))
        return out

    def delete_keys(self, keys: list[str]) -> int:
        """Apaga em lotes de 1000 (limite do S3). Devolve quantas chaves foram aceitas."""
        done = 0
        for i in range(0, len(keys), 1000):
            batch = [{"Key": k} for k in keys[i:i + 1000]]
            resp = self.client.delete_objects(Bucket=self.bucket, Delete={"Objects": batch, "Quiet": True})
            errors = resp.get("Errors") or []
            if errors:
                raise RuntimeError(f"B2 recusou {len(errors)} delecoes, ex.: {errors[0]}")
            done += len(batch)
        return done


def make_uploader(dry_run: bool):
    return DryRunUploader() if dry_run else S3Uploader()
