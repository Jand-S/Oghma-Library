"""Read-only database/content audit; writes a JSON report, never modifies chapters."""
import asyncio
from collections import Counter
import gzip
import json
from pathlib import Path

from selectolax.parser import HTMLParser
from sqlalchemy import or_, select

from oghma.config import get_settings
from oghma.db import SessionLocal
from oghma.models import Chapter, Novel


async def main():
    rows = []
    async with SessionLocal() as session:
        candidates = (await session.execute(select(Chapter, Novel).join(Novel).where(or_(
            Chapter.word_count <= 0, Chapter.content_path.is_(None),
            Chapter.content_hash == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        )).order_by(Novel.source_id, Novel.title, Chapter.number))).all()
        for chapter, novel in candidates:
            path = Path(chapter.content_path) if chapter.content_path else None
            exists = path is not None and path.is_file()
            html = path.read_text(encoding="utf-8") if exists else ""
            tree = HTMLParser(html)
            for node in tree.css("script,style"):
                node.decompose()
            text = tree.text(strip=True)
            images = len(tree.css("img[src]"))
            raw = b""
            if chapter.raw_path and Path(chapter.raw_path).is_file():
                raw = gzip.decompress(Path(chapter.raw_path).read_bytes())
            status = "text_present" if text else "image_only" if images else "empty" if exists else "missing_file"
            rows.append({"source": novel.source_id, "novel_id": novel.id, "slug": novel.slug,
                         "title": novel.title, "number": float(chapter.number),
                         "chapter_title": chapter.title, "url": chapter.source_url,
                         "status": status, "images": images, "raw_bytes": len(raw),
                         "raw_rate_limited": b"rate limit exceeded" in raw.lower()})
    summary = {}
    for source in sorted({r["source"] for r in rows}):
        group = [r for r in rows if r["source"] == source]
        affected = [r for r in group if r["status"] in ("empty", "missing_file")]
        summary[source] = {"status_counts": dict(Counter(r["status"] for r in group)),
                           "affected_novels": len({r["novel_id"] for r in affected}),
                           "rate_limited": sum(r["raw_rate_limited"] for r in group)}
    path = Path(get_settings().storage_root) / "reports" / "empty-chapters-audit.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"scope": "zero word count, missing content path or empty content hash", "summary": summary, "chapters": rows}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)
    print(f"report={path}")


if __name__ == "__main__":
    asyncio.run(main())
