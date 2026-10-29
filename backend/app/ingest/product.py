"""Product-link analysis.

The product page is the source of truth for product details. We collect
everything the page states (structured data first, visible copy second),
ask the model to extract facts *with verbatim quotes*, and then verify every
quote against the page text in code. Facts that fail verification are kept
for transparency but never reach the writer.
"""
from __future__ import annotations
import time

import json
import re
from typing import Optional
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup
from pydantic import BaseModel

from ..llm import LLM
from ..netsafe import UnsafeURL, safe_get
from ..prompts import PRODUCT_EXTRACT_SYSTEM
from ..schemas import Evidence, FactCategory, Flag, ProductDossier, ProductFact

class PageSource(BaseModel):
    url: str
    title: str = ""
    structured: list[dict] = []   # JSON-LD Product objects / Shopify product JSON
    meta: dict[str, str] = {}
    text: str = ""
    image_urls: list[str] = []


# ------------------------------------------------------------------ fetching

def fetch(url: str, client: Optional[httpx.Client] = None) -> PageSource:
    resp = safe_get(url, client)
    # busy stores answer "too many requests" or "unavailable" for a moment; wait briefly and ask again
    for wait in (2, 5):
        if resp.status_code not in (429, 503):
            break
        ra = resp.headers.get("retry-after", "")
        time.sleep(min(float(ra), 8) if ra.isdigit() else wait)
        resp = safe_get(url, client)
    resp.raise_for_status()
    src = parse_html(resp.url, resp.text)
    shopify = _try_shopify(client, resp.url)
    if shopify:
        src.structured.append(shopify)
        src.image_urls = _dedupe(src.image_urls + [i for i in shopify.get("images", []) if isinstance(i, str)])
    return src


def _try_shopify(client: Optional[httpx.Client], url: str) -> Optional[dict]:
    """Shopify stores (most D2C brands) expose clean product JSON at <product-url>.js."""
    if "/products/" not in urlparse(url).path:
        return None
    try:
        r = safe_get(url.split("?")[0].rstrip("/") + ".js", client)
        if r.status_code == 200 and r.headers.get("content-type", "").startswith(("application/json", "text/javascript")):
            data = r.json()
            data["description"] = _html_to_text(data.get("description", ""))
            data["images"] = [("https:" + i if i.startswith("//") else i) for i in data.get("images", [])]
            keep = ("title", "vendor", "type", "description", "tags", "images", "variants", "options", "price")
            out = {k: data[k] for k in keep if k in data}
            out["variants"] = [{k: v.get(k) for k in ("title", "price", "available", "sku")}
                               for v in out.get("variants", [])]
            return {"@source": "shopify", **out}
    except Exception:
        return None
    return None


def parse_html(url: str, html: str) -> PageSource:
    soup = BeautifulSoup(html, "html.parser")
    src = PageSource(url=url, title=(soup.title.string or "").strip() if soup.title else "")

    for tag in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(tag.string or "")
        except Exception:
            continue
        for node in _walk_jsonld(data):
            if _is_type(node, "Product"):
                src.structured.append(_trim_jsonld(node))

    for m in soup.find_all("meta"):
        key = m.get("property") or m.get("name")
        if key and m.get("content") and (key.startswith(("og:", "product:", "twitter:")) or key == "description"):
            src.meta[key] = m["content"].strip()

    images = []
    if src.meta.get("og:image"):
        images.append(src.meta["og:image"])
    for node in src.structured:
        img = node.get("image")
        images.extend(img if isinstance(img, list) else [img] if img else [])
    for img in soup.find_all("img"):
        s = img.get("src") or img.get("data-src") or ""
        if s and ("product" in s.lower() or "product" in (img.get("alt") or "").lower()):
            images.append(s)
    src.image_urls = _dedupe([urljoin(url, i if isinstance(i, str) else i.get("url", ""))
                              for i in images if i])[:8]

    for t in soup(["script", "style", "noscript", "svg", "nav", "footer", "header", "form", "iframe"]):
        t.decompose()
    src.text = _normalise(soup.get_text(" "))[:20000]
    return src


def _walk_jsonld(data):
    if isinstance(data, list):
        for d in data:
            yield from _walk_jsonld(d)
    elif isinstance(data, dict):
        yield data
        for k in ("@graph", "mainEntity", "itemListElement"):
            if k in data:
                yield from _walk_jsonld(data[k])


def _is_type(node: dict, t: str) -> bool:
    nt = node.get("@type")
    return nt == t or (isinstance(nt, list) and t in nt)


def _trim_jsonld(node: dict) -> dict:
    keep = ("name", "brand", "description", "sku", "gtin13", "image", "offers", "aggregateRating",
            "additionalProperty", "material", "color", "size", "weight", "category")
    return {k: node[k] for k in keep if k in node}


def _html_to_text(html: str) -> str:
    return _normalise(BeautifulSoup(html or "", "html.parser").get_text(" "))


