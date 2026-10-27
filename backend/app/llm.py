"""Thin LLM boundary. Every stage asks for a typed object, never free text,
so outputs are validated before the next stage sees them."""
from __future__ import annotations

import base64
import json
import logging
import re
import threading
import time
from typing import Callable, Protocol, TypeVar

from pydantic import BaseModel, ValidationError

from .config import settings

T = TypeVar("T", bound=BaseModel)
log = logging.getLogger(__name__)


class LLM(Protocol):
    def structured(self, *, stage: str, system: str, user: str, schema: type[T],
                   images: list[str] | None = None) -> T: ...


STAGE_MODEL = {
    "extract_product": "extract", "parse_brief": "extract", "reconcile": "extract",
    "concepts": "creative", "choose_concept": "critic", "beats": "creative",
    "write": "creative", "critic": "critic", "revise": "creative",
}


class OpenAILLM:
    def __init__(self, client=None):
        from openai import OpenAI
        self.client = client or OpenAI(api_key=settings.openai_api_key or None,
                                       timeout=settings.llm_timeout_sec, max_retries=2)

    def _model(self, stage: str) -> str:
        tier = STAGE_MODEL.get(stage, "creative")
        return {"extract": settings.model_extract, "critic": settings.model_critic}.get(
            tier, settings.model_creative)

    def structured(self, *, stage, system, user, schema, images=None):
        content: list[dict] = [{"type": "input_text", "text": user}]
        for url in (images or [])[:4]:
            content.append({"type": "input_image", "image_url": url})
        last_err: Exception | None = None
        for attempt in range(3):
            try:
                t0 = time.time()
                resp = self.client.responses.parse(
                    model=self._model(stage),
                    instructions=system,
                    input=[{"role": "user", "content": content}],
                    text_format=schema,
                    reasoning={"effort": settings.reasoning_effort},
                )
                log.info("llm stage=%s model=%s %.1fs", stage, self._model(stage), time.time() - t0)
                if resp.output_parsed is None:
                    raise ValueError(f"{stage}: model returned no parsed output")
                return resp.output_parsed
            except Exception as e:  # network blips, refusals, schema misses
                last_err = e
                if getattr(e, "status_code", None) in (400, 401, 403, 404):
                    raise  # bad key / unknown model / bad request: retrying won't help
                log.warning("llm stage=%s attempt=%d failed: %s", stage, attempt + 1, e)
                time.sleep(2 ** attempt)
        raise RuntimeError(f"LLM stage '{stage}' failed after retries: {last_err}")


class _Throttle:
    """Spaces calls out process-wide so free tiers' requests-per-minute limits aren't hit."""

    def __init__(self):
        self._lock = threading.Lock()
        self._next = 0.0

    def wait(self, interval: float):
        if interval <= 0:
            return
        with self._lock:
            now = time.monotonic()
            delay = max(0.0, self._next - now)
            self._next = max(now, self._next) + interval
        if delay:
            time.sleep(delay)


_throttle = _Throttle()


def _retry_after(e: Exception) -> float:
    """Seconds a 429 asks us to wait (Gemini puts it in the message as 'retry in 23s' / retryDelay)."""
    m = re.search(r"retry(?:Delay)?[^0-9]{0,12}(\d+(?:\.\d+)?)\s*s", str(e), re.I)
    return min(float(m.group(1)) + 1, 65) if m else 20.0


def _extract_json(text: str) -> str:
    text = text.strip()
    m = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if m:
        text = m.group(1).strip()
    start = min([i for i in (text.find("{"), text.find("[")) if i >= 0], default=0)
    return text[start:]


