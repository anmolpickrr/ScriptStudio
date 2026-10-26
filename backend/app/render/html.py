"""Deterministic script renderer.

One HTML document serves two purposes: the in-app preview and the source
that Google Drive converts into a native Google Doc. Inline styles only,
because that is what the Docs importer reliably keeps.
"""
from __future__ import annotations

from html import escape

from .. import playbook
from ..house_format import FormatSpec
from ..schemas import Flag, Job, QCReport, Script

SEV_ORDER = {"blocker": 0, "major": 1, "minor": 2, "info": 3}
SEV_LABEL = {"blocker": "BLOCKER", "major": "IMPORTANT", "minor": "NOTE", "info": "FYI"}


def _e(s) -> str:
    return escape(str(s or "")).replace("\n", "<br>")


def _ts(sec: float) -> str:
    sec = round(sec, 1)
    m, s = divmod(sec, 60)
    return f"{int(m)}:{s:04.1f}" if s % 1 else f"{int(m)}:{int(s):02d}"


class _R:
    def __init__(self, spec: FormatSpec):
        st = spec.style
        self.st = st
        self.font = f"font-family:{st.font_family},sans-serif;"
        self.p = f"{self.font}font-size:{st.body_pt}pt;line-height:1.4;margin:0 0 6pt 0;"
        self.h1 = f"{self.font}font-size:{st.h1_pt}pt;font-weight:bold;color:{st.accent_hex};margin:0 0 4pt 0;"
        self.h2 = (f"{self.font}font-size:{st.h2_pt}pt;font-weight:bold;color:{st.accent_hex};"
                   f"margin:18pt 0 6pt 0;border-bottom:1px solid {st.accent_hex};padding-bottom:2pt;")
        self.td = (f"{self.font}font-size:{st.body_pt - 0.5}pt;vertical-align:top;border:1px solid #B7C2CF;"
                   f"padding:5pt;line-height:1.35;")
        self.th = self.td + f"background:{st.table_header_bg};font-weight:bold;"
        self.table = "border-collapse:collapse;width:100%;margin:4pt 0 8pt 0;"

    def kv_table(self, rows: list[tuple[str, str]]) -> str:
        body = "".join(f"<tr><td style='{self.th}width:24%'>{_e(k)}</td><td style='{self.td}'>{v}</td></tr>"
                       for k, v in rows if v)
        return f"<table style='{self.table}'>{body}</table>"

    def bullets(self, items: list[str]) -> str:
        if not items:
            return f"<p style='{self.p}color:#777'>None.</p>"
        lis = "".join(f"<li style='{self.p}'>{i}</li>" for i in items)
        return f"<ul style='margin:0 0 6pt 18pt;padding:0'>{lis}</ul>"


def render_script_html(job: Job, spec: FormatSpec, include_qc: bool = True) -> str:
    s = job.script
    assert s is not None
    r = _R(spec)
    plat = playbook.platform(job.inputs.platform)
    blocks = {
        "header": lambda: _header(r, job, s, plat),
        "open_questions": lambda: _flags(r, job.flags),
        "concept": lambda: _concept(r, s),
        "characters": lambda: _characters(r, s),
        "continuity": lambda: r.bullets([_e(c) for c in s.continuity]),
        "product": lambda: _product(r, job, s),
        "scenes": lambda: _scenes(r, s, spec),
        "cta": lambda: r.kv_table([("Line", _e(s.cta.line)), ("Visual", _e(s.cta.visual)),
                                   ("End-frame text", _e(s.cta.on_screen_text)), ("Action", _e(s.cta.action))]),
        "production": lambda: r.bullets([_e(n) for n in s.production_notes]),
        "qc": lambda: _qc(r, job.qc_history[-1]) if job.qc_history else "",
    }
    kicker = " · ".join(x for x in [job.dossier.brand if job.dossier else "", plat["label"],
                                     f"{job.inputs.duration_sec}s"] if x)
    parts = [f"<p style='{r.p}color:#667;text-transform:uppercase;letter-spacing:1px'>{_e(kicker)}</p>",
             f"<h1 style='{r.h1}'>{_e(s.title)}</h1>",
             f"<p style='{r.p}font-style:italic'>{_e(s.logline)}</p>"]
    n = 0
    for sec in spec.sections:
        if sec.key == "qc" and not include_qc:
            continue
        if sec.key == "open_questions" and not job.flags:
            continue
        body = blocks.get(sec.key, lambda: "")()
        if not body:
            continue
        n += 1
        parts.append(f"<h2 style='{r.h2}'>{n}. {_e(sec.label)}</h2>{body}")
    return ("<!DOCTYPE html><html><head><meta charset='utf-8'>"
            f"<title>{_e(s.title)}</title></head><body style='{r.font}'>" + "".join(parts) + "</body></html>")


def _header(r, job, s: Script, plat) -> str:
    i = job.inputs
    return r.kv_table([
        ("Product", _e(job.dossier.name if job.dossier else "") + f" — <a href='{_e(i.product_url)}'>product page</a>"),
        ("Platform / Format", _e(f"{plat['label']} · {i.aspect_ratio or plat['aspect']} · {i.duration_sec}s")),
        ("Objective", _e(job.brief.objective if job.brief else "")),
        ("Key message", _e(job.brief.key_message if job.brief else "")),
        ("Audience", _e(s.audience)),
        ("Tone", _e(s.tone)),
        ("Hook type", _e(s.hook_type.replace("_", " ").title())),
        ("Theme", _e(s.theme)),
        ("Format", _e(f"{job.format_version}")),
    ])


