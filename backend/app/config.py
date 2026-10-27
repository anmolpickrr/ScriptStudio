"""All runtime configuration comes from environment variables (see .env.example)."""
from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, field


def _load_dotenv() -> None:
    """Read backend/.env for local development. Real environment variables always win."""
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
    if not os.path.exists(path):
        return
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        val = val.split(" #")[0].strip().strip('"').strip("'")
        os.environ.setdefault(key.strip(), val)


_load_dotenv()


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _list(name: str) -> list[str]:
    return [x.strip().lower() for x in _env(name).split(",") if x.strip()]


def _int(name: str, default: int) -> int:
    try:
        return int(_env(name, str(default)))
    except ValueError:
        return default


@dataclass
class Settings:
    env: str = field(default_factory=lambda: _env("APP_ENV", "development"))  # development | production
    public_base_url: str = field(default_factory=lambda: _env("PUBLIC_BASE_URL"))  # https://scriptwright-xyz.a.run.app

    # ---- AI
    llm_provider: str = field(default_factory=lambda: _env("LLM_PROVIDER", "openai"))  # openai | demo
    openai_api_key: str = field(default_factory=lambda: _env("OPENAI_API_KEY"))
    model_creative: str = field(default_factory=lambda: _env("MODEL_CREATIVE", "gpt-5"))
    model_critic: str = field(default_factory=lambda: _env("MODEL_CRITIC", "gpt-5"))
    model_extract: str = field(default_factory=lambda: _env("MODEL_EXTRACT", "gpt-5-mini"))
    reasoning_effort: str = field(default_factory=lambda: _env("REASONING_EFFORT", "medium"))
    llm_timeout_sec: int = field(default_factory=lambda: _int("LLM_TIMEOUT_SEC", 300))

    # ---- Auth
    # google = Google sign-in; anonymous = open access, each browser gets its own private workspace;
    # none = single local admin (development only)
    auth_mode: str = field(default_factory=lambda: _env("AUTH_MODE", "none"))
    admin_passcode: str = field(default_factory=lambda: _env("ADMIN_PASSCODE"))  # unlocks admin in anonymous mode
    google_client_id: str = field(default_factory=lambda: _env("GOOGLE_CLIENT_ID"))
    session_secret: str = field(default_factory=lambda: _env("SESSION_SECRET") or secrets.token_hex(32))
    session_days: int = field(default_factory=lambda: _int("SESSION_DAYS", 14))
    allowed_email_domains: list[str] = field(default_factory=lambda: _list("ALLOWED_EMAIL_DOMAINS"))
    allowed_emails: list[str] = field(default_factory=lambda: _list("ALLOWED_EMAILS"))
    admin_emails: list[str] = field(default_factory=lambda: _list("ADMIN_EMAILS"))
    daily_job_limit: int = field(default_factory=lambda: _int("DAILY_JOB_LIMIT", 15))   # per user
    global_daily_limit: int = field(default_factory=lambda: _int("GLOBAL_DAILY_LIMIT", 200))  # whole app
    max_concurrent_jobs: int = field(default_factory=lambda: _int("MAX_CONCURRENT_JOBS", 3))  # in-process runner

    # ---- Storage
    store_backend: str = field(default_factory=lambda: _env("STORE_BACKEND", "local"))  # local | firestore
    local_store_dir: str = field(default_factory=lambda: _env("LOCAL_STORE_DIR", ".data"))
    gcp_project: str = field(default_factory=lambda: _env("GOOGLE_CLOUD_PROJECT"))

    # ---- Background processing (Cloud Tasks). Empty = run in-process (local dev).
    tasks_queue: str = field(default_factory=lambda: _env("CLOUD_TASKS_QUEUE"))  # projects/p/locations/l/queues/q
    tasks_service_account: str = field(default_factory=lambda: _env("TASKS_SERVICE_ACCOUNT"))
    worker_url: str = field(default_factory=lambda: _env("WORKER_URL"))  # defaults to PUBLIC_BASE_URL

    # ---- Google Docs
    gdrive_folder_id: str = field(default_factory=lambda: _env("GDRIVE_FOLDER_ID"))

    # ---- Frontend
    static_dir: str = field(default_factory=lambda: _env("STATIC_DIR", "../frontend/dist"))

    fetch_timeout_sec: float = 20.0
    fetch_max_bytes: int = 5_000_000

    @property
    def production(self) -> bool:
        return self.env == "production"

    def validate(self) -> list[str]:
        """Problems that would make the deployed app misbehave. Logged at startup and shown on /api/health."""
        issues = []
        if self.llm_provider == "openai" and not self.openai_api_key:
            issues.append("OPENAI_API_KEY is not set")
        if self.auth_mode == "google" and not self.google_client_id:
            issues.append("AUTH_MODE=google but GOOGLE_CLIENT_ID is not set")
        if self.production and not _env("SESSION_SECRET"):
            issues.append("SESSION_SECRET is not set; sessions reset on every restart")
        if self.production and self.auth_mode == "none":
            issues.append("AUTH_MODE=none in production: every visitor is an admin")
        if self.auth_mode == "anonymous" and not self.global_daily_limit:
            issues.append("AUTH_MODE=anonymous without GLOBAL_DAILY_LIMIT: no cap on OpenAI spend")
        if self.auth_mode not in ("google", "anonymous", "none"):
            issues.append(f"Unknown AUTH_MODE '{self.auth_mode}'")
        if self.tasks_queue and not (self.worker_url or self.public_base_url):
            issues.append("CLOUD_TASKS_QUEUE is set but neither WORKER_URL nor PUBLIC_BASE_URL is")
        return issues


settings = Settings()
