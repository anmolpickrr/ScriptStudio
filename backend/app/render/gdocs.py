"""Google Docs export.

The rendered HTML is uploaded through the Drive API with conversion to
`application/vnd.google-apps.document`, which gives a native, editable Doc
with real headings, tables and bullets. A Docs API pass then applies page
setup (landscape, margins) that HTML can't express.
"""
from __future__ import annotations

import json
from typing import Optional

import httpx

from ..config import settings
from ..house_format import FormatSpec

# drive.file only: the app can touch just the files it creates. It is a non-sensitive scope,
# so the OAuth consent screen doesn't need Google verification.
SCOPES = ["https://www.googleapis.com/auth/drive.file"]
UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink"
DOCS_URL = "https://docs.googleapis.com/v1/documents/{id}:batchUpdate"


def _token(user_token: Optional[str]) -> str:
    """Prefer the signed-in user's OAuth token (doc lands in their Drive);
    fall back to the service's own credentials (doc lands in the shared folder)."""
    if user_token:
        return user_token
    import google.auth
    import google.auth.transport.requests
    creds, _ = google.auth.default(scopes=SCOPES)
    creds.refresh(google.auth.transport.requests.Request())
    return creds.token


def page_setup_requests(spec: FormatSpec) -> list[dict]:
    # A4 in points; swap for landscape so the scene table has room.
    w, h = (842, 595) if spec.style.landscape else (595, 842)
    return [{
        "updateDocumentStyle": {
            "documentStyle": {
                "pageSize": {"width": {"magnitude": w, "unit": "PT"}, "height": {"magnitude": h, "unit": "PT"}},
                "marginTop": {"magnitude": 36, "unit": "PT"}, "marginBottom": {"magnitude": 36, "unit": "PT"},
                "marginLeft": {"magnitude": 36, "unit": "PT"}, "marginRight": {"magnitude": 36, "unit": "PT"},
            },
            "fields": "pageSize,marginTop,marginBottom,marginLeft,marginRight",
        }
    }]


def export_to_google_doc(title: str, html: str, spec: FormatSpec, *, user_token: Optional[str] = None,
                         folder_id: Optional[str] = None, client: Optional[httpx.Client] = None) -> str:
    token = _token(user_token)
    meta = {"name": title, "mimeType": "application/vnd.google-apps.document"}
    folder = folder_id or settings.gdrive_folder_id
    if folder:
        meta["parents"] = [folder]
    boundary = "scriptwright-boundary"
    body = (f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{json.dumps(meta)}\r\n"
            f"--{boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n{html}\r\n--{boundary}--").encode()
    headers = {"Authorization": f"Bearer {token}"}
    own = client is None
    client = client or httpx.Client(timeout=60)
    try:
        r = client.post(UPLOAD_URL, content=body,
                        headers={**headers, "Content-Type": f"multipart/related; boundary={boundary}"})
        r.raise_for_status()
        doc = r.json()
        client.post(DOCS_URL.format(id=doc["id"]), json={"requests": page_setup_requests(spec)},
                    headers=headers).raise_for_status()
        return doc.get("webViewLink") or f"https://docs.google.com/document/d/{doc['id']}/edit"
    finally:
        if own:
            client.close()
