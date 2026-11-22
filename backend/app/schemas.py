"""Core data model.

The script is generated as structured data and rendered to Google Docs by code,
never as free text. That is what keeps every document in the same format: the
model decides *what* goes in each field, the renderer decides how it looks.
"""
from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Annotated, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------- inputs

Short = Annotated[str, Field(max_length=300)]


class Reference(BaseModel):
    kind: Literal["url", "note"] = "note"
    value: str = Field(max_length=2000)
    what_to_take: str = Field("", max_length=500)  # e.g. "pacing and jump cuts"


class JobInputs(BaseModel):
    product_url: str = Field(max_length=2000, pattern=r"^https?://")

    @field_validator("product_url", mode="before")
    @classmethod
    def _link_as_pasted(cls, v):
        """People paste links without https:// or with stray spaces; accept them as typed."""
        if isinstance(v, str):
            v = v.strip().strip("<>\"'")
            if v and "://" not in v:
                v = "https://" + v.lstrip("/")
        return v
    client_brief: str = Field("", max_length=20000)
    mode: Literal["write", "refine"] = "write"            # refine = improve the client's own script, keep the rest
    client_script: str = Field("", max_length=30000)
    # more products for one script: combos, colour variants, designs, related items, a range
    extra_product_urls: list[Annotated[str, Field(max_length=2000)]] = Field([], max_length=5)

    @field_validator("extra_product_urls", mode="before")
    @classmethod
    def _more_links(cls, v):
        out = []
        for u in v or []:
            u = str(u).strip().strip("<>\"'")
            if u:
                out.append(u if "://" in u else "https://" + u.lstrip("/"))
        return list(dict.fromkeys(out))

    @model_validator(mode="before")
    @classmethod
    def _split_pasted_links(cls, data):
        """Several links pasted into the main box become extra products."""
        if isinstance(data, dict) and isinstance(data.get("product_url"), str):
            parts = [p for p in data["product_url"].replace(",", " ").split() if "." in p]
            if len(parts) > 1:
                data = {**data, "product_url": parts[0],
                        "extra_product_urls": [*parts[1:], *(data.get("extra_product_urls") or [])][:5]}
        return data

    @model_validator(mode="after")
    def _enough_to_work_with(self):
        if self.mode == "refine" and len(self.client_script.strip()) < 40:
            raise ValueError("Paste the client's script to refine (a few lines at least).")
        if self.mode == "write" and len(self.client_brief.strip()) < 20:
            raise ValueError("Add a sentence or two of brief.")
        return self
    product_copy: str = Field("", max_length=20000)  # fallback/extra product text pasted by the user
    product_image_urls: list[Annotated[str, Field(max_length=2000, pattern=r"^https://")]] = Field([], max_length=4)
    platform: str = Field("instagram_reels", max_length=40)
    duration_sec: int = Field(30, ge=6, le=180)
    aspect_ratio: Optional[Short] = None
    creative_direction: str = Field("", max_length=5000)
    references: list[Reference] = Field([], max_length=8)
    hook_type: Optional[Short] = None
    theme: Optional[Short] = None
    target_audience: str = Field("", max_length=1000)
    tone: Short = ""
    language: Short = "English"
    mandatories: list[Short] = Field([], max_length=15)  # must-say lines, legal supers, hashtags
    exclusions: list[Short] = Field([], max_length=30)   # words, claims or visuals the client has ruled out
    brand_name: Optional[Short] = None
    # Creative-brief fields (mirroring the team's brief template; all optional)
    logo_url: str = Field("", max_length=2000)
    brand_guidelines_url: str = Field("", max_length=2000)
    asset_links: list[Annotated[str, Field(max_length=2000)]] = Field([], max_length=10)  # raw/clicked product images/videos
    ad_type: Short = "Video"
    headline_ideas: list[Short] = Field([], max_length=10)
    key_usps: list[Short] = Field([], max_length=15)
    offer: Short = ""
    cta: Short = ""
    design_style: Short = ""
    elements_to_highlight: list[Short] = Field([], max_length=15)
    subtitles: bool = True
    image_source: Short = "Web"  # where product visuals come from: Web, Client assets, AI generated, Fresh shoot
    format_id: str = Field("house-v1", max_length=60)
    concept_count: int = Field(3, ge=1, le=5)
    # auto = ScriptStudio's built-in AI pipeline; chatgpt / claude = the user runs one prompt in their own
    # ChatGPT or Claude chat and pastes the answer back (no API needed).
    engine: Literal["auto", "chatgpt", "claude"] = "auto"


