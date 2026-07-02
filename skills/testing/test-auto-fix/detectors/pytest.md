---
title: Pytest Detector
stack: pytest
tags:
  - pytest
  - python
---

# Pytest Detector

Bootstrap template for projects using pytest.

## Detection signals

- `pytest.ini` in the project root
- `[tool.pytest.ini_options]` in `pyproject.toml`
- `[tool:pytest]` in `setup.cfg`
- `pytest` in `requirements*.txt` or `pyproject.toml` dependencies

## Surface starter template

```yaml
---
project-key: <normalised-git-remote-key>
stack: pytest
detect-command: python -m pytest -v
single-test-command: python -m pytest "{file}::{name}" -v
failure-parser: '^FAILED\s+(\S+\.py)::(.+?)\s*$'
# group 1 = file path, group 2 = test node id (e.g., TestClass::test_method or test_function)
cache-bust-flag: --cache-clear
---
# Notes
# If using a virtual environment: source .venv/bin/activate first, or use
#   python -m pytest (which uses the active venv's pytest)
# For pyproject.toml-based projects with uv: uv run pytest
# For Django: python -m pytest --ds=myapp.settings
# For async tests: add --asyncio-mode=auto if using pytest-asyncio
```

## Failure output format

```
FAILED tests/unit/test_parser.py::TestParser::test_handles_missing_keys - AssertionError: assert result == "default"
```

Parser regex: `^FAILED\s+(\S+\.py)::(.+?)\s*$`

- Group 1: file path (e.g., `tests/unit/test_parser.py`)
- Group 2: node ID (e.g., `TestParser::test_handles_missing_keys`)

## Single-test re-run

```bash
python -m pytest tests/unit/test_parser.py::TestParser::test_handles_missing_keys -v
```

For parametrized tests, the node ID includes the parameter:
```bash
python -m pytest "tests/unit/test_parser.py::test_parse[json-valid]" -v
```

## Common failure families

- **Fixture drift** — a fixture's return type or shape changed; the test is using the old contract.
- **Import path moved** — a module was renamed or relocated; the test import is stale.
- **Environment variable missing** — test reads from `os.environ`; a required var was removed from `.env.test`.
- **Database state leak** — integration tests share a DB transaction that wasn't rolled back.
- **Async fixture mismatch** — mixing `asyncio` and `sync` fixtures; check `pytest-asyncio` mode.
- **Snapshot drift** — `pytest-snapshot` or `syrupy` output changed; review before accepting.
