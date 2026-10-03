"""Portao de um conector contra o site real, sem gravar nada no banco.

Reprova o conector se a descoberta vier vazia, se a ficha vier sem titulo/sinopse,
se a lista de capitulos tiver numero repetido ou fora de ordem, ou se algum capitulo
baixado vier vazio ou com placeholder. Usado pelo worker antes de qualquer deploy e
pelo subagente qa-reviewer.
"""
from __future__ import annotations

import time
from dataclasses import asdict, dataclass, field

from ..scraper import registry
from ..scraper.fetcher import HttpFetcher
from ..scraper.normalize import chapter_problem, clean_description
from ..scraper.novel_url import novel_ref_from_url

DISCOVER_LIMIT = 3
CHAPTER_SAMPLES = 5
MIN_DESCRIPTION_CHARS = 40


@dataclass
class Check:
    name: str
    ok: bool
    detail: str = ""


@dataclass
class ProbeReport:
    source: str
    novel_url: str | None
    ok: bool = False
    checks: list[Check] = field(default_factory=list)
    novel: dict = field(default_factory=dict)
    chapters_listed: int = 0
    samples: list[dict] = field(default_factory=list)
    seconds: float = 0.0

    def add(self, name: str, ok: bool, detail: str = "") -> bool:
        self.checks.append(Check(name, ok, detail))
        return ok

    def as_dict(self) -> dict:
        return asdict(self)


def _sample_indexes(total: int, count: int = CHAPTER_SAMPLES) -> list[int]:
    """Primeiro, ultimo e pontos espalhados: pega erros que so aparecem no fim da lista."""
    if total <= count:
        return list(range(total))
    step = (total - 1) / (count - 1)
    return sorted({round(i * step) for i in range(count)})


async def probe_connector(source: str, novel_url: str | None = None, fetcher=None) -> ProbeReport:
    import oghma.scraper.connectors  # noqa: F401  (registra conectores)

    started = time.monotonic()
    report = ProbeReport(source=source, novel_url=novel_url)
    connector = registry.get(source)
    own_fetcher = fetcher is None
    if own_fetcher:
        headers_provider = getattr(connector, "request_headers", None)
        headers = headers_provider() if callable(headers_provider) else getattr(connector, "headers", None)
        fetcher = HttpFetcher(
            connector.rate_limit_seconds, headers=headers, http2=getattr(connector, "http2", True),
            use_curl=getattr(connector, "use_curl", False), curl_bin=getattr(connector, "curl_bin", "curl"),
        )
    try:
        report.add("contract", all(hasattr(connector, a) for a in (
            "id", "display_name", "base_url", "rate_limit_seconds", "discover_novels",
            "fetch_novel", "list_chapters", "fetch_chapter", "normalize_chapter")), "atributos do SiteConnector")
        report.add("rate_limit", float(getattr(connector, "rate_limit_seconds", 0)) >= 0.5,
                   f"{getattr(connector, 'rate_limit_seconds', None)} s entre requisicoes (minimo 0,5)")

        try:
            discovered = list(await connector.discover_novels(fetcher, limit=DISCOVER_LIMIT))
        except Exception as exc:  # o relatorio mostra a falha em vez de quebrar
            discovered = []
            report.add("discover", False, f"erro: {exc}"[:300])
        else:
            report.add("discover", bool(discovered), f"{len(discovered)} novels na descoberta")

        if novel_url:
            try:
                ref = novel_ref_from_url(connector, novel_url)
            except Exception as exc:
                report.add("ref_from_url", False, str(exc)[:300])
                ref = None
            else:
                report.add("ref_from_url", True, f"slug {ref.slug}")
        else:
            ref = discovered[0] if discovered else None
        if ref is None:
            return report

        try:
            meta = await connector.fetch_novel(fetcher, ref)
        except Exception as exc:
            report.add("fetch_novel", False, f"erro: {exc}"[:300])
            return report
        description = clean_description(meta.description) or ""
        report.novel = {"slug": meta.slug, "title": meta.title, "author": meta.author,
                        "cover_url": meta.cover_url, "language": meta.language,
                        "description": description[:300], "tags": meta.tags[:8]}
        report.add("title", bool(meta.title and meta.title.strip() and meta.title != meta.slug), meta.title or "")
        # Algumas obras nao tem sinopse no proprio site: o conector passa se extrair a
        # sinopse de pelo menos uma das novels amostradas.
        lengths = [len(description)]
        if len(description) < MIN_DESCRIPTION_CHARS:
            for other in discovered:
                if other.slug == meta.slug:
                    continue
                try:
                    other_meta = await connector.fetch_novel(fetcher, other)
                except Exception:
                    continue
                lengths.append(len(clean_description(other_meta.description) or ""))
                if lengths[-1] >= MIN_DESCRIPTION_CHARS:
                    break
        report.add("description", max(lengths) >= MIN_DESCRIPTION_CHARS,
                   f"sinopse limpa nas novels testadas: {lengths} caracteres")
        report.add("cover", bool(meta.cover_url), meta.cover_url or "sem capa")

        try:
            chapters = await connector.list_chapters(fetcher, meta)
        except Exception as exc:
            report.add("list_chapters", False, f"erro: {exc}"[:300])
            return report
        report.chapters_listed = len(chapters)
        numbers = [float(c.number) for c in chapters]
        report.add("list_chapters", bool(chapters), f"{len(chapters)} capitulos")
        report.add("chapter_numbers_unique", len(numbers) == len(set(numbers)),
                   f"{len(numbers) - len(set(numbers))} numeros repetidos")
        report.add("chapter_order", numbers == sorted(numbers), "lista em ordem crescente")
        report.add("chapter_urls", all(c.url and c.url.startswith("http") for c in chapters), "URLs absolutas")

        bad = 0
        for index in _sample_indexes(len(chapters)):
            cref = chapters[index]
            sample = {"number": cref.number, "title": cref.title, "url": cref.url}
            try:
                raw = await connector.fetch_chapter(fetcher, cref.url)
                norm = connector.normalize_chapter(raw)
            except Exception as exc:
                sample["problem"] = f"erro: {exc}"[:200]
            else:
                sample["words"] = norm.word_count
                sample["problem"] = chapter_problem(norm.html)
                sample["preview"] = " ".join(norm.html.split())[:160]
            bad += bool(sample["problem"])
            report.samples.append(sample)
        report.add("chapter_content", bool(report.samples) and bad == 0,
                   f"{len(report.samples) - bad}/{len(report.samples)} capitulos com conteudo")
        return report
    finally:
        report.ok = bool(report.checks) and all(c.ok for c in report.checks)
        report.seconds = round(time.monotonic() - started, 1)
        if own_fetcher:
            await fetcher.aclose()
