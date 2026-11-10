PY ?= python
export PYTHONPATH := src

.PHONY: setup lint type imports test contracts check-contracts contracts-runtime doctor migrate check

setup:
	uv sync

lint:
	$(PY) -m ruff check src tests

type:
	$(PY) -m mypy src

imports:
	lint-imports

test:
	$(PY) -m pytest

contracts:
	$(PY) -m contracts.generate

check-contracts:
	$(PY) -m contracts.check

contracts-runtime:
	PYTHONPATH=generated/py $(PY) -m contracts.runtime_check

doctor:
	$(PY) -m polyopus doctor

migrate:
	$(PY) -m polyopus migrate

check: lint type imports test check-contracts
	$(PY) contracts/coverage_check.py
