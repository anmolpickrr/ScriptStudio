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
    font_family: str = "Arial"
    body_pt: int = 10
    h1_pt: int = 20
    h2_pt: int = 13
    accent_hex: str = "#1F3A5F"
    table_header_bg: str = "#E8EDF3"
    flag_bg: str = "#FFF4E5"
    landscape: bool = True  # scene tables need the width


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


DEFAULT_FORMAT = FormatSpec(
    id="house-v1",
    name="House Script Format",
    sections=[
        SectionSpec(key="header", label="Project Overview"),
        SectionSpec(key="open_questions", label="Open Questions & Flags", required=False),
        SectionSpec(key="concept", label="Concept"),
        SectionSpec(key="characters", label="Characters"),
        SectionSpec(key="continuity", label="Continuity Guidelines"),
        SectionSpec(key="product", label="Product Details (Verified)"),
        SectionSpec(key="scenes", label="Scene-by-Scene Script"),
        SectionSpec(key="cta", label="Call to Action"),
        SectionSpec(key="production", label="Production Notes"),
        SectionSpec(key="qc", label="Quality Check Summary", required=False),
    ],
    scene_columns=["#", "Time", "Visual", "VO / Dialogue", "On-screen Text", "SFX / Music"],
    editorial_notes=[
        "Every scene earns its place: one idea per scene.",
        "Show it, then say what the picture cannot.",
        "Pack shots use the real pack, label facing camera.",
    ],
)
