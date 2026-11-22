"""HTML renderer for the document outline.

One HTML document serves two purposes: the in-app preview and the source that Google Drive converts into a
native Google Doc. Inline styles only, because that is what the Docs importer reliably keeps.
"""
from __future__ import annotations

from html import escape

from ..house_format import FormatSpec
from ..schemas import Job
from . import document as doc
from .document import SEV_LABEL, SEV_ORDER, ts  # noqa: F401  (re-exported for the Word renderer and tests)

# Preview only (never sent to Google Docs): comfortable reading width, wide tables stack on phones.
RESPONSIVE_CSS = """<style>
body{margin:0;padding:40px 48px;max-width:860px}
a{color:#1155cc}
@media (max-width:720px){
 body{padding:20px 18px}
 .sw-stack,.sw-stack tbody,.sw-stack tr,.sw-stack td{display:block!important;width:auto!important}
 .sw-stack tr:first-child{display:none!important}
 .sw-stack tr{border:1px solid #ddd;border-radius:6px;margin:0 0 10px;overflow:hidden}
 .sw-stack td{border:0!important;border-bottom:1px solid #eee!important}
 .sw-stack td::before{content:attr(data-label);display:block;font-weight:bold;color:#666;font-size:10px;text-transform:uppercase}
}
</style>"""


def _e(s) -> str:
    return escape(str(s or "")).replace("\n", "<br>")


class _Styles:
    def __init__(self, spec: FormatSpec):
        st = spec.style
        f = f"font-family:{st.font_family},Helvetica,sans-serif;"
        self.body = f"{f}font-size:{st.body_pt}pt;line-height:1.15;color:#000;"
        self.title = f"{f}font-size:{st.h1_pt}pt;font-weight:bold;color:{st.title_hex};margin:20pt 0 6pt 0;"
        self.brand = f"{f}font-size:{st.h2_pt}pt;font-weight:bold;color:#000;margin:0 0 4pt 0;"
        self.meta = f"{f}font-size:{st.body_pt - 1}pt;color:#666666;margin:0 0 6pt 0;"
        self.h = f"{f}font-size:{st.h2_pt}pt;font-weight:bold;color:{st.accent_hex};margin:16pt 0 6pt 0;"
        self.sub = f"{f}font-size:{st.body_pt}pt;font-weight:bold;color:#000;margin:10pt 0 2pt 0;"
        self.ul = "margin:0 0 4pt 0;padding-left:24pt;"
        self.li = f"{f}font-size:{st.body_pt}pt;line-height:1.3;margin:0 0 2pt 0;"
        self.note = f"{f}font-size:{st.body_pt - 1}pt;color:#666666;margin:4pt 0;"
        self.muted = "color:#999999;"
        self.rule = f"border:0;border-top:1px solid {st.rule_hex};margin:14pt 0 4pt 0;"
        self.td = f"{f}font-size:{st.body_pt - 1}pt;vertical-align:top;border:1px solid #bbbbbb;padding:4pt;"
        self.th = self.td + f"background:{st.table_header_bg};font-weight:bold;"


def _value(it: doc.Item, st: _Styles) -> str:
    if isinstance(it.value, list):
        inner = "".join(f"<li style='{st.li}'>{_link(v) }</li>" for v in it.value)
        return f"<ul style='{st.ul}'>{inner}</ul>"
    if it.muted:
        return f"<span style='{st.muted}'>{_e(it.value)}</span>"
    if it.link:
        return f"<a href='{_e(it.link)}'>{_e(it.value)}</a>"
    return _e(it.value)


def _link(v: str) -> str:
    v = str(v)
    if v.startswith(("http://", "https://")) and " " not in v:
        return f"<a href='{_e(v)}'>{_e(v)}</a>"
    return _e(v)


def _items(items: list[doc.Item], st: _Styles) -> str:
    lis = "".join(f"<li style='{st.li}'>" + (f"<b>{_e(it.label)}:</b> " if it.label else "") + f"{_value(it, st)}</li>"
                  for it in items)
    return f"<ul style='{st.ul}'>{lis}</ul>"


