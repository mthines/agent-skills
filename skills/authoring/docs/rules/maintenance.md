# Documentation Maintenance

Docs-as-code: lint, link-check, and automate the CHANGELOG so docs stay
honest without manual upkeep. This rule covers the CI lint stack
(Vale, markdownlint, alex, lychee) and the
[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) →
CHANGELOG automation.

## 1. Why This Matters

A 2025 GetDX study on developer documentation found:

- Undocumented or stale docs add **2–3 months** to new-hire ramp time.
- Developers lose **3–10 hours per week** searching for information that
  should be documented.

The cheapest way to fight drift is to make the build fail when drift
appears. Every check below is a build-time gate.

## 2. The Recommended Lint Stack

Four tools, each covering a different concern. All four run in CI on
every PR.

| Tool                         | Covers                                                                 | Source                                        |
| ---------------------------- | ---------------------------------------------------------------------- | --------------------------------------------- |
| **markdownlint**             | Structural / formatting (heading levels, line length, list style)      | [github.com/DavidAnson/markdownlint](https://github.com/DavidAnson/markdownlint) |
| **Vale**                     | Prose style — enforces house style (Google / Microsoft packs available) | [vale.sh](https://vale.sh/)                   |
| **alex**                     | Catches insensitive / exclusionary language                            | [github.com/get-alex/alex](https://github.com/get-alex/alex) |
| **lychee** / `markdown-link-check` | Link validation (relative, absolute, anchor)                       | [github.com/lycheeverse/lychee](https://github.com/lycheeverse/lychee) |

## 3. CI Gate — Sample `docs.yml`

A drop-in workflow that runs all four checks on every PR. Each check
fails the build on `error` level findings and warns on `warning` level.

```yaml
# .github/workflows/docs.yml
name: docs

on:
  pull_request:
    paths:
      - "**/*.md"
      - ".github/workflows/docs.yml"
      - ".vale.ini"
      - ".markdownlint.json"

jobs:
  lint-docs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: markdownlint
        run: npx markdownlint-cli2 "**/*.md"

      - name: Vale
        uses: errata-ai/vale-action@v2
        with:
          fail_on_error: true

      - name: alex
        run: npx alex .

      - name: lychee (link check)
        uses: lycheeverse/lychee-action@v2
        with:
          args: --no-progress './**/*.md'
          fail: true
```

Why these four:

- **markdownlint** catches structural defects (heading skips, line
  length, bare URLs) that Vale does not.
- **Vale** enforces prose style. Pre-built rule packs for Google,
  Microsoft, and Write Good are available out of the box.
- **alex** catches accidental insensitive language. Cheap, almost no
  false positives in technical docs.
- **lychee** validates every link in the docs tree. Catches dead links
  before merge.

Used in production by GitLab, Elastic, Datadog, Linode, and many others.

## 4. Vale Configuration

A minimal `.vale.ini` that uses the Google style pack:

```ini
StylesPath = .github/styles
MinAlertLevel = suggestion

Packages = Google

[*.md]
BasedOnStyles = Vale, Google
```

Install the pack:

```bash
vale sync
```

Then commit the styles directory. CI runs against the committed rules,
so PR reviewers see the same warnings as authors.

For stricter style, swap `Packages = Google` for `Packages = Microsoft`
or layer both. The two packs occasionally disagree (em-dash spacing,
e.g.); pick one as canonical for the repo.

## 5. markdownlint Configuration

A minimal `.markdownlint.json` that aligns with the rules in
[`writing-style.md`](./writing-style.md):

```json
{
  "default": true,
  "MD013": { "line_length": 120, "code_blocks": false, "tables": false },
  "MD024": { "siblings_only": true },
  "MD033": { "allowed_elements": ["br", "details", "summary", "img"] },
  "MD041": false
}
```

Rules to relax with care:

- **MD013** (line length) — fine to raise to 120 or 140. Disabling
  entirely loses the diff-friendliness payoff of semantic line breaks.
- **MD033** (inline HTML) — needed for `<details>`, `<img>` with
  attributes. Allowlist the tags you actually use.
- **MD041** (first line H1) — disable for files that intentionally start
  with frontmatter.

## 6. Drift Detection in CI

The deterministic checks from
[`drift-detection.md`](./drift-detection.md) §3 can run in CI too.
Add a job:

```yaml
  drift-checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Dead @imports
        run: |
          MISSING=$(grep -rhoE '@[A-Za-z0-9_.][A-Za-z0-9_./-]*\.[A-Za-z0-9]+' \
            CLAUDE.md .claude/rules/ 2>/dev/null \
            | sort -u \
            | while read -r ref; do
                path="${ref#@}"
                [ ! -e "$path" ] && echo "DEAD: $ref"
              done)
          if [ -n "$MISSING" ]; then
            echo "$MISSING"
            exit 1
          fi

      - name: Documented scripts exist
        if: hashFiles('package.json') != ''
        run: |
          STALE=$(grep -ohE '`(npm|pnpm|yarn|bun)( run)? [a-zA-Z][a-zA-Z0-9:_-]*`' CLAUDE.md \
            | tr -d '`' \
            | awk '{print $NF}' \
            | sort -u \
            | while read -r script; do
                if ! grep -qE "\"${script}\"[[:space:]]*:" package.json; then
                  echo "MISSING: $script"
                fi
              done)
          if [ -n "$STALE" ]; then
            echo "$STALE"
            exit 1
          fi
```

These two checks alone catch the majority of doc drift before merge.

## 7. Conventional Commits → CHANGELOG.md

[Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)
gives every commit a machine-readable shape:

```
type(scope)!: subject

[body]

[BREAKING CHANGE: ...]
```

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`,
`build`, `ci`. A `!` after type or a `BREAKING CHANGE:` footer triggers
a major version bump.

### Tool choice

| Tool                | Best for                                                                       | Source                                                                                       |
| ------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| **release-please** (Google) | Repos that are not pure npm packages — language-agnostic, opens a "release PR" you merge | [github.com/googleapis/release-please](https://github.com/googleapis/release-please)         |
| **semantic-release** | Pure-npm packages — fully automated (version bump → CHANGELOG → tag → publish) | [github.com/semantic-release/semantic-release](https://github.com/semantic-release/semantic-release) |

Both auto-generate `CHANGELOG.md` grouped by type
(Features / Bug Fixes / etc.) — no manual maintenance.

### release-please example

A minimal workflow:

```yaml
# .github/workflows/release-please.yml
name: release-please

on:
  push:
    branches: [main]

permissions:
  contents: write
  pull-requests: write

jobs:
  release-please:
    runs-on: ubuntu-latest
    steps:
      - uses: googleapis/release-please-action@v4
        with:
          release-type: node  # or python, rust, go, simple, …
```

release-please opens a PR titled `chore(main): release <version>` with
the updated `CHANGELOG.md` and version bump. Merge it to ship.

## 8. Audit Rubric — Maintenance Coverage

| Check                                                            | Pass condition                                                |
| ---------------------------------------------------------------- | ------------------------------------------------------------- |
| `markdownlint` runs in CI                                         | `.github/workflows/*.yml` contains markdownlint               |
| Vale or equivalent prose linter runs in CI                        | `.github/workflows/*.yml` contains Vale                       |
| Link checker runs in CI                                           | `lychee` or `markdown-link-check`                             |
| `CHANGELOG.md` exists at repo root                                | File exists                                                   |
| CHANGELOG is auto-generated (not hand-maintained)                 | release-please / semantic-release / similar tool wired up     |
| Commits follow Conventional Commits                               | Recent `git log` matches the type-scope-subject shape         |
| `.vale.ini` or `.markdownlint.json` committed                     | Config visible to PR authors                                  |
| Drift checks (dead `@imports`, dead scripts) run in CI            | A job covers them                                             |

## 9. Common Failure Modes

| Failure                                                          | Detection                                                | Fix                                                                |
| ---------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------ |
| CHANGELOG hand-maintained and out of date                         | Last entry > 30 days behind last release                 | Adopt release-please or semantic-release                           |
| Vale rules too strict (PR authors disable them)                   | Frequent `vale-disable` annotations                      | Move stricter rules to `warning` level; keep only `error` for critical |
| markdownlint disabled entirely                                    | No `.markdownlint.json` or `MD013` and friends `false`   | Re-enable with relaxed limits (line length 120, not 80)            |
| Conventional Commits drift (mix of `feat:`, `Add:`, `update`)     | `git log --pretty=%s` shows mixed shapes                 | Add `commitlint` + `husky` to enforce on commit                    |
| Link checker finds many false positives (private URLs)            | CI repeatedly fails on internal links                    | Add `--exclude` patterns for known-private hosts                   |
| No CI gate at all                                                 | `.github/workflows/` has no docs job                     | Add the workflow from §3                                           |
