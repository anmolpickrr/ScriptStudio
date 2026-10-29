"""Deterministic quality gates. These run before (and in addition to) the LLM
critic because structure, timing and fact-grounding are things code can check
exactly; there's no reason to trust a model's opinion on them."""
from __future__ import annotations

import re

from .. import playbook
from ..house_format import FormatSpec
from ..schemas import CreativeBrief, JobInputs, ProductDossier, QCFinding, Script

NUMBER_RE = re.compile(r"\d+(?:[.,]\d+)?\s*(?:%|ml|l|g|kg|mg|hrs?|hours?|days?|weeks?|x|₹|rs\.?|inr|spf)?", re.I)
CLOCK_RE = re.compile(r"\b\d{1,2}[:.]\d{2}\s*(?:am|pm)?\b|\b\d{1,2}\s*(?:am|pm)\b", re.I)
TIME_TOL = 0.25


def words(s: str) -> int:
    return len(re.findall(r"[\w'’-]+", s or ""))


def spoken_text(scene) -> str:
    return " ".join([scene.vo] + [d.line for d in scene.dialogue]).strip()


def all_text(script: Script) -> str:
    """What the audience actually hears and reads: the scenes, not the summary blocks."""
    parts = []
    for s in script.scenes:
        parts += [spoken_text(s), s.on_screen_text]
    return "\n".join(parts)


def run_checks(script: Script, inputs: JobInputs, dossier: ProductDossier | None,
               brief: CreativeBrief | None, spec: FormatSpec) -> list[QCFinding]:
    out: list[QCFinding] = []
    plat = playbook.platform(inputs.platform)
    out += check_structure(script, inputs.duration_sec)
    out += check_timing(script, inputs, plat, spec)
    out += check_hook(script, plat)
    out += check_sync(script, spec)
    out += check_continuity(script)
    out += check_product_truth(script, dossier, inputs)
    out += check_authenticity(script, dossier)
    out += check_language(script)
    out += check_cta(script, spec)
    out += check_mandatories(script, inputs, brief)
    return out


def check_structure(script: Script, duration: int) -> list[QCFinding]:
    out = []
    f = lambda msg, fix="", scene=None, sev="major": out.append(
        QCFinding(check="structure", severity=sev, scene=scene, message=msg, fix=fix))
    if not script.scenes:
        f("Script has no scenes.", sev="blocker")
        return out
    for i, s in enumerate(script.scenes, 1):
        if s.number != i:
            f(f"Scene numbering out of order (found {s.number}, expected {i}).", "Renumber scenes sequentially.", s.number)
    first, last = script.scenes[0], script.scenes[-1]
    if abs(first.start_sec) > TIME_TOL:
        f("First scene doesn't start at 0s.", "Start scene 1 at 0.", 1)
    if abs(last.end_sec - duration) > 1.0:
        f(f"Script runs {last.end_sec:g}s; the brief asks for {duration}s.",
          f"Re-time scenes so the last one ends at {duration}s.", last.number)
    for a, b in zip(script.scenes, script.scenes[1:]):
        if abs(b.start_sec - a.end_sec) > TIME_TOL:
            f(f"Gap/overlap between scene {a.number} (ends {a.end_sec:g}s) and scene {b.number} "
              f"(starts {b.start_sec:g}s).", "Make timecodes contiguous.", b.number)
    for s in script.scenes:
        if s.end_sec <= s.start_sec:
            f(f"Scene {s.number} has no duration.", "Fix its timecodes.", s.number, "blocker")
        if not s.visual.strip():
            f(f"Scene {s.number} has no visual direction.", "Describe what we see.", s.number, "blocker")
    for name, val in (("title", script.title), ("logline", script.logline)):
        if not val.strip():
            f(f"Missing {name}.", sev="minor")
    if not script.characters and any(s.dialogue for s in script.scenes):
        f("Dialogue exists but no characters are defined.", "Add character descriptions.")
    return out


