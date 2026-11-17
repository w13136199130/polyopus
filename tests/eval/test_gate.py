"""Gate arithmetic: a >3% drop blocks (V1-17)."""

from polyopus.eval import harness


def test_gate_passes_with_baseline_scores() -> None:
    baseline = harness.load_baseline()
    passed, failures = harness.gate(dict(baseline["suites"]), baseline)
    assert passed and failures == []


def test_gate_blocks_a_three_percent_drop() -> None:
    baseline = harness.load_baseline()
    scores = dict(baseline["suites"])
    scores["rag"] = round(scores["rag"] - 0.04, 4)
    passed, failures = harness.gate(scores, baseline)
    assert not passed
    assert any(item.startswith("rag:") for item in failures)
