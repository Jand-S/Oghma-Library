from datetime import datetime, timezone

from oghma.api.routes import _crawl_run_out
from oghma.api.monitor import MONITOR_HTML, router as monitor_router


class DummyCrawlRun:
    id = 12
    source_id = "central-novel"
    status = "running"
    stats = {
        "stage": "downloading_chapter",
        "current_novel_title": "A Will Eternal",
        "current_novel_chapters_done": 100,
        "current_novel_chapters_total": 1315,
    }
    error = None
    started_at = datetime(2026, 6, 16, 18, 13, tzinfo=timezone.utc)
    finished_at = None


def test_crawl_run_out_uses_desktop_camel_case_contract():
    payload = _crawl_run_out(DummyCrawlRun()).model_dump(by_alias=True)

    assert payload["id"] == 12
    assert payload["sourceId"] == "central-novel"
    assert payload["status"] == "running"
    assert payload["stats"]["stage"] == "downloading_chapter"
    assert payload["stats"]["current_novel_title"] == "A Will Eternal"
    assert payload["startedAt"] == "2026-06-16T18:13:00+00:00"
    assert payload["finishedAt"] == ""
    assert payload["error"] == ""


def test_monitor_route_is_registered():
    paths = {getattr(route, "path", "") for route in monitor_router.routes}

    assert "/monitor" in paths


def test_monitor_page_polls_crawl_and_stats_endpoints():
    assert 'fetch("/api/crawls?limit=12"' in MONITOR_HTML
    assert 'fetch("/api/stats"' in MONITOR_HTML
