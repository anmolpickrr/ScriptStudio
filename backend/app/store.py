"""Persistence: jobs, format specs and the approved-script library.

LocalStore (JSON files) for development; FirestoreStore for Cloud Run.
Both expose the same interface so the pipeline doesn't care which is used.
"""
from __future__ import annotations

import json
import logging
import re
import threading
from pathlib import Path
from typing import Optional, Protocol

from pydantic import BaseModel

from .config import settings

log = logging.getLogger(__name__)
from .house_format import DEFAULT_FORMAT, FormatSpec
from .schemas import Job, Script, utcnow


class ApprovedScript(BaseModel):
    job_id: str
    approved_at: str
    approved_by: str = ""
    platform: str
    duration_sec: int
    hook_type: str
    theme: str
    category: str = ""
    tone: str
    editor_notes: str = ""
    script: Script


class Store(Protocol):
    def save_job(self, job: Job) -> None: ...
    def get_job(self, job_id: str) -> Optional[Job]: ...
    def list_jobs(self, owner: Optional[str] = None, limit: int = 100) -> list[Job]: ...
    def delete_job(self, job_id: str) -> None: ...
    def get_format(self, format_id: str) -> FormatSpec: ...
    def save_format(self, spec: FormatSpec) -> FormatSpec: ...
    def list_formats(self) -> list[FormatSpec]: ...
    def add_approved(self, item: ApprovedScript) -> None: ...
    def remove_approved(self, job_id: str) -> None: ...
    def list_approved(self, platform: Optional[str] = None) -> list[ApprovedScript]: ...
    def consume(self, day: str, limits: dict[str, int]) -> Optional[str]: ...


class LocalStore:
    def __init__(self, root: str | Path):
        self.root = Path(root)
        for d in ("jobs", "formats", "approved", "usage"):
            (self.root / d).mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def _write(self, path: Path, model: BaseModel):
        with self._lock:
            tmp = path.with_suffix(".tmp")
            tmp.write_text(model.model_dump_json(indent=2))
            tmp.replace(path)

    def save_job(self, job):
        self._write(self.root / "jobs" / f"{job.id}.json", job)

    def get_job(self, job_id):
        p = self.root / "jobs" / f"{job_id}.json"
        return Job.model_validate_json(p.read_text()) if p.exists() else None

    def list_jobs(self, owner=None, limit=100):
        jobs = [Job.model_validate_json(p.read_text()) for p in (self.root / "jobs").glob("*.json")]
        jobs = [j for j in jobs if owner is None or j.owner == owner]
        return sorted(jobs, key=lambda j: j.created_at, reverse=True)[:limit]

    def delete_job(self, job_id):
        (self.root / "jobs" / f"{job_id}.json").unlink(missing_ok=True)

    def get_format(self, format_id):
        p = self.root / "formats" / f"{format_id}.json"
        if p.exists():
            return FormatSpec.model_validate_json(p.read_text())
        if format_id == DEFAULT_FORMAT.id:
            return DEFAULT_FORMAT.model_copy(deep=True)
        raise KeyError(f"Unknown format '{format_id}'")

    def save_format(self, spec):
        try:
            current = self.get_format(spec.id)
            spec.version = current.version + 1
            # keep history so an approved script can always be re-rendered in its original format
            self._write(self.root / "formats" / f"{spec.id}@v{current.version}.json", current)
        except KeyError:
            spec.version = 1
        self._write(self.root / "formats" / f"{spec.id}.json", spec)
        return spec

    def list_formats(self):
        specs = {DEFAULT_FORMAT.id: DEFAULT_FORMAT}
        for p in (self.root / "formats").glob("*.json"):
            if "@v" not in p.stem:
                s = FormatSpec.model_validate_json(p.read_text())
                specs[s.id] = s
        return list(specs.values())

    def add_approved(self, item):
        self._write(self.root / "approved" / f"{item.job_id}.json", item)

    def remove_approved(self, job_id):
        (self.root / "approved" / f"{job_id}.json").unlink(missing_ok=True)

    def consume(self, day, limits):
        """Atomically check every counter against its limit (0 = unlimited) and, if all pass, add 1 to each.
        Returns the first key that is over its limit, or None."""
        path = self.root / "usage" / f"{day}.json"
        with self._lock:
            counts = json.loads(path.read_text()) if path.exists() else {}
            for key, limit in limits.items():
                if limit and counts.get(key, 0) >= limit:
                    return key
            for key in limits:
                counts[key] = counts.get(key, 0) + 1
            tmp = path.with_suffix(".tmp")
            tmp.write_text(json.dumps(counts))
            tmp.replace(path)
        return None

    def list_approved(self, platform=None):
        items = [ApprovedScript.model_validate_json(p.read_text())
                 for p in (self.root / "approved").glob("*.json")]
        items = [i for i in items if platform is None or i.platform == platform]
        return sorted(items, key=lambda i: i.approved_at, reverse=True)


