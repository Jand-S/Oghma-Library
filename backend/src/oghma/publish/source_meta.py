"""Metadados de cada fonte no index.json: idioma dominante e icone do site.

O desktop nao deve adivinhar essas coisas (mapa fixo de idiomas, favicons empacotados):
uma fonte nova, criada pelo autoconnector, chega com idioma e icone pelo proprio indice.
"""
from __future__ import annotations

import time
from collections import Counter
from pathlib import Path
from typing import Callable, Optional
from urllib.parse import urljoin

import httpx
from selectolax.parser import HTMLParser

from .hashing import file_sha256

# Nova tentativa de baixar o icone de uma fonte sem icone (site fora do ar, Cloudflare...).
ICON_RETRY_SECONDS = 7 * 24 * 3600
ICON_MAX_BYTES = 512 * 1024
ICON_CONTENT_TYPES = {
    "png": "image/png",
    "ico": "image/x-icon",
    "gif": "image/gif",
    "jpg": "image/jpeg",
    "webp": "image/webp",
    "svg": "image/svg+xml",
}


def dominant_language(novels) -> Optional[str]:
    """Idioma mais comum das novels da fonte ("pt-BR", "en"...), ou None sem novels."""
    counts = Counter(n.language for n in novels if n.language)
    return counts.most_common(1)[0][0] if counts else None


def sniff_image(data: bytes) -> Optional[str]:
    """Extensao pelo conteudo (o content-type dos sites nao e confiavel)."""
    head = data[:512]
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if head.startswith(b"\x00\x00\x01\x00"):
        return "ico"
    if head.startswith((b"GIF87a", b"GIF89a")):
        return "gif"
    if head.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    text = head.lstrip().lower()
    if text.startswith(b"<svg") or (text.startswith(b"<?xml") and b"<svg" in text):
        return "svg"
    return None


def _icon_size(sizes: str) -> int:
    best = 0
    for item in sizes.lower().split():
        if item == "any":
            return 512
        width = item.split("x", 1)[0]
        if width.isdigit():
            best = max(best, int(width))
    return best


def icon_candidates(html: str, page_url: str) -> list[str]:
    """URLs de icone em ordem de preferencia: apple-touch-icon e icones grandes antes do /favicon.ico."""
    ranked: list[tuple[int, str]] = []
    for link in HTMLParser(html).css("link[rel][href]"):
        rel = set((link.attributes.get("rel") or "").lower().split())
        href = (link.attributes.get("href") or "").strip()
        if not href or href.startswith("data:") or not rel & {"icon", "apple-touch-icon", "apple-touch-icon-precomposed"}:
            continue
        score = _icon_size(link.attributes.get("sizes") or "")
        if rel & {"apple-touch-icon", "apple-touch-icon-precomposed"}:
            score = max(score, 180)
        elif href.lower().split("?", 1)[0].endswith(".svg"):
            score = max(score, 256)
        ranked.append((score, urljoin(page_url, href)))
    urls = [url for _, url in sorted(ranked, key=lambda item: -item[0])]
    fallback = urljoin(page_url, "/favicon.ico")
    if fallback not in urls:
        urls.append(fallback)
    return list(dict.fromkeys(urls))


def fetch_source_icon(base_url: str, dest_dir: Path, source_id: str, *, user_agent: str,
                      client: Optional[httpx.Client] = None) -> Optional[Path]:
    """Baixa o icone do site para dest_dir/<source_id>.<ext>. Devolve o caminho ou None."""
    own = client is None
    client = client or httpx.Client(timeout=15, follow_redirects=True, http2=True, headers={"User-Agent": user_agent})
    try:
        try:
            page = client.get(base_url)
            candidates = icon_candidates(page.text if page.status_code < 400 else "", str(page.url))
        except httpx.HTTPError:
            candidates = [urljoin(base_url, "/favicon.ico")]
        for url in candidates:
            try:
                response = client.get(url)
            except httpx.HTTPError:
                continue
            data = response.content
            if response.status_code >= 400 or not data or len(data) > ICON_MAX_BYTES:
                continue
            ext = sniff_image(data)
            if not ext:
                continue
            dest_dir.mkdir(parents=True, exist_ok=True)
            for old in dest_dir.glob(f"{source_id}.*"):
                old.unlink()
            path = dest_dir / f"{source_id}.{ext}"
            path.write_bytes(data)
            return path
        return None
    finally:
        if own:
            client.close()


def local_icon(icons_dir: Path, source_id: str) -> Optional[Path]:
    for ext in ICON_CONTENT_TYPES:
        path = icons_dir / f"{source_id}.{ext}"
        if path.is_file():
            return path
    return None


def plan_source_icon(source, icons_dir: Path, prev_site: dict, *, user_agent: str,
                     now: Optional[float] = None,
                     fetch: Optional[Callable[..., Optional[Path]]] = None) -> dict:
    """Decide o icone da fonte para o index.json.

    Devolve {"fields": {...campos do site...}, "upload": (local, key, content_type) | None}.
    Usa o arquivo local se existir; senao tenta baixar do site (no maximo 1 vez por semana).
    Nunca levanta excecao: sem icone o desktop mostra o monograma.
    """
    now = time.time() if now is None else now
    fields: dict = {}
    path = local_icon(icons_dir, source.id)
    if path is None and source.base_url:
        checked = float(prev_site.get("iconCheckedAt") or 0)
        if now - checked >= ICON_RETRY_SECONDS:
            fields["iconCheckedAt"] = now
            try:
                path = (fetch or fetch_source_icon)(source.base_url, icons_dir, source.id, user_agent=user_agent)
            except Exception:  # noqa: BLE001 - icone e enfeite, nunca derruba o publish
                path = None
        else:
            fields["iconCheckedAt"] = checked
    if path is None:
        return {"fields": fields, "upload": None}
    sha, _ = file_sha256(path)
    ext = path.suffix.lstrip(".")
    key = f"sources/{source.id}-{sha[:12]}.{ext}"
    fields.update({"iconKey": key, "iconSha256": sha})
    upload = None if prev_site.get("iconKey") == key else (str(path), key, ICON_CONTENT_TYPES[ext])
    return {"fields": fields, "upload": upload}
