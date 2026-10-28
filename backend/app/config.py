"""All runtime configuration comes from environment variables (see .env.example)."""
from __future__ import annotations

import os
import re
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


PROVIDER_PRESETS: dict[str, dict] = {
    "openai": {"creative": "gpt-5", "critic": "gpt-5", "extract": "gpt-5-mini"},
    # Google AI Studio free tier: no card needed. ~10 requests/minute on Flash, so calls are spaced out.
    "gemini": {"base_url": "https://generativelanguage.googleapis.com/v1beta/openai/", "key_env": "GEMINI_API_KEY",
               # Comma-separated = fallback order: if a model is overloaded, retired or too slow, the next is used.
               "creative": "gemini-3.5-flash,gemini-3.8-flash,gemini-3.5-flash-lite,gemini-flash-latest",
               "critic": "gemini-3.5-flash,gemini-3.8-flash,gemini-3.5-flash-lite,gemini-flash-latest",
               "extract": "gemini-flash-lite-latest,gemini-3.5-flash-lite,gemini-3.1-flash-lite",
               "min_interval": 7.0},
    "groq": {"base_url": "https://api.groq.com/openai/v1", "key_env": "GROQ_API_KEY",
             "creative": "llama-3.3-70b-versatile", "critic": "llama-3.3-70b-versatile",
             "extract": "llama-3.1-8b-instant", "min_interval": 2.5},
    "openrouter": {"base_url": "https://openrouter.ai/api/v1", "key_env": "OPENROUTER_API_KEY", "min_interval": 4.0},
    "compat": {"key_env": "LLM_API_KEY"},
}


def clean_database_url(raw: str) -> str:
    """Accept what people actually paste from a provider's dashboard: `psql '…'` snippets, quotes,
    `DATABASE_URL=…` lines, stray whitespace."""
    s = (raw or "").strip()
    s = re.sub(r"^(export\s+)?DATABASE_URL\s*=\s*", "", s)
    s = re.sub(r"^psql\s+", "", s).strip()
    s = s.strip("'\"` ").strip()
    m = re.search(r"postgres(?:ql)?://\S+", s)
    return m.group(0).rstrip("'\"`") if m else s


@dataclass
class Settings:
    env: str = field(default_factory=lambda: _env("APP_ENV", "development"))  # development | production
    # other sites allowed to call the API from the browser (the GitHub Pages copy of the frontend)
    cors_origins: list = field(default_factory=lambda: [o.strip().rstrip("/") for o in
                               _env("CORS_ORIGINS", "https://anmolpickrr.github.io").split(",") if o.strip()])
    # where people open the app (links returned to Claude / ChatGPT point here)
    app_url: str = field(default_factory=lambda: _env("APP_URL", "https://anmolpickrr.github.io/ScriptStudio").rstrip("/"))
    public_base_url: str = field(default_factory=lambda: _env("PUBLIC_BASE_URL"))  # https://scriptwright-xyz.a.run.app

    # ---- AI
    # openai (paid, Responses API) | gemini (free tier) | groq | openrouter | compat (any OpenAI-compatible URL) | demo
    llm_provider: str = field(default_factory=lambda: _env("LLM_PROVIDER", "gemini"))
    openai_api_key: str = field(default_factory=lambda: _env("OPENAI_API_KEY"))
    llm_api_key: str = field(default_factory=lambda: _env("LLM_API_KEY"))    # for gemini/groq/openrouter/compat
    llm_base_url: str = field(default_factory=lambda: _env("LLM_BASE_URL"))
    model_creative: str = field(default_factory=lambda: _env("MODEL_CREATIVE"))
    model_critic: str = field(default_factory=lambda: _env("MODEL_CRITIC"))
    model_extract: str = field(default_factory=lambda: _env("MODEL_EXTRACT"))
    reasoning_effort: str = field(default_factory=lambda: _env("REASONING_EFFORT", "medium"))
    llm_timeout_sec: int = field(default_factory=lambda: _int("LLM_TIMEOUT_SEC", 300))
    # Free tiers limit requests per minute; calls are spaced at least this far apart.
    llm_min_interval_sec: float = field(default_factory=lambda: float(_env("LLM_MIN_INTERVAL_SEC", "-1")))

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
    store_backend: str = field(default_factory=lambda: _env("STORE_BACKEND") or "local")  # local | postgres | firestore
    database_url: str = field(default_factory=lambda: _env("DATABASE_URL"))  # postgres (e.g. Neon free tier)
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

    def __post_init__(self):
        self.database_url = clean_database_url(self.database_url)
        preset = PROVIDER_PRESETS.get(self.llm_provider, {})
        self.llm_base_url = self.llm_base_url or preset.get("base_url", "")
        self.llm_api_key = self.llm_api_key or _env(preset.get("key_env", "")) if preset.get("key_env") else self.llm_api_key
        self.model_creative = self.model_creative or preset.get("creative", "")
        self.model_critic = self.model_critic or preset.get("critic", "")
        self.model_extract = self.model_extract or preset.get("extract", "")
        if self.llm_min_interval_sec < 0:
            self.llm_min_interval_sec = preset.get("min_interval", 0.0)
        if self.database_url and self.store_backend == "local" and not _env("STORE_BACKEND"):
            self.store_backend = "postgres"

    @property
    def production(self) -> bool:
        return self.env == "production"

    def validate(self) -> list[str]:
        """Problems that would make the deployed app misbehave. Logged at startup and shown on /api/health."""
        issues = []
        if self.llm_provider == "openai" and not self.openai_api_key:
            issues.append("OPENAI_API_KEY is not set")
        if self.llm_provider in ("gemini", "groq", "openrouter", "compat") and not self.llm_api_key:
            key = PROVIDER_PRESETS.get(self.llm_provider, {}).get("key_env", "LLM_API_KEY")
            issues.append(f"{key} is not set")
        if self.llm_provider not in (*PROVIDER_PRESETS, "demo"):
            issues.append(f"Unknown LLM_PROVIDER '{self.llm_provider}'")
        if not all((self.model_creative, self.model_critic, self.model_extract)) and self.llm_provider != "demo":
            issues.append("MODEL_CREATIVE / MODEL_CRITIC / MODEL_EXTRACT must be set for this provider")
        if self.store_backend == "postgres" and not self.database_url:
            issues.append("STORE_BACKEND=postgres but DATABASE_URL is not set")
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