def check_timing(script, inputs, plat, spec) -> list[QCFinding]:
    out = []
    rate = playbook.wps(inputs.language) * spec.rules.max_words_per_sec_factor
    for s in script.scenes:
        dur = s.end_sec - s.start_sec
        n = words(spoken_text(s))
        budget = rate * dur
        if n > budget + 1:
            out.append(QCFinding(check="timing", severity="major", scene=s.number,
                                 message=f"Scene {s.number}: {n} spoken words in {dur:g}s "
                                         f"(budget ~{int(budget)} at {rate:.1f} words/sec). It won't fit.",
                                 fix="Cut the line or give the scene more time."))
        if dur < spec.rules.min_scene_sec and s.number != 1:
            out.append(QCFinding(check="timing", severity="minor", scene=s.number,
                                 message=f"Scene {s.number} is only {dur:g}s; too short to register.",
                                 fix="Merge it or extend it."))
        if dur > plat["max_shot_sec"] * 2:
            out.append(QCFinding(check="timing", severity="minor", scene=s.number,
                                 message=f"Scene {s.number} holds {dur:g}s; long for {plat['label']} pacing.",
                                 fix="Break it into two shots or add a cut point."))
        if s.on_screen_text and words(s.on_screen_text) > max(3, dur * 3):
            out.append(QCFinding(check="timing", severity="minor", scene=s.number,
                                 message=f"Scene {s.number}: on-screen text too long to read in {dur:g}s.",
                                 fix="Shorten the super."))
    return out


def check_hook(script, plat) -> list[QCFinding]:
    if not script.scenes:
        return []
    s = script.scenes[0]
    out = []
    window = plat["hook_window_sec"]
    hook_scenes = [x for x in script.scenes if x.start_sec < window]
    if not any(spoken_text(x) or x.on_screen_text for x in hook_scenes):
        out.append(QCFinding(check="hook", severity="major", scene=1,
                             message=f"Nothing is said or shown as text in the first {window:g}s hook window.",
                             fix="Land the hook line (VO, dialogue or super) inside the window."))
    if s.end_sec > window * 2.5:
        out.append(QCFinding(check="hook", severity="minor", scene=1,
                             message=f"Opening shot runs {s.end_sec:g}s; the hook window on {plat['label']} is {window:g}s.",
                             fix="Cut into the action sooner."))
    return out


def check_sync(script, spec) -> list[QCFinding]:
    out = []
    for s in script.scenes:
        if spec.rules.require_sync_note and spoken_text(s) and not s.sync_note.strip():
            out.append(QCFinding(check="visual_vo_sync", severity="minor", scene=s.number,
                                 message=f"Scene {s.number} has no sync note explaining how the visual supports the line.",
                                 fix="Add a sync note, or rethink the pairing if you can't write one."))
        for d in s.dialogue:
            if d.character_id not in s.characters:
                out.append(QCFinding(check="visual_vo_sync", severity="major", scene=s.number,
                                     message=f"Scene {s.number}: {d.character_id} speaks on camera but isn't listed in frame.",
                                     fix="Put the speaker in frame or move the line to VO."))
    return out


def check_continuity(script) -> list[QCFinding]:
    out = []
    ids = {c.id for c in script.characters}
    for s in script.scenes:
        for cid in set(s.characters) | {d.character_id for d in s.dialogue}:
            if cid not in ids:
                out.append(QCFinding(check="continuity", severity="major", scene=s.number,
                                     message=f"Scene {s.number} uses character '{cid}' who isn't defined.",
                                     fix="Define the character or fix the id."))
    for c in script.characters:
        if not c.description.strip():
            out.append(QCFinding(check="continuity", severity="minor",
                                 message=f"Character {c.id} has no description.", fix="Add age, look, wardrobe."))
        if not any(c.id in s.characters for s in script.scenes):
            out.append(QCFinding(check="continuity", severity="minor",
                                 message=f"Character {c.id} ({c.name}) never appears.", fix="Use or remove them."))
    if script.characters and not script.continuity:
        out.append(QCFinding(check="continuity", severity="major", message="No continuity guidelines.",
                             fix="List wardrobe, props, product state and time-of-day rules."))
    return out


