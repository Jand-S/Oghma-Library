"""Novels que mudaram de endereco no site.

A Central Novel republicou 14 obras com outro slug (`shadow-slave-20230928` ->
`shadow-slave-20260913`, o antigo responde 301 para o novo). A coleta achava o slug novo na
listagem e criava outra novel: o app mostrava dois Shadow Slave. Aqui, depois da listagem, as
novels do banco que sumiram dela tem o endereco antigo consultado sem seguir redirecionamento;
se ele aponta para uma novel listada, a antiga fica marcada `extra.moved_to` com o id da nova.
A publicacao deixa a antiga fora do catalogo e da o id dela a nova como apelido (os livros
baixados pela entrada antiga continuam reconhecidos).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Iterable, Optional
from urllib.parse import urljoin, urlsplit

from .base import NovelRef
from .novel_url import novel_ref_from_url

REDIRECTS = (301, 302, 303, 307, 308)
# Teto por coleta: uma fonte que tirou muitas obras do ar nao vira centenas de requisicoes.
MAX_CHECKS = 200


async def redirect_target(fetcher, url: str) -> Optional[str]:
    """Para onde o endereco redireciona (absoluto), ou None se nao redireciona ou falhou."""
    client = getattr(fetcher, "_client", None)
    if client is None or getattr(fetcher, "use_curl", False) or not url:
        return None
    try:
        await fetcher._throttle(urlsplit(url).netloc)
        resp = await client.get(url, follow_redirects=False)
    except Exception:  # rede: tenta de novo na proxima coleta
        return None
    location = resp.headers.get("Location")
    return urljoin(url, location) if resp.status_code in REDIRECTS and location else None


async def detect_moved(session, connector, fetcher, source_id: str, refs: Iterable[NovelRef],
                       *, max_checks: int = MAX_CHECKS, log=None) -> list[dict]:
    """Marca as novels que mudaram de endereco. Devolve [{"from", "to"}]."""
    from sqlalchemy import select

    from ..models import Novel

    listed = {ref.slug for ref in refs}
    if not listed:
        return []
    rows = (await session.scalars(select(Novel).where(Novel.source_id == source_id))).all()
    stale = [n for n in rows if n.slug not in listed and not (n.extra or {}).get("moved_to")]
    moved: list[dict] = []
    for novel in stale[:max_checks]:
        target = await redirect_target(fetcher, novel.source_url)
        if not target:
            continue
        try:
            ref = novel_ref_from_url(connector, target)
        except ValueError:
            continue
        if ref.slug == novel.slug or ref.slug not in listed:
            continue
        new_id = f"{source_id}:{ref.slug}"
        novel.extra = {**(novel.extra or {}), "moved_to": new_id,
                       "moved_at": datetime.now(timezone.utc).isoformat()}
        moved.append({"from": novel.id, "to": new_id})
        if log:
            log(f"novel moved {novel.id} -> {new_id}")
    if moved:
        await session.commit()
    return moved


async def detect_moved_now(source_id: str) -> dict:
    """Lista a fonte e marca as novels que mudaram de endereco, sem coletar nada (CLI)."""
    from ..db import SessionLocal
    from .fetcher import HttpFetcher
    from . import registry

    connector = registry.get(source_id)
    headers_provider = getattr(connector, "request_headers", None)
    headers = headers_provider() if callable(headers_provider) else getattr(connector, "headers", None)
    fetcher = HttpFetcher(connector.rate_limit_seconds, headers=headers, http2=getattr(connector, "http2", True),
                          use_curl=getattr(connector, "use_curl", False), curl_bin=getattr(connector, "curl_bin", "curl"))
    refs = list(await connector.discover_novels(fetcher))
    async with SessionLocal() as session:
        moved = await detect_moved(session, connector, fetcher, source_id, refs, log=print)
    return {"source": source_id, "listed": len(refs), "moved": moved}
