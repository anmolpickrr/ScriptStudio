"""Thin LLM boundary. Every stage asks for a typed object, never free text,
so outputs are validated before the next stage sees them."""
from __future__ import annotations

import logging
import time
from typing import Callable, Protocol, TypeVar

from pydantic import BaseModel

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
    return OpenAILLM()
