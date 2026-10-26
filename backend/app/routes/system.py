from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from .. import playbook
from ..auth import (COOKIE, User, admin_user, current_user, make_session, read_session, verify_google_id_token,
                    verify_task_request)
from ..config import settings
from ..house_format import FormatSpec
from ..store import get_store
from ..worker import TaskBody, execute

router = APIRouter()


@router.get("/api/health")
def health():
    return {"ok": True}


@router.get("/api/admin/status")
def status(user: User = Depends(admin_user)):
    issues = settings.validate()
    return {"ok": not issues, "issues": issues, "llm_provider": settings.llm_provider,
            "models": {"creative": settings.model_creative, "critic": settings.model_critic,
                       "extract": settings.model_extract}, "store": settings.store_backend,
            "queue": bool(settings.tasks_queue), "auth_mode": settings.auth_mode}


@router.get("/api/config")
def public_config(request: Request):
    """What the browser needs before sign-in. Contains no secrets."""
    user = None
    if settings.auth_mode == "none":
        user = {"email": "local@localhost", "name": "Local user", "admin": True}
    else:
        u = read_session(request.cookies.get(COOKIE, ""))
        user = u.model_dump() if u else None
    return {"auth_mode": settings.auth_mode, "google_client_id": settings.google_client_id,
            "demo_mode": settings.llm_provider == "demo", "user": user,
            "daily_job_limit": settings.daily_job_limit, "drive_export": True}


class GoogleLogin(BaseModel):
    credential: str = Field(max_length=8192)


@router.post("/api/auth/google")
def login(body: GoogleLogin, response: Response):
    if settings.auth_mode != "google":
        raise HTTPException(400, "Google sign-in is not enabled.")
    user = verify_google_id_token(body.credential)
    response.set_cookie(COOKIE, make_session(user), max_age=settings.session_days * 86400, httponly=True,
                        secure=settings.production, samesite="lax", path="/")
    return user


@router.post("/api/auth/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@router.get("/api/me")
def me(user: User = Depends(current_user)):
    return user


@router.get("/api/options")
def options(user: User = Depends(current_user)):
    return {"platforms": playbook.PLATFORMS, "hook_types": playbook.HOOK_TYPES,
            "languages": list(playbook.SPEECH_WPS), "formats": [
                {"id": f.id, "name": f.name, "version": f.version} for f in get_store().list_formats()]}


# ---------------------------------------------------------------- house library & format

@router.get("/api/library")
def library(user: User = Depends(current_user)):
    return [{"job_id": a.job_id, "title": a.script.title, "logline": a.script.logline, "platform":
             playbook.platform(a.platform)["label"], "duration_sec": a.duration_sec, "hook_type": a.hook_type,
             "approved_by": a.approved_by, "approved_at": a.approved_at, "editor_notes": a.editor_notes}
            for a in get_store().list_approved()]


@router.delete("/api/library/{job_id}")
def remove_from_library(job_id: str, user: User = Depends(admin_user)):
    get_store().remove_approved(job_id)
    return {"ok": True}


@router.get("/api/formats/{format_id}")
def get_format(format_id: str, user: User = Depends(current_user)):
    try:
        return get_store().get_format(format_id)
    except KeyError:
        raise HTTPException(404, "Format not found.")


@router.put("/api/formats/{format_id}")
def save_format(format_id: str, spec: FormatSpec, user: User = Depends(admin_user)):
    if spec.id != format_id:
        raise HTTPException(400, "Format id mismatch.")
    keys = {s.key for s in spec.sections}
    if not {"scenes", "cta", "product"} <= keys:
        raise HTTPException(422, "The format must keep the Scenes, Product and CTA sections.")
    return get_store().save_format(spec)


# ---------------------------------------------------------------- Cloud Tasks callback

@router.post("/tasks/run", include_in_schema=False)
def task_run(body: TaskBody, _: None = Depends(verify_task_request)):
    execute(body)
    return {"ok": True}
