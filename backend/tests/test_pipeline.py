import json

import httpx

from app.house_format import DEFAULT_FORMAT
from app.ingest.product import parse_html
from app.llm import FakeLLM
from app.pipeline import Pipeline
from app.render.gdocs import export_to_google_doc
from app.render.html import render_script_html
from app.schemas import CriticFinding, Job, JobInputs, JobStatus
from app.store import LocalStore, approve
from tests.fixtures import PRODUCT_HTML, critic, good_script, handlers

INPUTS = JobInputs(product_url="https://brewly.in/products/morning-brew", client_brief="Launch film for young professionals who need quick coffee",
                   platform="instagram_reels", duration_sec=15, mandatories=["Shop now on brewly.in"])


def run(tmp_path, **kw):
    store = LocalStore(tmp_path)
    llm = FakeLLM(handlers(**kw))
    page = parse_html(INPUTS.product_url, PRODUCT_HTML)
    job = Job(id="j1", inputs=INPUTS)
    return Pipeline(llm, store, page_override=page).run(job), llm, store


def test_happy_path_passes_first_round(tmp_path):
    job, llm, store = run(tmp_path)
    assert job.status == JobStatus.ready, (job.error, job.qc_history[-1].findings if job.qc_history else None)
    assert any(e.stage == "concepts" and "Standup 1" in e.detail for e in job.events)  # CD's pick is used
    assert llm.calls.count("critic") == 1 and "revise" not in llm.calls
    assert store.get_job("j1").status == JobStatus.ready


def test_failing_script_is_revised(tmp_path):
    def bad():
        s = good_script()
        s.scenes[2].vo = "Makes 40 cups. Game changer."
        return s
    scores = iter([2, 5, 5, 5])
    job, llm, _ = run(tmp_path, script_fn=bad, critic_fn=lambda **_: critic(next(scores)))
    assert "revise" in llm.calls
    assert job.qc_history[0].passed is False and job.qc_history[-1].passed is True
    assert "40" not in job.script.scenes[2].vo


def test_stuck_script_goes_to_needs_review_and_keeps_best(tmp_path):
    finding = CriticFinding(check="hook", severity="major", scene=1, message="Hook is generic", fix="Be specific")
    job, llm, _ = run(tmp_path, critic_fn=lambda **_: critic(3, [finding]))
    assert job.status == JobStatus.needs_review
    assert llm.calls.count("critic") == DEFAULT_FORMAT.rules.max_revisions + 1


def test_render_follows_format_order_and_shows_flags(tmp_path):
    job, _, _ = run(tmp_path)
    html = render_script_html(job, DEFAULT_FORMAT)
    labels = [s.label for s in DEFAULT_FORMAT.sections if s.key not in ("open_questions",)]
    pos = [html.find(l.replace("&", "&amp;")) for l in labels]
    assert all(p > 0 for p in pos) and pos == sorted(pos)
    assert "Open Questions" in html and "withheld" in html
    assert "Riya".upper() in html and "0:06–0:12" in html


def test_approval_feeds_style_memory(tmp_path):
    from app import memory
    job, _, store = run(tmp_path)
    approve(store, job, notes="Love the specific clock hook")
    block = memory.exemplar_block(memory.exemplars(store, INPUTS))
    assert "Love the specific clock hook" in block and "9:58" in block


def test_google_doc_export_converts_html(tmp_path):
    job, _, _ = run(tmp_path)
    seen = []

    def handler(req: httpx.Request):
        seen.append(req)
        if "upload" in str(req.url):
            body = req.content.decode()
            assert '"mimeType": "application/vnd.google-apps.document"' in body and "<table" in body
            return httpx.Response(200, json={"id": "doc123", "webViewLink": "https://docs.google.com/document/d/doc123/edit"})
        assert json.loads(req.content)["requests"][0]["updateDocumentStyle"]["documentStyle"]["pageSize"]["width"]["magnitude"] == 842
        return httpx.Response(200, json={})

    url = export_to_google_doc("t", render_script_html(job, DEFAULT_FORMAT), DEFAULT_FORMAT, user_token="tok",
                               client=httpx.Client(transport=httpx.MockTransport(handler)))
    assert url.endswith("doc123/edit") and len(seen) == 2
    assert seen[0].headers["Authorization"] == "Bearer tok"