def _flags(r, flags: list[Flag]) -> str:
    rows = []
    for f in sorted(flags, key=lambda f: SEV_ORDER[f.severity]):
        if f.severity == "info":
            continue
        sug = f"<br><span style='color:#555'>→ {_e(f.suggestion)}</span>" if f.suggestion else ""
        rows.append(f"<tr><td style='{r.td}width:14%;font-weight:bold;background:{r.st.flag_bg}'>"
                    f"{SEV_LABEL[f.severity]}</td><td style='{r.td}'>{_e(f.message)}{sug}</td></tr>")
    if not rows:
        return ""
    note = (f"<p style='{r.p}color:#8A4B00'>Resolve these with the client before the shoot. "
            "The script avoids every unconfirmed detail.</p>")
    return note + f"<table style='{r.table}'>{''.join(rows)}</table>"


def _concept(r, s: Script) -> str:
    return f"<p style='{r.p}'>{_e(s.concept_summary)}</p>"


def _characters(r, s: Script) -> str:
    if not s.characters:
        return f"<p style='{r.p}'>No on-screen talent (product-only / hands-only).</p>"
    head = "".join(f"<th style='{r.th}'>{h}</th>" for h in ("ID", "Character", "Role", "Description", "Keep consistent"))
    rows = "".join(
        f"<tr><td style='{r.td}width:6%'><b>{_e(c.id)}</b></td><td style='{r.td}width:14%'>{_e(c.name)}</td>"
        f"<td style='{r.td}width:14%'>{_e(c.role)}</td><td style='{r.td}'>{_e(c.description)}</td>"
        f"<td style='{r.td}width:26%'>{_e(c.continuity)}</td></tr>" for c in s.characters)
    return f"<table style='{r.table}'><tr>{head}</tr>{rows}</table>"


def _product(r, job: Job, s: Script) -> str:
    items = [f"<b>{_e(d.fact_id)}</b> — {_e(d.statement)}" for d in s.product_details]
    pack = job.dossier.packaging_description if job.dossier else ""
    out = r.bullets(items)
    out += f"<p style='{r.p}'><b>Packaging:</b> {_e(pack) if pack else '[USE ACTUAL PACK — details not confirmed]'}</p>"
    out += (f"<p style='{r.p}color:#667'>Source of truth: product page. "
            "Every claim in the script maps to one of the facts above (see fact IDs in the scene table).</p>")
    return out


def _scenes(r, s: Script, spec: FormatSpec) -> str:
    cols = spec.scene_columns
    widths = {"#": "4%", "Time": "8%", "Visual": "34%", "VO / Dialogue": "28%", "On-screen Text": "14%", "SFX / Music": "12%"}
    head = "".join(f"<th style='{r.th}width:{widths.get(c, 'auto')}'>{_e(c)}</th>" for c in cols)
    rows = []
    for sc in s.scenes:
        visual = (f"<b>{_e(sc.shot)}</b><br>{_e(sc.location)}<br><br>{_e(sc.visual)}"
                  + (f"<br><br><i>Props:</i> {_e(', '.join(sc.props))}" if sc.props else "")
                  + (f"<br><i>Transition:</i> {_e(sc.transition)}" if sc.transition else ""))
        audio = []
        if sc.vo:
            audio.append(f"<b>VO:</b> {_e(sc.vo)}")
        names = {c.id: c.name for c in s.characters}
        for d in sc.dialogue:
            deliv = f" <i>({_e(d.delivery)})</i>" if d.delivery else ""
            audio.append(f"<b>{_e(names.get(d.character_id, d.character_id)).upper()}</b>{deliv}: {_e(d.line)}")
        if sc.sync_note:
            audio.append(f"<span style='color:#667'>Sync: {_e(sc.sync_note)}</span>")
        if sc.product_fact_ids:
            audio.append(f"<span style='color:#667'>Facts: {_e(', '.join(sc.product_fact_ids))}</span>")
        cells = {
            "#": f"<b>{sc.number}</b>",
            "Time": f"{_ts(sc.start_sec)}–{_ts(sc.end_sec)}",
            "Visual": visual,
            "VO / Dialogue": "<br><br>".join(audio) or "—",
            "On-screen Text": _e(sc.on_screen_text) or "—",
            "SFX / Music": _e(sc.sfx_music) or "—",
        }
        rows.append("<tr>" + "".join(f"<td style='{r.td}'>{cells.get(c, '')}</td>" for c in cols) + "</tr>")
    return f"<table style='{r.table}'><tr>{head}</tr>{''.join(rows)}</table>"


def _qc(r, qc: QCReport) -> str:
    score_rows = [(k.replace("_", " ").title(), f"{v}/5") for k, v in qc.scores.items()]
    out = r.kv_table(score_rows) if score_rows else ""
    status = "Passed all quality gates" if qc.passed else "Did not pass every gate — editor review required"
    out += f"<p style='{r.p}'><b>{status}</b> after {qc.iteration} review round(s). {_e(qc.summary)}</p>"
    open_items = [f for f in qc.findings if f.severity in ("blocker", "major")]
    if open_items:
        out += r.bullets([f"{SEV_LABEL[f.severity]} — {'Scene ' + str(f.scene) + ': ' if f.scene else ''}"
                          f"{_e(f.message)}" for f in open_items])
    return out
