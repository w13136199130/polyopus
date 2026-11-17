"""Memory screening suite (V1-17)."""

from polyopus.eval import harness


def test_memory_screening_meets_baseline() -> None:
    baseline = harness.load_baseline()["suites"]["memory"]
    assert harness._memory_screening() >= baseline - harness.MAX_REGRESSION