def check_product_truth(script, dossier, inputs) -> list[QCFinding]:
    out = []
    verified = {f.id: f for f in (dossier.verified_facts() if dossier else [])}
    known = {f.id for f in (dossier.facts if dossier else [])}
    for s in script.scenes:
        for fid in s.product_fact_ids:
            if fid not in known:
                out.append(QCFinding(check="product_accuracy", severity="blocker", scene=s.number,
                                     message=f"Scene {s.number} cites fact {fid}, which doesn't exist.",
                                     fix="Remove the claim or cite a real verified fact."))
            elif fid not in verified:
                out.append(QCFinding(check="product_accuracy", severity="blocker", scene=s.number,
                                     message=f"Scene {s.number} relies on unverified fact {fid}.",
                                     fix="Drop the claim until the client confirms it."))
    for d in script.product_details:
        if d.fact_id not in verified:
            out.append(QCFinding(check="product_accuracy", severity="blocker",
                                 message=f"Product details list {d.fact_id}, which isn't a verified fact.",
                                 fix="List only verified facts."))

    evidence = " ".join([f.statement + " " + f.evidence.quote for f in verified.values()]
                        + inputs.mandatories).lower()
    for s in script.scenes:
        text = CLOCK_RE.sub(" ", f"{spoken_text(s)} {s.on_screen_text}".lower())
        cited = " ".join(verified[f].statement.lower() + " " + verified[f].evidence.quote.lower()
                         for f in s.product_fact_ids if f in verified)
        for m in NUMBER_RE.finditer(text):
            num = re.match(r"\d+(?:[.,]\d+)?", m.group(0)).group(0)
            if num not in evidence and not _is_time_reference(text, m):
                out.append(QCFinding(check="product_accuracy", severity="blocker", scene=s.number,
                                     message=f"Scene {s.number} states '{m.group(0).strip()}', a number not found in any verified fact.",
                                     fix="Use the exact figure from the product page or remove it."))
        for w in playbook.CLAIM_WORDS:
            if re.search(rf"(?<![\w-]){re.escape(w)}(?![\w-])", text) and w not in evidence:
                out.append(QCFinding(check="product_accuracy", severity="major", scene=s.number,
                                     message=f"Scene {s.number} uses claim language '{w}' that no verified fact supports.",
                                     fix="Remove it or rephrase to what the product page actually says."))
            elif w in text and cited and w not in cited and w in evidence:
                out.append(QCFinding(check="product_accuracy", severity="minor", scene=s.number,
                                     message=f"Scene {s.number} says '{w}' but doesn't cite the fact that supports it.",
                                     fix="Add the supporting fact id to product_fact_ids."))
    return out


def _is_time_reference(text: str, m: re.Match) -> bool:
    # "3 am", "day 2", "7 minutes before the meeting" are story, not product claims.
    after = text[m.end():m.end() + 10]
    return bool(re.match(r"\s*(am|pm|o'clock|minutes?|mins?|seconds?|secs?|years? old|yrs? old)\b", after))


def check_authenticity(script, dossier) -> list[QCFinding]:
    out = []
    has_cert = any(f.category == "certification" for f in (dossier.verified_facts() if dossier else []))
    pack_known = bool(dossier and any(f.category == "packaging" for f in dossier.verified_facts()))
    for s in script.scenes:
        vis = f"{s.visual} {s.shot} {' '.join(s.props)}".lower()
        for t in playbook.FAKE_VISUAL_TERMS:
            if t in vis:
                out.append(QCFinding(check="authenticity", severity="major", scene=s.number,
                                     message=f"Scene {s.number} visual includes '{t}', which reads as AI-generated or unshootable.",
                                     fix="Replace with a real, practical action or in-camera effect."))
        if not has_cert:
            for t in playbook.CLAIM_VISUAL_TERMS:
                if t in vis or t in s.on_screen_text.lower():
                    out.append(QCFinding(check="authenticity", severity="blocker", scene=s.number,
                                         message=f"Scene {s.number} shows '{t}' but the product has no verified certification/award.",
                                         fix="Remove the badge/seal/award visual."))
        if not pack_known and re.search(r"\b(label reads|pack (is|in)|bottle (is|in)|jar (is|in)|box (is|in))\b", vis):
            if "[use actual pack]" not in vis:
                out.append(QCFinding(check="authenticity", severity="major", scene=s.number,
                                     message=f"Scene {s.number} describes packaging details that aren't verified.",
                                     fix="Write '[USE ACTUAL PACK]' instead of describing the pack."))
    return out


