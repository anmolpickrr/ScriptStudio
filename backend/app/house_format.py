"""The approved script format.

A FormatSpec is stored, versioned and referenced by every job. The renderer
reads section order, labels and styling from it, and QC reads the rules, so
changing the house standard is a data change, not a prompt change.
"""
from __future__ import annotations

from pydantic import BaseModel


class SectionSpec(BaseModel):
    key: str        # maps to a renderer block
    label: str
    required: bool = True


class FormatStyle(BaseModel):
    # Defaults mirror the team's Creative Brief template: Arial 11, bold black title, numbered blue section
    # headings, bold "Label:" bullet pointers, grey rules between sections, portrait page with 1" margins.
    font_family: str = "Arial"
    body_pt: int = 11
    h1_pt: int = 17
    h2_pt: int = 13
    accent_hex: str = "#3C78D8"
    title_hex: str = "#000000"
    rule_hex: str = "#9E9E9E"
    table_header_bg: str = "#E8EDF3"
    flag_bg: str = "#FFF4E5"
    landscape: bool = False
    scene_layout: str = "blocks"  # blocks = one labelled block per scene (portrait-friendly) | table


class FormatRules(BaseModel):
    max_words_per_sec_factor: float = 1.0  # multiplier on language WPS
    min_scene_sec: float = 1.0
    require_sync_note: bool = True
    require_cta_in_last_scene: bool = True
    min_critic_score: int = 4
    max_revisions: int = 3


class FormatSpec(BaseModel):
    id: str
    version: int = 1
    name: str
    sections: list[SectionSpec]
    scene_columns: list[str]
    style: FormatStyle = FormatStyle()
    rules: FormatRules = FormatRules()
    editorial_notes: list[str] = []  # house preferences learned from approvals


BRIEF_KEYS = ("brief_basic", "brief_audience", "brief_format", "brief_messaging", "brief_direction", "brief_visual")

DEFAULT_FORMAT = FormatSpec(
    id="house-v1",
    version=2,
    name="House Script Format",
    sections=[
        # Part 1 — Creative Brief (same sections and labels as the team's brief template)
        SectionSpec(key="brief_basic", label="Basic Information"),
        SectionSpec(key="brief_audience", label="Targeting & Audience"),
        SectionSpec(key="brief_format", label="Ad Format & Specifications"),
        SectionSpec(key="brief_messaging", label="Messaging & Copy"),
        SectionSpec(key="brief_direction", label="Creative Direction (Summary)"),
        SectionSpec(key="brief_visual", label="Visual Direction"),
        # Part 2 — Video Script
        SectionSpec(key="concept", label="Concept"),
        SectionSpec(key="characters", label="Characters"),
        SectionSpec(key="continuity", label="Continuity Guidelines"),
        SectionSpec(key="product", label="Product Details (Verified)"),
        SectionSpec(key="scenes", label="Scene-by-Scene Script"),
        SectionSpec(key="cta", label="Call-To-Action (CTA)"),
        SectionSpec(key="production", label="Production Notes"),
        SectionSpec(key="open_questions", label="Open Questions for the Client", required=False),
        SectionSpec(key="qc", label="Quality Check Summary", required=False),
    ],
    scene_columns=["#", "Time", "Visual", "VO / Dialogue", "On-screen Text", "SFX / Music"],
    editorial_notes=[
        "Every scene earns its place: one idea per scene.",
        "Show it, then say what the picture cannot.",
        "Pack shots use the real pack, label facing camera.",
    ],
)
