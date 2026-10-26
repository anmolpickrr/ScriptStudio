"""Demo provider (LLM_PROVIDER=demo).

Produces a deterministic, structurally valid script from the real product
page without calling an AI model, so the whole app (UI, product analysis,
QC, Google Docs export) can be exercised without an API key. The UI shows a
banner whenever this provider is active. Never use it for client work.
"""
from __future__ import annotations

import re

from pydantic import BaseModel

from .schemas import (CTA, Beat, BeatSheet, Character, Concept, ConceptDecision, ConceptScore, ConceptSet,
                      CreativeBrief, CriticReport, CriticScores, DialogueLine, ProductDetail, Scene, Script)


def _between(text: str, start: str, end: str | None = None) -> str:
    i = text.find(start)
    if i < 0:
        return ""
    j = text.find(end, i + len(start)) if end else -1
    return text[i + len(start): j if j >= 0 else None].strip()


def _facts_from_source(source: str) -> list[dict]:
    text = _between(source, "PAGE TEXT:") or source
    copy = _between(source, "CLIENT-SUPPLIED PRODUCT COPY:")
    sentences = re.split(r"(?<=[.!?])\s+", f"{text} {copy}")
    facts = []
    for s in sentences:
        s = s.strip()
        if 4 <= len(s.split()) <= 22 and not re.search(r"cookie|privacy|login|cart|subscribe|©", s, re.I):
            facts.append({"category": "feature", "statement": s.rstrip("."), "quote": s, "from_image": False})
        if len(facts) == 5:
            break
    return facts


class DemoLLM:
    def __init__(self):
        self.facts: list[str] = []
        self.product = "the product"
        self.duration = 30

    def structured(self, *, stage, system, user, schema, images=None):
        out = getattr(self, f"_{stage}")(user)
        return schema.model_validate(out.model_dump() if isinstance(out, BaseModel) else out)

    def _extract_product(self, user):
        title = _between(user, "TITLE:", "\n") or "Product"
        self.product = title.split("–")[0].split("|")[0].strip()[:60] or "Product"
        facts = _facts_from_source(user)
        return {"product_name": self.product, "brand": "", "facts": facts, "packaging_description": "",
                "unknowns": ["Demo mode: packaging and claims were not analysed by AI"]}

    def _parse_brief(self, user):
        brief = _between(user, "CLIENT BRIEF:", "USER INPUTS:")
        return CreativeBrief(objective=brief[:160] or "Drive consideration", key_message=brief[:120],
                             supporting_messages=[], audience="As described in the brief",
                             audience_insight="(demo) not analysed", tone="Conversational", cta_intent="Shop now",
                             mandatories=[], exclusions=[], reference_takeaways=[],
                             assumptions=["Demo mode is on: no AI model was used. Output is a structural placeholder."])

    def _reconcile(self, user):
        return {"flags": []}

    def _concepts(self, user):
        return ConceptSet(concepts=[Concept(
            title=f"A day with {self.product}", logline="A simple, honest walkthrough of the product in use.",
            hook_type="relatable_moment", hook_visual="Hands reach for the product", hook_line="This is how I actually use it.",
            story_arc="moment -> product -> use -> payoff", product_role="the hero", ending_button="smile to camera",
            why_it_works="demo", risks="demo")])

    def _choose_concept(self, user):
        return ConceptDecision(scores=[ConceptScore(index=0, hook=3, brief_fit=3, originality=3, producibility=5,
                                                    product_truth=5, rationale="demo")],
                               chosen_index=0, director_notes="Demo mode: connect an AI model for real creative work.")

    def _beats(self, user):
        m = re.search(r'"duration_sec": (\d+)', user)
        self.duration = int(m.group(1)) if m else 30
        self.facts = re.findall(r"- (F\d+) \[\w+\] (.+)", user)
        d = self.duration
        cuts = [0, round(d * 0.15, 1), round(d * 0.5, 1), round(d * 0.8, 1), d]
        names = ["hook", "product enters", "proof", "cta"]
        return BeatSheet(beats=[Beat(index=i + 1, purpose=n, start_sec=cuts[i], end_sec=cuts[i + 1],
                                     what_happens=n, emotional_note="") for i, n in enumerate(names)])

    def _write(self, user):
        d = self.duration
        cuts = [0, round(d * 0.15, 1), round(d * 0.5, 1), round(d * 0.8, 1), d]
        facts = self.facts[:2]
        lines = [("Okay, real talk.", [], "Mid-shot, handheld", "Creator looks up from their desk, mid-thought."),
                 ("", [], "Close-up, static", f"Hands pick up {self.product} [USE ACTUAL PACK], label to camera."),
                 (" ".join(f[1] + "." for f in facts)[:120], [f[0] for f in facts], "Close-up, slow push-in",
                  f"The product is used exactly as described on the product page."),
                 ("Link's below.", [], "Mid-shot", "Creator holds the product beside their face and smiles.")]
        scenes = []
        for i, (line, fids, shot, visual) in enumerate(lines):
            dur = cuts[i + 1] - cuts[i]
            words = line.split()[: max(1, int(dur * 2.4))]
            scenes.append(Scene(number=i + 1, start_sec=cuts[i], end_sec=cuts[i + 1], location="Home, daylight",
                                shot=shot, visual=visual, vo="",
                                dialogue=[DialogueLine(character_id="C1", line=" ".join(words), delivery="natural")] if words else [],
                                on_screen_text="Shop now" if i == 3 else "", sfx_music="Light acoustic bed",
                                transition="Cut on action" if i < 3 else "", characters=["C1"], props=[],
                                product_fact_ids=fids, sync_note="Line delivered on camera as the action happens"))
        return Script(title=f"{self.product} – demo script", logline="Demo output (no AI model connected).",
                      concept_summary="Structural placeholder generated in demo mode.", hook_type="relatable_moment",
                      theme="Everyday use", audience="Per brief", tone="Conversational",
                      characters=[Character(id="C1", name="Creator", role="Host",
                                            description="Late 20s, casual everyday clothes", continuity="Same outfit throughout")],
                      continuity=["Same outfit, same room, daylight throughout"],
                      product_details=[ProductDetail(fact_id=f[0], statement=f[1]) for f in facts],
                      scenes=scenes, cta=CTA(line="Link's below.", visual="Product beside face",
                                             on_screen_text="Shop now", action="Tap Shop Now"),
                      production_notes=["DEMO MODE: replace with a real AI-generated script before production."])

    def _critic(self, user):
        return CriticReport(scores=CriticScores(hook_strength=3, story_logic=4, visual_vo_sync=4, dialogue_quality=3,
                                                product_integration=4, cta_relevance=4, brief_alignment=3, authenticity=5),
                            findings=[], verdict="Demo mode: scores are placeholders, not a real review.")

    def _revise(self, user):
        return self._write(user)