def _blocks(blocks: list, st: _Styles) -> str:
    out, run = [], []
    for bl in blocks + [None]:
        if isinstance(bl, doc.Item):
            run.append(bl)
            continue
        if run:
            out.append(_items(run, st))
            run = []
        if isinstance(bl, doc.Sub):
            out.append(f"<p style='{st.sub}'>{_e(bl.text)}</p>{_items(bl.items, st)}")
        elif isinstance(bl, doc.Note):
            out.append(f"<p style='{st.note}'>{_e(bl.text)}</p>")
        elif isinstance(bl, doc.Table):
            head = "".join(f"<th style='{st.th}'>{_e(h)}</th>" for h in bl.header)
            rows = "".join("<tr>" + "".join(f"<td data-label='{_e(h)}' style='{st.td}'>{_e(c)}</td>"
                                            for h, c in zip(bl.header, r)) + "</tr>" for r in bl.rows)
            out.append(f"<table class='sw-stack' style='border-collapse:collapse;width:100%;'><tr>{head}</tr>{rows}</table>")
    return "".join(out)


def _sheet_html(job: Job, spec: FormatSpec, st: _Styles) -> list[str]:
    sh = doc.build_sheet(job, spec)
    f = f"font-family:{spec.style.font_family},Helvetica,sans-serif;font-size:{spec.style.body_pt}pt;line-height:1.35;"
    p = f"{f}margin:0 0 3pt 0;"

    def text(v: str) -> str:  # product mentions link to the product page
        return "".join(f"<a href='{_e(u)}'>{_e(t)}</a>" if u else _e(t)
                       for t, u in doc.link_spans(v, sh.product_names, sh.product_url))

    HL = "background:#f4ffb3;border-left:3px solid #8aa000;padding:2pt 5pt;margin-left:-8pt;"

    def line(k: str, v: str, changed: bool = False) -> str:
        val = f"<a href='{_e(v)}'>{_e(v)}</a>" if k == "Product Link" else text(v)
        tag = " <span style='font-size:8pt;font-weight:bold;color:#4d6a00;letter-spacing:.5px;'>EDITED</span>" if changed else ""
        return f"<p style='{p}{HL if changed else ''}'><b>{_e(k)}:</b> {val}{tag}</p>"

    def block(title: str, rows) -> None:
        if not rows:
            return
        out.append(f"<p style='{f}font-weight:bold;margin:12pt 0 3pt 0;'>{_e(title)}</p>")
        out.append(f"<ul style='{st.ul}'>" + "".join(f"<li style='{st.li}'><b>{_e(k)}:</b> {text(v)}</li>" for k, v in rows)
                   + "</ul>")

    out = [f"<p style='{f}font-size:{spec.style.body_pt + 1}pt;margin:0 0 12pt 0;padding-bottom:6pt;"
           f"border-bottom:1px solid {spec.style.rule_hex};'><span style='color:#666666;'>File name:</span> "
           f"<b>{_e(sh.file_name)}</b></p>",
           f"<h1 style='{st.title}margin-top:0;margin-bottom:2pt;'>{_e(sh.title)}</h1>",
           f"<p style='{st.brand}margin-bottom:10pt;'>BRAND: {_e(sh.brand)}</p>"]
    if sh.changes:
        out.append(f"<div style='{f}background:#f4ffb3;border-radius:6pt;padding:8pt 10pt;margin:0 0 12pt 0;'>"
                   f"<b>Refined from the client's script: {len(sh.changes)} change{'s' if len(sh.changes) != 1 else ''}.</b> "
                   "Edited lines are highlighted; everything else is the client's original. The full list is at the end.</div>")
    out += [line(k, v) for k, v in sh.header]
    out.append(f"<p style='{f}font-weight:bold;margin:12pt 0 3pt 0;'>Continuity (same in every scene)</p>")
    lis = "".join(f"<li style='{st.li}'>" + (f"<b>{_e(k)}:</b> " if k else "") + f"{text(v)}</li>" for k, v in sh.continuity)
    out.append(f"<ul style='{st.ul}'>{lis}</ul>")
    block("Cast", sh.cast)
    block("Look & sound", sh.look_sound)
    out.append(f"<p style='{f}margin:16pt 0 16pt 0;'><b>Disclaimer:</b> {_e(sh.disclaimer)}</p>")
    for sc in sh.scenes:
        retimed = " <span style='font-size:8pt;color:#4d6a00;'>(TIMING EDITED)</span>" if sc.heading_changed else ""
        out.append(f"<p style='{f}font-weight:bold;margin:12pt 0 3pt 0;'>{_e(sc.heading)}{retimed}</p>")
        out.append("<div style='margin-left:14pt;'>" + "".join(line(k, v, k in sc.changed) for k, v in sc.lines) + "</div>")
    if sh.small_line:
        out.append(f"<p style='{f}margin:12pt 0 0 0;'><b>Small line:</b> {_e(doc._quoted(sh.small_line))}</p>")
    if sh.changes:
        out.append(f"<p style='{f}font-weight:bold;margin:18pt 0 4pt 0;'>What changed from the client's script</p>")
        for c in sh.changes:
            where = f"Scene {c.scene} · {c.part}" if c.scene else c.part
            out.append(f"<div style='{f}margin:0 0 8pt 0;padding:6pt 8pt;border:1px solid #e2ded5;border-radius:6pt;'>"
                       f"<b>{_e(where)}</b><br>"
                       + (f"<span style='color:#888;text-decoration:line-through;'>{_e(c.before)}</span><br>" if c.before else
                          "<span style='color:#888;'>(added)</span><br>")
                       + f"<span style='background:#f4ffb3;'>{_e(c.after)}</span><br>"
                         f"<span style='color:#666;font-size:9pt;'>Why: {_e(c.why)}</span></div>")
    if sh.client_brief:  # the original brief, on its own page, for reference
        out.append(f"<hr style='{st.rule}margin-top:40pt;page-break-before:always;break-before:page;'>")
        out.append(f"<h1 style='{st.title}'>CLIENT BRIEF (REFERENCE)</h1>")
        out.append(f"<p style='{st.note}margin-bottom:10pt;'>The brief as received, kept for reference. "
                   "The script above is the deliverable.</p>")
        out += [f"<p style='{p}'>{_e(par)}</p>" if par.strip() else f"<p style='{p}'>&nbsp;</p>"
                for par in sh.client_brief.splitlines()]
    return out


