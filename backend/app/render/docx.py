"""Word (.docx) export in the house format.

Works without any Google setup: the file opens in Google Docs (upload to Drive,
or File → Open), Word and Pages with headings, tables and bullets intact.
Section order and labels come from the same FormatSpec as the HTML/Docs output.
"""
from __future__ import annotations

import io

from docx import Document
from docx.enum.section import WD_ORIENT
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor, Mm

from .. import playbook
from ..house_format import FormatSpec
from ..schemas import Job
from .html import SEV_LABEL, SEV_ORDER, _ts


def _rgb(hex_: str) -> RGBColor:
    h = hex_.lstrip("#")
    return RGBColor(int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def _shade(cell, hex_: str):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_.lstrip("#"))
    tc_pr.append(shd)


class _Doc:
    def __init__(self, spec: FormatSpec):
        self.spec, self.st = spec, spec.style
        self.d = Document()
        sec = self.d.sections[0]
        if self.st.landscape:
            sec.orientation = WD_ORIENT.LANDSCAPE
            sec.page_width, sec.page_height = Mm(297), Mm(210)
        else:
            sec.page_width, sec.page_height = Mm(210), Mm(297)
        for m in ("left_margin", "right_margin", "top_margin", "bottom_margin"):
            setattr(sec, m, Mm(13))
        normal = self.d.styles["Normal"]
        normal.font.name = self.st.font_family
        normal.font.size = Pt(self.st.body_pt)
        normal.paragraph_format.space_after = Pt(4)
        for name, size in (("Title", self.st.h1_pt), ("Heading 1", self.st.h2_pt)):
            style = self.d.styles[name]
            style.font.name = self.st.font_family
            style.font.size = Pt(size)
            style.font.bold = True
            style.font.color.rgb = _rgb(self.st.accent_hex)
        self.d.styles["Heading 1"].paragraph_format.space_before = Pt(14)
        self.d.styles["Heading 1"].paragraph_format.space_after = Pt(6)

    def para(self, text: str = "", *, bold=False, italic=False, color: str | None = None, size: int | None = None):
        p = self.d.add_paragraph()
        if text:
            self.run(p, text, bold=bold, italic=italic, color=color, size=size)
        return p

    @staticmethod
    def run(p, text: str, *, bold=False, italic=False, color: str | None = None, size: int | None = None):
        r = p.add_run(text)
        r.bold, r.italic = bold, italic
        if color:
            r.font.color.rgb = _rgb(color)
        if size:
            r.font.size = Pt(size)
        return r

    def bullets(self, items: list[str]):
        if not items:
            self.para("None.", color="#777777")
        for i in items:
            self.d.add_paragraph(i, style="List Bullet")

    def table(self, header: list[str] | None, rows: list[list], widths_pct: list[int] | None = None,
              first_col_shaded=False):
        ncols = len(header or rows[0])
        t = self.d.add_table(rows=0, cols=ncols)
        t.style = "Table Grid"
        t.alignment = WD_TABLE_ALIGNMENT.CENTER
        if header:
            cells = t.add_row().cells
            for c, h in zip(cells, header):
                c.text = ""
                self.run(c.paragraphs[0], h, bold=True)
                _shade(c, self.st.table_header_bg)
        for row in rows:
            cells = t.add_row().cells
            for i, (c, val) in enumerate(zip(cells, row)):
                c.text = ""
                parts = val if isinstance(val, list) else [(str(val or "—"), {})]
                p = c.paragraphs[0]
                for j, (txt, fmt) in enumerate(parts):
                    if fmt.get("newpara") and j:
                        p = c.add_paragraph()
                    self.run(p, txt, bold=fmt.get("bold", False), italic=fmt.get("italic", False),
                             color=fmt.get("color"), size=self.st.body_pt - 1)
                if first_col_shaded and i == 0:
                    _shade(c, self.st.table_header_bg)
                    for r in c.paragraphs[0].runs:
                        r.bold = True
        if widths_pct:
            total = (Mm(297 - 26) if self.st.landscape else Mm(210 - 26))
            for row in t.rows:
                for c, pct in zip(row.cells, widths_pct):
                    c.width = int(total * pct / 100)
        self.d.add_paragraph()
        return t


