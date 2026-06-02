# Python CI workflow template

Copy into `.github/workflows/ci.yml`. Replace SHAs with current ones
before committing.

```yaml
name: CI

on:
  pull_request:
    branches: [main]
    paths:
      - 'src/**'
      - 'tests/**'
      - 'requirements*.txt'
      - 'pyproject.toml'
      - '.github/workflows/ci.yml'
  push:
    branches: [main]
    paths:
      - 'src/**'
      - 'tests/**'
      - 'requirements*.txt'
      - 'pyproject.toml'
      - '.github/workflows/ci.yml'

permissions: {}

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

jobs:
  lint:
    name: Lint + format
    runs-on: ubuntu-latest
    permissions:
      contents: read
    timeout-minutes: 5
    steps:
      - name: Checkout
        uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332 # v4.1.7

      - name: Setup Python + cached pip
        uses: actions/setup-python@39cd14951b08e74b54015e9e001cdefcf80e669f # v5.1.1
        with:
          python-version: '3.13'
          cache: 'pip'
          cache-dependency-path: requirements-dev.txt

      - name: Install dev dependencies
        run: pip install -r requirements-dev.txt

      - name: Run Ruff
        run: ruff check . --output-format=github

      - name: Check formatting
        run: ruff format . --check

  typecheck:
    name: Type-check (mypy)
    runs-on: ubuntu-latest
    permissions:
      contents: read
    timeout-minutes: 10
    steps:
      - name: Checkout
        uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332 # v4.1.7

      - name: Setup Python + cached pip
        uses: actions/setup-python@39cd14951b08e74b54015e9e001cdefcf80e669f # v5.1.1
        with:
          python-version: '3.13'
          cache: 'pip'
          cache-dependency-path: |
            requirements.txt
            requirements-dev.txt

      - name: Install dependencies
        run: |
          pip install -r requirements.txt
          pip install -r requirements-dev.txt

      - name: mypy
        run: mypy src/

  test:
    name: Tests (Python ${{ matrix.python }})
    runs-on: ubuntu-latest
    permissions:
      contents: read
    timeout-minutes: 15
    strategy:
      fail-fast: false
      matrix:
        python: ['3.12', '3.13', '3.14']
    steps:
      - name: Checkout
        uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332 # v4.1.7

      - name: Setup Python + cached pip
        uses: actions/setup-python@39cd14951b08e74b54015e9e001cdefcf80e669f # v5.1.1
        with:
          python-version: ${{ matrix.python }}
          cache: 'pip'
          cache-dependency-path: |
            requirements.txt
            requirements-dev.txt

      - name: Install dependencies
        run: |
          pip install -r requirements.txt
          pip install -r requirements-dev.txt

      - name: Run pytest
        run: pytest tests/ --junit-xml=junit.xml --cov=src --cov-report=term-missing

      - name: Test summary
        if: always()
        run: |
          if [ -f junit.xml ]; then
            {
              echo "## Test results (Python ${{ matrix.python }})"
              python -c "import xml.etree.ElementTree as ET; r=ET.parse('junit.xml').getroot(); print(f\"Tests: {r.attrib.get('tests','?')} | Failures: {r.attrib.get('failures','?')} | Errors: {r.attrib.get('errors','?')}\")"
            } >> "$GITHUB_STEP_SUMMARY"
          fi
```
