from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from .. import playbook
from ..auth import (COOKIE, User, admin_user, check_passcode, current_user, new_guest, session_user, set_session,
                    verify_google_id_token, verify_task_request)
from ..config import settings
from ..house_format import FormatSpec
from ..store import get_store
from ..worker import TaskBody, execute

router = APIRouter()


@router.get("/api/health")
def health():
    return {"ok": True}


@router.get("/api/health/deep")
def deep_health():
    """Checks the database and AI configuration (not the AI itself). Errors are redacted. Not used by the
    platform health check, so a serverless database can still scale to zero between visits."""
    from ..store import StoreUnavailable, redact
    import os
    out = {"version": os.environ.get("RENDER_GIT_COMMIT", "")[:7],  # set by Render on every deploy
           "store": settings.store_backend, "llm_provider": settings.llm_provider,
           "models": [settings.model_creative, settings.model_critic, settings.model_extract],
           "config_issues": [i for i in settings.validate() if "SESSION_SECRET" not in i]}
    try:
        store = get_store()
        store.list_formats()
        out["db"] = "ok"
    except StoreUnavailable as e:
        out["db"] = f"error: {e}"
        out["db_direct"] = _direct_db_check()
    except Exception as e:
        out["db"] = f"error: {type(e).__name__}: {redact(str(e))}"
        out["db_direct"] = _direct_db_check()
    out["ok"] = out["db"] == "ok" and not out["config_issues"]
    return out


def _direct_db_check() -> str:
    """One plain connection attempt, so the real reason (DNS, TLS, auth…) is visible instead of a pool timeout."""
    if settings.store_backend != "postgres":
        return "n/a"
    from urllib.parse import urlparse
    from ..store import redact
    url = settings.database_url
    p = urlparse(url)
    shape = (f"scheme={p.scheme} host_suffix={(p.hostname or '')[-24:].split('.', 1)[-1] if p.hostname else 'MISSING'} "
             f"db={(p.path or '/')[1:] or 'MISSING'} user={'set' if p.username else 'MISSING'} "
             f"password={'set' if p.password else 'MISSING'} params={sorted(k.split('=')[0] for k in p.query.split('&') if k)}")
    try:
        import psycopg
        with psycopg.connect(url, connect_timeout=10) as c:
            c.execute("select 1")
        return f"ok ({shape})"
    except Exception as e:
        return f"{type(e).__name__}: {redact(str(e))} ({shape})"


@router.get("/api/admin/status")
def status(user: User = Depends(admin_user)):
    issues = settings.validate()
    return {"ok": not issues, "issues": issues, "llm_provider": settings.llm_provider,
            "models": {"creative": settings.model_creative, "critic": settings.model_critic,
                       "extract": settings.model_extract}, "store": settings.store_backend,
            "queue": bool(settings.tasks_queue), "auth_mode": settings.auth_mode}


@router.get("/api/config")
def public_config(request: Request, response: Response):
    """What the browser needs at startup. Contains no secrets. In anonymous mode this also
    hands a first-time visitor their private guest workspace."""
    user = session_user(request)
    if settings.auth_mode == "anonymous" and not user:
        user = new_guest()
        set_session(response, user)
    return {"auth_mode": settings.auth_mode, "google_client_id": settings.google_client_id,
            "demo_mode": settings.llm_provider == "demo", "user": user.model_dump() if user else None,
            "daily_job_limit": settings.daily_job_limit, "admin_unlock": bool(settings.admin_passcode),
            "drive_export": bool(settings.google_client_id) or settings.auth_mode == "none"}


class GoogleLogin(BaseModel):
    credential: str = Field(max_length=8192)


@router.post("/api/auth/google")
def login(body: GoogleLogin, response: Response):
    if settings.auth_mode != "google":
        raise HTTPException(400, "Google sign-in is not enabled.")
    user = verify_google_id_token(body.credential)
    set_session(response, user)
    return user


class AdminUnlock(BaseModel):
    passcode: str = Field(max_length=200)


@router.post("/api/auth/admin")
def unlock_admin(body: AdminUnlock, response: Response, user: User = Depends(current_user)):
    if settings.auth_mode != "anonymous" or not settings.admin_passcode:
        raise HTTPException(400, "Admin passcode is not enabled.")
    if not check_passcode(body.passcode):
        raise HTTPException(403, "That passcode isn't right.")
    user = user.model_copy(update={"elevated": True, "admin": True})
    set_session(response, user)
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


# ---------------------------------------------------------------- brief import

class BriefUpload(BaseModel):
    filename: str = Field(max_length=300)
    data_base64: str = Field(max_length=7_000_000)


@router.post("/api/brief/import")
def import_brief(body: BriefUpload, user: User = Depends(current_user)):
    """Fill the New script form from a brief .docx (e.g. the Creative Brief template from Google Docs)."""
    import base64
    from ..brief_import import BriefImportError, parse_brief_docx
    if not body.filename.lower().endswith(".docx"):
        raise HTTPException(422, "Upload a .docx file. In Google Docs: File → Download → Microsoft Word (.docx).")
    try:
        data = base64.b64decode(body.data_base64, validate=True)
        result = parse_brief_docx(data)
    except BriefImportError as e:
        raise HTTPException(422, str(e))
    except ValueError:
        raise HTTPException(422, "That file couldn't be read.")
    if not result["has_content"]:
        raise HTTPException(422, "This looks like an empty template — fill in the brief first, then upload it.")
    return result


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
