"""Creative knowledge the pipeline relies on: platform specs, hook library,
and the lists of clichés and fake-looking visuals the QC gate rejects.

This is editorial policy, kept in code so it is versioned and reviewable.
"""
from __future__ import annotations

PLATFORMS: dict[str, dict] = {
    "instagram_reels": {
        "label": "Instagram Reels", "aspect": "9:16", "durations": [15, 30, 45, 60],
        "hook_window_sec": 2.0, "max_shot_sec": 4.0,
        "notes": "Sound-on but caption every spoken line. Keep text out of the bottom 20% and right edge "
                 "(UI overlays). Native, handheld or creator-shot feel beats glossy ad look.",
        "cta_style": "Tap 'Shop Now' / link in bio / save this for later",
    },
    "tiktok": {
        "label": "TikTok", "aspect": "9:16", "durations": [15, 21, 30, 45, 60],
        "hook_window_sec": 1.5, "max_shot_sec": 3.5,
        "notes": "Creator-first, talk-to-camera works. Trending-sound friendly. Text in the safe zone, "
                 "avoid bottom 25% and right 15%. Fast pattern interrupts.",
        "cta_style": "Tap the orange cart / link in bio",
    },
    "youtube_shorts": {
        "label": "YouTube Shorts", "aspect": "9:16", "durations": [15, 30, 45, 60],
        "hook_window_sec": 2.0, "max_shot_sec": 4.0,
        "notes": "Loopable endings perform well. Keep text above the bottom 25%.",
        "cta_style": "Tap the product sticker / check the link",
    },
    "youtube": {
        "label": "YouTube (in-stream)", "aspect": "16:9", "durations": [15, 30, 60, 90],
        "hook_window_sec": 5.0, "max_shot_sec": 6.0,
        "notes": "Brand and product must land before the 5s skip. Can carry a fuller story.",
        "cta_style": "Visit / Shop now via the companion banner",
    },
    "meta_feed": {
        "label": "Meta Feed (FB/IG)", "aspect": "4:5", "durations": [10, 15, 30],
        "hook_window_sec": 2.0, "max_shot_sec": 4.0,
        "notes": "Most viewers watch muted: the story must work with sound off via supers.",
        "cta_style": "Shop Now button",
    },
    "tv": {
        "label": "TV / CTV", "aspect": "16:9", "durations": [10, 15, 20, 30, 60],
        "hook_window_sec": 3.0, "max_shot_sec": 6.0,
        "notes": "Broadcast finish. Legal supers must hold long enough to read (min 3s).",
        "cta_style": "End frame with brand, pack shot and URL/QR",
    },
}

# Spoken words per second by language, used to budget VO and dialogue per scene.
SPEECH_WPS = {"English": 2.6, "Hindi": 2.4, "Hinglish": 2.5}
DEFAULT_WPS = 2.5

HOOK_TYPES: dict[str, str] = {
    "question": "Open on a question the audience is already asking themselves. Must be specific, not rhetorical fluff.",
    "relatable_moment": "Open mid-moment on a situation the audience instantly recognises from their own life.",
    "problem_agitation": "Show the frustration vividly in the first second, then twist the knife once before the turn.",
    "pov": "'POV:' framing. The camera is the viewer, dropped into a specific situation.",
    "bold_statement": "A strong, true statement. Only from verified product facts or the brief - never invented.",
    "myth_bust": "State a common belief, then break it. The 'truth' must be backed by a verified fact.",
    "curiosity_gap": "Show the result or an odd detail first and withhold the explanation.",
    "visual_pattern_interrupt": "An unexpected but real, shootable visual action in frame one. No CGI tricks.",
    "unboxing_reveal": "Hands, real packaging, satisfying reveal of the actual product.",
    "before_after": "A real contrast. Only if the brief allows it and claims are supported.",
    "listicle": "'3 reasons...' / '2 things nobody tells you...' Numbers must match the scenes that follow.",
    "testimonial": "Creator or customer voice speaking from experience. Must be framed as a portrayal unless real.",
    "asmr_sensory": "Texture, sound, pour, click, swatch - the product's real sensory moment as the hook.",
    "challenge_trend": "A platform-native format or trend, adapted to the product without forcing it.",
}

# VO/dialogue phrases that make a script read as generic AI copy.
CLICHE_PHRASES = [
    "introducing", "game-changer", "game changer", "say goodbye to", "unlock", "elevate your",
    "revolutionary", "in today's fast-paced world", "look no further", "take it to the next level",
    "whether you're", "transform your", "say hello to", "the secret to", "it's time to",
    "level up your", "experience the magic", "like never before", "one-stop solution",
    "seamless", "effortlessly", "embark", "journey", "boost your confidence",
]

# Visual directions that read as AI-generated or cannot be honestly shot.
FAKE_VISUAL_TERMS = [
    "glowing aura", "aura", "hologram", "holographic", "floating particles", "sparkles emanate",
    "magical glow", "magic sparkles", "levitat", "glowing molecules", "cgi molecules",
    "energy waves", "light beams shoot", "futuristic hud", "dna helix", "neon outline around",
    "shimmering particles", "ethereal glow", "portal", "fairy dust", "radiant glow surrounds",
    "glowing skin cells", "3d icons float", "infographic icons pop",
]

# Visuals that imply a claim (badges, seals). Only allowed when a certification fact backs them.
CLAIM_VISUAL_TERMS = ["badge", "seal", "certified", "award", "stamp of", "approved by", "#1"]

# Words that turn a line into a claim needing evidence.
CLAIM_WORDS = [
    "clinically", "proven", "dermatologist", "dermatologist-tested", "guaranteed", "100%", "cure",
    "cures", "#1", "number one", "no side effects", "chemical-free", "chemical free", "permanent",
    "certified", "award-winning", "patented", "fda", "organic", "vegan", "cruelty-free",
    "cruelty free", "sugar-free", "sugar free", "paraben-free", "toxin-free", "zero sugar",
]


def platform(name: str) -> dict:
    return PLATFORMS.get(name, PLATFORMS["instagram_reels"])


def wps(language: str) -> float:
    return SPEECH_WPS.get(language, DEFAULT_WPS)
