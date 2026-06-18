"""Download and localize inline chapter images."""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from html import unescape
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import httpx

from .. import storage

_IMG_TAG_RE = re.compile(r'<img\b[^>]*\bsrc="([^"]+)"[^>]*>', re.I)
_IMG_SRC_RE = re.compile(r'(\bsrc=")([^"]+)(")', re.I)
_LOCAL_SRC_PREFIX = "../assets/"
_MAX_IMAGE_BYTES = 25 * 1024 * 1024


@dataclass
class LocalizeResult:
    html: str
    references: int = 0
    downloaded: int = 0
    reused: int = 0
    removed: int = 0
    failed: int = 0


def external_image_urls(html: str, page_url: str = "") -> list[str]:
    urls: list[str] = []
    for match in _IMG_TAG_RE.finditer(html):
        src = unescape(match.group(1)).strip()
        if src.startswith(_LOCAL_SRC_PREFIX):
            continue
        absolute = urljoin(page_url, src)
        parts = urlsplit(absolute)
        if parts.scheme in {"http", "https"}:
            urls.append(absolute)
    return urls


def _image_extension(url: str, content_type: str | None, data: bytes) -> str | None:
    content_type = (content_type or "").split(";", 1)[0].strip().lower()
    by_type = {
        "image/jpeg": "jpg",
        "image/jpg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/gif": "gif",
        "image/avif": "avif",
    }
    if content_type in by_type:
        return by_type[content_type]
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "webp"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "gif"
    suffix = Path(urlsplit(url).path).suffix.lower().lstrip(".")
    return "jpg" if suffix == "jpeg" else suffix if suffix in {"jpg", "png", "webp", "gif", "avif"} else None


def _asset_key(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()[:24]


def _existing_asset(source: str, slug: str, key: str) -> Path | None:
    matches = list(storage.asset_dir(source, slug).glob(f"{key}.*"))
    return matches[0] if matches else None


async def localize_chapter_images(
    fetcher,
    html: str,
    page_url: str,
    source: str,
    slug: str,
    *,
    remove_unavailable: bool = False,
) -> LocalizeResult:
    urls = external_image_urls(html, page_url)
    if not urls:
        return LocalizeResult(html=html)

    replacements: dict[str, str | None] = {}
    result = LocalizeResult(html=html, references=len(urls))
    for url in dict.fromkeys(urls):
        parts = urlsplit(url)
        if not parts.hostname or parts.hostname == ":0":
            replacements[url] = None
            result.removed += 1
            continue
        key = _asset_key(url)
        existing = _existing_asset(source, slug, key)
        if existing is not None:
            replacements[url] = f"{_LOCAL_SRC_PREFIX}{existing.name}"
            result.reused += 1
            continue
        try:
            raw = await fetcher.get(url)
            if not raw.html or len(raw.html) > _MAX_IMAGE_BYTES:
                raise ValueError("invalid image size")
            ext = _image_extension(raw.url, raw.content_type, raw.html)
            if ext is None:
                raise ValueError(f"unsupported image content-type: {raw.content_type}")
            path = storage.save_asset(source, slug, f"{key}.{ext}", raw.html)
        except httpx.HTTPStatusError as exc:
            if remove_unavailable or exc.response.status_code in {404, 410}:
                replacements[url] = None
                result.removed += 1
            else:
                result.failed += 1
            continue
        except Exception:  # transient in crawls; definitive in the explicit repair pass
            if remove_unavailable:
                replacements[url] = None
                result.removed += 1
            else:
                result.failed += 1
            continue
        replacements[url] = f"{_LOCAL_SRC_PREFIX}{Path(path).name}"
        result.downloaded += 1

    def replace(match: re.Match[str]) -> str:
        tag = match.group(0)
        src = unescape(match.group(1)).strip()
        if src.startswith(_LOCAL_SRC_PREFIX):
            return tag
        absolute = urljoin(page_url, src)
        if absolute not in replacements:
            return tag
        replacement = replacements[absolute]
        if replacement is None:
            return ""
        return _IMG_SRC_RE.sub(lambda src_match: f"{src_match.group(1)}{replacement}{src_match.group(3)}", tag, count=1)

    result.html = _IMG_TAG_RE.sub(replace, html)
    return result
