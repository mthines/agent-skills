# Composite action template

Path: `.github/actions/<name>/action.yml`. Invoked as
`uses: ./.github/actions/<name>`.

## Setup Node + deps

`.github/actions/setup-node-deps/action.yml`:

```yaml
name: 'Setup Node + cached deps'
description: 'Sets up Node, restores the npm cache, and runs `npm ci`.'

inputs:
  node-version:
    description: 'Node version (e.g. 20, 22)'
    required: false
    default: '20'
  working-directory:
    description: 'Where to run npm ci'
    required: false
    default: '.'

outputs:
  cache-hit:
    description: 'Whether the cache was hit exactly.'
    value: ${{ steps.setup.outputs.cache-hit }}

runs:
  using: 'composite'
  steps:
    - name: Setup Node ${{ inputs.node-version }}
      id: setup
      uses: actions/setup-node@1d0ff469b7ec7b3cb9d8673fde0c81c44821de2a # v4.2.0
      with:
        node-version: ${{ inputs.node-version }}
        cache: 'npm'
        cache-dependency-path: ${{ inputs.working-directory }}/package-lock.json

    - name: Install dependencies
      shell: bash
      working-directory: ${{ inputs.working-directory }}
      run: npm ci
```

Caller:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@692973e3d937129bcbf40652eb9f2f61becf3332 # v4.1.7

      - name: Setup Node + cached deps
        uses: ./.github/actions/setup-node-deps
        with:
          node-version: '22'

      - run: npm test
```

## Rules for composite actions

1. **Every `run:` step needs `shell:`.** `bash` is the usual choice.
   There is no default.
2. **Inputs are strings.** `type:` is not supported. JSON-encode for
   structured data.
3. **Outputs map a step's output to the action's output** via the
   step `id:`.
4. **No `jobs:`.** A composite is steps only. If you need jobs, use a
   reusable workflow.
5. **Pin nested `uses:`.** Same SHA-pinning rule applies recursively.
