"""The script document as a renderer-neutral outline.

Both the HTML (preview + Google Docs import) and the Word renderer draw this same outline, so every output
has identical content and structure. The layout follows the team's Creative Brief template: a bold title
and "BRAND:" line, numbered section headings, and bullet pointers of the form **Label:** value, with a rule
between sections. Part 1 is the filled-in creative brief; part 2 is the video script.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional, Union

from .. import playbook
from ..house_format import BRIEF_KEYS, FormatSpec
from ..schemas import Job

MISSING = "Not provided"
SEV_ORDER = {"blocker": 0, "major": 1, "minor": 2, "info": 3}
SEV_LABEL = {"blocker": "BLOCKER", "major": "IMPORTANT", "minor": "NOTE", "info": "FYI"}


@dataclass
class Item:
    """A bullet: bold label, then a value. A list value becomes nested bullets."""
    label: str
    value: Union[str, list[str]] = ""
    link: str = ""        # makes the value a hyperlink
    muted: bool = False   # value is a placeholder ("Not provided")


@dataclass
class Sub:
    """A small heading inside a section (e.g. one scene)."""
    text: str
    items: list[Item] = field(default_factory=list)


@dataclass
class Note:
    text: str


@dataclass
class Table:
    header: list[str]
    rows: list[list[str]]


@dataclass
class Section:
    number: int
    title: str
    blocks: list[Union[Item, Sub, Note, Table]] = field(default_factory=list)


@dataclass
class Part:
    title: str
    brand: str
    meta: str
    sections: list[Section] = field(default_factory=list)


def ts(sec: float) -> str:
    sec = round(sec, 1)
    m, s = divmod(sec, 60)
    return f"{int(m)}:{s:04.1f}" if s % 1 else f"{int(m)}:{int(s):02d}"


def _v(value: Optional[str]) -> tuple[str, bool]:
    value = (value or "").strip()
    return (value, False) if value else (MISSING, True)


def item(label: str, value: Union[str, list[str], None], link: str = "") -> Item:
    if isinstance(value, list):
        vals = [v for v in value if v and v.strip()]
        return Item(label, vals) if vals else Item(label, MISSING, muted=True)
    text, muted = _v(value)
    return Item(label, text, link=link if not muted else "", muted=muted)


def build(job: Job, spec: FormatSpec, include_qc: bool = False) -> list[Part]:
    s = job.script
    assert s is not None
    i, b, d = job.inputs, job.brief, job.dossier
    plat = playbook.platform(i.platform)
    brand = (d.brand if d and d.brand else "") or (i.brand_name or "")
    chosen = None
    if job.concepts:
        idx = job.concept_decision.chosen_index if job.concept_decision else 0
        chosen = job.concepts[min(max(idx, 0), len(job.concepts) - 1)]
    used = {fid for sc in s.scenes for fid in sc.product_fact_ids}
    verified = d.verified_facts() if d else []

    def brief_section(key: str) -> list:
        if key == "brief_basic":
            return [item("Product Link", i.product_url, link=i.product_url),
                    item("Product", d.name if d else ""),
                    item("Logo Image", i.logo_url, link=i.logo_url),
                    item("Color Palette or Brand Guidelines Link", i.brand_guidelines_url, link=i.brand_guidelines_url),
                    item("Raw/Clicked Product Link (Images/Videos)", list(dict.fromkeys(i.asset_links + i.product_image_urls)))]
        if key == "brief_audience":
            return [item("Primary Audience", (b.audience if b else "") or i.target_audience),
                    item("Audience Insight", b.audience_insight if b else ""),
                    item("Creative Language", i.language),
                    item("Creator Direction", i.creative_direction)]
        if key == "brief_format":
            return [item("Platform", plat["label"]), item("Ad Type", i.ad_type),
                    item("Duration", f"{i.duration_sec} seconds"), item("Aspect Ratio", i.aspect_ratio or plat["aspect"]),
                    item("Hook Type", s.hook_type.replace("_", " ").title())]
        if key == "brief_messaging":
            selling = ("feature", "benefit", "claim", "ingredient", "spec", "certification")
            usps = i.key_usps or [f.statement for f in verified if f.id in used and f.category in selling][:6]
            return [item("Headline Options", s.headline_options or i.headline_ideas),
                    item("Subheadline / Supporting Copy", s.supporting_copy or (b.key_message if b else "")),
                    item("Key USPs (Unique Selling Points)", usps),
                    item("Offer", i.offer),
                    item("Call-To-Action (CTA)", s.cta.line or i.cta)]
        if key == "brief_direction":
            return [item("Highlight Creative Direction", s.concept_summary),
                    item("Objective", b.objective if b else ""), item("Key Message", b.key_message if b else ""),
                    item("Tone", s.tone or i.tone), item("Theme", s.theme or (i.theme or ""))]
        if key == "brief_visual":
            refs = [f"{r.value} — {r.what_to_take}" if r.what_to_take else r.value for r in i.references]
            return [item("Design Style", i.design_style or s.visual_style),
                    item("Reference Links", refs),
                    item("Elements to Highlight", s.elements_to_highlight or i.elements_to_highlight)]
        return []

    def script_section(key: str) -> Optional[list]:
        if key == "concept":
            out = [item("Title", s.title), item("Logline", s.logline), item("Concept", s.concept_summary)]
            if chosen:
                out += [item("Hook", f"{chosen.hook_line} — {chosen.hook_visual}" if chosen.hook_visual else chosen.hook_line),
                        item("Why It Works", chosen.why_it_works)]
            if job.concept_decision and job.concept_decision.director_notes:
                out.append(item("Director's Notes", job.concept_decision.director_notes))
            return out
        if key == "characters":
            if not s.characters:
                return [Note("No on-screen talent (product-only / hands-only).")]
            return [Item(f"{c.id} · {c.name} ({c.role})", [c.description, f"Keep consistent: {c.continuity}"])
                    for c in s.characters]
        if key == "continuity":
            return [Item("", c) for c in s.continuity] or [Note("None.")]
        if key == "product":
            out: list = [Item(f.id, f.statement) for f in verified if f.id in used] or \
                [Item(f.id, f.statement) for f in verified[:8]]
            pack = d.packaging_description if d else ""
            out.append(item("Packaging", pack or "[USE ACTUAL PACK — details not confirmed]"))
            out.append(Note("Source of truth: the product page. Every claim in the script maps to one of these facts."))
            return out
        if key == "scenes":
            names = {c.id: c.name for c in s.characters}
            if spec.style.scene_layout == "table":
                rows = []
                for sc in s.scenes:
                    audio = "\n".join(([f"VO: {sc.vo}"] if sc.vo else []) +
                                      [f"{names.get(dl.character_id, dl.character_id).upper()}: {dl.line}" for dl in sc.dialogue])
                    rows.append([str(sc.number), f"{ts(sc.start_sec)}–{ts(sc.end_sec)}",
                                 f"{sc.shot}\n{sc.visual}", audio or "—", sc.on_screen_text or "—", sc.sfx_music or "—"])
                return [Table(spec.scene_columns, rows)]
            subs = []
            for sc in s.scenes:
                items = [Item("Location", sc.location), Item("Visual", sc.visual)]
                if sc.vo:
                    items.append(Item("VO", sc.vo))
                for dl in sc.dialogue:
                    who = names.get(dl.character_id, dl.character_id)
                    items.append(Item(f"Dialogue — {who}" + (f" ({dl.delivery})" if dl.delivery else ""), f"“{dl.line}”"))
                for label, val in (("On-screen Text", sc.on_screen_text), ("SFX / Music", sc.sfx_music),
                                   ("Props", ", ".join(sc.props)), ("Transition", sc.transition),
                                   ("Why This Visual", sc.sync_note), ("Product Facts", ", ".join(sc.product_fact_ids))):
                    if val:
                        items.append(Item(label, val))
                subs.append(Sub(f"Scene {sc.number}  ·  {ts(sc.start_sec)}–{ts(sc.end_sec)}  ·  {sc.shot}", items))
            return subs
        if key == "cta":
            return [item("Line", s.cta.line), item("Visual", s.cta.visual),
                    item("End-frame Text", s.cta.on_screen_text), item("Action", s.cta.action)]
        if key == "production":
            return [Item("", n) for n in s.production_notes] or [Note("None.")]
        if key == "open_questions":
            flags = sorted((f for f in job.flags if f.severity != "info"), key=lambda f: SEV_ORDER[f.severity])
            if not flags:
                return None
            return [Note("Resolve these with the client before the shoot. The script avoids every unconfirmed detail.")] + \
                [Item(SEV_LABEL[f.severity], [f.message] + ([f"→ {f.suggestion}"] if f.suggestion else []))
                 for f in flags]
        if key == "qc":
            if not include_qc or not job.qc_history:
                return None
            qc = job.qc_history[-1]
            out = [Item(k.replace("_", " ").title(), f"{v}/5") for k, v in qc.scores.items()]
            status = "Passed all quality gates" if qc.passed else "Editor review recommended"
            out.append(Item("Result", f"{status} (round {qc.iteration}). {qc.summary}".strip()))
            for f in qc.findings:
                if f.severity in ("blocker", "major"):
                    out.append(Item(SEV_LABEL[f.severity], f"{'Scene ' + str(f.scene) + ': ' if f.scene else ''}{f.message}"))
            return out
        return None

    meta = " · ".join(x for x in [plat["label"], f"{i.duration_sec}s", i.aspect_ratio or plat["aspect"], job.format_version] if x)
    brief_part = Part("Creative Brief", brand, meta)
    script_part = Part(f"Video Script — {s.title}", brand, s.logline)
    for sec in spec.sections:
        target = brief_part if sec.key in BRIEF_KEYS else script_part
        blocks = brief_section(sec.key) if sec.key in BRIEF_KEYS else script_section(sec.key)
        if blocks:
            target.sections.append(Section(len(target.sections) + 1, sec.label, blocks))
    return [p for p in (brief_part, script_part) if p.sections]


# ---------------------------------------------------------------- the one-page script sheet (default format)

@dataclass
class SheetScene:
    heading: str                        # "Scene 1 (Hook)"
    lines: list[tuple[str, str]]        # ("Visual", "..."), ("VO (Wife)", "“...”"), ("On-screen text", "...")


@dataclass
class Sheet:
    file_name: str
    brand: str
    product_url: str
    product_names: list[str]            # mentions of these are linked to product_url
    client_brief: str
    title: str
    header: list[tuple[str, str]]       # Model, Language, Image Source, Subtitle, Product, CTA, Idea
    continuity: list[tuple[str, str]]   # ("Wife", "About 34, ..."); label may be "" for free-form items
    disclaimer: str
    scenes: list[SheetScene]
    small_line: str = ""


def _split_label(text: str) -> tuple[str, str]:
    head, sep, rest = text.partition(":")
    if sep and 0 < len(head) <= 40 and rest.strip():
        return head.strip(), rest.strip()
    return "", text.strip()


def _quoted(line: str) -> str:
    line = line.strip()
    return line if line[:1] in "\"“'‘" else f"“{line}”"


PLATFORM_SHORT = {"instagram_reels": "IGReels", "tiktok": "TikTok", "youtube_shorts": "YTShorts", "youtube": "YouTube",
                  "meta_feed": "MetaFeed", "tv": "TV"}


def _camel(text: str, max_words: int = 4) -> str:
    words = re.findall(r"[A-Za-z0-9]+", text.replace("'", ""))[:max_words]
    return "".join(w if any(c.isupper() for c in w[1:]) else w[:1].upper() + w[1:].lower() for w in words)


def brand_of(job: Job) -> str:
    d, i = job.dossier, job.inputs
    if i.brand_name:
        return i.brand_name.strip()
    if d and d.brand:
        return d.brand.strip()
    host = re.sub(r"^www\.", "", re.sub(r"^https?://", "", i.product_url)).split("/")[0]
    return host.split(".")[0].capitalize()


def product_name(job: Job) -> str:
    """The product's short name: the page title without the brand, colour or variant suffix."""
    d, s = job.dossier, job.script
    name = (d.name if d and d.name else "") or (s.product_line if s else "")
    name = re.split(r"\s+[-–—|(\[]\s*|\s*[(\[]", name, maxsplit=1)[0].strip()
    brand = brand_of(job)
    if brand and name.lower().startswith(brand.lower() + " "):
        name = name[len(brand) + 1:]
    return name


