"""Outbound service unit tests: redaction, URL policy, signing, outcomes."""

from __future__ import annotations

import hashlib
import hmac

import pytest

from polyopus.domains.outbound import service as outbound
from polyopus.domains.outbound.port import DeliveryResult
from polyopus.platform.errors import AppError

# ---- redact ------------------------------------------------------------------


def test_redact_strips_windows_and_unix_absolute_paths() -> None:
    text = "读取 E:\\space\\my_space\\secret.txt 和 /etc/passwd 与 /tmp/build/x 失败"
    out = outbound.redact(text)
    assert "E:" not in out and "space" not in out
    assert "/etc" not in out and "/tmp" not in out
    assert out.count("[path]") == 3


def test_redact_leaves_urls_and_plain_text_intact() -> None:
    text = "see http://127.0.0.1:8000/tasks?ticketId=tk_1 and ratio 3:2 done"
    assert outbound.redact(text) == text


# ---- callback URL policy (docs/09 §11) ---------------------------------------


@pytest.mark.parametrize("url", [
    "http://127.0.0.1:9000/hook",  # loopback: dev/test receivers
    "http://localhost:9000/hook",
    "https://example.com/webhook",
    "http://[::1]:9000/hook",
])
def test_validate_callback_url_accepts(url: str) -> None:
    assert outbound.validate_callback_url(url) == url


@pytest.mark.parametrize("url", [
    "ftp://example.com/hook",
    "file:///etc/passwd",
    "not a url",
    "http://",            # no host
    "http://10.0.0.5/hook",
    "http://192.168.1.10/hook",
    "http://172.16.0.1/hook",
    "http://169.254.169.254/latest/meta-data",  # cloud metadata
    "http://[fe80::1]/hook",
    "http://[fd00::1]/hook",
])
def test_validate_callback_url_rejects(url: str) -> None:
    with pytest.raises(AppError) as excinfo:
        outbound.validate_callback_url(url)
    assert excinfo.value.normalized_code() == "VALIDATION_FAILED"


# ---- signing mirrors the inbound scheme ---------------------------------------


def test_sign_matches_inbound_hmac_shape() -> None:
    body = outbound.canonical({"a": 1, "b": ["x"]})
    expected = hmac.new(b"topsecret", body, hashlib.sha256).hexdigest()
    assert outbound.sign("topsecret", body) == expected


def test_canonical_is_sorted_compact() -> None:
    assert outbound.canonical({"b": 1, "a": 2}) == b'{"a":2,"b":1}'


# ---- outcome classification ----------------------------------------------------


@pytest.mark.parametrize("result,expected", [
    (DeliveryResult(status_code=200, ok=True), "sent"),
    (DeliveryResult(status_code=204, ok=True), "sent"),
    (DeliveryResult(status_code=None, ok=False, error="refused"), "retry"),
    (DeliveryResult(status_code=429, ok=False, error="HTTP 429"), "retry"),
    (DeliveryResult(status_code=500, ok=False, error="HTTP 500"), "retry"),
    (DeliveryResult(status_code=503, ok=False, error="HTTP 503"), "retry"),
    (DeliveryResult(status_code=404, ok=False, error="HTTP 404"), "dead"),
    (DeliveryResult(status_code=401, ok=False, error="HTTP 401"), "dead"),
    (DeliveryResult(status_code=410, ok=False, error="HTTP 410"), "dead"),
])
def test_outcome_of(result: DeliveryResult, expected: str) -> None:
    assert outbound.outcome_of(result) == expected


# ---- payload whitelist (SEC: no secrets, no absolute paths) -------------------


def test_build_payload_whitelist_and_idem() -> None:
    payload = outbound.build_payload(
        source_id="src_1", ticket_id="tk_1", report_id="rp_1", state="ready",
        title="fix E:\\repo\\bug.py", summary="done from /tmp/build",
        base_url="http://127.0.0.1:8000",
    )
    assert set(payload) == {
        "kind", "sourceId", "ticketId", "reportId", "state",
        "title", "summary", "link", "idemKey", "sentAt",
    }
    assert "secret" not in payload
    assert "E:" not in payload["title"] and "/tmp" not in payload["summary"]
    assert payload["idemKey"] == "reply:tk_1:rp_1"
    assert payload["link"] == "http://127.0.0.1:8000/tasks?ticketId=tk_1"


def test_reply_states_exclude_waiting() -> None:
    assert "waiting" not in outbound.REPLY_STATES
    assert set(outbound.REPLY_STATES) == {"ready", "blocked", "failed"}
