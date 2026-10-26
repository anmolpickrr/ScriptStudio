"""Style memory: approved scripts become exemplars for new ones.

New jobs get the 2 most relevant approved scripts (same platform first, then
matching hook type / theme / duration) condensed into a reference block, plus
the editor notes left at approval time. The writer is told to match their
standard and structure, not to copy their ideas.
"""
from __future__ import annotations

from .schemas import JobInputs
from .store import ApprovedScript, Store


def _score(a: ApprovedScript, inputs: JobInputs) -> float:
    s = 0.0
    s += 3 if a.platform == inputs.platform else 0
    s += 2 if inputs.hook_type and a.hook_type == inputs.hook_type else 0
    s += 1 if inputs.theme and inputs.theme.lower() in a.theme.lower() else 0
    s += 1 if abs(a.duration_sec - inputs.duration_sec) <= 10 else 0
    return s


def exemplars(store: Store, inputs: JobInputs, k: int = 2) -> list[ApprovedScript]:
    items = store.list_approved()
    ranked = sorted(items, key=lambda a: (_score(a, inputs), a.approved_at), reverse=True)
    return ranked[:k]


def exemplar_block(items: list[ApprovedScript]) -> str:
    if not items:
        return ""
    out = ["APPROVED HOUSE EXAMPLES - match this standard of craft, structure and specificity. "
           "Do NOT reuse their ideas, lines or products."]
    for a in items:
        s = a.script
        out.append(f"\n--- {s.title} ({a.platform}, {a.duration_sec}s, hook: {a.hook_type})")
        if a.editor_notes:
            out.append(f"Editor notes on why it was approved: {a.editor_notes}")
        for sc in s.scenes:
            spoken = sc.vo or " / ".join(f"{d.character_id}: {d.line}" for d in sc.dialogue)
            out.append(f"[{sc.start_sec:g}-{sc.end_sec:g}s] VISUAL: {sc.visual} | AUDIO: {spoken} | "
                       f"TEXT: {sc.on_screen_text}")
        out.append(f"CTA: {s.cta.line}")
    return "\n".join(out)
