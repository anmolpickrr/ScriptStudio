from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel, Field

from .. import playbook
from ..auth import User, current_user
from ..config import settings
from ..netsafe import UnsafeURL, check_url
from ..render.gdocs import export_to_google_doc
from ..render.docx import render_script_docx
from ..render.html import render_script_html
from ..schemas import Job, JobInputs, JobStatus
from ..store import approve, get_store
from ..worker import TaskBody, dispatch

router = APIRouter(prefix="/api/jobs", tags=["jobs"])
log = logging.getLogger(__name__)
BUSY = (JobStatus.queued, JobStatus.running)


def _get(job_id: str, user: User) -> Job:
    job = get_store().get_job(job_id)
    if not job or (job.owner != user.email and not user.admin):
        raise HTTPException(404, "Script not found.")
    return job


def _check_quota(user: User):
    """Counts every generation and revision against the user's and the app's daily limits."""
    day = datetime.now(timezone.utc).date().isoformat()
    limits = {"global": settings.global_daily_limit}
    if not user.admin:
        limits[f"user:{user.email}"] = settings.daily_job_limit
    over = get_store().consume(day, limits)
    if over == "global":
        raise HTTPException(429, "ScriptStudio has reached today's generation capacity. Please try again tomorrow.")
    if over:
        raise HTTPException(429, f"You've reached today's limit of {settings.daily_job_limit} generations. "
                                 "It resets at midnight UTC.")


def summary(j: Job) -> dict:
    return {"id": j.id, "status": j.status, "created_at": j.created_at, "updated_at": j.updated_at,
            "title": j.script.title if j.script else "", "product_url": j.inputs.product_url,
            "brand": j.dossier.brand if j.dossier else (j.inputs.brand_name or ""),
            "platform": playbook.platform(j.inputs.platform)["label"], "duration_sec": j.inputs.duration_sec,
            "passed": bool(j.qc_history and j.qc_history[-1].passed), "owner": j.owner}


@router.post("")
def create_job(inputs: JobInputs, user: User = Depends(current_user)):
    if inputs.platform not in playbook.PLATFORMS:
        raise HTTPException(422, "Unknown platform.")
    if inputs.hook_type and inputs.hook_type not in playbook.HOOK_TYPES:
        raise HTTPException(422, "Unknown hook type.")
    try:
        check_url(inputs.product_url)
    except UnsafeURL as e:
        raise HTTPException(422, f"Product link: {e}")
    try:
        get_store().get_format(inputs.format_id)
    except KeyError:
        raise HTTPException(422, f"Unknown format '{inputs.format_id}'.")
    _check_quota(user)
    job = Job(id=uuid.uuid4().hex[:12], owner=user.email, inputs=inputs)
    get_store().save_job(job)
    _dispatch(job, TaskBody(job_id=job.id, action="generate", by=user.email))
    return summary(job)


def _dispatch(job: Job, task: TaskBody):
    try:
        dispatch(task)
    except Exception:
        log.exception("could not queue job %s", job.id)
        job.status, job.error = JobStatus.failed, "Couldn't start processing (queue unavailable). Please try again."
        get_store().save_job(job)
        raise HTTPException(503, job.error)


@router.get("")
def list_jobs(user: User = Depends(current_user)):
    return [summary(j) for j in get_store().list_jobs(owner=user.email)]


@router.get("/{job_id}")
def get_job(job_id: str, user: User = Depends(current_user)):
    job = _get(job_id, user)
    data = job.model_dump(mode="json")
    if data.get("dossier"):
        data["dossier"].pop("source_excerpt", None)  # large and only needed server-side
    return data


@router.delete("/{job_id}")
def delete_job(job_id: str, user: User = Depends(current_user)):
    job = _get(job_id, user)
    if job.status in BUSY:
        raise HTTPException(409, "This script is still being generated.")
    get_store().delete_job(job.id)
    return {"ok": True}


def _html(job: Job, include_qc: bool, responsive: bool = False) -> str:
    if not job.script:
        raise HTTPException(409, "The script isn't ready yet.")
    return render_script_html(job, get_store().get_format(job.inputs.format_id), include_qc=include_qc,
                              responsive=responsive)


def _filename(job: Job) -> str:
    return re.sub(r"[^\w-]+", "-", job.script.title if job.script else "script").strip("-")[:60] or "script"


@router.get("/{job_id}/preview", response_class=HTMLResponse)
def preview(job_id: str, qc: bool = False, user: User = Depends(current_user)):
    return HTMLResponse(_html(_get(job_id, user), qc, responsive=True))


