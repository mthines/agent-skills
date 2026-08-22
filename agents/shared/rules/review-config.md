---
title: Review config — .github/review.yaml profile, filters, and path instructions
impact: MEDIUM
tags:
  - pr-reviewer
  - configuration
  - profile
---

# Review config

`pr-reviewer` supports per-repo (and per-subtree) configuration via a review config file.
The config surface is deliberately small — one profile knob, one noise-suppressor list, one path-scoped guidance list — so that the most common customizations require minimal YAML authorship.

**Default config location:** the repo-level default config lives at `.github/review.yaml`, keeping the repo root uncluttered.
For back-compat, if `.github/review.yaml` is absent but a legacy root `.review.yaml` exists, the root file is honoured (the root location is **DEPRECATED** but still read — not removed).
Per-subtree overrides are still named `<subtree>/.review.yaml` (the root was the pollution concern, not deep directories).

**Back-compat guarantee:** with no `.github/review.yaml` and no legacy root `.review.yaml` (subtree files may still exist), configuration resolves to `profile: balanced`, which equals today's defaults (per-comment threshold 80, inline placement cap 5 per file on the posted review, no filters, no path instructions).
The config surface itself introduces no behaviour change: with no config file, `pr-reviewer` posts the same inline comments it always did, and the threshold is still 80.

**One deliberate exception, introduced with placement (Step 2.9b):** the Step 3 terminal report has no per-file cap (local output, no posting cost) in either relation, so an absent config now reports *more* findings on a large branch than it used to.
That is a widening, never a suppression — the terminal report prints every finding that clears confidence.
Nothing that clears the confidence threshold is hidden in either relation: the cap governs inline placement on the posted review only, and overflow is deferred to the review body (`rubric-composition.md § Placement (Step 2.9b)`).

---

## Contents

