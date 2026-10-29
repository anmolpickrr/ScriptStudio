"""Write scripts with your own Claude or ChatGPT plan, without copy-paste.

ScriptStudio prepares a job (product source, brief, house format) exactly as for the copy-paste relay, and gives it a
handoff code. The person's own Claude (through a custom connector, i.e. this remote MCP server) or ChatGPT (through a
custom GPT Action) fetches the job with that code, writes the script, and submits it back. The submission gets the
same treatment as a pasted answer: facts verified against the page, quality gates, house formatting.

The code (job id + a random per-round secret) is the only credential: it is shown only to the job's owner, works only
while that round is waiting for an answer, and is replaced on every new round.
"""
from __future__ import annotations

import json
import re
from typing import Any, Optional

from . import relay
from .config import settings
from .schemas import Job, JobStatus
from .store import get_store

CODE_RE = re.compile(r"SS-([0-9a-f]{6,32})-([0-9a-f]{8})", re.I)


class ConnectError(ValueError):
    pass


def _job_for(code: str) -> Job:
    m = CODE_RE.search(code or "")
    if not m:
        raise ConnectError("That isn't a ScriptStudio code. It looks like SS-1a2b3c4d5e6f-9a8b7c6d; copy it from the "
                           "script page in ScriptStudio.")
    job = get_store().get_job(m.group(1).lower())
    if not job or not job.relay or not job.relay.token or job.relay.token != m.group(2).lower():
        raise ConnectError("No ScriptStudio job matches this code. It may be from an earlier round; open the script "
                           "in ScriptStudio and use the current code.")
    if job.status != JobStatus.awaiting_input:
        raise ConnectError(f"This job isn't waiting for a script any more (status: {job.status.value}). "
                           f"See it at {script_url(job)}")
    return job


def script_url(job: Job) -> str:
    return f"{settings.app_url}/scripts/{job.id}"


def task(code: str, submit_hint: str) -> dict:
    job = _job_for(code)
    prompt = re.sub(r"OUTPUT: reply with ONE JSON object only, inside a single ```json code block, (with no other text "
                    r"before or after\. It \\?\s*must match|matching) this JSON schema exactly",
                    "OUTPUT: produce ONE JSON object matching this JSON schema exactly", job.relay.prompt)
    brand = (job.inputs.brand_name or "").strip()
    return {
        "code": relay.handoff_code(job),
        "kind": "revision" if job.relay.kind == "revise" else "new script",
        "brand": brand, "product_url": job.inputs.product_url,
        "instructions": prompt + f"\n\nWHEN YOU ARE DONE: {submit_hint} Work quickly: do not write the script, a plan "
                                 "or the JSON in the chat first. Put it straight into the submission. If the "
                                 "submission returns problems, fix exactly those and submit again.",
    }


def submit(code: str, answer: Any, via: str) -> dict:
    job = _job_for(code)
    text = answer if isinstance(answer, str) else json.dumps(answer, ensure_ascii=False)
    store = get_store()
    spec = store.get_format(job.inputs.format_id)
    try:
        relay.apply_answer(job, spec, text)
    except relay.RelayError as e:
        job.relay.last_error = str(e)
        store.save_job(job)
        return {"ok": False, "problem": str(e).replace("paste it again", "submit it again")
                .replace("then paste the whole answer", "then submit the whole JSON again")}
    job.relay.submitted_via = via
    store.save_job(job)
    qc = job.qc_history[-1] if job.qc_history else None
    open_flags = [f.message for f in job.flags if f.severity in ("blocker", "major")][:5]
    return {
        "ok": True, "status": job.status.value, "title": job.script.title if job.script else "",
        "open_in_scriptstudio": script_url(job),
        "quality": {"passed": qc.passed, "scores": qc.scores, "summary": qc.summary} if qc else None,
        "flags_for_the_client": open_flags,
        "message": "Saved. ScriptStudio fact-checked and formatted the script; it's on the script page now.",
    }


# ---------------------------------------------------------------- MCP (Claude custom connector)

