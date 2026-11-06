import httpx
import pytest

from app.ingest import product
from app.ingest.product import SiteRefused, fetch, gather_source, normalise_url


@pytest.fixture(autouse=True)
def no_dns(monkeypatch):
    # tests use made-up shops; resolve-and-check is covered elsewhere
    monkeypatch.setattr(product, "safe_get", _safe_get_no_dns)
    monkeypatch.setattr(product.time, "sleep", lambda s: None)


def _safe_get_no_dns(url, client=None, timeout=None, headers=None):
    from app.netsafe import SafeResponse
    r = client.get(url, headers=headers)
    return SafeResponse(str(r.url), r.status_code, r.headers, r.content)


def client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_links_are_accepted_as_people_paste_them():
    assert normalise_url("  shop.example.com/products/tee ") == "https://shop.example.com/products/tee"
    assert normalise_url("<https://a.example.com/x>") == "https://a.example.com/x"


def test_busy_site_is_retried_then_read():
    calls = []

    def handler(req):
        calls.append(1)
        if req.url.path.endswith(".js"):
            return httpx.Response(404)
        return httpx.Response(429) if len(calls) == 1 else httpx.Response(200, html="<title>Tee</title><p>" + "Soft cotton tee. " * 30 + "</p>")
    page = fetch("https://shop.example.com/products/tee", client(handler))
    assert "Soft cotton tee" in page.text


def test_bot_check_is_reported_honestly_not_bypassed():
    seen = []

    def handler(req):
        seen.append(str(req.url))
        return httpx.Response(200, html="<html><title>Just a moment...</title><div id='challenge-platform'></div></html>")
    with pytest.raises(SiteRefused):
        fetch("https://shop.example.com/products/tee", client(handler))
    assert len(seen) == 1          # no second disguise, no third-party detour


def test_unreadable_page_points_to_pasting_the_description(monkeypatch):
    def refuse(url, client=None):
        raise SiteRefused("shop.example.com only lets people in a browser see this page")
    monkeypatch.setattr(product, "fetch", refuse)
    with pytest.raises(product.SourceUnavailable, match="paste it into 'Page won't load\\?'"):
        gather_source("https://shop.example.com/p")
    # with pasted copy the script still goes ahead, flagged
    _, text, flags = gather_source("https://shop.example.com/p", product_copy="Pet Tee. Embroidered from your pet's photo.")
    assert "Embroidered" in text and any("pasted product copy only" in f.message for f in flags)


def test_javascript_store_still_yields_embedded_product_data():
    html = """<html><title>Tee</title><body><div id="root"></div>
      <script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"product":
        {"name":"Pet Tee","price":1399,"description":"Embroidered from your pet's photo","sku":"PT-1"}}}}</script></body></html>"""
    page = product.parse_html("https://shop.example.com/p", html)
    assert page.structured and page.structured[0]["name"] == "Pet Tee" and page.structured[0]["price"] == 1399


def test_woocommerce_store_api_adds_product_details():
    def handler(req):
        if "/wp-json/wc/store/v1/products" in str(req.url):
            return httpx.Response(200, json=[{"name": "Cushion", "description": "<p>Memory foam</p>",
                                              "prices": {"price": "2999", "currency_code": "INR"}, "images": [], "attributes": []}])
        return httpx.Response(200, html="<title>Cushion</title><p>" + "Comfort cushion. " * 30 + "</p>")
    page = fetch("https://shop.example.com/product/cushion/", client(handler))
    assert any(s.get("@source") == "woocommerce" and s["description"] == "Memory foam" for s in page.structured)
