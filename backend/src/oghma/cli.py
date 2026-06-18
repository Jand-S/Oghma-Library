"""CLI do backend Oghma. Entrada do cron e das tarefas de calibracao."""
from __future__ import annotations

import asyncio
import gzip
from pathlib import Path

import typer
from selectolax.parser import HTMLParser
from sqlalchemy import select, text

import oghma.scraper.connectors  # noqa: F401  (registra conectores)
from . import storage
from .db import SessionLocal, engine
from .models import Base, Chapter, Novel, SourceSite
from .scraper.base import RawPage
from .scraper import registry
from .scraper.fetcher import HttpFetcher
from .scraper.orchestrator import crawl_source
from .scraper.repair_images import repair_chapter_images

app = typer.Typer(add_completion=False, help="Oghma Library backend")


@app.command("init-db")
def init_db() -> None:
    """Cria extensoes e tabelas no Postgres."""

    async def _run() -> None:
        async with engine.begin() as conn:
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS unaccent"))
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_run())
    typer.echo("init-db: ok")


@app.command("seed-sources")
def seed_sources() -> None:
    """Insere as fontes conhecidas (idempotente)."""

    seeds = [
        dict(
            id="central-novel",
            name="Central Novel",
            base_url="https://centralnovel.com/",
            mode="static_html",
            rate_limit_seconds=2.0,
        ),
        dict(
            id="novel-mania",
            name="Novel Mania",
            base_url="https://novelmania.com.br/",
            mode="static_html",
            rate_limit_seconds=2.5,
        ),
        dict(
            id="house-saikai",
            name="House Saikai",
            base_url="https://housesaikai.net/",
            mode="api_available",
            rate_limit_seconds=1.5,
        ),
        dict(
            id="sky-demon-order",
            name="Sky Demon Order",
            base_url="https://skydemonorder.com/",
            mode="static_html",
            rate_limit_seconds=2.0,
        ),
    ]

    async def _run() -> None:
        async with SessionLocal() as s:
            for seed in seeds:
                existing = await s.get(SourceSite, seed["id"])
                if existing is None:
                    s.add(SourceSite(**seed))
            await s.commit()

    asyncio.run(_run())
    typer.echo("seed-sources: ok")


@app.command("probe")
def probe(url: str, source: str = "central-novel") -> None:
    """Baixa uma pagina e mostra o que cada seletor encontra (calibracao)."""

    async def _run() -> None:
        connector = registry.get(source)
        headers_provider = getattr(connector, "request_headers", None)
        headers = headers_provider() if callable(headers_provider) else getattr(connector, "headers", None)
        fetcher = HttpFetcher(
            connector.rate_limit_seconds,
            headers=headers,
            http2=getattr(connector, "http2", True),
            use_curl=getattr(connector, "use_curl", False),
        )
        try:
            raw = await fetcher.get(url)
        finally:
            await fetcher.aclose()
        tree = HTMLParser(raw.html)
        typer.echo(f"URL final: {raw.url}  ({len(raw.html)} bytes)")
        for attr in ["LIST_ITEM", "NOVEL_TITLE", "NOVEL_COVER", "NOVEL_DESC", "NOVEL_TAG", "CHAPTER_ITEM", "CONTENT"]:
            sel = getattr(connector, attr, None)
            if not sel:
                continue
            nodes = tree.css(sel)
            sample = ""
            if nodes:
                n0 = nodes[0]
                sample = (n0.attributes.get("href") or n0.text(strip=True) or "")[:80]
            typer.echo(f"  {attr:12} [{sel}] -> {len(nodes)} hits | ex: {sample}")

    asyncio.run(_run())


@app.command("crawl")
def crawl(
    source: str = "central-novel",
    limit: int = typer.Option(None, help="max de novels (teste)"),
    chapter_limit: int = typer.Option(None, help="max de capitulos novos por novel (teste)"),
    refresh: bool = typer.Option(False, help="rebaixa capitulos ja existentes"),
) -> None:
    """Roda um crawl (e o que o cron chama)."""

    async def _run() -> None:
        async with SessionLocal() as s:
            stats = await crawl_source(
                s, source, limit=limit, chapter_limit=chapter_limit, refresh=refresh
            )
        typer.echo(f"crawl {source}: {stats}")

    asyncio.run(_run())


@app.command("reprocess-content")
def reprocess_content(
    source: str = "central-novel",
    limit: int = typer.Option(None, help="max de capitulos para reprocessar (teste)"),
    dry_run: bool = typer.Option(False, help="normaliza e conta sem regravar arquivos"),
) -> None:
    """Regera content_path a partir do raw_path usando o normalizador atual."""

    async def _run() -> None:
        connector = registry.get(source)
        processed = 0
        missing_raw = 0
        async with SessionLocal() as s:
            stmt = (
                select(Chapter, Novel.slug)
                .join(Novel, Chapter.novel_id == Novel.id)
                .where(Novel.source_id == source, Chapter.raw_path.is_not(None))
                .order_by(Novel.slug, Chapter.number)
            )
            if limit:
                stmt = stmt.limit(limit)
            rows = (await s.execute(stmt)).all()
            for chapter, slug in rows:
                raw_path = Path(chapter.raw_path or "")
                if not raw_path.exists():
                    missing_raw += 1
                    continue
                with gzip.open(raw_path, "rb") as fh:
                    raw_html = fh.read()
                norm = connector.normalize_chapter(
                    RawPage(url=chapter.source_url, html=raw_html)
                )
                processed += 1
                if dry_run:
                    continue
                chapter.content_path = storage.save_content(
                    source,
                    slug,
                    float(chapter.number),
                    norm.html,
                )
                chapter.content_hash = norm.text_hash
                chapter.word_count = norm.word_count
                if processed % 100 == 0:
                    await s.commit()
                    typer.echo(f"reprocess-content: {processed} capitulos")
            if not dry_run:
                await s.commit()
        suffix = " (dry-run)" if dry_run else ""
        typer.echo(
            f"reprocess-content{suffix}: {processed} capitulos, "
            f"{missing_raw} raw ausentes"
        )

    asyncio.run(_run())


@app.command("serve")
def serve(host: str = "0.0.0.0", port: int = 8000) -> None:
    """Sobe a API (dev). Em producao use o container/uvicorn."""
    import uvicorn

    uvicorn.run("oghma.api.main:app", host=host, port=port)


@app.command("repair-chapter-images")
def repair_images(
    source: str = typer.Option("all", help="fonte ou all"),
    limit: int = typer.Option(None, help="max de capitulos por fonte (teste)"),
    dry_run: bool = typer.Option(False, help="somente gera o relatorio"),
    image_rate_seconds: float = typer.Option(0.1, help="intervalo por host entre imagens"),
) -> None:
    """Baixa imagens inline, reescreve HTML e gera relatorio por novel."""

    result = asyncio.run(
        repair_chapter_images(
            source,
            limit=limit,
            dry_run=dry_run,
            image_rate_seconds=image_rate_seconds,
        )
    )
    for source_id, stats in result["sources"].items():
        typer.echo(
            f"{source_id}: {len(stats['novels'])} novels, "
            f"{stats['chapters_affected']} chapters, "
            f"{stats['downloaded']} downloaded, {stats['reused']} reused, "
            f"{stats['removed']} removed, {stats['failed']} failures"
        )
    typer.echo(f"report: {result['report_path']}")


if __name__ == "__main__":
    app()
