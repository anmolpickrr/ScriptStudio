"""One contract for every storage backend. Postgres runs when TEST_DATABASE_URL is set (CI provides one)."""
import os
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest

from app import store as store_mod
from app.house_format import DEFAULT_FORMAT
from app.ingest.product import parse_html
from app.llm import FakeLLM
from app.pipeline import Pipeline
from app.schemas import Job, JobInputs, JobStatus
from tests.fixtures import PRODUCT_HTML, handlers

PG = os.environ.get("TEST_DATABASE_URL")
BODY = dict(product_url="https://brewly.in/products/morning-brew", platform="instagram_reels", duration_sec=15,
            client_brief="Launch film for young professionals who skip coffee on busy mornings.")


@pytest.fixture(params=["local", "postgres"])
def store(request, tmp_path):
    if request.param == "local":
        return store_mod.LocalStore(tmp_path)
    if not PG:
        pytest.skip("TEST_DATABASE_URL not set")
    s = store_mod.PostgresStore(PG)
    with s.pool.connection() as c:
        c.execute("TRUNCATE sw_docs")
    return s


def test_jobs_roundtrip_owner_filter_and_order(store):
    a = Job(id="a" + uuid.uuid4().hex[:6], owner="x", inputs=JobInputs(**BODY), created_at="2026-01-01T00:00:00")
    b = Job(id="b" + uuid.uuid4().hex[:6], owner="y", inputs=JobInputs(**BODY), created_at="2026-01-02T00:00:00")
    store.save_job(a); store.save_job(b)
    a.status = JobStatus.ready
    store.save_job(a)  # upsert
    assert store.get_job(a.id).status == JobStatus.ready
    assert [j.id for j in store.list_jobs()] == [b.id, a.id]
    assert [j.id for j in store.list_jobs(owner="x")] == [a.id]
    store.delete_job(a.id)
    assert store.get_job(a.id) is None


def test_format_versioning(store):
    spec = store.get_format("house-v1")
    spec.editorial_notes.append("Keep it tight.")
    assert store.save_format(spec).version == 2
    assert store.get_format("house-v1").editorial_notes[-1] == "Keep it tight."
    with pytest.raises(KeyError):
        store.get_format("nope")


def test_usage_counters_are_atomic(store):
    with ThreadPoolExecutor(8) as ex:
        results = list(ex.map(lambda _: store.consume("2026-01-01", {"global": 10, "user:u": 0}), range(25)))
    assert results.count(None) == 10 and results.count("global") == 15


def test_full_pipeline_and_library(store):
    page = parse_html(BODY["product_url"], PRODUCT_HTML)
    job = Pipeline(FakeLLM(handlers()), store, page_override=page).run(Job(id="p1", owner="x", inputs=JobInputs(**BODY)))
    assert job.status == JobStatus.ready
    got = store.get_job("p1")
    assert got.script.title == job.script.title and got.dossier.facts
    store_mod.approve(store, got, notes="good")
    assert store.list_approved()[0].editor_notes == "good"
    store.remove_approved("p1")
    assert store.list_approved() == []
