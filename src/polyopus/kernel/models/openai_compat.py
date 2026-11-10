"""OpenAI-compatible streaming client (stdlib only).

Works with DeepSeek / OpenAI / vLLM / Ollama's /v1 endpoints. Reads the key
from settings or the providers table; never logs it.
"""

from __future__ import annotations

import json
import time
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from polyopus.kernel.models.gateway import (
    FinishDelta,
    ModelCaps,
    ModelDelta,
    ModelRequest,
    ModelUnavailableError,
    TextDelta,
    UsageDelta,
)

RETRYABLE_STATUS = {408, 409, 429, 500, 502, 503, 504}
MAX_RETRIES = 3
BACKOFF = (0.5, 1.0, 2.0)


@dataclass
class ProviderConfig:
    base_url: str
    api_key: str = ""
    timeout_seconds: int = 120
    extra_headers: dict[str, str] | None = None


class OpenAICompatProvider:
    """Implements the ModelGateway protocol over POST /chat/completions."""

    def __init__(self, config: ProviderConfig) -> None:
        self._config = config
        self._caps: dict[str, ModelCaps] = {}

    def capabilities(self, model: str) -> ModelCaps:
        return self._caps.get(model, ModelCaps())

    def set_caps(self, model: str, caps: ModelCaps) -> None:
        self._caps[model] = caps

    async def stream(self, req: ModelRequest) -> AsyncIterator[ModelDelta]:
        payload = {
            "model": req.model,
            "messages": [
                {"role": m.role, "content": m.content} for m in req.messages
            ],
            "temperature": req.temperature,
            "max_tokens": req.max_output_tokens,
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        if req.response_format == "json_object":
            payload["response_format"] = {"type": "json_object"}

        body = json.dumps(payload).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        if self._config.api_key:
            headers["Authorization"] = f"Bearer {self._config.api_key}"
        if self._config.extra_headers:
            headers.update(self._config.extra_headers)

        url = self._config.base_url.rstrip("/") + "/chat/completions"
        last_error: ModelUnavailableError | None = None
        for attempt in range(MAX_RETRIES + 1):
            try:
                for delta in self._connect(url, body, headers):
                    yield delta
                return
            except ModelUnavailableError as exc:
                last_error = exc
                if not exc.retryable or attempt == MAX_RETRIES:
                    raise
                time.sleep(BACKOFF[min(attempt, len(BACKOFF) - 1)])
        assert last_error is not None
        raise last_error

    def _connect(
        self, url: str, body: bytes, headers: dict[str, str]
    ) -> Iterator[ModelDelta]:
        request = Request(url, data=body, headers=headers, method="POST")
        try:
            response = urlopen(request, timeout=self._config.timeout_seconds)
        except HTTPError as exc:
            retryable = exc.code in RETRYABLE_STATUS
            raise ModelUnavailableError(
                "MODEL_NOT_AVAILABLE" if retryable else "PROVIDER_AUTH_FAILED",
                f"HTTP {exc.code}",
                retryable=retryable,
            ) from exc
        except (URLError, OSError) as exc:
            raise ModelUnavailableError(
                "MODEL_NOT_AVAILABLE", str(exc), retryable=True
            ) from exc

        with response:
            for raw_line in response:
                line = raw_line.decode("utf-8", errors="replace").strip()
                if not line.startswith("data:"):
                    continue
                data = line[len("data:") :].strip()
                if data == "[DONE]":
                    return
                try:
                    chunk = json.loads(data)
                except json.JSONDecodeError:
                    continue
                yield from self._parse_chunk(chunk)

    def _parse_chunk(self, chunk: dict[str, object]) -> Iterator[ModelDelta]:
        choices = chunk.get("choices") or []
        if isinstance(choices, list) and choices and isinstance(choices[0], dict):
            choice = choices[0]
            delta = choice.get("delta") or {}
            if isinstance(delta, dict):
                text = delta.get("content")
                if text:
                    yield TextDelta(text=str(text))
            finish = choice.get("finish_reason")
            if finish:
                reason = finish if finish in ("stop", "length", "tool_calls") else "stop"
                yield FinishDelta(reason=reason)  # type: ignore[arg-type]
        usage = chunk.get("usage")
        if isinstance(usage, dict):
            yield UsageDelta(
                input_tokens=int(usage.get("prompt_tokens", 0)),
                output_tokens=int(usage.get("completion_tokens", 0)),
                cached_tokens=int(usage.get("prompt_tokens_details", {}).get("cached_tokens", 0))
                if isinstance(usage.get("prompt_tokens_details"), dict)
                else 0,
            )
