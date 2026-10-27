"""The multi-step workflow.

  product link ─► dossier (verified facts) ─┐
  brief + inputs + references ─► creative brief ─► reconcile (flags)
                                            └─► concepts ─► CD choice ─► beat sheet ─► script
                                                 ─► QC loop [deterministic checks + critic ─► revise] ─► render

Each stage is a separate, typed call with its own role and model tier, and
the job is saved after every stage so progress is visible and a failure is
diagnosable.
"""
from __future__ import annotations

import json
import logging
from typing import Literal, Optional

from pydantic import BaseModel

from . import memory, playbook, prompts
from .house_format import FormatSpec
from .ingest.product import PageSource, analyse_product
from .ingest.references import describe_references
from .llm import LLM
from .qc.checks import run_checks
from .schemas import (BeatSheet, ConceptDecision, ConceptSet, CreativeBrief, CriticReport, Flag, Job,
                      JobStatus, QCFinding, QCReport, Revision, Script, StageEvent, utcnow)
from .store import Store

log = logging.getLogger(__name__)
SEV_WEIGHT = {"blocker": 100, "major": 10, "minor": 1, "info": 0}


class _LLMFlag(BaseModel):
    severity: Literal["blocker", "major", "minor"]
    area: str
    message: str
    suggestion: str


class _FlagList(BaseModel):
    flags: list[_LLMFlag]


