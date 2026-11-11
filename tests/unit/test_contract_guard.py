"""Contract name guard: reserved words die at spec import (v0.1 card 4)."""

from __future__ import annotations

import pytest

from contracts.spec.api import assert_valid_name


def test_python_keywords_rejected() -> None:
    for bad in ("from", "class", "import", "lambda", "None", "True"):
        with pytest.raises(AssertionError, match="keyword"):
            assert_valid_name(bad, "test.model")


def test_non_identifiers_rejected() -> None:
    for bad in ("Idempotency-Key", "2fast", "has space", "a.b"):
        with pytest.raises(AssertionError, match="identifier"):
            assert_valid_name(bad, "test.model")


def test_valid_names_pass() -> None:
    for good in ("fromTs", "userId", "_private", " camel" .strip()):
        assert_valid_name(good, "test.model")


def test_current_spec_passes_guard() -> None:
    """Import success IS the guard firing on the real spec (module-level
    validate_spec); reaching here means every field/param name compiles."""
    import contracts.spec.api as spec  # noqa: F401 - import runs validation

    assert len(spec.MODELS) > 0
