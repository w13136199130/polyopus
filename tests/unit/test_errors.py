"""M1 pre-work: error catalog + envelope + i18n fallback."""

from __future__ import annotations

import json
from pathlib import Path

from polyopus.platform.errors import ERROR_CODES, AppError, error_payload, status_for
from polyopus.platform.i18n import error_message, normalize_locale, translate

ROOT = Path(__file__).resolve().parents[2]
LOCALES = ROOT / "src" / "polyopus" / "platform" / "i18n" / "locales"


def test_catalog_is_complete() -> None:
    assert len(ERROR_CODES) >= 140
    assert ERROR_CODES["NOT_FOUND"] == 404
    assert ERROR_CODES["MANDATE_SCOPE_VIOLATION"] == 403


def test_locale_key_trees_match() -> None:
    en = json.loads((LOCALES / "error.en.json").read_text(encoding="utf-8"))
    zh = json.loads((LOCALES / "error.zh-CN.json").read_text(encoding="utf-8"))
    assert set(en) == set(zh)
    assert len(en) == len(ERROR_CODES)


def test_envelope_shape() -> None:
    payload = error_payload("NOT_FOUND", details={"id": "x"}, trace_id="tr_1")
    assert payload["error"]["code"] == "NOT_FOUND"
    assert payload["error"]["details"] == {"id": "x"}
    assert payload["error"]["traceId"] == "tr_1"
    assert payload["error"]["message"]


def test_unknown_code_fails_closed() -> None:
    err = AppError(code="MY_TYPO")
    assert err.normalized_code() == "INTERNAL_ERROR"
    assert err.status() == 500
    payload = err.to_payload()
    assert payload["error"]["code"] == "INTERNAL_ERROR"
    assert payload["error"]["details"]["originalCode"] == "MY_TYPO"


def test_status_override() -> None:
    err = AppError(code="BUDGET_EXCEEDED", http_status=402)
    assert err.status() == 402
    assert status_for("BUDGET_EXCEEDED") in (402, 409)


def test_locale_fallback_and_failure() -> None:
    assert normalize_locale("zh") == "zh-CN"
    assert normalize_locale("fr") == "en"
    zh = error_message("NOT_FOUND", "zh-CN")
    assert zh != "error.NOT_FOUND"
    assert translate("error.__missing__", "zh-CN") == "error.__missing__"
