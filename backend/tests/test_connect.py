import json

from tests.test_api import H, client  # noqa: F401  (fixture)
from tests.test_relay import answer, start


def rpc(client, method, params=None, id_=1):
    r = client.post("/mcp", json={"jsonrpc": "2.0", "id": id_, "method": method, "params": params or {}})
    assert r.status_code == 200, r.text
    return r.json()


def payload(ans: str) -> dict:
    return json.loads(ans.split("```json\n")[1].split("\n```")[0])


def test_claude_connector_fetches_and_submits_a_job(client):
    jid, _ = start(client, "claude")
    code = client.get(f"/api/jobs/{jid}").json()["relay"]["code"]
    assert code.startswith(f"SS-{jid}-") and "token" not in client.get(f"/api/jobs/{jid}").json()["relay"]

    init = rpc(client, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t"}})
    assert init["result"]["serverInfo"]["name"] == "ScriptStudio" and "tools" in init["result"]["capabilities"]
    assert client.post("/mcp", json={"jsonrpc": "2.0", "method": "notifications/initialized"}).status_code == 202
    assert {t["name"] for t in rpc(client, "tools/list")["result"]["tools"]} == {"get_script_job", "submit_script"}
    assert client.get("/mcp").status_code == 405 and client.get("/.well-known/oauth-protected-resource").status_code == 404

    job = rpc(client, "tools/call", {"name": "get_script_job", "arguments": {"code": f"Please write {code} thanks"}})["result"]
    text = job["content"][0]["text"]
    assert not job["isError"] and "PRODUCT SOURCE" in text and "submit_script" in text and "```json code block" not in text

    wrong = rpc(client, "tools/call", {"name": "get_script_job", "arguments": {"code": code[:-1] + "0"}})["result"]
    assert wrong["isError"] and "No ScriptStudio job" in wrong["content"][0]["text"]

    bad = rpc(client, "tools/call", {"name": "submit_script", "arguments": {"code": code, "script": {"product_name": "x"}}})["result"]
    assert bad["isError"] and "missing some required parts" in bad["content"][0]["text"]
    assert client.get(f"/api/jobs/{jid}").json()["status"] == "awaiting_input"  # can fix and resubmit

    ok = rpc(client, "tools/call", {"name": "submit_script", "arguments": {"code": code, "script": payload(answer())}})["result"]
    out = json.loads(ok["content"][0]["text"])
    assert not ok["isError"] and out["ok"] and out["open_in_scriptstudio"].endswith(f"/scripts/{jid}")
    job = client.get(f"/api/jobs/{jid}").json()
    assert job["status"] in ("ready", "needs_review") and job["script"]["title"] and job["relay"]["submitted_via"] == "claude-connector"

    done = rpc(client, "tools/call", {"name": "get_script_job", "arguments": {"code": code}})["result"]
    assert done["isError"] and "isn't waiting" in done["content"][0]["text"]


def test_chatgpt_action_endpoints(client):
    jid, _ = start(client, "chatgpt")
    code = client.get(f"/api/jobs/{jid}").json()["relay"]["code"]
    schema = client.get("/connect/openapi.json").json()
    assert schema["servers"][0]["url"].startswith("https://") and "/connect/jobs/{code}" in schema["paths"]

    got = client.get(f"/connect/jobs/{code}").json()  # no CSRF header: called by OpenAI's servers, guarded by the code
    assert "submitScript" in got["instructions"] and got["kind"] == "new script"
    assert client.get(f"/connect/jobs/SS-{jid}-00000000").status_code == 404

    res = client.post(f"/connect/jobs/{code}", json={"script": answer()}).json()  # a string (with ```json) works too
    assert res["ok"] and client.get(f"/api/jobs/{jid}").json()["relay"]["submitted_via"] == "chatgpt-action"