# ---------------------------------------------------------------- product truth

FactCategory = Literal[
    "name", "variant", "feature", "benefit", "claim", "ingredient", "spec",
    "packaging", "price", "usage", "certification", "audience", "other",
]


class Evidence(BaseModel):
    source: str   # "product_page", "image:<url>", "brief"
    quote: str    # verbatim text the fact is based on


class ProductFact(BaseModel):
    id: str
    category: FactCategory
    statement: str
    evidence: Evidence
    verified: bool = False
    note: str = ""


class ProductDossier(BaseModel):
    url: str
    name: str = ""
    brand: str = ""
    facts: list[ProductFact] = []
    packaging_description: str = ""
    image_urls: list[str] = []
    unknowns: list[str] = []
    source_excerpt: str = ""  # the normalised page text facts were checked against

    def verified_facts(self) -> list[ProductFact]:
        return [f for f in self.facts if f.verified]


# ---------------------------------------------------------------- flags

Severity = Literal["blocker", "major", "minor", "info"]


class Flag(BaseModel):
    severity: Severity
    area: str  # "product", "brief", "conflict", "missing_input", ...
    message: str
    suggestion: str = ""


# ---------------------------------------------------------------- creative layer

class CreativeBrief(BaseModel):
    objective: str
    key_message: str
    supporting_messages: list[str]
    audience: str
    audience_insight: str
    tone: str
    cta_intent: str
    mandatories: list[str]
    exclusions: list[str]
    reference_takeaways: list[str]
    assumptions: list[str]  # anything the system had to assume, stated openly


class Concept(BaseModel):
    title: str
    logline: str
    hook_type: str
    hook_visual: str
    hook_line: str
    story_arc: str
    product_role: str
    ending_button: str
    why_it_works: str
    risks: str


class ConceptSet(BaseModel):
    concepts: list[Concept]


class ConceptScore(BaseModel):
    index: int
    hook: int
    brief_fit: int
    originality: int
    producibility: int
    product_truth: int
    rationale: str


class ConceptDecision(BaseModel):
    scores: list[ConceptScore]
    chosen_index: int
    director_notes: str


class Beat(BaseModel):
    index: int
    purpose: str  # hook, tension, turn, proof, payoff, cta ...
    start_sec: float
    end_sec: float
    what_happens: str
    emotional_note: str


class BeatSheet(BaseModel):
    beats: list[Beat]


# ---------------------------------------------------------------- script

class Character(BaseModel):
    id: str           # "C1"
    name: str
    role: str
    description: str  # age range, look, wardrobe, energy
    continuity: str   # what must stay identical across scenes
    age_range: str = ""      # "28–34"
    appearance: str = ""     # build, skin tone, hair, natural skin texture, grooming
    personality: str = ""    # who they are, in a few words
    expressions: str = ""    # how their face and body react across the story
    wardrobe: str = ""
    voice: str = ""          # language, accent, pace, pitch, how names are pronounced


class Shot(BaseModel):
    framing: str             # "CU", "MCU", "Wide", "Macro", "OTS"
    camera: str              # angle + movement: "eye level, slow push-in", "high angle, locked off"
    action: str              # what happens in this shot
    seconds: float = 0


class DialogueLine(BaseModel):
    character_id: str
    line: str
    delivery: str = ""  # e.g. "deadpan, under breath"


class Scene(BaseModel):
    number: int
    label: str = ""           # the scene's role in a few words: "Hook", "The surprise", "Gift and CTA"
    start_sec: float
    end_sec: float
    location: str
    shot: str                 # framing + camera movement
    visual: str               # what we see, concretely
    vo: str                   # voiceover ("" when none)
    dialogue: list[DialogueLine]
    on_screen_text: str
    sfx_music: str
    transition: str           # how we get into the next scene
    characters: list[str]     # character ids in frame
    props: list[str]
    product_fact_ids: list[str]  # every product claim in this scene must point at a fact
    sync_note: str            # why this picture belongs with this line
    shots: list[Shot] = []    # the scene broken into shots
    performance: str = ""     # expressions, gestures, energy of the people in frame
    music: str = ""           # music cue for this scene
    sfx: str = ""             # sound effects / natural sound
    changed: list[str] = []   # refine mode: which parts were changed ("visual", "vo", "dialogue", ...)


class CTA(BaseModel):
    line: str
    visual: str
    on_screen_text: str
    action: str  # the platform-native action, e.g. "Tap Shop Now"