class ChatLLM:
    """Any OpenAI-compatible Chat Completions API: Gemini (free tier), Groq, OpenRouter, local servers.

    Structured output degrades gracefully: strict JSON schema → JSON mode with the schema in the prompt →
    plain text. Whatever comes back is validated with Pydantic, and invalid output is sent back to the
    model with the validation errors to fix (up to 2 repairs)."""

    MODES = ("json_schema", "json_object", "text")

    def __init__(self, client=None):
        from openai import OpenAI
        self.client = client or OpenAI(api_key=settings.llm_api_key or "missing", base_url=settings.llm_base_url or None,
                                       timeout=settings.llm_timeout_sec, max_retries=0)
        self.mode = 0  # index into MODES; moves down when a provider rejects a mode

    def _model(self, stage: str) -> str:
        tier = STAGE_MODEL.get(stage, "creative")
        return {"extract": settings.model_extract, "critic": settings.model_critic}.get(tier, settings.model_creative)

    @staticmethod
    def _schema(schema: type[BaseModel]) -> dict:
        from openai.lib._pydantic import to_strict_json_schema
        return to_strict_json_schema(schema)

    def _images(self, urls: list[str]) -> list[dict]:
        """Inline images as data URLs; several providers can't fetch remote image URLs themselves."""
        from .netsafe import safe_get
        out = []
        for url in urls[:2]:
            try:
                r = safe_get(url, timeout=15)
                ctype = r.headers.get("content-type", "").split(";")[0]
                if r.status_code == 200 and ctype.startswith("image/") and len(r.content) <= 3_000_000:
                    out.append({"type": "image_url", "image_url": {
                        "url": f"data:{ctype};base64,{base64.b64encode(r.content).decode()}"}})
            except Exception:
                continue
        return out

    def structured(self, *, stage, system, user, schema, images=None):
        js = self._schema(schema)
        content: list[dict] | str = user
        imgs = self._images(images or []) if images else []
        if imgs:
            content = [{"type": "text", "text": user}, *imgs]
        messages = [{"role": "system", "content": system}, {"role": "user", "content": content}]
        repairs = transient = 0
        while True:
            mode = self.MODES[self.mode]
            req = list(messages)
            kwargs: dict = {}
            if mode == "json_schema":
                kwargs["response_format"] = {"type": "json_schema",
                                             "json_schema": {"name": schema.__name__, "schema": js, "strict": True}}
            else:
                req[0] = {"role": "system", "content": system + "\n\nRespond with ONLY a JSON object (no prose, no "
                          "markdown) that matches this JSON schema exactly:\n" + json.dumps(js, separators=(",", ":"))}
                if mode == "json_object":
                    kwargs["response_format"] = {"type": "json_object"}
            _throttle.wait(settings.llm_min_interval_sec)
            t0 = time.time()
            try:
                resp = self.client.chat.completions.create(model=self._model(stage), messages=req, **kwargs)
            except Exception as e:
                status = getattr(e, "status_code", None)
                if status == 400 and self.mode < len(self.MODES) - 1 and _is_format_error(e):
                    log.warning("provider rejected %s output mode (%s); falling back", mode, str(e)[:200])
                    self.mode += 1
                    continue
                if status in (400, 401, 403, 404):
                    raise
                transient += 1
                if transient > 4:
                    raise RuntimeError(f"LLM stage '{stage}' failed after retries: {e}")
                wait = _retry_after(e) if status == 429 else 2 ** transient
                log.warning("llm stage=%s transient error (%s); retrying in %.0fs", stage, str(e)[:160], wait)
                time.sleep(wait)
                continue
            text = (resp.choices[0].message.content or "") if resp.choices else ""
            log.info("llm stage=%s model=%s mode=%s %.1fs", stage, self._model(stage), mode, time.time() - t0)
            try:
                return schema.model_validate_json(_extract_json(text))
            except (ValidationError, ValueError) as e:
                repairs += 1
                if repairs > 2:
                    raise RuntimeError(f"The AI model returned malformed output for '{stage}' three times.")
                log.warning("llm stage=%s invalid output, asking for a fix: %s", stage, str(e)[:300])
                messages = messages + [{"role": "assistant", "content": text[:20000]},
                                       {"role": "user", "content": "That JSON doesn't match the required schema:\n"
                                        f"{str(e)[:2000]}\nReturn the complete corrected JSON object only."}]


def _is_format_error(e: Exception) -> bool:
    msg = str(e).lower()
    return any(k in msg for k in ("response_format", "json_schema", "schema", "json mode", "not supported",
                                  "unsupported", "invalid argument", "additionalproperties"))


class FakeLLM:
    """Test double: maps stage name to a callable returning the response object."""

    def __init__(self, handlers: dict[str, Callable[..., BaseModel]]):
        self.handlers = handlers
        self.calls: list[str] = []

    def structured(self, *, stage, system, user, schema, images=None):
        self.calls.append(stage)
        out = self.handlers[stage](system=system, user=user, images=images)
        return schema.model_validate(out.model_dump() if isinstance(out, BaseModel) else out)


def get_llm() -> LLM:
    if settings.llm_provider == "demo":
        from .llm_demo import DemoLLM
        return DemoLLM()
    if settings.llm_provider == "openai":
        return OpenAILLM()
    return ChatLLM()
