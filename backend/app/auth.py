"""Authentication and access control.

Three modes (AUTH_MODE):
- google:    users sign in with Google. The browser sends the Google ID token
             once; we verify it and set our own signed, HttpOnly session cookie.
             Access can be limited to email domains / addresses.
- anonymous: no sign-in. Each browser gets a private guest workspace tied to a
             signed cookie. Admin features unlock with ADMIN_PASSCODE.
- none:      a single local admin user (development only).

Cloud Tasks callbacks are authenticated with Google-signed OIDC tokens.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Optional

from fastapi import Depends, HTTPException, Request, Response
from pydantic import BaseModel

from .config import settings

COOKIE = "sw_session"
TOKEN_HEADER = "X-Session-Token"  # same session, for the GitHub Pages site (a different origin, so no cookies)


class User(BaseModel):
    email: str           # stable owner id; "guest-<id>" for anonymous visitors
    name: str = ""
    picture: str = ""
    admin: bool = False
    guest: bool = False
    elevated: bool = False  # admin unlocked with the passcode (anonymous mode)


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
        if user.guest != (settings.auth_mode == "anonymous"):
            return None  # session from a different auth mode
        user.admin = is_admin(user)
        return user
    except Exception:
        return None


def set_session(response: Response, user: User) -> None:
    token = make_session(user)
    response.set_cookie(COOKIE, token, max_age=settings.session_days * 86400, httponly=True,
                        secure=settings.production, samesite="lax", path="/")
    response.headers[TOKEN_HEADER] = token


def new_guest() -> User:
    return User(email=f"guest-{secrets.token_hex(8)}", name="Guest", guest=True)


# ------------------------------------------------------------------ policy

def is_allowed(email: str) -> bool:
    email = email.lower()
    if not settings.allowed_emails and not settings.allowed_email_domains:
        return True
    return email in settings.allowed_emails or email.split("@")[-1] in settings.allowed_email_domains \
        or email in settings.admin_emails


def is_admin(user: User) -> bool:
    if settings.auth_mode == "none":
        return True
    if settings.auth_mode == "anonymous":
        return user.elevated and bool(settings.admin_passcode)
    return user.email.lower() in settings.admin_emails


def check_passcode(passcode: str) -> bool:
    return bool(settings.admin_passcode) and hmac.compare_digest(passcode.encode(), settings.admin_passcode.encode())


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
    user = User(email=email, name=info.get("name", ""), picture=info.get("picture", ""))
    user.admin = is_admin(user)
    return user


# ------------------------------------------------------------------ dependencies

def session_user(request: Request) -> Optional[User]:
    if settings.auth_mode == "none":
        return LOCAL_USER
    return read_session(request.headers.get(TOKEN_HEADER) or request.cookies.get(COOKIE, ""))


def current_user(request: Request, response: Response) -> User:
    user = session_user(request)
    if settings.auth_mode == "anonymous":
        if not user:  # first visit: hand out a private guest workspace
            user = new_guest()
            set_session(response, user)
        return user
    if not user:
        raise HTTPException(401, "Please sign in.")
    if settings.auth_mode == "google" and not is_allowed(user.email):
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