FieldFilter = None  # imported lazily with google-cloud-firestore


def _fs_key(key: str) -> str:
    # Firestore field names can't contain dots or slashes; emails have dots.
    return key.replace(".", "_").replace("/", "_")


class FirestoreStore:
    """Same interface backed by Firestore (collections: jobs, formats, approved)."""

    def __init__(self, project: str = ""):
        global FieldFilter
        from google.cloud import firestore
        from google.cloud.firestore_v1.base_query import FieldFilter
        self.db = firestore.Client(project=project or None)

    def save_job(self, job):
        self.db.collection("jobs").document(job.id).set(json.loads(job.model_dump_json()))

    def get_job(self, job_id):
        d = self.db.collection("jobs").document(job_id).get()
        return Job.model_validate(d.to_dict()) if d.exists else None

    def list_jobs(self, owner=None, limit=100):
        # Equality filter only, sorted in memory: works without a composite index.
        q = self.db.collection("jobs")
        if owner is not None:
            q = q.where(filter=FieldFilter("owner", "==", owner))
        jobs = [Job.model_validate(d.to_dict()) for d in q.stream()]
        return sorted(jobs, key=lambda j: j.created_at, reverse=True)[:limit]

    def delete_job(self, job_id):
        self.db.collection("jobs").document(job_id).delete()

    def get_format(self, format_id):
        d = self.db.collection("formats").document(format_id).get()
        if d.exists:
            return FormatSpec.model_validate(d.to_dict())
        if format_id == DEFAULT_FORMAT.id:
            return DEFAULT_FORMAT.model_copy(deep=True)
        raise KeyError(f"Unknown format '{format_id}'")

    def save_format(self, spec):
        ref = self.db.collection("formats").document(spec.id)
        cur = ref.get()
        if cur.exists:
            old = FormatSpec.model_validate(cur.to_dict())
            spec.version = old.version + 1
            ref.collection("history").document(f"v{old.version}").set(json.loads(old.model_dump_json()))
        ref.set(json.loads(spec.model_dump_json()))
        return spec

    def list_formats(self):
        specs = {DEFAULT_FORMAT.id: DEFAULT_FORMAT}
        for d in self.db.collection("formats").stream():
            s = FormatSpec.model_validate(d.to_dict())
            specs[s.id] = s
        return list(specs.values())

    def add_approved(self, item):
        self.db.collection("approved").document(item.job_id).set(json.loads(item.model_dump_json()))

    def remove_approved(self, job_id):
        self.db.collection("approved").document(job_id).delete()

    def consume(self, day, limits):
        from google.cloud import firestore
        ref = self.db.collection("usage").document(day)

        @firestore.transactional
        def txn(t):
            snap = ref.get(transaction=t)
            counts = snap.to_dict() or {} if snap.exists else {}
            for key, limit in limits.items():
                if limit and counts.get(_fs_key(key), 0) >= limit:
                    return key
            t.set(ref, {_fs_key(k): counts.get(_fs_key(k), 0) + 1 for k in limits}, merge=True)
            return None
        return txn(self.db.transaction())

    def list_approved(self, platform=None):
        q = self.db.collection("approved")
        if platform:
            q = q.where(filter=FieldFilter("platform", "==", platform))
        items = [ApprovedScript.model_validate(d.to_dict()) for d in q.stream()]
        return sorted(items, key=lambda i: i.approved_at, reverse=True)


