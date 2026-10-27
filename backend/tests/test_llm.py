"""The OpenAI-compatible client used for free providers (Gemini, Groq, OpenRouter)."""
import json

import httpx
import pytest
from openai import OpenAI

from app import llm
from app.config import settings
from app.schemas import BeatSheet

BEATS = {"beats": [{"index": 1, "purpose": "hook", "start_sec": 0, "end_sec": 2, "what_happens": "x", "emotional_note": "y"}]}


def completion(text):
    return httpx.Response(200, json={"id": "c", "object": "chat.completion", "created": 0, "model": "m",
                                     "choices": [{"index": 0, "finish_reason": "stop",
                                                  "message": {"role": "assistant", "content": text}}]})


def client(responses, seen):
    it = iter(responses)

    def handler(req):
        seen.append(json.loads(req.content))
        return next(it)
    return OpenAI(api_key="k", base_url="https://example.test/v1", max_retries=0,
                  http_client=httpx.Client(transport=httpx.MockTransport(handler)))


@pytest.fixture(autouse=True)
def no_wait(monkeypatch):
    monkeypatch.setattr(settings, "llm_min_interval_sec", 0)
    monkeypatch.setattr(settings, "model_creative", "gemini-2.5-flash")
    monkeypatch.setattr(llm.time, "sleep", lambda s: None)


def test_strict_schema_path():
    seen = []
    c = llm.ChatLLM(client([completion(json.dumps(BEATS))], seen))
    out = c.structured(stage="beats", system="s", user="u", schema=BeatSheet)
    assert out.beats[0].purpose == "hook"
    assert seen[0]["response_format"]["type"] == "json_schema" and seen[0]["model"] == "gemini-2.5-flash"


def test_falls_back_when_schema_mode_rejected_and_repairs_bad_json():
    seen = []
    rejected = httpx.Response(400, json={"error": {"message": "Invalid JSON payload: Unknown name \"additionalProperties\" at 'generation_config.response_schema'"}})
    responses = [rejected, completion("Sure! ```json\n{\"beats\": [{\"index\": 1}]}\n```"),
                 completion("```json\n" + json.dumps(BEATS) + "\n```")]
    c = llm.ChatLLM(client(responses, seen))
    out = c.structured(stage="beats", system="s", user="u", schema=BeatSheet)
    assert out.beats[0].end_sec == 2
    assert seen[1]["response_format"] == {"type": "json_object"}
    assert "JSON schema" in seen[1]["messages"][0]["content"]
    assert "doesn't match" in seen[2]["messages"][-1]["content"]  # validation errors sent back for repair
    assert c.mode == 1  # remembers the working mode


def test_rate_limit_is_retried():
    seen = []
    limited = httpx.Response(429, json={"error": {"message": "Quota exceeded. Please retry in 3s."}})
    c = llm.ChatLLM(client([limited, completion(json.dumps(BEATS))], seen))
    assert c.structured(stage="beats", system="s", user="u", schema=BeatSheet).beats
    assert len(seen) == 2


def test_bad_key_is_not_retried():
    seen = []
    bad = httpx.Response(401, json={"error": {"message": "API key not valid"}})
    c = llm.ChatLLM(client([bad], seen))
    with pytest.raises(Exception):
        c.structured(stage="beats", system="s", user="u", schema=BeatSheet)
    assert len(seen) == 1


def test_retry_after_parsing():
    assert llm._retry_after(Exception("Please retry in 23.5s")) == 24.5
    assert llm._retry_after(Exception("'retryDelay': '41s'")) == 42