def file_name(job: Job) -> str:
    """Brand_Product_Platform_Duration_Date_vN, e.g. Kleenest_StrideComfortCushion_IGReels_30s_2026-10-28_v1."""
    i = job.inputs
    parts = [_camel(brand_of(job), 3) or "Brand", _camel(product_name(job)) or "Product",
             PLATFORM_SHORT.get(i.platform, _camel(i.platform)), f"{i.duration_sec}s", job.created_at[:10],
             f"v{1 + len(job.revisions)}"]
    return "_".join(p for p in parts if p)


def link_spans(text: str, names: list[str], url: str) -> list[tuple[str, str]]:
    """Splits text into (piece, link) pairs, linking every mention of the product to its page."""
    names = sorted({n for n in names if len(n) >= 4}, key=len, reverse=True)
    if not url or not names or not text:
        return [(text, "")]
    pat = re.compile("|".join(re.escape(n) for n in names), re.I)
    out, pos = [], 0
    for m in pat.finditer(text):
        if m.start() > pos:
            out.append((text[pos:m.start()], ""))
        out.append((m.group(0), url))
        pos = m.end()
    if pos < len(text):
        out.append((text[pos:], ""))
    return out


def _button(text: str) -> str:
    """The button label from a CTA description: "User taps 'Shop Now' button…" -> "Shop Now"."""
    m = re.search(r"[‘'\"“]([^’'\"”]{2,30})[’'\"”]", text or "")
    if m:
        return m.group(1).strip()
    t = re.sub(r"^(user\s+)?taps?\s+", "", (text or "").strip(), flags=re.I).rstrip(".")
    return t if 0 < len(t.split()) <= 4 else ""


