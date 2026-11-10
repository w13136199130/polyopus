"""Provider registry: resolves models to configured gateways (settings-first).

Resolution order:
1. env-provided default (`POLY_MODEL_BASE_URL`) -> one OpenAI-compat gateway;
2. the `providers`/`models` tables (kind=openai_compat, enabled);
3. FakeModel fallback when nothing is configured (dev/demo).
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass

from polyopus.kernel.models.fake import FakeModel
from polyopus.kernel.models.gateway import (
    ChatMessage,
    ModelCaps,
    ModelGateway,
    ModelRequest,
)
from polyopus.kernel.models.openai_compat import OpenAICompatProvider, ProviderConfig


@dataclass(frozen=True)
class Resolved:
    gateway: ModelGateway
    model: str
    caps: ModelCaps
    provider_id: str
    fake: bool


class Registry:
    def __init__(self, conn: sqlite3.Connection | None = None, env_base_url: str | None = None,
                 env_api_key: str | None = None, env_model: str | None = None) -> None:
        # default to instance settings so every caller (engine, doctor) sees
        # the same provider without threading env through each call site
        if env_base_url is None or env_api_key is None or env_model is None:
            from polyopus.config import load_settings
            settings = load_settings()
            env_base_url = settings.model_base_url if env_base_url is None else env_base_url
            env_api_key = settings.model_api_key if env_api_key is None else env_api_key
            env_model = settings.model_name if env_model is None else env_model
        self._conn = conn
        self._env_base_url = env_base_url.rstrip("/")
        self._env_api_key = env_api_key
        self._env_model = env_model
        self._env_provider = (
            OpenAICompatProvider(
                ProviderConfig(base_url=self._env_base_url, api_key=self._env_api_key)
            )
            if self._env_base_url
            else None
        )

    def resolve(self, model_hint: str | None = None) -> Resolved:
        if self._env_provider is not None:
            model = model_hint or self._env_model or "default"
            return Resolved(
                gateway=self._env_provider,
                model=model,
                caps=self._env_provider.capabilities(model),
                provider_id="env",
                fake=False,
            )
        if self._conn is not None:
            row = self._conn.execute(
                """
                SELECT p.provider_id, p.base_url, p.api_key_enc, p.kind, m.name AS model,
                       m.caps_json
                FROM models m JOIN providers p ON p.provider_id = m.provider_id
                WHERE m.enabled = 1 AND p.status != 'error'
                  AND (? IS NULL OR m.name = ? OR m.model_id = ?)
                ORDER BY m.id LIMIT 1
                """,
                (model_hint, model_hint, model_hint),
            ).fetchone()
            if row is not None:
                provider = OpenAICompatProvider(
                    ProviderConfig(
                        base_url=str(row["base_url"] or ""),
                        api_key=str(row["api_key_enc"] or ""),
                    )
                )
                caps = ModelCaps()
                if row["caps_json"]:
                    caps = ModelCaps(**json.loads(row["caps_json"]))
                provider.set_caps(str(row["model"]), caps)
                return Resolved(
                    gateway=provider,
                    model=str(row["model"]),
                    caps=caps,
                    provider_id=str(row["provider_id"]),
                    fake=False,
                )
        return Resolved(
            gateway=FakeModel(),
            model=model_hint or "fake",
            caps=ModelCaps(),
            provider_id="fake",
            fake=True,
        )

    def probe(self, model_hint: str | None = None) -> tuple[str, str]:
        """Lightweight liveness check for doctor: (status, detail)."""
        if self._env_provider is None and self._conn is not None:
            row = self._conn.execute("SELECT count(*) FROM models WHERE enabled=1").fetchone()
            if not int(row[0]):
                return "WARN", "no models configured; FakeModel will be used"
        resolved = self.resolve(model_hint)
        if resolved.fake:
            return "WARN", "FakeModel (no provider configured)"
        try:
            import asyncio

            async def probe_stream() -> None:
                # one minimal message: most providers reject empty arrays
                async for _delta in resolved.gateway.stream(
                    ModelRequest(
                        model=resolved.model,
                        messages=(
                            ChatMessage(role="user", content="ping"),
                        ),
                        max_output_tokens=1,
                        temperature=0,
                    )
                ):
                    return  # first frame is enough

            asyncio.run(probe_stream())
        except Exception as exc:  # noqa: BLE001 - doctor reports, never crashes
            return "FAIL", f"{resolved.model}: {exc}"
        return "OK", f"{resolved.model} reachable"
