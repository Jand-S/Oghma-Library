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
from .taxonomy import canonical_tag_keys, normalize_tag_key

app = typer.Typer(add_completion=False, help="Oghma Library backend")


async def _ensure_schema() -> None:
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS unaccent"))
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(text("ALTER TABLE novel ADD COLUMN IF NOT EXISTS tag_keys VARCHAR[] DEFAULT '{}'::varchar[] NOT NULL"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_novel_tag_keys ON novel USING gin (tag_keys)"))
        await conn.execute(text("ALTER TABLE chapter ADD COLUMN IF NOT EXISTS status VARCHAR(16) DEFAULT 'ok' NOT NULL"))
        await conn.execute(text("ALTER TABLE chapter ADD COLUMN IF NOT EXISTS problem VARCHAR(32)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_chapter_novel_status ON chapter (novel_id, status)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_chapter_novel_hash ON chapter (novel_id, content_hash)"))
        await conn.execute(text("ALTER TABLE chapter ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ"))
        await conn.execute(text("ALTER TABLE novel ADD COLUMN IF NOT EXISTS storage_state VARCHAR(8) DEFAULT 'hot' NOT NULL"))
        await conn.execute(text("ALTER TABLE novel ADD COLUMN IF NOT EXISTS last_new_chapter_at TIMESTAMPTZ"))
        await conn.execute(text("UPDATE chapter SET first_seen_at = fetched_at WHERE first_seen_at IS NULL AND fetched_at IS NOT NULL"))
        await conn.execute(text(
            "UPDATE novel n SET last_new_chapter_at = m.last FROM ("
            "SELECT novel_id, max(first_seen_at) AS last FROM chapter WHERE status = 'ok' GROUP BY novel_id) m "
            "WHERE m.novel_id = n.id AND n.last_new_chapter_at IS NULL"
        ))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_novel_storage ON novel (storage_state, last_new_chapter_at)"))


@app.command("init-db")
def init_db() -> None:
    """Cria extensoes e tabelas no Postgres."""

    asyncio.run(_ensure_schema())
    typer.echo("init-db: ok")


@app.command("upgrade-db")
def upgrade_db() -> None:
    """Aplica ajustes idempotentes em bancos ja existentes."""

    asyncio.run(_ensure_schema())
    typer.echo("upgrade-db: ok")


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
        dict(
            id="golden-novel",
            name="Golden Novel",
            base_url="https://goldennovel.com/",
            mode="wordpress_api",
            rate_limit_seconds=1.0,
        ),
        dict(
            id="mahou-reader",
            name="Mahou Reader",
            base_url="https://mahoureader.com/",
            mode="next_data",
            rate_limit_seconds=1.0,
        ),
        dict(
            id="light-novel-pub",
            name="Light Novel Pub",
            base_url="https://lightnovelpub.me/",
            mode="static_html",
            rate_limit_seconds=1.0,
        ),
        dict(
            id="novellunar",
            name="NovelLunar",
            base_url="https://novellunar.com/",
            mode="api_available",
            rate_limit_seconds=1.5,
        ),
        dict(
            id="rolia-scan",
            name="RoliaScan",
            base_url="https://roliascan.com/",
            mode="wordpress_rest",
            rate_limit_seconds=1.0,
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
            if isinstance(sel, (tuple, list)):
                sel = ", ".join(sel)
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
    novel_url: str = typer.Option(None, help="coleta so esta novel (URL da pagina dela no site)"),
) -> None:
    """Roda um crawl (e o que o cron chama)."""

    async def _run() -> None:
        async with SessionLocal() as s:
            stats = await crawl_source(
                s, source, limit=limit, chapter_limit=chapter_limit, refresh=refresh, novel_url=novel_url
            )
        typer.echo(f"crawl {source}: {stats}")

    asyncio.run(_run())


def _echo_json(payload: dict) -> None:
    import json

    typer.echo(json.dumps(payload, ensure_ascii=False, indent=2, default=str))


@app.command("probe-connector")
def probe_connector_cmd(
    source: str = typer.Option(..., help="id do conector"),
    novel_url: str = typer.Option(None, help="URL de uma novel especifica para testar"),
) -> None:
    """Portao: testa o conector contra o site real sem gravar nada. Sai com codigo 1 se reprovar."""
    from .autoconnector.probe import probe_connector

    report = asyncio.run(probe_connector(source, novel_url))
    _echo_json(report.as_dict())
    if not report.ok:
        raise typer.Exit(code=1)


@app.command("evict")
def evict_cmd(
    source: str = typer.Option(None, help="so uma fonte"),
    dry_run: bool = typer.Option(False, help="mostra o que esfriaria, sem apagar"),
    cap_gb: float = typer.Option(None, help="teto de content+assets em GB (padrao OGHMA_HOT_CAP_GB ou 20)"),
    window_days: int = typer.Option(60, help="sem capitulo novo ha mais de N dias"),
) -> None:
    """Esfria novels publicadas e paradas: apaga content/assets locais (ficam no B2)."""
    from .coldstore import evict

    async def _run():
        async with SessionLocal() as s:
            return await evict(s, source_id=source, dry_run=dry_run, cap_gb=cap_gb, window_days=window_days)

    _echo_json(asyncio.run(_run()))


@app.command("rehydrate")
def rehydrate_cmd(novel: str = typer.Option(..., help="id da novel (<fonte>:<slug>)")) -> None:
    """Traz de volta do B2 os arquivos de uma novel fria."""
    from .coldstore import ensure_hot

    async def _run():
        async with SessionLocal() as s:
            return await ensure_hot(s, novel)

    _echo_json({"novel": novel, "rehydrated": asyncio.run(_run())})


@app.command("publish-prune")
def publish_prune_cmd(
    source: str = typer.Option(None, help="so uma fonte"),
    keep: int = typer.Option(2, help="versoes mantidas por novel/catalogo"),
    dry_run: bool = typer.Option(False, help="so mostra o que apagaria"),
    local_only: bool = typer.Option(False, help="nao mexe no B2"),
) -> None:
    """Apaga bundles e catalogos antigos do B2 e do disco, nunca o que o estado atual usa."""
    from .config import get_settings
    from .publish.prune import prune
    from .publish.state import load_state, publish_lock
    from .publish.uploader import S3Uploader

    root = Path(get_settings().storage_root)
    with publish_lock(str(root / "publish.lock")):
        state = load_state(str(root / "publish_state.json"))
        up = None if local_only else S3Uploader()
        remote = None if up is None else up.list_keys()
        report = prune(state, work_dir=root / "publish", remote=remote, uploader=up,
                       keep=keep, source=source, dry_run=dry_run)
    _echo_json(report)


@app.command("rodizio")
def rodizio_cmd(
    parallel: int = typer.Option(2, help="fontes coletadas ao mesmo tempo"),
    pause_minutes: float = typer.Option(30.0, help="pausa entre voltas"),
    once: bool = typer.Option(False, help="faz uma volta so e sai"),
    source: list[str] = typer.Option(None, help="restringe a estas fontes (repetivel)"),
) -> None:
    """Coleta continua em rodizio: crawl -> publica -> evict -> aviso no brain, fonte por fonte."""
    from .rodizio import main as rodizio_main

    raise typer.Exit(code=asyncio.run(rodizio_main(parallel=parallel, pause_minutes=pause_minutes,
                                                   once=once, only=source or None)))


@app.command("crawl-runs")
def crawl_runs_cmd(
    source: str = typer.Option(None, help="so uma fonte"),
    limit: int = typer.Option(50, help="execucoes mais recentes"),
) -> None:
    """Execucoes recentes de coleta, no mesmo formato de /api/crawls (para quem roda sem API)."""
    from sqlalchemy import select

    from .models import CrawlRun

    async def _run():
        async with SessionLocal() as s:
            stmt = select(CrawlRun)
            if source:
                stmt = stmt.where(CrawlRun.source_id == source)
            rows = (await s.scalars(stmt.order_by(CrawlRun.started_at.desc()).limit(limit))).all()
            return [{"id": int(r.id), "sourceId": r.source_id, "status": r.status, "stats": dict(r.stats or {}),
                     "error": r.error or "", "startedAt": r.started_at.isoformat() if r.started_at else "",
                     "finishedAt": r.finished_at.isoformat() if r.finished_at else ""} for r in rows]

    _echo_json(asyncio.run(_run()))


@app.command("backup-db")
def backup_db_cmd(keep: int = typer.Option(14, help="copias mantidas no bucket privado")) -> None:
    """pg_dump do banco para o bucket privado do B2."""
    from .ops import backup_db

    _echo_json(backup_db(keep=keep))


@app.command("disk-check")
def disk_check_cmd() -> None:
    """Aviso no brain se o disco ou o acervo quente estiverem perto do limite."""
    from .ops import disk_check

    _echo_json(disk_check())


def _set_source_enabled(source: str, enabled: bool) -> None:
    from .models import SourceSite

    async def _run():
        async with SessionLocal() as s:
            src = await s.get(SourceSite, source)
            if src is None:
                raise typer.BadParameter(f"fonte desconhecida: {source}")
            src.enabled = enabled
            await s.commit()

    asyncio.run(_run())
    _echo_json({"source": source, "enabled": enabled})


@app.command("source-enable")
def source_enable_cmd(source: str = typer.Argument(..., help="id da fonte")) -> None:
    """Devolve a fonte ao rodizio (depois de ela sair por falhas seguidas)."""
    _set_source_enabled(source, True)


@app.command("source-disable")
def source_disable_cmd(source: str = typer.Argument(..., help="id da fonte")) -> None:
    """Tira a fonte do rodizio (continua no app, so nao e mais coletada)."""
    _set_source_enabled(source, False)


@app.command("detect-moved")
def detect_moved_cmd(source: str = typer.Option(..., help="id da fonte")) -> None:
    """Marca as novels cujo endereco o site mudou (301 para outra novel listada); a publicacao
    seguinte deixa a antiga fora do app e passa o id dela para a nova como apelido."""
    import oghma.scraper.connectors  # noqa: F401
    from .scraper.moved import detect_moved_now

    _echo_json(asyncio.run(detect_moved_now(source)))


@app.command("source-unpublish")
def source_unpublish_cmd(
    source: str = typer.Argument(..., help="id da fonte"),
    dry_run: bool = typer.Option(False, help="simula o upload do index.json"),
) -> None:
    """Tira a fonte do app (index.json). Use com source-disable para ela tambem sair do rodizio."""
    from .publish.runner import unpublish_source

    _echo_json(unpublish_source(source, dry_run=dry_run))


@app.command("audit-content")
def audit_content_cmd(source: str = typer.Option(None, help="so uma fonte")) -> None:
    """Relatorio somente leitura: status dos capitulos, sinopses e o que mark-chapters mudaria."""
    from .maintenance import audit_content

    _echo_json(asyncio.run(audit_content(source)))


@app.command("mark-chapters")
def mark_chapters_cmd(
    source: str = typer.Option(None, help="so uma fonte"),
    apply: bool = typer.Option(False, help="grava (sem isso so mostra o que mudaria)"),
) -> None:
    """Marca capitulos ja salvos como `invalid` (vazio/placeholder) ou `duplicate` (texto repetido)."""
    from .maintenance import mark_chapters

    _echo_json(asyncio.run(mark_chapters(source, apply=apply)))


@app.command("discovery-fichas")
def discovery_fichas_cmd(
    limit: int = typer.Option(None, help="no maximo N obras nesta rodada"),
) -> None:
    """Escreve com o Codex a ficha da historia das obras sem ficha (ou com sinopse nova)."""
    from .discovery.runner import run_fichas

    _echo_json(asyncio.run(run_fichas(limit=limit)))


@app.command("discovery-build")
def discovery_build_cmd(
    dry_run: bool = typer.Option(False, help="simula o upload"),
    no_upload: bool = typer.Option(False, help="so calcula e grava em <storage>/discovery"),
) -> None:
    """Calcula os parecidos de todo o catalogo (embeddings locais + tags) e publica no B2."""
    from .discovery.runner import run

    _echo_json(asyncio.run(run(dry_run=dry_run, no_upload=no_upload)))


@app.command("clean-descriptions")
def clean_descriptions_cmd(
    source: str = typer.Option(None, help="so uma fonte"),
    apply: bool = typer.Option(False, help="grava (sem isso so mostra exemplos)"),
) -> None:
    """Limpa as sinopses salvas (HTML, entidades, avisos, propaganda), sem acessar a internet."""
    from .maintenance import clean_descriptions

    _echo_json(asyncio.run(clean_descriptions(source, apply=apply)))


@app.command("refresh-descriptions")
def refresh_descriptions_cmd(
    source: str = typer.Option(..., help="fonte"),
    only_missing: bool = typer.Option(False, help="so novels sem sinopse"),
    apply: bool = typer.Option(False, help="grava (sem isso so mostra exemplos)"),
    limit: int = typer.Option(None, help="max de novels (teste)"),
) -> None:
    """Busca de novo a pagina da novel no site e atualiza so a sinopse."""
    from .maintenance import refresh_descriptions

    _echo_json(asyncio.run(refresh_descriptions(source, only_missing=only_missing, apply=apply, limit=limit)))


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


@app.command("normalize-tags")
def normalize_tags(
    source: str = typer.Option("all", help="fonte ou all"),
    apply: bool = typer.Option(False, "--apply", help="grava as tag_keys no banco"),
    limit: int = typer.Option(None, help="max de novels para processar"),
) -> None:
    """Preenche novel.tag_keys usando a taxonomia versionada."""

    async def _run() -> None:
        await _ensure_schema()
        dry_run = not apply
        changed = 0
        scanned = 0
        unknown: dict[str, int] = {}
        by_source: dict[str, dict[str, int]] = {}
        async with SessionLocal() as s:
            stmt = select(Novel).order_by(Novel.source_id, Novel.id)
            if source != "all":
                stmt = stmt.where(Novel.source_id == source)
            if limit:
                stmt = stmt.limit(limit)
            rows = (await s.scalars(stmt)).all()
            for novel in rows:
                scanned += 1
                keys = canonical_tag_keys(novel.tags or [])
                source_stats = by_source.setdefault(novel.source_id, {"novels": 0, "changed": 0})
                source_stats["novels"] += 1
                if keys != list(novel.tag_keys or []):
                    changed += 1
                    source_stats["changed"] += 1
                    if not dry_run:
                        novel.tag_keys = keys
                for raw in novel.tags or []:
                    key = normalize_tag_key(raw)
                    if key.startswith("raw."):
                        unknown[raw] = unknown.get(raw, 0) + 1
            if not dry_run:
                await s.commit()
        suffix = " (dry-run)" if dry_run else ""
        typer.echo(f"normalize-tags{suffix}: {scanned} novels, {changed} alteradas")
        for source_id, stats in sorted(by_source.items()):
            typer.echo(f"- {source_id}: {stats['novels']} novels, {stats['changed']} alteradas")
        if unknown:
            typer.echo("tags desconhecidas:")
            for tag, count in sorted(unknown.items(), key=lambda item: (-item[1], item[0].casefold()))[:80]:
                typer.echo(f"- {tag}: {count}")

    asyncio.run(_run())


if __name__ == "__main__":
    app()