class Pipeline:
    def __init__(self, llm: LLM, store: Store, page_override: Optional[PageSource] = None):
        self.llm, self.store, self.page_override = llm, store, page_override

    # ---------------------------------------------------------------- helpers
    def _stage(self, job: Job, name: str, status: str, detail: str = ""):
        job.events.append(StageEvent(stage=name, status=status, detail=detail))
        job.updated_at = utcnow()
        self.store.save_job(job)

    def _context(self, job: Job, spec: FormatSpec, *, include_brief=True) -> str:
        i, plat = job.inputs, playbook.platform(job.inputs.platform)
        facts = job.dossier.verified_facts() if job.dossier else []
        parts = [
            "PLATFORM: " + json.dumps({**plat, "duration_sec": i.duration_sec,
                                       "aspect": i.aspect_ratio or plat["aspect"],
                                       "language": i.language,
                                       "words_per_second": playbook.wps(i.language)}),
            f"PRODUCT: {job.dossier.name if job.dossier else ''} by {job.dossier.brand if job.dossier else ''}",
            "VERIFIED PRODUCT FACTS (the only product information you may use):\n" +
            ("\n".join(f"- {f.id} [{f.category}] {f.statement}" for f in facts) or "- none"),
            "PACKAGING: " + ((job.dossier.packaging_description if job.dossier else "") or
                             "UNKNOWN - write [USE ACTUAL PACK] for pack shots"),
        ]
        if include_brief and job.brief:
            parts.append("CREATIVE BRIEF: " + job.brief.model_dump_json())
        if i.hook_type:
            parts.append(f"HOOK TYPE: {i.hook_type} - {playbook.HOOK_TYPES.get(i.hook_type, '')}")
        if i.theme:
            parts.append(f"THEME: {i.theme}")
        if i.creative_direction:
            parts.append(f"CREATIVE DIRECTION: {i.creative_direction}")
        if spec.editorial_notes:
            parts.append("HOUSE EDITORIAL NOTES:\n" + "\n".join(f"- {n}" for n in spec.editorial_notes))
        blockers = [f for f in job.flags if f.severity in ("blocker", "major")]
        if blockers:
            parts.append("OPEN FLAGS (do not resolve these by inventing details; write around them):\n" +
                         "\n".join(f"- {f.message}" for f in blockers))
        return "\n\n".join(parts)

    # ---------------------------------------------------------------- run
    def run(self, job: Job) -> Job:
        """Full pipeline from the product link."""
        def steps(spec):
            # a retry starts clean so flags and history don't pile up
            job.flags, job.dossier, job.brief, job.concepts = [], None, None, []
            job.concept_decision, job.beats, job.script, job.qc_history = None, None, None, []
            self._ingest(job)
            self._brief(job, spec)
            self._reconcile(job, spec)
            concept = self._concepts(job, spec)
            self._beats(job, spec, concept)
            self._write(job, spec, concept)
            self._qc_loop(job, spec)
        return self._execute(job, steps, "Full generation")

    def rerun_with_concept(self, job: Job, index: int, by: str = "") -> Job:
        """Rewrite from the beat sheet using a different explored concept."""
        if not (0 <= index < len(job.concepts)) or not job.dossier or not job.brief:
            raise ValueError("That concept doesn't exist for this job.")

        def steps(spec):
            concept = job.concepts[index]
            if job.concept_decision:
                job.concept_decision.chosen_index = index
            job.revisions.append(Revision(by=by, kind="concept", detail=concept.title))
            self._beats(job, spec, concept)
            self._write(job, spec, concept)
            self._qc_loop(job, spec)
        return self._execute(job, steps, f"Switch to concept {index + 1}")

    def revise_with_feedback(self, job: Job, feedback: str, by: str = "") -> Job:
        """Apply an editor's or client's notes, then re-run QC."""
        if not job.script:
            raise ValueError("There is no script to revise yet.")

        def steps(spec):
            job.revisions.append(Revision(by=by, kind="feedback", detail=feedback))
            self._stage(job, "revise", "started", "editor feedback")
            job.script = self.llm.structured(
                stage="revise", system=prompts.REVISE_SYSTEM, schema=Script,
                user=self._context(job, spec) + f"\n\nCURRENT SCRIPT:\n{job.script.model_dump_json()}"
                f"\n\nEDITOR / CLIENT FEEDBACK TO APPLY (highest priority, unless it asks for an unverified "
                f"product claim - in that case keep the claim out and say so in production_notes):\n{feedback}")
            self._stage(job, "revise", "done")
            self._qc_loop(job, spec)
        return self._execute(job, steps, "Revise with feedback")

    def _execute(self, job: Job, steps, label: str) -> Job:
        spec = self.store.get_format(job.inputs.format_id)
        job.format_version = f"{spec.name} v{spec.version}"
        job.status, job.error = JobStatus.running, ""
        self._stage(job, "run", "started", label)
        try:
            steps(spec)
            blockers = any(f.severity == "blocker" for f in job.flags)
            job.status = JobStatus.ready if job.qc_history[-1].passed and not blockers else JobStatus.needs_review
            self._stage(job, "run", "done", label)
        except Exception as e:
            log.exception("job %s failed", job.id)
            job.status, job.error = JobStatus.failed, _friendly(e)
            self._stage(job, "run", "failed", job.error)
        self.store.save_job(job)
        return job

    def _ingest(self, job: Job):
        self._stage(job, "product_analysis", "started")
        job.dossier, flags = analyse_product(job.inputs.product_url, self.llm, page=self.page_override,
                                             product_copy=job.inputs.product_copy,
                                             extra_images=job.inputs.product_image_urls)
        job.flags += flags
        self._stage(job, "product_analysis", "done",
                    f"{len(job.dossier.verified_facts())} verified facts, {len(job.dossier.facts)} extracted")
        if not job.dossier.verified_facts():
            raise RuntimeError("No verifiable product information; cannot write an accurate script. "
                               "Check the product link or provide product copy.")

    def _brief(self, job: Job, spec: FormatSpec):
        self._stage(job, "brief", "started")
        refs, flags = describe_references(job.inputs.references)
        job.flags += flags
        i = job.inputs
        user = (f"CLIENT BRIEF:\n{i.client_brief}\n\nUSER INPUTS:\n" +
                json.dumps({"target_audience": i.target_audience, "tone": i.tone, "theme": i.theme,
                            "hook_type": i.hook_type, "creative_direction": i.creative_direction,
                            "mandatories": i.mandatories, "exclusions": i.exclusions,
                            "platform": i.platform, "duration_sec": i.duration_sec}) +
                f"\n\nREFERENCES:\n{refs or 'none'}")
        job.brief = self.llm.structured(stage="parse_brief", system=prompts.BRIEF_SYSTEM, user=user,
                                        schema=CreativeBrief)
        for a in job.brief.assumptions:
            job.flags.append(Flag(severity="minor", area="assumption", message=f"Assumed: {a}",
                                  suggestion="Confirm or correct in the brief."))
        self._stage(job, "brief", "done")

    def _reconcile(self, job: Job, spec: FormatSpec):
        self._stage(job, "reconcile", "started")
        user = (self._context(job, spec, include_brief=False) +
                f"\n\nCLIENT BRIEF:\n{job.inputs.client_brief}\n\nPARSED BRIEF:\n{job.brief.model_dump_json()}" +
                "\n\nUNVERIFIED / WITHHELD DETAILS:\n" +
                "\n".join(f"- {f.statement}" for f in job.dossier.facts if not f.verified))
        res = self.llm.structured(stage="reconcile", system=prompts.RECONCILE_SYSTEM, user=user, schema=_FlagList)
        job.flags += [Flag(**f.model_dump()) for f in res.flags]
        self._stage(job, "reconcile", "done", f"{len(res.flags)} flag(s)")

    def _concepts(self, job: Job, spec: FormatSpec):
        self._stage(job, "concepts", "started")
        n = job.inputs.concept_count
        cs = self.llm.structured(stage="concepts", system=prompts.CONCEPTS_SYSTEM.format(n=n),
                                 user=self._context(job, spec), schema=ConceptSet)
        job.concepts = cs.concepts[:n]
        if len(job.concepts) > 1:
            listing = "\n\n".join(f"[{k}] {c.model_dump_json()}" for k, c in enumerate(job.concepts))
            job.concept_decision = self.llm.structured(
                stage="choose_concept", system=prompts.CHOOSE_SYSTEM,
                user=self._context(job, spec) + f"\n\nCONCEPTS:\n{listing}", schema=ConceptDecision)
            idx = min(max(job.concept_decision.chosen_index, 0), len(job.concepts) - 1)
        else:
            idx = 0
        self._stage(job, "concepts", "done", f"chose: {job.concepts[idx].title}")
        return job.concepts[idx]

    def _beats(self, job: Job, spec: FormatSpec, concept):
        self._stage(job, "beats", "started")
        plat = playbook.platform(job.inputs.platform)
        system = prompts.BEATS_SYSTEM.format(duration=job.inputs.duration_sec, platform=plat["label"],
                                             hook_window=plat["hook_window_sec"])
        notes = job.concept_decision.director_notes if job.concept_decision else ""
        job.beats = self.llm.structured(stage="beats", system=system, schema=BeatSheet,
                                        user=self._context(job, spec) +
                                        f"\n\nCHOSEN CONCEPT:\n{concept.model_dump_json()}\n\nDIRECTOR NOTES: {notes}")
        self._stage(job, "beats", "done", f"{len(job.beats.beats)} beats")

    def _write(self, job: Job, spec: FormatSpec, concept):
        self._stage(job, "write", "started")
        examples = memory.exemplar_block(memory.exemplars(self.store, job.inputs))
        notes = job.concept_decision.director_notes if job.concept_decision else ""
        user = (self._context(job, spec) + f"\n\nCHOSEN CONCEPT:\n{concept.model_dump_json()}"
                f"\n\nDIRECTOR NOTES: {notes}\n\nBEAT SHEET:\n{job.beats.model_dump_json()}"
                f"\n\nMANDATORIES (verbatim): {json.dumps(job.inputs.mandatories + job.brief.mandatories)}"
                f"\nEXCLUSIONS: {json.dumps(job.inputs.exclusions + job.brief.exclusions)}"
                + (f"\n\n{examples}" if examples else ""))
        job.script = self.llm.structured(stage="write", system=prompts.WRITE_SYSTEM, user=user, schema=Script)
        self._stage(job, "write", "done", f"{len(job.script.scenes)} scenes")

    # ---------------------------------------------------------------- QC
    def review(self, job: Job, spec: FormatSpec, iteration: int) -> QCReport:
        checks = run_checks(job.script, job.inputs, job.dossier, job.brief, spec)
        critic = self.llm.structured(
            stage="critic", system=prompts.CRITIC_SYSTEM, schema=CriticReport,
            user=self._context(job, spec) + f"\n\nSCRIPT:\n{job.script.model_dump_json()}")
        findings = checks + [QCFinding(check=f.check, severity=f.severity, scene=f.scene, message=f.message,
                                       fix=f.fix) for f in critic.findings]
        scores = critic.scores.model_dump()
        low = [k for k, v in scores.items() if v < spec.rules.min_critic_score]
        # Gate: no blockers from anyone, no major from the exact checks, every critic score at the bar.
        # Critic "majors" alone don't fail a script the critic itself scores at the bar.
        passed = (not any(f.severity == "blocker" for f in findings) and not low
                  and not any(f.severity == "major" for f in checks))
        summary = critic.verdict + (f" Below bar: {', '.join(low)}." if low else "")
        return QCReport(iteration=iteration, findings=findings, scores=scores, passed=passed, summary=summary)

    def _qc_loop(self, job: Job, spec: FormatSpec):
        best: tuple[float, Script, QCReport] | None = None
        for it in range(1, spec.rules.max_revisions + 2):
            self._stage(job, "qc", "started", f"round {it}")
            report = self.review(job, spec, it)
            job.qc_history.append(report)
            badness = sum(SEV_WEIGHT[f.severity] for f in report.findings) - 5 * sum(report.scores.values())
            if best is None or badness < best[0]:
                best = (badness, job.script, report)
            self._stage(job, "qc", "done", f"round {it}: {'pass' if report.passed else 'revise'}")
            if report.passed or it > spec.rules.max_revisions:
                break
            self._stage(job, "revise", "started", f"round {it}")
            fixes = "\n".join(f"- [{f.severity}] {'scene ' + str(f.scene) + ': ' if f.scene else ''}"
                              f"{f.message} FIX: {f.fix}" for f in report.findings if f.severity != "info")
            job.script = self.llm.structured(
                stage="revise", system=prompts.REVISE_SYSTEM, schema=Script,
                user=self._context(job, spec) + f"\n\nCURRENT SCRIPT:\n{job.script.model_dump_json()}"
                f"\n\nFINDINGS TO FIX:\n{fixes}")
            self._stage(job, "revise", "done")
        # a revision can regress; ship the best version we saw
        _, job.script, final = best
        if job.qc_history[-1] is not final:
            job.qc_history.append(final.model_copy(update={"summary": final.summary + " (best version kept)"}))


def _friendly(e: Exception) -> str:
    msg = str(e) or e.__class__.__name__
    low = msg.lower()
    if "api key" in low or "401" in low or "authentication" in low:
        return "The AI service rejected our credentials. An admin needs to check OPENAI_API_KEY."
    if "429" in low or "rate limit" in low or "quota" in low:
        return "The AI service is rate-limiting us or the account is out of credit. Try again in a few minutes."
    if "model" in low and ("not found" in low or "does not exist" in low):
        return f"The configured AI model isn't available on this account ({msg[:160]})."
    return msg[:500]
