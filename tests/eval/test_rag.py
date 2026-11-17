"""RAG recall suite (V1-17)."""

from polyopus.eval import harness


def test_rag_suite_meets_baseline() -> None:
    baseline = harness.load_baseline()["suites"]["rag"]
    assert harness._rag_recall() >= baseline - harness.MAX_REGRESSION