class PostgresStore:
    """Same interface on Postgres (e.g. Neon's free tier). One JSONB table keeps it schema-migration free."""

    DDL = """
    CREATE TABLE IF NOT EXISTS sw_docs (
        collection text NOT NULL, id text NOT NULL, owner text NOT NULL DEFAULT '',
        created_at text NOT NULL DEFAULT '', data jsonb NOT NULL,
        PRIMARY KEY (collection, id));
    CREATE INDEX IF NOT EXISTS sw_docs_owner ON sw_docs (collection, owner, created_at DESC);
    """

    def __init__(self, url: str):
        from psycopg_pool import ConnectionPool
        url = self._working_url(url)
        # check= revalidates idle connections, which serverless Postgres closes when it scales to zero;
        # prepare_threshold=None keeps it compatible with PgBouncer-style poolers (e.g. Neon's "-pooler" hosts)
        self.pool = ConnectionPool(url, min_size=1, max_size=5,
                                   kwargs={"autocommit": True, "connect_timeout": 10, "prepare_threshold": None},
                                   check=ConnectionPool.check_connection, open=True, timeout=20)
        with self.pool.connection() as c:
            c.execute(self.DDL)

    @staticmethod
    def _working_url(url: str) -> str:
        """Connect once up front so a bad URL fails fast with its real error, and fall back to dropping
        options some poolers or client libraries reject (channel_binding)."""
        import psycopg
        try:
            psycopg.connect(url, connect_timeout=10).close()
            return url
        except psycopg.OperationalError as e:
            relaxed = re.sub(r"[?&]channel_binding=[^&]*", "", url).replace("?&", "?").rstrip("?")
            if relaxed != url:
                try:
                    psycopg.connect(relaxed, connect_timeout=10).close()
                    log.warning("database connected after dropping channel_binding (%s)", redact(str(e)))
                    return relaxed
                except psycopg.OperationalError:
                    pass
            raise

    def _put(self, collection: str, id_: str, model: BaseModel, owner: str = "", created_at: str = ""):
        from psycopg.types.json import Jsonb
        with self.pool.connection() as c:
            c.execute("INSERT INTO sw_docs (collection, id, owner, created_at, data) VALUES (%s, %s, %s, %s, %s) "
                      "ON CONFLICT (collection, id) DO UPDATE SET owner = EXCLUDED.owner, data = EXCLUDED.data",
                      (collection, id_, owner, created_at, Jsonb(json.loads(model.model_dump_json()))))

    def _get(self, collection: str, id_: str):
        with self.pool.connection() as c:
            row = c.execute("SELECT data FROM sw_docs WHERE collection = %s AND id = %s", (collection, id_)).fetchone()
        return row[0] if row else None

    def _list(self, collection: str, owner: Optional[str] = None, limit: int = 1000) -> list[dict]:
        q = "SELECT data FROM sw_docs WHERE collection = %s"
        args: list = [collection]
        if owner is not None:
            q += " AND owner = %s"
            args.append(owner)
        q += " ORDER BY created_at DESC LIMIT %s"
        args.append(limit)
        with self.pool.connection() as c:
            return [r[0] for r in c.execute(q, args).fetchall()]

    def _delete(self, collection: str, id_: str):
        with self.pool.connection() as c:
            c.execute("DELETE FROM sw_docs WHERE collection = %s AND id = %s", (collection, id_))

    def save_job(self, job):
        self._put("jobs", job.id, job, job.owner, job.created_at)

    def get_job(self, job_id):
        d = self._get("jobs", job_id)
        return Job.model_validate(d) if d else None

    def list_jobs(self, owner=None, limit=100):
        return [Job.model_validate(d) for d in self._list("jobs", owner, limit)]

    def delete_job(self, job_id):
        self._delete("jobs", job_id)

    def get_format(self, format_id):
        d = self._get("formats", format_id)
        if d:
            return FormatSpec.model_validate(d)
        if format_id == DEFAULT_FORMAT.id:
            return DEFAULT_FORMAT.model_copy(deep=True)
        raise KeyError(f"Unknown format '{format_id}'")

    def save_format(self, spec):
        try:
            current = self.get_format(spec.id)
            spec.version = current.version + 1
            self._put("format_history", f"{spec.id}@v{current.version}", current)
        except KeyError:
            spec.version = 1
        self._put("formats", spec.id, spec)
        return spec

    def list_formats(self):
        specs = {DEFAULT_FORMAT.id: DEFAULT_FORMAT}
        for d in self._list("formats"):
            s = FormatSpec.model_validate(d)
            specs[s.id] = s
        return list(specs.values())

    def add_approved(self, item):
        self._put("approved", item.job_id, item, item.platform, item.approved_at)

    def remove_approved(self, job_id):
        self._delete("approved", job_id)

    def list_approved(self, platform=None):
        return [ApprovedScript.model_validate(d) for d in self._list("approved", platform)]

    def consume(self, day, limits):
        from psycopg.types.json import Jsonb
        with self.pool.connection() as c, c.transaction():
            c.execute("INSERT INTO sw_docs (collection, id, data) VALUES ('usage', %s, '{}'::jsonb) "
                      "ON CONFLICT DO NOTHING", (day,))
            counts = c.execute("SELECT data FROM sw_docs WHERE collection = 'usage' AND id = %s FOR UPDATE",
                               (day,)).fetchone()[0]
            for key, limit in limits.items():
                if limit and counts.get(key, 0) >= limit:
                    return key
            for key in limits:
                counts[key] = counts.get(key, 0) + 1
            c.execute("UPDATE sw_docs SET data = %s WHERE collection = 'usage' AND id = %s", (Jsonb(counts), day))
        return None


