"""API-level tests: auth, CSRF, validation, SSRF, ownership, quotas and the full job lifecycle."""
import pytest
from fastapi.testclient import TestClient

from app import auth, store as store_mod, worker
from app.auth import User, make_session
from app.config import settings
from app.ingest import product
from app.llm import FakeLLM
from app.main import app
from app.pipeline import Pipeline
from app.routes import jobs as jobs_routes
from tests.fixtures import PRODUCT_HTML, handlers

H = {"X-Requested-With": "scriptwright"}
BODY = {"product_url": "https://brewly.in/products/morning-brew",
        "client_brief": "Launch film for young professionals who skip coffee on busy mornings.",
        "platform": "instagram_reels", "duration_sec": 15, "mandatories": ["Shop now on brewly.in"]}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(store_mod, "_store", store_mod.LocalStore(tmp_path))
    monkeypatch.setattr(settings, "auth_mode", "none")
    monkeypatch.setattr(settings, "daily_job_limit", 15)
    monkeypatch.setattr(jobs_routes, "check_url", lambda u: u)
    monkeypatch.setattr(product, "fetch", lambda url, client=None: product.parse_html(url, PRODUCT_HTML))

    def run_now(task):  # execute synchronously with the fake model instead of a background worker
        monkeypatch.setattr(worker, "get_llm", lambda: FakeLLM(handlers()))
        worker.execute(task)
    monkeypatch.setattr(jobs_routes, "dispatch", run_now)
    return TestClient(app)


def test_post_without_csrf_header_is_rejected(client):
    assert client.post("/api/jobs", json=BODY).status_code == 403


def test_validation_errors_are_readable(client):
    r = client.post("/api/jobs", json={**BODY, "client_brief": "short", "duration_sec": 999}, headers=H)
    assert r.status_code == 422
    assert "client_brief" in r.json()["detail"] and "duration_sec" in r.json()["detail"]


def test_private_urls_are_rejected(client, monkeypatch):
    from app.netsafe import check_url
    monkeypatch.setattr(jobs_routes, "check_url", check_url)
    for url in ["http://127.0.0.1:8080/", "http://169.254.169.254/computeMetadata/v1/", "http://localhost/x",
                "http://metadata.google.internal/"]:
        r = client.post("/api/jobs", json={**BODY, "product_url": url}, headers=H)
        assert r.status_code == 422, url


def test_full_lifecycle(client):
    r = client.post("/api/jobs", json=BODY, headers=H)
    assert r.status_code == 200, r.text
    jid = r.json()["id"]
    job = client.get(f"/api/jobs/{jid}").json()
    assert job["status"] == "ready" and job["script"]["title"]
    assert "source_excerpt" not in job["dossier"]

    html = client.get(f"/api/jobs/{jid}/preview").text
    assert "Scene-by-Scene Script" in html
    assert client.get(f"/api/jobs/{jid}/download").headers["content-disposition"].startswith("attachment")

    assert client.post(f"/api/jobs/{jid}/revise", json={"feedback": "Make the hook punchier."}, headers=H).status_code == 200
    job = client.get(f"/api/jobs/{jid}").json()
    assert job["status"] == "ready" and job["revisions"][0]["kind"] == "feedback"

    assert client.post(f"/api/jobs/{jid}/concept", json={"index": 2}, headers=H).status_code == 200
    assert client.get(f"/api/jobs/{jid}").json()["concept_decision"]["chosen_index"] == 2

    assert client.post(f"/api/jobs/{jid}/approve", json={"notes": "Specific hook"}, headers=H).json()["status"] == "approved"
    assert client.get("/api/library").json()[0]["editor_notes"] == "Specific hook"

    assert client.delete(f"/api/jobs/{jid}", headers=H).status_code == 200
    assert client.get(f"/api/jobs/{jid}").status_code == 404


def test_google_auth_mode_requires_session_and_scopes_jobs(client, monkeypatch):
    monkeypatch.setattr(settings, "auth_mode", "google")
    monkeypatch.setattr(settings, "admin_emails", [])
    assert client.get("/api/jobs").status_code == 401

    alice = make_session(User(email="alice@agency.com"))
    bob = make_session(User(email="bob@agency.com"))
    client.cookies.set(auth.COOKIE, alice)
    jid = client.post("/api/jobs", json=BODY, headers=H).json()["id"]
    assert client.get(f"/api/jobs/{jid}").status_code == 200

    client.cookies.set(auth.COOKIE, bob)
    assert client.get(f"/api/jobs/{jid}").status_code == 404      # can't see someone else's script
    assert client.get("/api/jobs").json() == []
    assert client.put("/api/formats/house-v1", json={}, headers=H).status_code in (403, 422)

    client.cookies.set(auth.COOKIE, alice[:-2] + "00")             # tampered cookie
    assert client.get("/api/jobs").status_code == 401


def test_domain_allowlist(monkeypatch):
    monkeypatch.setattr(settings, "auth_mode", "google")
    monkeypatch.setattr(settings, "allowed_email_domains", ["agency.com"])
    monkeypatch.setattr(settings, "allowed_emails", ["freelancer@gmail.com"])
    assert auth.is_allowed("a@agency.com") and auth.is_allowed("freelancer@gmail.com")
    assert not auth.is_allowed("someone@gmail.com")


def test_daily_quota(client, monkeypatch):
    monkeypatch.setattr(settings, "auth_mode", "google")
    monkeypatch.setattr(settings, "daily_job_limit", 1)
    client.cookies.set(auth.COOKIE, make_session(User(email="carol@agency.com")))
    assert client.post("/api/jobs", json=BODY, headers=H).status_code == 200
    r = client.post("/api/jobs", json=BODY, headers=H)
    assert r.status_code == 429 and "limit" in r.json()["detail"]


def test_task_endpoint_requires_oidc(client, monkeypatch):
    monkeypatch.setattr(settings, "tasks_queue", "projects/p/locations/l/queues/q")
    monkeypatch.setattr(settings, "public_base_url", "https://example.run.app")
    r = client.post("/tasks/run", json={"job_id": "x"})
    assert r.status_code == 401
    r = client.post("/tasks/run", json={"job_id": "x"}, headers={"Authorization": "Bearer forged"})
    assert r.status_code == 401


def test_failed_model_call_marks_job_failed_with_readable_error(tmp_path):
    from app.schemas import Job, JobInputs
    s = store_mod.LocalStore(tmp_path)
    h = handlers()
    h["concepts"] = lambda **_: (_ for _ in ()).throw(RuntimeError("Error code: 429 - rate limit"))
    job = Pipeline(FakeLLM(h), s, page_override=product.parse_html(BODY["product_url"], PRODUCT_HTML)).run(
        Job(id="f1", inputs=JobInputs(**BODY)))
    assert job.status == "failed" and "rate-limiting" in job.error


def test_security_headers_and_spa_fallback(client):
    r = client.get("/api/health")
    assert r.headers["x-content-type-options"] == "nosniff" and "frame-ancestors" in r.headers["content-security-policy"]
    assert client.get("/api/does-not-exist").status_code == 404
