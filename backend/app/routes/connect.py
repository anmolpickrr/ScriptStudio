"""Endpoints for the Claude connector (remote MCP) and the ChatGPT custom GPT Action."""
from __future__ import annotations

from typing import Any, Union

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

from .. import connect

router = APIRouter()


@router.post("/mcp")
async def mcp(request: Request):
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(connect._error(None, -32700, "Parse error"), status_code=400)
    if isinstance(body, list):
        out = [r for r in (connect.mcp_handle(m) for m in body) if r is not None]
        return JSONResponse(out) if out else Response(status_code=202)
    res = connect.mcp_handle(body)
    return JSONResponse(res) if res is not None else Response(status_code=202)


@router.get("/mcp")
@router.delete("/mcp")
def mcp_no_stream():
    # Streamable HTTP without a server-initiated stream or sessions: every reply comes back on the POST.
    return Response(status_code=405, headers={"Allow": "POST"})


# ---------------------------------------------------------------- ChatGPT custom GPT Action

class Submission(BaseModel):
    script: Union[dict, str] = Field(description="The complete JSON object matching the job's schema")


@router.get("/connect/jobs/{code}", operation_id="getScriptJob")
def get_job(code: str):
    try:
        return connect.task(code, "call the submitScript action with this code and the JSON object as `script`.")
    except connect.ConnectError as e:
        raise HTTPException(404, str(e))


@router.post("/connect/jobs/{code}", operation_id="submitScript")
def submit_job(code: str, body: Submission):
    try:
        return connect.submit(code, body.script, "chatgpt-action")
    except connect.ConnectError as e:
        raise HTTPException(404, str(e))


@router.get("/connect/openapi.json", include_in_schema=False)
def gpt_schema(request: Request) -> dict[str, Any]:
    """Paste this URL into the GPT editor (Configure → Actions → Import from URL)."""
    base = str(request.base_url).rstrip("/").replace("http://", "https://")
    code = {"name": "code", "in": "path", "required": True, "schema": {"type": "string"},
            "description": "The ScriptStudio code, like SS-1a2b3c4d5e6f-9a8b7c6d"}
    return {
        "openapi": "3.1.0",
        "info": {"title": "ScriptStudio", "version": "1.0.0",
                 "description": "Fetch a ScriptStudio script job, write the script, and submit it back."},
        "servers": [{"url": base}],
        "paths": {"/connect/jobs/{code}": {
            "get": {"operationId": "getScriptJob", "summary": "Get the brief, product source and output format for a job",
                    "parameters": [code], "responses": {"200": {"description": "The job instructions"}},
                    "x-openai-isConsequential": False},
            "post": {"operationId": "submitScript", "summary": "Submit the finished script JSON for a job",
                     "parameters": [code],
                     "requestBody": {"required": True, "content": {"application/json": {"schema": {
                         "type": "object", "required": ["script"],
                         "properties": {"script": {"type": "object", "description":
                                                   "The complete JSON object matching the job's schema"}}}}}},
                     "responses": {"200": {"description": "Result, or problems to fix and resubmit"}},
                     "x-openai-isConsequential": False}}},
    }
