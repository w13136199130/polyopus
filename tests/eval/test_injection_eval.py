"""Injection / path-jail suite (V1-17)."""

from polyopus.eval import harness


def test_injection_suite_meets_baseline() -> None:
    baseline = harness.load_baseline()["suites"]["injection"]
    assert harness._injection_paths() >= baseline - harness.MAX_REGRESSION
