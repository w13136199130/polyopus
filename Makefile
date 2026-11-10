PY ?= python
export PYTHONPATH := src

.PHONY: setup lint type imports schema test contracts check-contracts contracts-runtime doctor migrate check

setup:
	uv sync

lint:
	$(PY) -m ruff check src tests

type:
	$(PY) -m mypy src

imports:
	lint-imports

schema:
	$(PY) tools/extract_ddl.py --check
	errors:
	$(PY) tools/extract_errors.py --check

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

check: lint type imports schema errors test check-contracts
	$(PY) contracts/coverage_check.py