def _normalise(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def _dedupe(items: list[str]) -> list[str]:
    seen, out = set(), []
    for i in items:
        if i and i not in seen:
            seen.add(i)
            out.append(i)
    return out


def corpus(src: PageSource, product_copy: str = "") -> str:
    """The exact text facts must be quoted from."""
    parts = [f"TITLE: {src.title}"]
    parts += [f"META {k}: {v}" for k, v in src.meta.items()]
    parts += [f"STRUCTURED: {json.dumps(s, ensure_ascii=False)}" for s in src.structured]
    parts.append(f"PAGE TEXT: {src.text}")
    if product_copy.strip():
        parts.append(f"CLIENT-SUPPLIED PRODUCT COPY: {_normalise(product_copy)[:15000]}")
    return "\n".join(parts)


# ------------------------------------------------------------------ extraction

class _ExtractedFact(BaseModel):
    category: FactCategory
    statement: str
    quote: str
    from_image: bool


class _Extraction(BaseModel):
    product_name: str
    brand: str
    facts: list[_ExtractedFact]
    packaging_description: str
    unknowns: list[str]


def _canon(s: str) -> str:
    s = s.lower().replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    s = re.sub(r"\\u[0-9a-f]{4}", " ", s)
    return re.sub(r"[^a-z0-9%.'\"]+", " ", s).strip()


def quote_in_source(quote: str, source: str) -> bool:
    q = _canon(quote)
    return bool(q) and len(q) >= 3 and q in _canon(source)


class SourceUnavailable(RuntimeError):
    pass


def gather_source(url: str, page: Optional[PageSource] = None, product_copy: str = "",
                  extra_images: Optional[list[str]] = None) -> tuple[PageSource, str, list[Flag]]:
    """Fetch the product page (or fall back to pasted copy) and build the text facts must be quoted from."""
    flags: list[Flag] = []
    try:
        page = page or fetch(url)
    except UnsafeURL as e:
        raise ValueError(str(e))
    except Exception as e:
        if not product_copy.strip():
            raise SourceUnavailable(f"Could not read the product link ({e}). Check the link is public, or paste "
                                    "the product description into 'Page won't load?' and try again.")
        flags.append(Flag(severity="major", area="product",
                          message=f"Could not read the product link ({e}); using the pasted product copy only.",
                          suggestion="Double-check the pasted copy is current."))
        page = PageSource(url=url)
    page.image_urls = _dedupe((extra_images or []) + page.image_urls)
    text = corpus(page, product_copy)
    if len(page.text) < 200 and not page.structured and not product_copy.strip():
        flags.append(Flag(severity="major", area="product",
                          message="The product page exposes very little readable text (likely rendered by JavaScript).",
                          suggestion="Paste the product description so claims can be verified."))
    return page, text, flags


def build_dossier(url: str, page: PageSource, text: str, ext: "_Extraction", product_copy: str = "",
                  ids: Optional[list[str]] = None) -> tuple[ProductDossier, list[Flag]]:
    """Verify every extracted fact against the source text; unverifiable ones are kept but withheld."""
    flags: list[Flag] = []
    facts: list[ProductFact] = []
    for i, f in enumerate(ext.facts, 1):
        if f.from_image:
            ev = Evidence(source="image", quote=f.quote)
            ok = f.category == "packaging"  # images may only support packaging observations
            note = "Observed in product imagery; confirm against the physical pack." if ok else \
                "Image-only evidence is not accepted for non-packaging claims."
        else:
            ev = Evidence(source="client_copy" if product_copy and _canon(f.quote) in _canon(product_copy)
                          else "product_page", quote=f.quote)
            ok = quote_in_source(f.quote, text)
            note = "" if ok else "Quote not found on the product page; excluded from the script."
        fid = ids[i - 1] if ids else f"F{i}"
        facts.append(ProductFact(id=fid, category=f.category, statement=f.statement, evidence=ev, verified=ok, note=note))

    dropped = [f for f in facts if not f.verified]
    if dropped:
        flags.append(Flag(severity="minor", area="product",
                          message=f"{len(dropped)} extracted detail(s) could not be verified against the page "
                                  "and were withheld from the script: " + "; ".join(f.statement for f in dropped[:5]),
                          suggestion="Confirm these with the client if they matter to the story."))
    if not any(f.category == "packaging" and f.verified for f in facts):
        flags.append(Flag(severity="major", area="product",
                          message="No verifiable packaging details (pack shape, colour, label) were found.",
                          suggestion="Share pack images or a physical sample; pack shots are written as "
                                     "'[USE ACTUAL PACK]' until then."))
    for u in ext.unknowns:
        flags.append(Flag(severity="info", area="product", message=f"Not stated on product page: {u}"))
    dossier = ProductDossier(url=url, name=ext.product_name, brand=ext.brand, facts=facts,
                             packaging_description=ext.packaging_description,
                             image_urls=page.image_urls, unknowns=ext.unknowns, source_excerpt=text[:20000])
    return dossier, flags


def analyse_product(url: str, llm: LLM, page: Optional[PageSource] = None, product_copy: str = "",
                    extra_images: Optional[list[str]] = None) -> tuple[ProductDossier, list[Flag]]:
    try:
        page, text, flags = gather_source(url, page, product_copy, extra_images)
    except SourceUnavailable as e:
        return ProductDossier(url=url, unknowns=["Entire product page unreadable"]), [
            Flag(severity="blocker", area="product", message=str(e))]
    ext = llm.structured(stage="extract_product", system=PRODUCT_EXTRACT_SYSTEM,
                         user=f"PRODUCT URL: {url}\n\nSOURCE:\n{text}", schema=_Extraction,
                         images=page.image_urls[:4])
    dossier, more = build_dossier(url, page, text, ext, product_copy)
    return dossier, flags + more