SERVER_INFO = {"name": "ScriptStudio", "title": "ScriptStudio by fastrr", "version": "1.0.0"}
INSTRUCTIONS = ("ScriptStudio writes production-ready video ad scripts. When the user gives you a ScriptStudio code "
                "(SS-…), call get_script_job with it, follow the returned instructions exactly, then call submit_script "
                "with the same code and the JSON object. Don't draft the script in the chat first; write it directly "
                "into submit_script. Keep the reply after submitting to one line. Never invent product facts.")
TOOLS = [
    {"name": "get_script_job", "title": "Get a ScriptStudio job",
     "description": "Fetch a ScriptStudio script job by its code (looks like SS-1a2b3c4d5e6f-9a8b7c6d). Returns the brief, "
                    "the product page text (the only source of product facts), the house format and the exact JSON "
                    "schema to return. Write the script, then call submit_script.",
     "inputSchema": {"type": "object", "properties": {"code": {"type": "string", "description": "The SS-… code"}},
                     "required": ["code"]},
     "annotations": {"readOnlyHint": True, "openWorldHint": False}},
    {"name": "submit_script", "title": "Submit the script to ScriptStudio",
     "description": "Submit the finished script for a ScriptStudio job. `script` is the complete JSON object described "
                    "in the job's instructions. ScriptStudio verifies every product fact, runs its quality checks and "
                    "formats the document. If it reports problems, fix them and submit again.",
     "inputSchema": {"type": "object", "properties": {
         "code": {"type": "string", "description": "The same SS-… code"},
         "script": {"type": "object", "description": "The complete JSON object matching the job's schema"}},
         "required": ["code", "script"]},
     "annotations": {"readOnlyHint": False, "destructiveHint": False, "openWorldHint": False}},
]
PROTOCOL_VERSIONS = ("2025-06-18", "2025-03-26", "2024-11-05")


def _result(id_: Any, result: dict) -> dict:
    return {"jsonrpc": "2.0", "id": id_, "result": result}


def _error(id_: Any, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": id_, "error": {"code": code, "message": message}}


def _text(data: Any, is_error: bool = False) -> dict:
    text = data if isinstance(data, str) else json.dumps(data, ensure_ascii=False, indent=1)
    return {"content": [{"type": "text", "text": text}], "isError": is_error}


def mcp_handle(msg: dict) -> Optional[dict]:
    """One JSON-RPC message in, one response out (None for notifications)."""
    if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0" or "method" not in msg:
        return _error(msg.get("id") if isinstance(msg, dict) else None, -32600, "Invalid request")
    id_, method, params = msg.get("id"), msg["method"], msg.get("params") or {}
    if id_ is None:  # notification (e.g. notifications/initialized)
        return None
    if method == "initialize":
        asked = params.get("protocolVersion")
        return _result(id_, {"protocolVersion": asked if asked in PROTOCOL_VERSIONS else PROTOCOL_VERSIONS[0],
                             "capabilities": {"tools": {"listChanged": False}},
                             "serverInfo": SERVER_INFO, "instructions": INSTRUCTIONS})
    if method == "ping":
        return _result(id_, {})
    if method == "tools/list":
        return _result(id_, {"tools": TOOLS})
    if method == "tools/call":
        name, args = params.get("name"), params.get("arguments") or {}
        try:
            if name == "get_script_job":
                return _result(id_, _text(task(str(args.get("code", "")),
                                               "call the submit_script tool with this code and the JSON object as `script`.")))
            if name == "submit_script":
                out = submit(str(args.get("code", "")), args.get("script"), "claude-connector")
                return _result(id_, _text(out, is_error=not out["ok"]))
            return _error(id_, -32602, f"Unknown tool: {name}")
        except ConnectError as e:
            return _result(id_, _text(str(e), is_error=True))
    if method in ("resources/list", "prompts/list"):
        return _result(id_, {method.split("/")[0]: []})
    return _error(id_, -32601, f"Method not found: {method}")