- [Config schema](#config-schema)
- [Profile knob](#profile-knob)
- [Filters](#filters)
- [Path instructions](#path-instructions)
- [Hierarchical discovery](#hierarchical-discovery)
- [Config loading step](#config-loading-step)
- [Integration with per-comment-confidence.md](#integration-with-per-comment-confidencemd)
- [Standards](#standards)
- [What this rule does not do](#what-this-rule-does-not-do)

---

## Config schema

```yaml
# .github/review.yaml  (default location; legacy root .review.yaml still honoured)
# All fields are optional. With no .github/review.yaml AND no legacy root .review.yaml,
# configuration defaults to profile: balanced.

profile: chill | balanced | assertive   # default: balanced

filters:                                 # declarative category suppressors
  - naming-nits
  - defensive-null-checks-in-safe-contexts
  # add more categories — see § Filters below

path_instructions:                       # path-scoped guidance
  - path: "src/migrations/**"
    instruction: "Flag any irreversible schema change without a rollback path."
  - path: "src/billing/**"
    instruction: "Always engage critical lens for money-touching code."
```

---

## Profile knob

`profile` is a single knob that maps to three correlated settings.
`balanced` always equals today's defaults, ensuring back-compat.

| Profile | Generation aggression | Per-comment confidence threshold | Inline placement cap per file |
| --- | --- | --- | --- |
| `chill` | Low — only high-confidence, high-severity findings | 90 | 3 |
| `balanced` | Medium — today's defaults | **80** | **5** |
| `assertive` | High — include lower-confidence and lower-severity findings | 70 | 7 |

The cap column governs **placement only** — how many findings are posted as inline comments per file on the Step 4 review. It applies to every run; `pr-reviewer` runs the identical pipeline and posts in both relations (`rubric-composition.md § Placement (Step 2.9b)`).
It never discards a finding: overflow is deferred to the review body.
The confidence threshold is the only setting that decides whether a finding is reported at all, which is why the Step 3 terminal report (local output, no posting cost) has no cap in any profile.

The `balanced` row in the table is the definition of today's defaults — if any default changes in the agents, update this row to match and bump the config schema version.

`assertive` operationalizes Bugbot's "we turned aggression UP" insight as an explicit opt-in: lower threshold, more inline slots.
Use only in repos with high author trust in automated review (experienced team, high review culture).

`chill` is the inverse: conservative for repos where false positives are especially costly (public APIs, security-sensitive code, solo maintainer projects).

---

## Filters

`filters:` is a declarative list of category names that suppress entire classes of findings before they reach the confidence gate.
This is Diamond's first-class noise-suppressor mechanism — a filter entry drops any finding the agent would have produced in that category, without touching the detection logic.

| Filter name | What it suppresses |
| --- | --- |
| `naming-nits` | Any finding whose sole substance is a name/identifier rename suggestion |
| `defensive-null-checks-in-safe-contexts` | Null-check suggestions in code paths where type narrowing or static analysis guarantees non-null |
| `import-ordering` | Suggestions about import order when the file does not already enforce a convention |
| `trailing-commas` | Trailing comma style suggestions |
| `prefer-const-over-let` | `const`/`let` preference findings where `let` is not mutated |

Teams add their own filter names to this list; `pr-reviewer` treats any unknown filter name as a tag to match against the finding's category annotation.
Unknown filter names do not error — they are simply never matched until a rubric produces a finding tagged with that name.

A finding dropped by a filter is logged:

```
[filter] DROP src/foo.ts:42 — category "naming-nits" suppressed by review config
```

Filters are counted in the Quality Gate summary: `Filter drops: N`.

---

## Path instructions

`path_instructions:` is an ordered list of glob → instruction pairs.
When a finding targets a file matching a glob, the instruction is prepended to that finding's `Evidence` input at the `per-comment-confidence` (2.7) step, giving the confidence skill additional context for scoring.

Path instructions do NOT:
- Change confidence thresholds.
- Override filter suppressions (a filtered finding stays filtered regardless of path instructions).
- Enable new rubrics (use `--with` for that).

```yaml
path_instructions:
  - path: "packages/auth/**"
    instruction: "Treat any missing permission check as a blocker, not a suggestion."
  - path: "*.test.ts"
    instruction: "Flag test assertions that do not actually exercise the behavior described in the test name."
```

---

## Hierarchical discovery

Subtree config files are discovered by traversing **upward** from the changed file toward the repo root, collecting all `<dir>/.review.yaml` files found along the path.
The repo-level default (`.github/review.yaml`, or the legacy root `.review.yaml`) is then prepended as the lowest-precedence base.
This is Bugbot's model: a subtree can tighten (or loosen) rules without affecting the whole repo.

### Merge precedence

The agent resolves a single effective config by merging all discovered files, with **closer-to-the-changed-file winning** on conflict:

```
.github/review.yaml               ← lowest precedence (repo-level default base)
                                     (or legacy ./.review.yaml if .github/review.yaml is absent — DEPRECATED)
<subdir>/.review.yaml             ← overrides the default base for files under <subdir>/
<subdir>/<nested>/.review.yaml    ← overrides both for files under <nested>/
```

Merge rules by field:

| Field | Merge rule |
| --- | --- |
| `profile` | Closer file wins — the most specific `.review.yaml` (or the `.github/review.yaml` base) sets the profile |
| `filters` | **Union** — filters from all files in the hierarchy apply; a closer file cannot un-filter a category from the base |
| `path_instructions` | **Concatenation** — all instructions from all files apply, with closer-file instructions listed first |

Example: if `.github/review.yaml` sets `profile: chill` and `src/payments/.review.yaml` sets `profile: assertive`, then files under `src/payments/` use `assertive` while all other files use `chill`.

### Loading algorithm

For each changed file path `P`:

1. Split `P` into its directory components.
2. Walk upward from the file's directory toward the repo root, collecting each `<dir>/.review.yaml` found.
3. Stop at the repo root (do not cross the `.git` directory boundary).
4. Prepend the repo-level default as the lowest-precedence base: prefer `.github/review.yaml`, else fall back to a legacy root `.review.yaml` (DEPRECATED).
5. Merge the collected configs in precedence order (default base last).
6. Apply the merged config for this file's findings.

Run this once per changed file at the start of Step 1 (change-scope understanding), not per finding.

---

## Config loading step

`pr-reviewer` loads the effective config **before Step 2 (Review)**.
Add this step immediately after Step 1.6 (lens loading), labelled **Step 1.7: Load review config**.

```bash
# Step 1.7 — Load review config
CHANGED_FILES=$(git diff --name-only origin/main...HEAD 2>/dev/null || \
  gh api repos/$REPO/pulls/$PR_NUMBER/files --jq '.[].filename')

declare -A FILE_CONFIGS  # path → effective profile/threshold

for f in $CHANGED_FILES; do
  # Subtree overrides (unchanged): walk up collecting <dir>/.review.yaml
  dir=$(dirname "$f")
  configs=()
  while [[ "$dir" != "." && "$dir" != "/" ]]; do
    [[ -f "$dir/.review.yaml" ]] && configs=("$dir/.review.yaml" "${configs[@]}")
    dir=$(dirname "$dir")
  done
  # Root/default base: prefer .github/review.yaml, else legacy ./.review.yaml (deprecated)
  if [[ -f ".github/review.yaml" ]]; then
    configs=(".github/review.yaml" "${configs[@]}")
  elif [[ -f ".review.yaml" ]]; then
    configs=(".review.yaml" "${configs[@]}")   # deprecated legacy location
  fi
  # configs is now base-first (lowest precedence first) — merge later
  FILE_CONFIGS["$f"]="${configs[*]}"
done

# If no .github/review.yaml AND no legacy root .review.yaml found: defaults to profile: balanced
# (threshold 80, inline cap 5 for pr-reviewer / none for reviewer, no filters, no path instructions)
```

The effective config is consumed by:

- `per-comment-confidence.md` (2.7) — reads the profile's threshold.
- The filter evaluation (**Step 2.3**, early in Step 2, before holistic review) — drops findings in suppressed categories.
- The path-instruction injection at `per-comment-confidence.md` (2.7) — appends instruction to Evidence.

---

## Integration with per-comment-confidence.md

`per-comment-confidence.md` reads the per-comment confidence threshold from the resolved profile:

```
threshold = resolved_profile.per_comment_confidence_threshold
            (default: 80 when no config is present or profile: balanced)
```

The `per_comment_confidence_threshold` override in the review config (previously documented in `per-comment-confidence.md`) is now superseded by the `profile` field.
For backwards compatibility, a bare `per_comment_confidence_threshold: N` without a `profile:` field is honoured as a direct threshold override (equivalent to a custom profile with that threshold and the balanced caps).

---

## Standards

`standards:` is an opt-in list of glob → standards-source entries that feed the
`standards-conformance.md` lens (Step 2.4d).
Each entry supplies additional normative documents or inline rules for files matching its glob.

```yaml
standards:
  - path: "packages/api/**"          # glob the entry applies to
    docs: ["docs/api-guidelines.md", "packages/api/CLAUDE.md"]   # loaded and enforced as standards
    must:                             # inline normative rules (treated as "must:" statements)
      - "Every endpoint validates input with a schema before use."
      - "No raw SQL — use the query builder."
```

### Schema

| Field | Required | Description |
|---|---|---|
| `path` | yes | Glob pattern matching the changed files this entry applies to |
| `docs` | no | List of file paths to load as standards for matching changed files |
| `must` | no | List of inline normative rule strings, each treated as a "must:" statement |

At least one of `docs:` or `must:` must be present.

### Merge rule

`standards:` entries **concatenate** across the discovery hierarchy — identical to
`path_instructions`.
Entries from closer-to-the-changed-file `.review.yaml` files are listed first (higher
precedence).
A closer entry does not suppress a further entry; both apply.

### `path_instructions` vs. `standards` — the key distinction

These two config fields serve different purposes and should not be confused:

**`path_instructions`** is a **confidence nudge**.
It injects a glob-scoped instruction string into a finding's `Evidence` input at Step 2.7
(`per-comment-confidence.md`), giving the confidence scorer additional context.
It does not produce findings of its own; it only influences the scoring of findings that already
exist.

**`standards`** produces **real findings**.
The standards-conformance lens (Step 2.4d) compares the diff against the normative statements
loaded from `standards:` entries (and auto-discovered governing docs), and emits `issue:` /
`suggestion:` findings for clearly violated rules.
Each finding must cite the governing-doc `path:line` as grounding evidence and passes every
downstream quality gate unchanged.

Use `path_instructions` when you want the reviewer to weigh a contextual consideration during
confidence scoring.
Use `standards` when you want the reviewer to enforce a written rule as an explicit finding.

---

## What this rule does not do

- Define how rubrics are authored or loaded — that is `rubric-composition.md`.
- Govern how the review is posted — `pr-reviewer` posts one visible `COMMENT` review at Step 4 unconditionally, with no authorization gate.
- Replace per-run flags — `--no-holistic`, `--no-critical`, `--with` still override on a per-invocation basis and take precedence over the review config's profile settings.