def render_script_docx(job: Job, spec: FormatSpec) -> bytes:
    s = job.script
    assert s is not None
    doc = _Doc(spec)
    plat = playbook.platform(job.inputs.platform)
    kicker = " · ".join(x for x in [job.dossier.brand if job.dossier else "", plat["label"],
                                     f"{job.inputs.duration_sec}s"] if x)
    doc.para(kicker.upper(), color="#666677", size=spec.style.body_pt - 1)
    doc.d.add_paragraph(s.title, style="Title")
    doc.para(s.logline, italic=True)

    n = 0
    for sec in spec.sections:
        if sec.key == "qc" or (sec.key == "open_questions" and not any(f.severity != "info" for f in job.flags)):
            continue
        n += 1
        doc.d.add_paragraph(f"{n}. {sec.label}", style="Heading 1")
        if sec.key == "header":
            i = job.inputs
            rows = [["Product", job.dossier.name if job.dossier else ""], ["Product page", i.product_url],
                    ["Platform / Format", f"{plat['label']} · {i.aspect_ratio or plat['aspect']} · {i.duration_sec}s"],
                    ["Objective", job.brief.objective if job.brief else ""],
                    ["Key message", job.brief.key_message if job.brief else ""],
                    ["Audience", s.audience], ["Tone", s.tone],
                    ["Hook type", s.hook_type.replace("_", " ").title()], ["Theme", s.theme],
                    ["Format", job.format_version]]
            doc.table(None, [r for r in rows if r[1]], [25, 75], first_col_shaded=True)
        elif sec.key == "open_questions":
            doc.para("Resolve these with the client before the shoot. The script avoids every unconfirmed detail.",
                     color="#8A4B00")
            flags = sorted((f for f in job.flags if f.severity != "info"), key=lambda f: SEV_ORDER[f.severity])
            doc.table(None, [[SEV_LABEL[f.severity], [(f.message, {}), *([("→ " + f.suggestion,
                      {"color": "#555555", "newpara": True})] if f.suggestion else [])]] for f in flags],
                      [14, 86], first_col_shaded=True)
        elif sec.key == "concept":
            doc.para(s.concept_summary)
        elif sec.key == "characters":
            if s.characters:
                doc.table(["ID", "Character", "Role", "Description", "Keep consistent"],
                          [[c.id, c.name, c.role, c.description, c.continuity] for c in s.characters],
                          [6, 14, 14, 40, 26])
            else:
                doc.para("No on-screen talent (product-only / hands-only).")
        elif sec.key == "continuity":
            doc.bullets(s.continuity)
        elif sec.key == "product":
            doc.bullets([f"{d.fact_id} — {d.statement}" for d in s.product_details])
            pack = job.dossier.packaging_description if job.dossier else ""
            p = doc.para()
            doc.run(p, "Packaging: ", bold=True)
            doc.run(p, pack or "[USE ACTUAL PACK — details not confirmed]")
            doc.para("Source of truth: product page. Every claim in the script maps to one of the facts above.",
                     color="#666677")
        elif sec.key == "scenes":
            names = {c.id: c.name for c in s.characters}
            rows = []
            for sc in s.scenes:
                visual = [(sc.shot, {"bold": True}), (sc.location, {"newpara": True}), (sc.visual, {"newpara": True})]
                if sc.props:
                    visual.append((f"Props: {', '.join(sc.props)}", {"italic": True, "newpara": True}))
                if sc.transition:
                    visual.append((f"Transition: {sc.transition}", {"italic": True, "newpara": True}))
                audio: list = []
                if sc.vo:
                    audio += [("VO: ", {"bold": True, "newpara": True}), (sc.vo, {})]
                for dl in sc.dialogue:
                    who = names.get(dl.character_id, dl.character_id).upper()
                    audio += [(who, {"bold": True, "newpara": True}),
                              (f" ({dl.delivery})" if dl.delivery else "", {"italic": True}), (f": {dl.line}", {})]
                if sc.sync_note:
                    audio.append((f"Sync: {sc.sync_note}", {"color": "#666677", "newpara": True}))
                if sc.product_fact_ids:
                    audio.append((f"Facts: {', '.join(sc.product_fact_ids)}", {"color": "#666677", "newpara": True}))
                cells = {"#": str(sc.number), "Time": f"{_ts(sc.start_sec)}–{_ts(sc.end_sec)}", "Visual": visual,
                         "VO / Dialogue": audio or "—", "On-screen Text": sc.on_screen_text or "—",
                         "SFX / Music": sc.sfx_music or "—"}
                rows.append([cells.get(c, "") for c in spec.scene_columns])
            widths = {"#": 4, "Time": 8, "Visual": 34, "VO / Dialogue": 28, "On-screen Text": 14, "SFX / Music": 12}
            doc.table(spec.scene_columns, rows, [widths.get(c, 10) for c in spec.scene_columns])
        elif sec.key == "cta":
            doc.table(None, [["Line", s.cta.line], ["Visual", s.cta.visual],
                             ["End-frame text", s.cta.on_screen_text], ["Action", s.cta.action]],
                      [25, 75], first_col_shaded=True)
        elif sec.key == "production":
            doc.bullets(s.production_notes)

    buf = io.BytesIO()
    doc.d.save(buf)
    return buf.getvalue()
