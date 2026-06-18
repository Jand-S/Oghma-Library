import httpx
import pytest

from oghma.scraper import chapter_assets
from oghma.scraper.base import RawPage


class FakeFetcher:
    async def get(self, url: str) -> RawPage:
        if "missing" in url:
            response = httpx.Response(404, request=httpx.Request("GET", url))
            raise httpx.HTTPStatusError("missing", request=response.request, response=response)
        return RawPage(url=url, html=b"\x89PNG\r\n\x1a\nimage", content_type="image/png")


@pytest.mark.asyncio
async def test_localize_downloads_images_and_ignores_existing_local_refs(monkeypatch):
    monkeypatch.setattr(chapter_assets, "_existing_asset", lambda *args: None)
    monkeypatch.setattr(
        chapter_assets.storage,
        "save_asset",
        lambda source, slug, filename, data: f"/srv/oghma/assets/{source}/{slug}/{filename}",
    )
    html = '<p><img src="https://cdn.test/scene.png"><img src="../assets/already.webp"></p>'

    result = await chapter_assets.localize_chapter_images(
        FakeFetcher(), html, "https://site.test/chapter/1", "source", "novel"
    )

    assert result.downloaded == 1
    assert result.failed == 0
    assert 'src="../assets/' in result.html
    assert 'src="../assets/already.webp"' in result.html
    assert chapter_assets.external_image_urls(result.html, "https://site.test/chapter/1") == []


@pytest.mark.asyncio
async def test_localize_removes_permanently_missing_and_invalid_images(monkeypatch):
    monkeypatch.setattr(chapter_assets, "_existing_asset", lambda *args: None)
    html = '<p>before<img src="https://cdn.test/missing.jpg"><img src="https://:0">after</p>'

    result = await chapter_assets.localize_chapter_images(
        FakeFetcher(), html, "https://site.test/chapter/1", "source", "novel"
    )

    assert result.removed == 2
    assert result.failed == 0
    assert "<img" not in result.html


@pytest.mark.asyncio
async def test_repair_mode_removes_unavailable_images(monkeypatch):
    monkeypatch.setattr(chapter_assets, "_existing_asset", lambda *args: None)

    class OfflineFetcher:
        async def get(self, url):
            raise httpx.ConnectError("offline")

    result = await chapter_assets.localize_chapter_images(
        OfflineFetcher(),
        '<p><img src="https://dead.test/image.jpg"></p>',
        "https://site.test/chapter/1",
        "source",
        "novel",
        remove_unavailable=True,
    )

    assert result.removed == 1
    assert result.failed == 0
    assert "<img" not in result.html


@pytest.mark.asyncio
async def test_repair_mode_removes_non_404_http_errors(monkeypatch):
    monkeypatch.setattr(chapter_assets, "_existing_asset", lambda *args: None)

    class ForbiddenFetcher:
        async def get(self, url):
            response = httpx.Response(403, request=httpx.Request("GET", url))
            raise httpx.HTTPStatusError("forbidden", request=response.request, response=response)

    result = await chapter_assets.localize_chapter_images(
        ForbiddenFetcher(),
        '<img src="https://blocked.test/image.jpg">',
        "https://site.test/chapter/1",
        "source",
        "novel",
        remove_unavailable=True,
    )

    assert result.removed == 1
    assert result.failed == 0
    assert result.html == ""