class StoreUnavailable(RuntimeError):
    pass


def redact(msg: str) -> str:
    """Error text safe to show publicly: no credentials, hostnames or IPs."""
    msg = re.sub(r"postgres(?:ql)?://\S+", "postgresql://***", msg)
    msg = re.sub(r'"[^"]*\.(?:tech|com|net|io|cloud|app)"', '"<host>"', msg)
    msg = re.sub(r"\b\d{1,3}(?:\.\d{1,3}){3}\b", "<ip>", msg)
    msg = re.sub(r"\([0-9a-f:]{6,}\)", "(<ip>)", msg)
    msg = re.sub(r"(password|user)[^,;\n]*", r"\1 <redacted>", msg, flags=re.I)
    return " ".join(msg.split())[:400]


_store: Optional[Store] = None


def get_store() -> Store:
    global _store
    if _store is None:
        if settings.store_backend == "postgres":
            try:
                _store = PostgresStore(settings.database_url)
            except Exception as e:
                cause = e.__cause__ or e
                raise StoreUnavailable(f"{type(cause).__name__}: {redact(str(cause))}") from e
        elif settings.store_backend == "firestore":
            _store = FirestoreStore(settings.gcp_project)
        else:
            _store = LocalStore(settings.local_store_dir)
    return _store


def approve(store: Store, job: Job, approved_by: str = "", notes: str = "", category: str = "") -> ApprovedScript:
    assert job.script is not None
    item = ApprovedScript(job_id=job.id, approved_at=utcnow(), approved_by=approved_by,
                          platform=job.inputs.platform, duration_sec=job.inputs.duration_sec,
                          hook_type=job.script.hook_type, theme=job.script.theme, category=category,
                          tone=job.script.tone, editor_notes=notes, script=job.script)
    store.add_approved(item)
    return item
