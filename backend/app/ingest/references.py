"""References are style input only: structure, pacing, tone, shot language.
They never contribute product facts."""
from __future__ import annotations

from ..netsafe import safe_get
from ..schemas import Flag, Reference
from .product import parse_html


def describe_references(refs: list[Reference]) -> tuple[str, list[Flag]]:
    flags: list[Flag] = []
    lines = []
    for i, r in enumerate(refs, 1):
        take = f" | take: {r.what_to_take}" if r.what_to_take else ""
        if r.kind == "note":
            lines.append(f"R{i} (note): {r.value}{take}")
            continue
        try:
            page = parse_html(r.value, safe_get(r.value, timeout=10).text)
            desc = page.meta.get("og:description") or page.meta.get("description") or page.text[:400]
            lines.append(f"R{i} (link {r.value}): {page.title} - {desc}{take}")
        except Exception:
            lines.append(f"R{i} (link {r.value}): could not be opened{take}")
        if not r.what_to_take:
            flags.append(Flag(severity="minor", area="references",
                              message=f"Reference R{i} has no note on what to take from it.",
                              suggestion="Video links can't be watched by the system; add a line like "
                                         "'borrow the jump-cut pacing' so the reference is used as intended."))
    return "\n".join(lines), flags
