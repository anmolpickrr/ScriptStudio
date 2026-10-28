"""Chat relay: write scripts with the user's own ChatGPT or Claude subscription.

Consumer chat subscriptions have no API, and automating their web apps breaks both providers' terms.
Instead ScriptStudio does everything around the model: it reads the product page, assembles one complete
expert prompt (house format, craft rules, platform rules, brief, source text), and the user pastes it into
their chat. The answer comes back as JSON, and from there it gets the same treatment as the built-in
pipeline: every product fact is verified against the page in code, the deterministic quality gates run,
and the script is rendered in the house format. Revisions produce a follow-up prompt with the findings.
"""
from __future__ import annotations

import json
from typing import Optional

from pydantic import BaseModel, ValidationError

from . import playbook, prompts
from .house_format import FormatSpec
from .ingest.product import _Extraction, _ExtractedFact, build_dossier, gather_source, PageSource
from .llm import _extract_json
from .qc.checks import run_checks
from .schemas import (Concept, ConceptDecision, ConceptScore, CreativeBrief, FactCategory, Flag, Job, JobStatus,
                      QCReport, RelayState, Revision, Script, StageEvent)

ENGINE_LABEL = {"chatgpt": "ChatGPT", "claude": "Claude"}
MAX_SOURCE = 14000


class RelayFact(BaseModel):
    id: str
    category: FactCategory
    statement: str
    quote: str


class RelayResult(BaseModel):
    product_name: str
    brand: str
    facts: list[RelayFact]
    packaging_description: str
    unknowns: list[str]
    brief: CreativeBrief
    concepts: list[Concept]
    chosen_index: int
    director_notes: str
    script: Script


class RelayRevision(BaseModel):
    script: Script


class RelayError(ValueError):
    pass


def _schema(model: type[BaseModel]) -> str:
    from openai.lib._pydantic import to_strict_json_schema
    return json.dumps(to_strict_json_schema(model), separators=(",", ":"))


def _inputs_block(job: Job) -> str:
    i = job.inputs
    plat = playbook.platform(i.platform)
    lines = [
        f"PLATFORM: {plat['label']} | {i.aspect_ratio or plat['aspect']} | {i.duration_sec}s total | hook must land by "
        f"{plat['hook_window_sec']}s | max shot ~{plat['max_shot_sec']}s | {plat['notes']} | CTA style: {plat['cta_style']}",
        f"LANGUAGE: {i.language} (spoken pace ~{playbook.wps(i.language)} words/second — VO/dialogue in each scene "
        "must fit its duration)",
        f"HOOK TYPE: {i.hook_type} — {playbook.HOOK_TYPES.get(i.hook_type, '')}" if i.hook_type else
        "HOOK TYPE: choose the strongest per concept",
    ]
    for label, val in (("THEME", i.theme), ("TARGET AUDIENCE", i.target_audience), ("TONE", i.tone),
                       ("CREATIVE DIRECTION", i.creative_direction)):
        if val:
            lines.append(f"{label}: {val}")
    from .pipeline import brief_field_lines
    lines += brief_field_lines(i)
    if i.mandatories:
        lines.append("MANDATORIES (include verbatim): " + json.dumps(i.mandatories, ensure_ascii=False))
    if i.exclusions:
        lines.append("EXCLUSIONS (never include): " + json.dumps(i.exclusions, ensure_ascii=False))
    if i.references:
        lines.append("REFERENCES (style only, never product facts): " + "; ".join(
            f"{r.value} — take: {r.what_to_take or 'n/a'}" for r in i.references))
    return "\n".join(lines)