@router.get("/{job_id}/download")
def download(job_id: str, user: User = Depends(current_user)):
    job = _get(job_id, user)
    return Response(_html(job, False), media_type="text/html",
                    headers={"Content-Disposition": f'attachment; filename="{_filename(job)}.html"'})


@router.get("/{job_id}/docx")
def download_docx(job_id: str, user: User = Depends(current_user)):
    job = _get(job_id, user)
    if not job.script:
        raise HTTPException(409, "The script isn't ready yet.")
    data = render_script_docx(job, get_store().get_format(job.inputs.format_id))
    return Response(data, media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    headers={"Content-Disposition": f'attachment; filename="{_filename(job)}.docx"'})


class ExportRequest(BaseModel):
    access_token: Optional[str] = Field(None, max_length=4096)  # Google OAuth token (drive.file) from the browser
    include_qc: bool = False


@router.post("/{job_id}/export")
def export(job_id: str, req: ExportRequest, user: User = Depends(current_user)):
    job = _get(job_id, user)
    if settings.auth_mode != "none" and not req.access_token:
        raise HTTPException(400, "Google Drive permission is needed to create the Doc.")
    spec = get_store().get_format(job.inputs.format_id)
    brand = job.dossier.brand if job.dossier else (job.inputs.brand_name or "")
    title = " – ".join(x for x in [brand, job.script.title if job.script else "Script"] if x)
    title += f" ({playbook.platform(job.inputs.platform)['label']}, {job.inputs.duration_sec}s)"
    try:
        job.doc_url = export_to_google_doc(title, _html(job, req.include_qc), spec, user_token=req.access_token)
    except Exception as e:
        raise HTTPException(502, f"Google Docs export failed: {str(e)[:300]}")
    get_store().save_job(job)
    return {"doc_url": job.doc_url}


class ReviseRequest(BaseModel):
    feedback: str = Field(min_length=5, max_length=5000)


@router.post("/{job_id}/revise")
def revise(job_id: str, req: ReviseRequest, user: User = Depends(current_user)):
    return _rerun(job_id, user, TaskBody(job_id=job_id, action="revise", feedback=req.feedback, by=user.email))


class ConceptRequest(BaseModel):
    index: int = Field(ge=0, le=4)


@router.post("/{job_id}/retry")
def retry(job_id: str, user: User = Depends(current_user)):
    job = _get(job_id, user)
    if job.status != JobStatus.failed:
        raise HTTPException(409, "Only failed scripts can be retried.")
    return _rerun(job_id, user, TaskBody(job_id=job_id, action="generate", by=user.email))


@router.post("/{job_id}/concept")
def use_concept(job_id: str, req: ConceptRequest, user: User = Depends(current_user)):
    return _rerun(job_id, user, TaskBody(job_id=job_id, action="concept", concept_index=req.index, by=user.email))


def _rerun(job_id: str, user: User, task: TaskBody):
    job = _get(job_id, user)
    if job.status in BUSY:
        raise HTTPException(409, "This script is already being worked on.")
    if not job.script and task.action == "revise":
        raise HTTPException(409, "There's no script to revise yet.")
    if task.action == "concept" and task.concept_index >= len(job.concepts):
        raise HTTPException(422, "That concept doesn't exist.")
    _check_quota(user)
    previous = job.status
    job.status = JobStatus.queued
    get_store().save_job(job)
    try:
        dispatch(task)
    except Exception:
        log.exception("could not queue %s for job %s", task.action, job.id)
        job.status = previous
        get_store().save_job(job)
        raise HTTPException(503, "Couldn't start processing (queue unavailable). Please try again.")
    return summary(job)


class ApproveRequest(BaseModel):
    notes: str = Field("", max_length=2000)
    category: str = Field("", max_length=100)
    promote_note_to_format: bool = False
    acknowledge_flags: bool = False


@router.post("/{job_id}/approve")
def approve_job(job_id: str, req: ApproveRequest, user: User = Depends(current_user)):
    store = get_store()
    job = _get(job_id, user)
    if not job.script or job.status in BUSY:
        raise HTTPException(409, "There's nothing to approve yet.")
    if any(f.severity == "blocker" for f in job.flags) and not req.acknowledge_flags:
        raise HTTPException(409, "This script has unresolved blocker flags. Resolve them with the client first, "
                                 "or confirm you want to approve anyway.")
    approve(store, job, user.email, req.notes, req.category)
    if req.promote_note_to_format and req.notes and user.admin:
        spec = store.get_format(job.inputs.format_id)
        spec.editorial_notes.append(req.notes)
        store.save_format(spec)
    job.status = JobStatus.approved
    store.save_job(job)
    return summary(job)
