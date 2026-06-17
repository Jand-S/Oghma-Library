"""Probe manual da API House Saikai."""
from __future__ import annotations

import json
from urllib.parse import urlencode

import httpx


API = "https://api.housesaikai.net/api"
STORY_ID = 271
STORY_SLUG = "a-ameaca-do-rei-demonio"


def show(resp: httpx.Response) -> None:
    print("\n", resp.request.method, resp.url)
    print(resp.status_code, resp.headers.get("content-type"), "bytes", len(resp.content))
    try:
        data = resp.json()
    except json.JSONDecodeError:
        print(resp.text[:500])
        return
    if isinstance(data, dict):
        print("keys", list(data.keys())[:20])
        payload = data.get("data", data)
        if isinstance(payload, dict):
            print("data keys", list(payload.keys())[:60])
            for key in ["id", "title", "slug", "image", "releases_count", "content", "body", "text"]:
                if key in payload:
                    value = payload[key]
                    print(key, str(value)[:240])
        elif isinstance(payload, list):
            print("data list", len(payload), "first keys", list(payload[0].keys())[:50] if payload else [])
            if payload:
                print(json.dumps(payload[0], ensure_ascii=False)[:900])
        if "meta" in data:
            print("meta", data["meta"])
    else:
        print(type(data), str(data)[:500])


def main() -> None:
    headers = {
        "accept": "application/json, text/plain, */*",
        "origin": "https://housesaikai.net",
        "referer": "https://housesaikai.net/",
        "user-agent": "Mozilla/5.0 OghmaProbe",
    }
    relationships = "language,type,format,genre,genres,authors,releases,separators"
    paths = [
        "/stories?" + urlencode({
            "format": 1,
            "hdropped": 1,
            "q": "",
            "status": "null",
            "genres": "",
            "country": "null",
            "sortProperty": "title",
            "sortDirection": "asc",
            "page": 1,
            "per_page": 2,
            "relationships": "language,type,format",
        }),
        f"/stories/{STORY_ID}",
        f"/stories/{STORY_SLUG}",
        f"/stories/{STORY_ID}?relationships={relationships}",
        f"/stories/{STORY_SLUG}?relationships={relationships}",
        f"/stories/{STORY_ID}/releases",
        f"/stories/{STORY_SLUG}/releases",
        f"/stories/{STORY_ID}/chapters",
        f"/stories/{STORY_SLUG}/chapters",
        f"/releases?story_id={STORY_ID}",
        f"/releases?story={STORY_ID}",
        f"/releases?story_slug={STORY_SLUG}",
        f"/releases?stories={STORY_ID}",
        f"/releases?story_id[]={STORY_ID}",
        f"/releases?filter[story_id]={STORY_ID}",
        f"/releases?filters[story_id]={STORY_ID}",
        f"/releases?where[story_id]={STORY_ID}",
        f"/releases?storyId={STORY_ID}",
        f"/releases?story_id={STORY_ID}&relationships=story,separator,releaseText",
        f"/releases?format=1&story_id={STORY_ID}&sortProperty=order&sortDirection=asc&page=1&per_page=20",
        f"/releases?format=1&story={STORY_ID}&sortProperty=order&sortDirection=asc&page=1&per_page=20",
        "/releases?format=1&sortProperty=published_at&sortDirection=desc&page=1&per_page=3&relationships=story,separator",
        f"/releases/{STORY_ID}",
    ]
    with httpx.Client(headers=headers, follow_redirects=True, timeout=30) as client:
        for path in paths:
            try:
                show(client.get(API + path))
            except Exception as exc:
                print("\nERR", path, exc)


if __name__ == "__main__":
    main()
