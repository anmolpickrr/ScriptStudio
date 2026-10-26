"""ASGI entrypoint: API + the built frontend, served from one origin."""
from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse

from .config import settings
from .routes import jobs, system

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("scriptwright")

app = FastAPI(title="Scriptwright", version="1.0.0",
              docs_url=None if settings.production else "/api/docs", redoc_url=None)

for issue in settings.validate():
    log.warning("CONFIG: %s", issue)

CSP = ("default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client https://apis.google.com; "
       "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style; img-src 'self' data: https:; "
       "frame-src 'self' https://accounts.google.com https://content.googleapis.com; "
       "connect-src 'self' https://accounts.google.com https://oauth2.googleapis.com; "
       "frame-ancestors 'self'; base-uri 'self'; form-action 'self'")


@app.middleware("http")
async def guard(request: Request, call_next):
    # CSRF: state-changing API calls must carry a custom header, which browsers
    # only send cross-origin after a CORS preflight that we never approve.
    if request.url.path.startswith("/api/") and request.method in ("POST", "PUT", "PATCH", "DELETE"):
        if request.headers.get("x-requested-with") != "scriptwright":
            return JSONResponse({"detail": "Missing request header."}, status_code=403)
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Content-Security-Policy", CSP)
    response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin-allow-popups")
    if settings.production:
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000")
    if request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")
    return response


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    msgs = []
    for e in exc.errors():
        field = ".".join(str(x) for x in e["loc"] if x != "body")
        msgs.append(f"{field}: {e['msg']}" if field else e["msg"])
    return JSONResponse({"detail": "; ".join(msgs)[:600]}, status_code=422)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    log.exception("unhandled error on %s", request.url.path)
    return JSONResponse({"detail": "Something went wrong on our side. Please try again."}, status_code=500)


app.include_router(system.router)
app.include_router(jobs.router)

# ---------------------------------------------------------------- frontend (SPA)
STATIC = Path(settings.static_dir)
if not STATIC.is_absolute():
    STATIC = (Path(__file__).resolve().parent.parent / STATIC).resolve()


@app.get("/{path:path}", include_in_schema=False)
def spa(path: str):
    if path.startswith(("api/", "tasks/")):
        raise HTTPException(404, "Not found")
    if not (STATIC / "index.html").exists():
        return JSONResponse({"detail": "Frontend not built. Run `npm run build` in frontend/."}, status_code=503)
    target = (STATIC / path).resolve()
    if path and target.is_file() and STATIC in target.parents:
        cache = "public, max-age=31536000, immutable" if path.startswith("assets/") else "no-cache"
        return FileResponse(target, headers={"Cache-Control": cache})
    return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-cache"})
