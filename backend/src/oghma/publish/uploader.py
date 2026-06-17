"""Upload S3-compativel (R2/B2). boto3 e importado de forma tardia."""
from __future__ import annotations

import os
from pathlib import Path


class DryRunUploader:
    def __init__(self) -> None:
        self.ops: list[str] = []

    def put_file(self, local: str, key: str, content_type: str) -> None:
        self.ops.append(f"PUT {key}  <- {local} ({content_type})")

    def put_bytes(self, data: bytes, key: str, content_type: str) -> None:
        self.ops.append(f"PUT {key}  <- {len(data)} bytes ({content_type})")


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

    def put_file(self, local: str, key: str, content_type: str) -> None:
        with open(local, "rb") as fh:
            self.client.put_object(Bucket=self.bucket, Key=key, Body=fh, ContentType=content_type)

    def put_bytes(self, data: bytes, key: str, content_type: str) -> None:
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type)


def make_uploader(dry_run: bool):
    return DryRunUploader() if dry_run else S3Uploader()