def render_script_html(job: Job, spec: FormatSpec, include_qc: bool = True, responsive: bool = False) -> str:
    st = _Styles(spec)
    parts = _sheet_html(job, spec, st) if spec.style.layout == "sheet" else []
    for n, part in enumerate(doc.build(job, spec, include_qc) if spec.style.layout != "sheet" else []):
        if n:
            parts.append(f"<hr style='{st.rule}border-top:2px solid {spec.style.accent_hex};margin-top:28pt;'>")
        parts.append(f"<h1 style='{st.title}'>{_e(part.title)}</h1>")
        if part.brand:
            parts.append(f"<p style='{st.brand}'>BRAND: {_e(part.brand)}</p>")
        if part.meta:
            parts.append(f"<p style='{st.meta}'>{_e(part.meta)}</p>")
        for sec in part.sections:
            parts.append(f"<h3 style='{st.h}'>{sec.number}. {_e(sec.title)}</h3>{_blocks(sec.blocks, st)}"
                         f"<hr style='{st.rule}'>")
    head = "<meta name='viewport' content='width=device-width, initial-scale=1'>" + RESPONSIVE_CSS if responsive else ""
    title = _e(doc.file_name(job) if job.script else "Script")
    return (f"<!DOCTYPE html><html><head><meta charset='utf-8'><title>{title}</title>{head}</head>"
            f"<body style='{st.body}'>" + "".join(parts) + "</body></html>")
