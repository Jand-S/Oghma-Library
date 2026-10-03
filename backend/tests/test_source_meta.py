"""Idioma e icone de cada fonte no index.json (sem rede: httpx.MockTransport)."""
from pathlib import Path
from types import SimpleNamespace

import httpx

from oghma.publish.source_meta import (
    ICON_RETRY_SECONDS,
    dominant_language,
    fetch_source_icon,
    icon_candidates,
    plan_source_icon,
    sniff_image,
)

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
ICO = b"\x00\x00\x01\x00" + b"\x00" * 32


def _source(base_url="https://novellunar.com/"):
    return SimpleNamespace(id="novellunar", name="Novel Lunar", base_url=base_url)


def test_dominant_language():
    novels = [SimpleNamespace(language=l) for l in ("en", "en", "pt-BR", None)]
    assert dominant_language(novels) == "en"
    assert dominant_language([]) is None


def test_sniff_image():
    assert sniff_image(PNG) == "png"
    assert sniff_image(ICO) == "ico"
    assert sniff_image(b'<?xml version="1.0"?><svg xmlns="x"></svg>') == "svg"
    assert sniff_image(b"<!doctype html><html>") is None


def test_icon_candidates_prefers_big_icons_and_ends_with_favicon():
    html = """<head>
      <link rel="icon" href="/small.png" sizes="16x16">
      <link rel="apple-touch-icon" href="/touch.png">
      <link rel="shortcut icon" href="https://cdn.site/fav.ico">
      <link rel="stylesheet" href="/x.css">
      <link rel="icon" href="data:image/png;base64,AAAA">
    </head>"""
    urls = icon_candidates(html, "https://site.com/home")
    assert urls[0] == "https://site.com/touch.png"
    assert "https://site.com/small.png" in urls and "https://cdn.site/fav.ico" in urls
    assert urls[-1] == "https://site.com/favicon.ico"
    assert not any(u.startswith("data:") or u.endswith(".css") for u in urls)


def test_fetch_source_icon_skips_html_and_saves_first_image(tmp_path):
    def handler(request):
        if request.url.path == "/":
            return httpx.Response(200, text='<link rel="icon" href="/broken.png"><link rel="icon" href="/ok.ico">')
        if request.url.path == "/broken.png":
            return httpx.Response(200, text="<html>not an image</html>")
        if request.url.path == "/ok.ico":
            return httpx.Response(200, content=ICO)
        return httpx.Response(404)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    path = fetch_source_icon("https://novellunar.com/", tmp_path, "novellunar", user_agent="t", client=client)
    assert path == tmp_path / "novellunar.ico" and path.read_bytes() == ICO


def test_fetch_source_icon_none_when_site_has_no_icon(tmp_path):
    client = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(403, text="cf")))
    assert fetch_source_icon("https://blocked.com/", tmp_path, "blocked", user_agent="t", client=client) is None
    assert not list(tmp_path.iterdir())


def test_plan_source_icon_uploads_new_icon_once(tmp_path):
    (tmp_path / "novellunar.png").write_bytes(PNG)
    first = plan_source_icon(_source(), tmp_path, {}, user_agent="t")
    key = first["fields"]["iconKey"]
    assert key.startswith("sources/novellunar-") and key.endswith(".png")
    assert first["upload"] == (str(tmp_path / "novellunar.png"), key, "image/png")
    again = plan_source_icon(_source(), tmp_path, {"iconKey": key}, user_agent="t")
    assert again["upload"] is None and again["fields"]["iconKey"] == key


def test_plan_source_icon_fetches_at_most_weekly_and_never_raises(tmp_path):
    calls = []

    def failing_fetch(*args, **kwargs):
        calls.append(args)
        raise RuntimeError("rede caiu")

    now = ICON_RETRY_SECONDS * 2.0
    plan = plan_source_icon(_source(), tmp_path, {}, user_agent="t", now=now, fetch=failing_fetch)
    assert plan == {"fields": {"iconCheckedAt": now}, "upload": None}
    soon = plan_source_icon(_source(), tmp_path, {"iconCheckedAt": now}, user_agent="t",
                            now=now + 60, fetch=failing_fetch)
    assert soon["fields"] == {"iconCheckedAt": now} and len(calls) == 1
    plan_source_icon(_source(), tmp_path, {"iconCheckedAt": now}, user_agent="t",
                     now=now + ICON_RETRY_SECONDS, fetch=failing_fetch)
    assert len(calls) == 2


def test_plan_source_icon_uses_fetched_file(tmp_path):
    def fetch(base_url, dest, source_id, **kwargs):
        path = Path(dest) / f"{source_id}.png"
        path.write_bytes(PNG)
        return path

    now = ICON_RETRY_SECONDS + 5.0
    plan = plan_source_icon(_source(), tmp_path, {}, user_agent="t", now=now, fetch=fetch)
    assert plan["fields"]["iconCheckedAt"] == now
    assert plan["upload"] and plan["upload"][1] == plan["fields"]["iconKey"]