def build_full_prompt(job: Job, spec: FormatSpec, source_text: str) -> str:
    i = job.inputs
    n = i.concept_count
    return f"""You are ScriptStudio's creative team in one: a brand-accuracy specialist, a senior content strategist, an \
award-winning creative director and a senior scriptwriter. Produce a production-ready video ad script.

WORK IN THIS ORDER (all inside one JSON answer):
1. FACTS — from the PRODUCT SOURCE below only. Each fact needs a `quote` copied VERBATIM from the source (3–25 words, \
exact characters). Use ids F1, F2, … Never paraphrase inside `quote`. List what a writer needs but the page doesn't \
state in `unknowns`. Describe the real pack in `packaging_description` only from the source; empty if unknown.
2. BRIEF — turn the client brief into `brief`. List every gap you filled in `brief.assumptions`.
3. CONCEPTS — {n} genuinely different concepts (different story engines). Pick the strongest in `chosen_index` \
(0-based) and give 2–4 sharp `director_notes`.
4. SCRIPT — write the chosen concept as `script`, following every rule below. Every scene's `product_fact_ids` lists \
the fact ids it uses; a product claim without a fact id is not allowed.

FORMAT RULES
- Scenes are contiguous: scene 1 starts at 0, each starts where the previous ended, the last ends at exactly \
{i.duration_sec}s.
- `shot` = framing + camera movement; `visual` = concrete, shootable action (location, who, what we see of the product).
- `vo` = voiceover, `dialogue` = on-camera lines (use "" / [] when none). Speakers must be in that scene's `characters`.
- `sync_note` = one line on why the picture belongs with the words.
- `continuity` = wardrobe, props, product state, time of day — everything that must match between scenes.
- The CTA is delivered in the final scene and matches the brief and platform.
- `headline_options`: 2–3 short headline options (≤8 words). `supporting_copy`: 1–2 sentences of caption copy.
  `visual_style`: the look in one line. `elements_to_highlight`: 3–5 moments/benefits the edit must feature.
- `label` (per scene): the scene's role in 1–4 words, e.g. "Hook", "The surprise", "Reveal and benefits",
  "Gift and CTA". The last scene's label ends with "CTA".
- `talent_summary`: who is on screen in one line, e.g. "Indian couple, wife 30–38 and husband 33–40, fully
  clothed". Use "Product only (no talent)" when nobody appears.
- `product_line`: the product name followed by its key verified features in brackets, e.g.
  "Stride Comfort Cushion (memory foam, 27° angle, zip-off linen cover)". Verified facts only.
- `idea`: the core idea — a short quoted tagline in the script's language, then one or two sentences on the story.
- `continuity`: items written as "Label: detail" — one per character (by name or role: look, age, wardrobe, mood),
  then props/wrapping, "Product: <the real product exactly as on the product page; use the real product images as
  reference; never invent or alter it>", and "Setting: <location, time of day, light>".
- Characters' names are their on-screen role ("Wife", "Husband", "Creator") so lines read as VO (Wife).
- `cta.action`: the button text only, e.g. "Shop Now" (no sentence).
- `small_print`: a legal / compliance small line when the category needs one (e.g. "Comfort product. Not a medical
  treatment."), otherwise "".
- House editorial rules: {"; ".join(spec.editorial_notes) or "none"}
{prompts.CRAFT}
CLIENT BRIEF (source of truth for objective, message, tone and outcome):
<<<
{i.client_brief}
>>>

INPUTS
{_inputs_block(job)}

PRODUCT SOURCE (the only source of product truth; quotes must be copied from here):
<<<
{source_text[:MAX_SOURCE]}
>>>

OUTPUT: reply with ONE JSON object only, inside a single ```json code block, with no other text before or after. It \
must match this JSON schema exactly (every property is required; use "" or [] when empty):
{_schema(RelayResult)}
"""


def build_revision_prompt(job: Job, spec: FormatSpec, request: str) -> str:
    facts = "\n".join(f"- {f.id} [{f.category}] {f.statement}" for f in (job.dossier.verified_facts() if job.dossier else []))
    findings = ""
    if job.qc_history:
        items = [f for f in job.qc_history[-1].findings if f.severity in ("blocker", "major", "minor")]
        findings = "\n".join(f"- [{f.severity}] {'scene ' + str(f.scene) + ': ' if f.scene else ''}{f.message} FIX: {f.fix}"
                             for f in items[:25])
    return f"""You are the senior scriptwriter revising your script for ScriptStudio. Apply the requested changes and \
fix every quality finding. Keep everything that wasn't criticised. Keep timings contiguous (0 → {job.inputs.duration_sec}s).

REQUESTED CHANGES:
{request or "Fix the quality findings below."}

QUALITY FINDINGS FROM THE AUTOMATED REVIEW:
{findings or "- none"}

VERIFIED PRODUCT FACTS (the only product claims allowed; cite their ids in product_fact_ids):
{facts or "- none"}

{prompts.CRAFT}
INPUTS
{_inputs_block(job)}

CURRENT SCRIPT:
{job.script.model_dump_json() if job.script else "{}"}

OUTPUT: reply with ONE JSON object only, inside a single ```json code block, matching this JSON schema exactly:
{_schema(RelayRevision)}
"""


def prepare(job: Job, spec: FormatSpec, page: Optional[PageSource] = None) -> Job:
    """Runs in the worker: fetch the page, then wait for the user's chat answer."""
    _, text, flags = gather_source(job.inputs.product_url, page, job.inputs.product_copy,
                                          job.inputs.product_image_urls)
    job.flags = flags
    job.dossier, job.brief, job.concepts, job.concept_decision, job.script, job.qc_history = None, None, [], None, None, []
    job.relay = RelayState(kind="full", prompt=build_full_prompt(job, spec, text), source_text=text)
    job.status = JobStatus.awaiting_input
    job.events.append(StageEvent(stage="relay", status="started",
                                 detail=f"Prompt ready for {ENGINE_LABEL.get(job.inputs.engine, 'your chat')}"))
    return job


