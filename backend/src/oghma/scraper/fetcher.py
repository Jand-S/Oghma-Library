"""Fetcher HTTP com rate-limit por dominio e retry/backoff."""
from __future__ import annotations

import asyncio
import shutil
import tempfile
import time
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from ..config import get_settings
from .base import RawPage


class HttpFetcher:
    def __init__(
        self,
        rate_limit_seconds: float | None = None,
        headers: dict[str, str] | None = None,
        http2: bool = True,
        use_curl: bool = False,
        curl_bin: str = "curl",
    ) -> None:
        s = get_settings()
        self.rate_limit_seconds = rate_limit_seconds or s.default_rate_limit_seconds
        self._last: dict[str, float] = {}
        self._lock = asyncio.Lock()
        client_headers = {
            "User-Agent": s.user_agent,
            "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.6",
        }
        if headers:
            client_headers.update(headers)
        self.headers = client_headers
        self.use_curl = use_curl
        self.curl_bin = curl_bin
        self._curl_impersonate = curl_bin != "curl"
        self._client = httpx.AsyncClient(
            headers=client_headers,
            timeout=s.request_timeout_seconds,
            follow_redirects=True,
            http2=http2,
        )

    async def _throttle(self, host: str) -> None:
        async with self._lock:
            now = time.monotonic()
            wait = self._last.get(host, 0) + self.rate_limit_seconds - now
            if wait > 0:
                await asyncio.sleep(wait)
            self._last[host] = time.monotonic()

    @retry(
        reraise=True,
        stop=stop_after_attempt(4),
        wait=wait_exponential(multiplier=1, min=2, max=30),
        retry=retry_if_exception_type((httpx.TransportError, httpx.HTTPStatusError)),
    )
    async def get(self, url: str) -> RawPage:
        host = urlsplit(url).netloc
        await self._throttle(host)
        if self.use_curl:
            return await self._curl_get(url)
        resp = await self._client.get(url)
        if resp.status_code in (429, 500, 502, 503, 504):
            resp.raise_for_status()
        resp.raise_for_status()
        return RawPage(
            url=str(resp.url),
            html=resp.content,
            etag=resp.headers.get("ETag"),
            last_modified=resp.headers.get("Last-Modified"),
            content_type=resp.headers.get("Content-Type"),
        )

    async def _curl_get(self, url: str) -> RawPage:
        curl = shutil.which(self.curl_bin)
        if curl is None and self.curl_bin == "curl":
            curl = shutil.which("curl.exe")
        if curl is None:
            raise RuntimeError(f"curl transport requested, but {self.curl_bin!r} was not found")

        with tempfile.TemporaryDirectory(prefix="oghma-curl-") as tmp:
            body_path = Path(tmp) / "body.bin"
            args = [
                curl,
                "-sS",
                "-L",
                "-o",
                str(body_path),
                "-w",
                "%{http_code}\n%{url_effective}\n%{content_type}",
            ]
            if self._curl_impersonate:
                # The bundled NSS build cannot read Debian's PEM CA bundle.
                args.append("-k")
                cookie = self.headers.get("Cookie")
                if cookie:
                    args.extend(["-H", f"Cookie: {cookie}"])
            else:
                for name, value in self.headers.items():
                    args.extend(["-H", f"{name}: {value}"])
            args.append(url)

            proc = await asyncio.create_subprocess_exec(
                *args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()
            if proc.returncode != 0:
                message = stderr.decode("utf-8", errors="ignore").strip() or f"curl exited {proc.returncode}"
                raise httpx.TransportError(message)
            parts = stdout.decode("utf-8", errors="ignore").splitlines()
            status = int(parts[0]) if parts and parts[0].isdigit() else 0
            final_url = parts[1] if len(parts) > 1 and parts[1] else url
            content_type = parts[2] if len(parts) > 2 and parts[2] else None
            body = body_path.read_bytes()
            response = httpx.Response(
                status_code=status,
                headers={"Content-Type": content_type or ""},
                content=body,
                request=httpx.Request("GET", url),
            )
            if status in (429, 500, 502, 503, 504):
                response.raise_for_status()
            response.raise_for_status()
            return RawPage(url=final_url, html=body, content_type=content_type)

    async def get_json(self, url: str, params: dict | None = None) -> object:
        host = urlsplit(url).netloc
        await self._throttle(host)
        resp = await self._client.get(url, params=params)
        resp.raise_for_status()
        return resp.json()

    async def aclose(self) -> None:
        await self._client.aclose()
