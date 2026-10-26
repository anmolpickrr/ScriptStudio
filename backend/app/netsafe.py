"""Safe outbound fetching for user-supplied URLs.

The app fetches product and reference links that users type in, so it must
not be usable to reach internal services (SSRF): only http(s), only public
IPs (checked on every redirect hop), bounded size and time.
"""
from __future__ import annotations

import ipaddress
import os
import socket
from urllib.parse import urljoin, urlparse

import httpx

from .config import settings

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0 Safari/537.36")


class UnsafeURL(ValueError):
    pass


def check_url(url: str) -> str:
    p = urlparse(url)
    if p.scheme not in ("http", "https") or not p.hostname:
        raise UnsafeURL("Only http(s) links are supported.")
    if p.username or p.password:
        raise UnsafeURL("Links with embedded credentials are not allowed.")
    host = p.hostname.lower().rstrip(".")
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal")) or "." not in host:
        raise UnsafeURL("Links to private or internal addresses are not allowed.")
    try:
        infos = socket.getaddrinfo(host, p.port or (443 if p.scheme == "https" else 80))
    except socket.gaierror:
        # Behind an egress proxy (some dev sandboxes) DNS happens at the proxy; IP literals are still checked.
        if _via_proxy() and not _is_ip(host):
            return url
        raise UnsafeURL(f"Can't resolve host '{p.hostname}'.")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global or ip.is_multicast:
            raise UnsafeURL("Links to private or internal addresses are not allowed.")
    return url


def _via_proxy() -> bool:
    return bool(os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy"))


def _is_ip(host: str) -> bool:
    try:
        ipaddress.ip_address(host.strip("[]"))
        return True
    except ValueError:
        return False


class SafeResponse:
    def __init__(self, url: str, status_code: int, headers: httpx.Headers, content: bytes):
        self.url, self.status_code, self.headers, self.content = url, status_code, headers, content

    @property
    def text(self) -> str:
        return self.content.decode(self._charset(), errors="replace")

    def json(self):
        import json
        return json.loads(self.content)

    def _charset(self) -> str:
        ct = self.headers.get("content-type", "")
        return ct.split("charset=")[-1].split(";")[0].strip() if "charset=" in ct else "utf-8"

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(f"HTTP {self.status_code} from {self.url}", request=None, response=None)  # type: ignore[arg-type]


def safe_get(url: str, client: httpx.Client | None = None, max_redirects: int = 5,
             timeout: float | None = None) -> SafeResponse:
    own = client is None
    client = client or httpx.Client(timeout=timeout or settings.fetch_timeout_sec, follow_redirects=False,
                                    headers={"User-Agent": UA, "Accept-Language": "en-IN,en;q=0.9"})
    try:
        for _ in range(max_redirects + 1):
            check_url(url)
            with client.stream("GET", url) as r:
                if r.is_redirect and r.headers.get("location"):
                    url = urljoin(url, r.headers["location"])
                    continue
                buf = bytearray()
                for chunk in r.iter_bytes():
                    buf += chunk
                    if len(buf) > settings.fetch_max_bytes:
                        break
                return SafeResponse(str(r.url), r.status_code, r.headers, bytes(buf))
        raise UnsafeURL("Too many redirects.")
    finally:
        if own:
            client.close()