def start_revision(job: Job, spec: FormatSpec, request: str, by: str = "", kind: str = "feedback") -> Job:
    if not job.script:
        raise RelayError("There's no script to revise yet.")
    job.revisions.append(Revision(by=by, kind=kind, detail=request))  # type: ignore[arg-type]
    source = job.relay.source_text if job.relay else (job.dossier.source_excerpt if job.dossier else "")
    rnd = (job.relay.round + 1) if job.relay else 2
    job.relay = RelayState(kind="revise", round=rnd, prompt=build_revision_prompt(job, spec, request), source_text=source)
    job.status = JobStatus.awaiting_input
    job.error = ""
    job.events.append(StageEvent(stage="relay", status="started", detail=f"Revision prompt ready (round {rnd})"))
    return job


def _parse(text: str, model: type[BaseModel]) -> BaseModel:
    raw = _extract_json(text or "")
    if not raw.strip():
        raise RelayError("The pasted answer is empty. Copy the whole reply from your chat, including the ```json block.")
    try:
        return model.model_validate_json(raw)
    except ValidationError as e:
        problems = []
        for err in e.errors()[:4]:
            where = ".".join(str(x) for x in err["loc"])
            problems.append(f"{where}: {err['msg']}" if where else err["msg"])
        if any(err["type"] == "json_invalid" for err in e.errors()):
            raise RelayError("That isn't complete JSON — the reply may have been cut off. Ask your chat to "
                             "\"continue\" or \"send the full JSON again\", then paste the whole answer.")
        raise RelayError("The answer is missing some required parts (" + "; ".join(problems) + "). Ask your chat: "
                         "\"Return the complete JSON exactly matching the schema\", then paste it again.")


def apply_answer(job: Job, spec: FormatSpec, text: str) -> Job:
    """Validate the pasted answer, verify facts, run the quality gates, and finish the job."""
    if not job.relay or job.status != JobStatus.awaiting_input:
        raise RelayError("This script isn't waiting for a chat answer.")
    if job.relay.kind == "full":
        res: RelayResult = _parse(text, RelayResult)  # type: ignore[assignment]
        ids = [f.id.strip() or f"F{n}" for n, f in enumerate(res.facts, 1)]
        if len(set(ids)) != len(ids):
            ids = [f"F{n}" for n in range(1, len(ids) + 1)]
        ext = _Extraction(product_name=res.product_name, brand=res.brand,
                          facts=[_ExtractedFact(category=f.category, statement=f.statement, quote=f.quote, from_image=False)
                                 for f in res.facts],
                          packaging_description=res.packaging_description, unknowns=res.unknowns)
        page = PageSource(url=job.inputs.product_url)
        job.dossier, flags = build_dossier(job.inputs.product_url, page, job.relay.source_text, ext,
                                           job.inputs.product_copy, ids=ids)
        job.flags = [f for f in job.flags if f.area != "product" or f.severity == "major"] + flags
        job.brief = res.brief
        for a in res.brief.assumptions:
            job.flags.append(Flag(severity="minor", area="assumption", message=f"Assumed: {a}",
                                  suggestion="Confirm or correct in the brief."))
        job.concepts = res.concepts[:max(1, job.inputs.concept_count)]
        idx = min(max(res.chosen_index, 0), len(job.concepts) - 1) if job.concepts else 0
        job.concept_decision = ConceptDecision(
            scores=[ConceptScore(index=k, hook=0, brief_fit=0, originality=0, producibility=0, product_truth=0,
                                 rationale="") for k in range(len(job.concepts))],
            chosen_index=idx, director_notes=res.director_notes)
        job.script = res.script
    else:
        rev: RelayRevision = _parse(text, RelayRevision)  # type: ignore[assignment]
        job.script = rev.script

    findings = run_checks(job.script, job.inputs, job.dossier, job.brief, spec)
    passed = not any(f.severity in ("blocker", "major") for f in findings)
    who = ENGINE_LABEL.get(job.inputs.engine, "your chat")
    job.qc_history.append(QCReport(iteration=job.relay.round, findings=findings, scores={}, passed=passed,
                                   summary=f"Written with {who}. Structure, timing, product truth, continuity and CTA "
                                           "were checked automatically."))
    blockers = any(f.severity == "blocker" for f in job.flags)
    job.status = JobStatus.ready if passed and not blockers else JobStatus.needs_review
    job.relay.last_error = ""
    job.events.append(StageEvent(stage="relay", status="done", detail=f"Answer from {who} checked"))
    return job
