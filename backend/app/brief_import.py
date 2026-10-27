"""Import a client brief from a .docx (e.g. the team's Creative Brief template, downloaded from Google Docs).

Lines of the form "Label: value" are matched to form fields by their label; the whole document also becomes
the brief text, so nothing the client wrote is lost even if a label isn't recognised.
"""
from __future__ import annotations

import io
import re
from typing import Optional

from . import playbook

PLACEHOLDERS = {"click to select", "select", "n/a", "na", "-", "—", "tbd", "none", "(age, location, interests)"}

# (field, keywords that identify the label), checked in order; first match wins
LABELS: list[tuple[str, tuple[str, ...]]] = [
    ("asset_links", ("raw/clicked", "raw", "clicked product")),
    ("product_url", ("product link", "product url", "product page")),
    ("logo_url", ("logo",)),
    ("brand_guidelines_url", ("color palette", "colour palette", "brand guideline")),
    ("brand_name", ("brand",)),
    ("target_audience", ("primary audience", "audience", "target")),
    ("language", ("creative language", "language")),
    ("creative_direction", ("creator direction",)),
    ("platform", ("platform",)),
    ("ad_type", ("ad type",)),
    ("headline_ideas", ("headline",)),
    ("supporting_copy", ("subheadline", "supporting copy")),
    ("key_usps", ("usp", "unique selling")),
    ("offer", ("offer",)),
    ("cta", ("call-to-action", "call to action", "cta")),
    ("direction_summary", ("highlight creative direction", "creative direction")),
    ("design_style", ("design style",)),
    ("references", ("reference",)),
    ("elements_to_highlight", ("elements to highlight", "highlight")),
    ("duration", ("duration", "length")),
    ("tone", ("tone",)),
]
LIST_FIELDS = {"asset_links", "headline_ideas", "key_usps", "references", "elements_to_highlight"}

PLATFORM_WORDS = [("youtube shorts", "youtube_shorts"), ("shorts", "youtube_shorts"), ("reel", "instagram_reels"),
                  ("instagram", "instagram_reels"), ("tiktok", "tiktok"), ("youtube", "youtube"),
                  ("meta", "meta_feed"), ("facebook", "meta_feed"), ("tv", "tv"), ("ctv", "tv")]


class BriefImportError(ValueError):
    pass


def _lines(data: bytes) -> list[str]:
    try:
        from docx import Document
        d = Document(io.BytesIO(data))
    except Exception:
        raise BriefImportError("That file couldn't be opened as a Word document. In Google Docs use "
                               "File → Download → Microsoft Word (.docx), then upload that file.")
    lines: list[str] = []
    body = d.element.body
    from docx.oxml.ns import qn
    from docx.table import Table
    for child in body.iterchildren():
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "p":
            # read every text node, including Google Docs dropdown chips (exported as content controls)
            lines.append("".join(t.text or "" for t in child.iter(qn("w:t"))))
        elif tag == "tbl":
            for row in Table(child, d).rows:
                cells = [c.text.strip() for c in row.cells]
                if len(cells) >= 2 and cells[0] and not cells[0].endswith(":"):
                    cells[0] += ":"
                lines.append(" ".join(dict.fromkeys(c for c in cells if c)))
    return [" ".join(l.split()) for l in lines if l and l.strip()]


def _field_for(label: str) -> Optional[str]:
    low = label.lower()
    for field, keys in LABELS:
        if any(k in low for k in keys):
            return field
    return None


def _clean(value: str) -> str:
    v = re.sub(r"^\((?:age|e\.g\.|eg|if available)[^)]*\)\s*", "", value.strip(), flags=re.I)  # template hints
    v = v.strip().strip("•-–").strip()
    return "" if v.lower() in PLACEHOLDERS else v


def _split(value: str) -> list[str]:
    parts = re.split(r"\s*(?:;|\||\n|,\s(?=https?://)|\s(?=https?://)|\d\)\s)\s*", value)
    return [p.strip() for p in parts if p and p.strip()]


def parse_brief_docx(data: bytes) -> dict:
    if len(data) > 5_000_000:
        raise BriefImportError("That file is larger than 5 MB.")
    lines = _lines(data)
    if not lines:
        raise BriefImportError("The document is empty.")
    fields: dict = {}
    found: list[str] = []
    for line in lines:
        m = re.match(r"^([^:]{2,80}):\s*(.*)$", line)
        if not m:
            continue
        label, value = m.group(1), _clean(m.group(2))
        field = _field_for(label)
        if not field or not value:
            continue
        found.append(label.strip())
        if field in LIST_FIELDS:
            fields.setdefault(field, [])
            fields[field] += [v for v in _split(value) if v not in fields[field]]
        elif field not in fields:
            fields[field] = value

    out: dict = {}
    for k in ("product_url", "logo_url", "brand_guidelines_url"):
        if k in fields:
            url = re.search(r"https?://\S+", fields[k])
            if url:
                out[k] = url.group(0).rstrip(").,")
    if "brand_name" in fields:
        out["brand_name"] = fields["brand_name"][:300]
    if "asset_links" in fields:
        out["asset_links"] = [u for u in fields["asset_links"] if u.startswith("http")][:10]
    for k in ("target_audience", "creative_direction", "ad_type", "offer", "cta", "design_style", "tone"):
        if k in fields:
            out[k] = fields[k][:300] if k not in ("target_audience", "creative_direction") else fields[k][:1000]
    for k in ("headline_ideas", "key_usps", "elements_to_highlight"):
        if k in fields:
            out[k] = [v[:300] for v in fields[k]][:10]
    if "references" in fields:
        out["references"] = [{"kind": "url" if r.startswith("http") else "note", "value": r[:2000], "what_to_take": ""}
                             for r in fields["references"][:8]]
    if "language" in fields:
        lang = fields["language"].lower()
        out["language"] = next((l for l in playbook.SPEECH_WPS if l.lower() in lang), fields["language"][:60])
    if "platform" in fields:
        plat = fields["platform"].lower()
        key = next((v for w, v in PLATFORM_WORDS if w in plat), None)
        if key:
            out["platform"] = key
    if "duration" in fields:
        n = re.search(r"\d+", fields["duration"])
        if n:
            out["duration_sec"] = int(n.group(0))

    # The full document is the brief: the model reads everything, including fields we don't map.
    text = "\n".join(lines)
    out["client_brief"] = text[:20000]
    summary = fields.get("direction_summary", "")
    free_text = [l for l in lines if not re.match(r"^([^:]{2,80}):\s*$", l) and not re.match(r"^\d+\.\s", l)
                 and l.lower() not in ("creative brief", "brand:")]
    return {"fields": out, "recognised": found, "direction_summary": summary,
            "has_content": bool(found) or sum(len(l) for l in free_text) > 150}
