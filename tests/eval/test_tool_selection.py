"""Tool policy selection suite (V1-17)."""

from polyopus.eval import harness


def test_tool_selection_suite_meets_baseline() -> None:
    baseline = harness.load_baseline()["suites"]["tool_selection"]
    assert harness._tool_selection() >= baseline - harness.MAX_REGRESSION