def build_sheet(job: Job, spec: FormatSpec) -> Sheet:
    s = job.script
    assert s is not None
    i, d = job.inputs, job.dossier
    plat = playbook.platform(i.platform)
    names = {c.id: c.name for c in s.characters}

    model = s.talent_summary or "; ".join(f"{c.name}: {c.description}" for c in s.characters) \
        or i.creative_direction or "Product only (no talent)"
    product = s.product_line or (d.name if d and d.name else "") or (i.brand_name or "")
    cta = i.cta or _button(s.cta.action) or _button(s.cta.on_screen_text) or s.cta.line
    header = [("Model", model), ("Language", i.language), ("Image Source", i.image_source or "Web"),
              ("Subtitle", "Yes" if i.subtitles else "No"),
              ("Format", f"{plat['label']} · {i.duration_sec}s · {i.aspect_ratio or plat['aspect']}"),
              ("Product", product), ("Product Link", i.product_url), ("CTA", cta),
              ("Idea", s.idea or s.concept_summary or s.logline)]

    continuity = [_split_label(c) for c in s.continuity if c.strip()]
    labels = {lbl.lower() for lbl, _ in continuity}
    for c in s.characters:  # every character gets a continuity line, even if the writer missed one
        if c.name.lower() not in labels and not any(c.name.lower() in t.lower() for _, t in continuity):
            continuity.insert(0, (c.name, ". ".join(x.strip().rstrip(".") for x in (c.description, c.continuity) if x.strip()) + "."))
    real = ("Use the real product images as the reference. Do not invent or alter the product.")
    for n, (lbl, text) in enumerate(continuity):
        if lbl.lower() == "product" and "image" not in text.lower():
            continuity[n] = (lbl, f"{text.rstrip('.')}. {real}")
    if "product" not in labels:
        continuity.append(("Product", f"{product or 'The product'} exactly as on the product page. Use the real product "
                                      "images as the reference. Do not invent or alter the product."))

    scenes = []
    for sc in s.scenes:
        lines: list[tuple[str, str]] = [("Visual", sc.visual)]
        if sc.vo:
            lines.append(("VO", _quoted(sc.vo)))
        for dl in sc.dialogue:
            lines.append((f"VO ({names.get(dl.character_id, dl.character_id)})", _quoted(dl.line)))
        if sc.on_screen_text:
            lines.append(("On-screen text", sc.on_screen_text))
        label = sc.label.strip() or ("Hook" if sc.number == 1 else "CTA" if sc is s.scenes[-1] else "")
        scenes.append(SheetScene(f"Scene {sc.number}" + (f" ({label})" if label else ""), lines))

    short = product_name(job)
    names = [n for n in (short, d.name if d else "", re.split(r"\s*[(\[]", s.product_line)[0].strip()) if n]
    return Sheet(file_name(job), brand_of(job), i.product_url, names, i.client_brief.strip(),
                 "SCRIPT", [(k, v) for k, v in header if v], continuity, spec.disclaimer, scenes, s.small_print.strip())
