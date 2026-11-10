"""Tiny i18n runtime: catalogs in locales/, fallback locale -> en -> key."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

LOCALES_DIR = Path(__file__).parent / "locales"
SUPPORTED = ("en", "zh-CN")
FALLBACK = "en"


def normalize_locale(locale: str | None) -> str:
    if not locale:
        return FALLBACK
    value = locale.replace("_", "-")
    if value in SUPPORTED:
        return value
    base = value.split("-")[0].lower()
    return "zh-CN" if base == "zh" else FALLBACK


@lru_cache(maxsize=8)
def _catalog(locale: str) -> dict[str, str]:
    path = LOCALES_DIR / f"error.{locale}.json"
    if not path.is_file():
        return {}
    data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    return {str(k): str(v) for k, v in data.items()}


def translate(key: str, locale: str | None = None, **params: Any) -> str:
    loc = normalize_locale(locale)
    text = _catalog(loc).get(key) or _catalog(FALLBACK).get(key) or key
    if params:
        try:
            return text.format(**params)
        except (KeyError, IndexError):
            return text
    return text


def error_message(code: str, locale: str | None = None) -> str:
    return translate(f"error.{code}", locale)


def clear_cache() -> None:
    _catalog.cache_clear()