class ProductDetail(BaseModel):
    fact_id: str
    statement: str


class Script(BaseModel):
    title: str
    logline: str
    talent_summary: str = ""              # who is on screen, one line ("Indian couple, wife 30–38 …")
    product_line: str = ""                # product name (key verified features)
    idea: str = ""                        # quoted tagline + the story in a sentence or two
    small_print: str = ""                 # legal / compliance small line, "" when not needed
    headline_options: list[str] = []      # 2–3 headline / hook-line options for supers and post copy
    supporting_copy: str = ""             # sub-headline / caption copy
    visual_style: str = ""                # design style in one line (look, light, camera feel)
    elements_to_highlight: list[str] = [] # product moments, benefits, lifestyle shots to feature
    concept_summary: str
    hook_type: str
    theme: str
    audience: str
    tone: str
    characters: list[Character]
    continuity: list[str]
    product_details: list[ProductDetail]
    scenes: list[Scene]
    cta: CTA
    production_notes: list[str]
    style: str = ""                       # realistic UGC, live action, 2D/3D animation, cartoon, motion graphics
    look_and_texture: str = ""            # skin texture, grade, lighting, lens feel
    voice_direction: str = ""             # language, accent, pace, energy of VO and dialogue
    pronunciation: list[str] = []         # "Suroskie: soo-ROSS-kee"
    music_direction: str = ""
    sound_design: str = ""
    changes: list["ChangeNote"] = []      # refine mode: every edit made to the client's script


class ChangeNote(BaseModel):
    scene: int = 0            # 0 = the whole script
    part: str                 # "VO", "Visual", "Dialogue (Wife)", "Title", "CTA"
    before: str
    after: str
    why: str


Script.model_rebuild()


# ---------------------------------------------------------------- quality control

class QCFinding(BaseModel):
    check: str
    severity: Severity
    scene: Optional[int] = None
    message: str
    fix: str = ""


class CriticScores(BaseModel):
    hook_strength: int
    story_logic: int
    visual_vo_sync: int
    dialogue_quality: int
    product_integration: int
    cta_relevance: int
    brief_alignment: int
    authenticity: int


class CriticFinding(BaseModel):
    check: str
    severity: Literal["blocker", "major", "minor"]
    scene: Optional[int]
    message: str
    fix: str


class CriticReport(BaseModel):
    scores: CriticScores
    findings: list[CriticFinding]
    verdict: str


class QCReport(BaseModel):
    iteration: int
    findings: list[QCFinding] = []
    scores: dict[str, int] = {}
    passed: bool = False
    summary: str = ""


# ---------------------------------------------------------------- jobs

class JobStatus(str, Enum):
    queued = "queued"
    running = "running"
    ready = "ready"                # passed every gate
    needs_review = "needs_review"  # finished, but a gate or blocker flag needs a human
    awaiting_input = "awaiting_input"  # waiting for the user to paste their ChatGPT/Claude answer
    failed = "failed"
    approved = "approved"


class StageEvent(BaseModel):
    stage: str
    status: Literal["started", "done", "failed"]
    at: str = Field(default_factory=utcnow)
    detail: str = ""


class Revision(BaseModel):
    at: str = Field(default_factory=utcnow)
    by: str = ""
    kind: Literal["feedback", "concept", "edit"]
    detail: str


class RelayState(BaseModel):
    kind: Literal["full", "revise"]
    round: int = 1
    prompt: str
    source_text: str = ""      # what product facts are verified against
    created_at: str = Field(default_factory=utcnow)
    last_error: str = ""
    token: str = ""            # secret half of the handoff code Claude / ChatGPT use to fetch and submit this job
    submitted_via: str = ""    # "claude-connector", "chatgpt-action" or "" (pasted)


class Job(BaseModel):
    id: str
    owner: str = ""  # email of the creator ("local" when auth is off)
    inputs: JobInputs
    status: JobStatus = JobStatus.queued
    created_at: str = Field(default_factory=utcnow)
    events: list[StageEvent] = []
    flags: list[Flag] = []
    dossier: Optional[ProductDossier] = None
    brief: Optional[CreativeBrief] = None
    concepts: list[Concept] = []
    concept_decision: Optional[ConceptDecision] = None
    beats: Optional[BeatSheet] = None
    script: Optional[Script] = None
    qc_history: list[QCReport] = []
    doc_url: Optional[str] = None
    format_version: str = ""
    revisions: list[Revision] = []
    relay: Optional[RelayState] = None
    updated_at: str = Field(default_factory=utcnow)
    error: str = ""
