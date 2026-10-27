"""ChatGPT / Claude copy-paste mode, through the API."""
import json

from tests.fixtures import BRIEF, concept, good_script
from tests.test_api import BODY, H, client  # noqa: F401  (fixture)

FACTS = [
    {"id": "F1", "category": "usage", "statement": "Mix with milk or water", "quote": "Just add milk or water"},
    {"id": "F2", "category": "spec", "statement": "One 250 ml bottle makes 10 cups", "quote": "Makes 10 cups per 250 ml bottle"},
    {"id": "F3", "category": "claim", "statement": "Clinically proven energy", "quote": "clinically proven to boost energy"},
]


def answer(**over):
    data = {"product_name": "Morning Brew", "brand": "Brewly", "facts": FACTS, "packaging_description": "",
            "unknowns": ["Shelf life"], "brief": json.loads(BRIEF.model_dump_json()),
            "concepts": [json.loads(concept(i).model_dump_json()) for i in range(3)], "chosen_index": 1,
            "director_notes": "Cut faster.", "script": json.loads(good_script().model_dump_json())}
    data.update(over)
    return "Here's your script!\n\n```json\n" + json.dumps(data) + "\n```\nLet me know if you want changes."


def start(client, engine="chatgpt"):
    jid = client.post("/api/jobs", json={**BODY, "engine": engine}, headers=H).json()["id"]
    job = client.get(f"/api/jobs/{jid}").json()
    assert job["status"] == "awaiting_input", job
    return jid, job


def test_prompt_contains_everything_the_chat_needs(client):
    jid, job = start(client)
    p = job["relay"]["prompt"]
    for must in ("Just add milk or water", BODY["client_brief"], "Instagram Reels", "VERBATIM", '"script"', "15s"):
        assert must in p, must
    assert "source_text" not in job["relay"]


def test_full_round_trip_verifies_facts_and_checks_quality(client):
    jid, _ = start(client, "claude")
    r = client.post(f"/api/jobs/{jid}/relay", json={"answer": answer()}, headers=H)
    assert r.status_code == 200, r.text
    job = client.get(f"/api/jobs/{jid}").json()
    assert job["status"] == "ready" and job["script"]["title"]
    facts = {f["id"]: f["verified"] for f in job["dossier"]["facts"]}
    assert facts == {"F1": True, "F2": True, "F3": False}  # invented quote is caught
    assert "Claude" in job["qc_history"][-1]["summary"]
    assert client.get(f"/api/jobs/{jid}/docx").status_code == 200


def test_bad_answers_get_helpful_messages(client):
    jid, _ = start(client)
    r = client.post(f"/api/jobs/{jid}/relay", json={"answer": "Sure! Here's a great script about coffee..."}, headers=H)
    assert r.status_code == 422 and "complete JSON" in r.json()["detail"]
    cut = answer()[:3000]
    assert "cut off" in client.post(f"/api/jobs/{jid}/relay", json={"answer": cut}, headers=H).json()["detail"]
    missing = json.loads(answer().split("```json\n")[1].split("\n```")[0]); del missing["script"]
    d = client.post(f"/api/jobs/{jid}/relay", json={"answer": json.dumps(missing)}, headers=H).json()["detail"]
    assert "script" in d and "missing" in d
    assert client.get(f"/api/jobs/{jid}").json()["relay"]["last_error"] == d
    assert client.get(f"/api/jobs/{jid}").json()["status"] == "awaiting_input"  # can paste again


def test_invented_claim_in_script_is_flagged(client):
    jid, _ = start(client)
    s = json.loads(good_script().model_dump_json())
    s["scenes"][2]["vo"] = "Clinically proven. One bottle makes 30 cups."
    s["scenes"][2]["product_fact_ids"] = ["F3"]
    client.post(f"/api/jobs/{jid}/relay", json={"answer": answer(script=s)}, headers=H)
    job = client.get(f"/api/jobs/{jid}").json()
    assert job["status"] == "needs_review"
    msgs = " ".join(f["message"] for f in job["qc_history"][-1]["findings"])
    assert "unverified fact F3" in msgs and "'30" in msgs


def test_revision_and_concept_switch_rounds(client):
    jid, _ = start(client)
    client.post(f"/api/jobs/{jid}/relay", json={"answer": answer()}, headers=H)
    assert client.post(f"/api/jobs/{jid}/revise", json={"feedback": "Punchier hook please"}, headers=H).status_code == 200
    job = client.get(f"/api/jobs/{jid}").json()
    assert job["status"] == "awaiting_input" and job["relay"]["kind"] == "revise" and "Punchier hook" in job["relay"]["prompt"]
    s = json.loads(good_script().model_dump_json()); s["title"] = "Revised title"
    assert client.post(f"/api/jobs/{jid}/relay", json={"answer": json.dumps({"script": s})}, headers=H).status_code == 200
    job = client.get(f"/api/jobs/{jid}").json()
    assert job["script"]["title"] == "Revised title" and job["status"] == "ready" and len(job["qc_history"]) == 2
    assert client.post(f"/api/jobs/{jid}/concept", json={"index": 2}, headers=H).status_code == 200
    job = client.get(f"/api/jobs/{jid}").json()
    assert job["status"] == "awaiting_input" and "concept instead" in job["relay"]["prompt"]


def test_chat_mode_does_not_use_ai_quota(client, monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "global_daily_limit", 1)
    for _ in range(3):
        start(client)