def check_language(script) -> list[QCFinding]:
    out = []
    for s in script.scenes:
        text = spoken_text(s).lower() + " " + s.on_screen_text.lower()
        for p in playbook.CLICHE_PHRASES:
            if re.search(rf"\b{re.escape(p)}\b", text):
                out.append(QCFinding(check="dialogue_quality", severity="minor", scene=s.number,
                                     message=f"Scene {s.number} uses ad-speak cliché '{p}'.",
                                     fix="Say it the way a real person would."))
        if re.search(r"[—–]", spoken_text(s) + " " + s.on_screen_text):
            out.append(QCFinding(check="voice", severity="minor", scene=s.number,
                                 message=f"Scene {s.number} uses a dash in a spoken line or super, which reads as AI-written.",
                                 fix="Use a full stop or a comma instead."))
        for d in s.dialogue:
            if words(d.line) > 25:
                out.append(QCFinding(check="dialogue_quality", severity="minor", scene=s.number,
                                     message=f"Scene {s.number}: a {words(d.line)}-word dialogue line reads like a speech.",
                                     fix="Break it up or cut it."))
    stock = sum(1 for f in out if f.check == "dialogue_quality" and "cliché" in f.message)
    if stock >= 3:
        out.append(QCFinding(check="voice", severity="major",
                             message=f"{stock} stock ad phrases across the script; it reads like generic AI copy.",
                             fix="Rewrite those lines in plain, specific words this audience would actually say."))
    return out


def check_cta(script, spec) -> list[QCFinding]:
    out = []
    if not script.cta.line.strip() and not script.cta.on_screen_text.strip():
        return [QCFinding(check="cta", severity="blocker", message="No CTA.", fix="Add a CTA line and end-frame text.")]
    if spec.rules.require_cta_in_last_scene and script.scenes:
        last = script.scenes[-1]
        hay = f"{spoken_text(last)} {last.on_screen_text}".lower()
        key = _keywords(script.cta.line + " " + script.cta.on_screen_text)
        if key and not any(k in hay for k in key):
            out.append(QCFinding(check="cta", severity="major", scene=last.number,
                                 message="The CTA isn't delivered in the final scene.",
                                 fix="Put the CTA line or super in the last scene."))
    return out


def check_mandatories(script, inputs, brief) -> list[QCFinding]:
    out = []
    text = all_text(script).lower()
    mands = list(dict.fromkeys(inputs.mandatories + (brief.mandatories if brief else [])))
    for m in mands:
        if m.strip() and _canon(m) not in _canon(text):
            out.append(QCFinding(check="brief_alignment", severity="major",
                                 message=f"Mandatory not included verbatim: “{m}”.",
                                 fix="Add it exactly as given (VO or super)."))
    excl = list(dict.fromkeys(inputs.exclusions + (brief.exclusions if brief else [])))
    visuals = " ".join(s.visual for s in script.scenes).lower()
    for e in excl:
        if e.strip() and len(e) < 40 and (e.lower() in text or e.lower() in visuals):
            out.append(QCFinding(check="brief_alignment", severity="blocker",
                                 message=f"Script contains an excluded item: “{e}”.", fix="Remove it."))
    return out


def _canon(s: str) -> str:
    return re.sub(r"[^a-z0-9%#@]+", " ", s.lower()).strip()


def _keywords(s: str) -> list[str]:
    stop = {"the", "a", "an", "to", "now", "your", "and", "for", "on", "in", "of", "it", "this", "with"}
    return [w for w in re.findall(r"[a-z]{4,}", s.lower()) if w not in stop][:4]
