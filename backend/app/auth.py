"""Authentication and access control.

- Users sign in with Google (Google Identity Services). The browser sends the
  Google ID token once; we verify it and set our own signed, HttpOnly session
  cookie. No Google tokens are stored server-side.
- Access can be limited to email domains / addresses; admins can edit the
  house format.
- AUTH_MODE=none gives a single local user (development only).
- Cloud Tasks callbacks are authenticated with Google-signed OIDC tokens.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Optional

from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel

from .config import settings

COOKIE = "sw_session"


class User(BaseModel):
    email: str
    name: str = ""
    picture: str = ""
    admin: bool = False


LOCAL_USER = User(email="local@localhost", name="Local user", admin=True)


# ------------------------------------------------------------------ session cookie

def _sign(payload: bytes) -> str:
    return hmac.new(settings.session_secret.encode(), payload, hashlib.sha256).hexdigest()


def make_session(user: User) -> str:
    body = json.dumps({**user.model_dump(exclude={"admin"}), "exp": int(time.time()) + settings.session_days * 86400})
    raw = base64.urlsafe_b64encode(body.encode())
    return f"{raw.decode()}.{_sign(raw)}"


def read_session(token: str) -> Optional[User]:
    try:
        raw, sig = token.rsplit(".", 1)
        if not hmac.compare_digest(sig, _sign(raw.encode())):
            return None
        data = json.loads(base64.urlsafe_b64decode(raw.encode()))
        if data.get("exp", 0) < time.time():
            return None
        data.pop("exp", None)
        user = User(**data)
        user.admin = is_admin(user.email)
        return user
    except Exception:
        return None


# ------------------------------------------------------------------ policy

def is_allowed(email: str) -> bool:
    email = email.lower()
    if not settings.allowed_emails and not settings.allowed_email_domains:
        return True
    return email in settings.allowed_emails or email.split("@")[-1] in settings.allowed_email_domains \
        or email in settings.admin_emails


def is_admin(email: str) -> bool:
    if settings.auth_mode == "none":
        return True
    return email.lower() in settings.admin_emails


def verify_google_id_token(credential: str) -> User:
    from google.auth.transport import requests as grequests
    from google.oauth2 import id_token
    try:
        info = id_token.verify_oauth2_token(credential, grequests.Request(), settings.google_client_id)
    except Exception:
        raise HTTPException(401, "Google sign-in could not be verified. Please try again.")
    if not info.get("email_verified"):
        raise HTTPException(403, "Your Google account email isn't verified.")
    email = info["email"].lower()
    if not is_allowed(email):
        raise HTTPException(403, f"{email} doesn't have access to this workspace. Ask an admin to add you.")
    return User(email=email, name=info.get("name", ""), picture=info.get("picture", ""), admin=is_admin(email))


# ------------------------------------------------------------------ dependencies

def current_user(request: Request) -> User:
    if settings.auth_mode == "none":
        return LOCAL_USER
    user = read_session(request.cookies.get(COOKIE, ""))
    if not user:
        raise HTTPException(401, "Please sign in.")
    if not is_allowed(user.email):
        raise HTTPException(403, "Your access has been removed.")
    return user


def admin_user(user: User = Depends(current_user)) -> User:
    if not user.admin:
        raise HTTPException(403, "Only admins can do that.")
    return user


def verify_task_request(request: Request) -> None:
    """Cloud Tasks sends a Google-signed OIDC token for our service account."""
    if not settings.tasks_queue:
        raise HTTPException(404, "Not found")
    from google.auth.transport import requests as grequests
    from google.oauth2 import id_token
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(401, "Missing token")
    audience = (settings.worker_url or settings.public_base_url).rstrip("/")
    try:
        info = id_token.verify_oauth2_token(auth[7:], grequests.Request(), audience)
    except Exception:
        raise HTTPException(401, "Invalid token")
    if settings.tasks_service_account and info.get("email") != settings.tasks_service_account:
        raise HTTPException(403, "Unexpected caller")
