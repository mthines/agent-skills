---
title: Review config — .review.yaml profile, filters, and path instructions
impact: MEDIUM
tags:
  - reviewer
  - pr-reviewer
  - configuration
  - profile
---

# Review config

Both agents support per-repo (and per-subtree) configuration via a `.review.yaml` file.
The config surface is deliberately small — one profile knob, one noise-suppressor list, one path-scoped guidance list — so that the most common customizations require minimal YAML authorship.

**Back-compat guarantee:** an absent `.review.yaml` resolves to `profile: balanced`, which equals today's defaults (per-comment threshold 80, per-file caps 5 for `pr-reviewer` and 10 for `reviewer`, no filters, no path instructions).
No behavior changes without an explicit config file.

---

## Config schema

```yaml
# .review.yaml
# All fields are optional. An absent file defaults to profile: balanced.

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

| Profile | Generation aggression | Per-comment confidence threshold | Per-file cap |
| --- | --- | --- | --- |
| `chill` | Low — only high-confidence, high-severity findings | 90 | 3 (`pr-reviewer`), 5 (`reviewer`) |
| `balanced` | Medium — today's defaults | **80** | **5** (`pr-reviewer`), **10** (`reviewer`) |
| `assertive` | High — include lower-confidence and lower-severity findings | 70 | 7 (`pr-reviewer`), 15 (`reviewer`) |

The `balanced` row in the table is the definition of today's defaults — if any default changes in the agents, update this row to match and bump the config schema version.

`assertive` operationalizes Bugbot's "we turned aggression UP" insight as an explicit opt-in: lower threshold, higher cap.
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

Teams add their own filter names to this list; the agents treat any unknown filter name as a tag to match against the finding's category annotation.
Unknown filter names do not error — they are simply never matched until a rubric produces a finding tagged with that name.

A finding dropped by a filter is logged:

```
[filter] DROP src/foo.ts:42 — category "naming-nits" suppressed by .review.yaml
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

`.review.yaml` files are discovered by traversing **upward** from the changed file to the repo root, collecting all `.review.yaml` files found along the path.
This is Bugbot's model: a subtree can tighten (or loosen) rules without affecting the whole repo.

### Merge precedence

The agent resolves a single effective config by merging all discovered files, with **closer-to-the-changed-file winning** on conflict:

```
<repo-root>/.review.yaml          ← lowest precedence (base)
<subdir>/.review.yaml             ← overrides root for files under <subdir>/
<subdir>/<nested>/.review.yaml    ← overrides both for files under <nested>/
```

Merge rules by field:

| Field | Merge rule |
| --- | --- |
| `profile` | Closer file wins — the most specific `.review.yaml` sets the profile |
| `filters` | **Union** — filters from all files in the hierarchy apply; a closer file cannot un-filter a category from the root |
| `path_instructions` | **Concatenation** — all instructions from all files apply, with closer-file instructions listed first |

Example: if the root `.review.yaml` sets `profile: chill` and `src/payments/.review.yaml` sets `profile: assertive`, then files under `src/payments/` use `assertive` while all other files use `chill`.

### Loading algorithm

For each changed file path `P`:

1. Split `P` into its directory components.
2. Walk upward from the file's directory to the repo root, collecting each `.review.yaml` found.
3. Stop at the repo root (do not cross the `.git` directory boundary).
4. Merge the collected configs in precedence order (root last).
5. Apply the merged config for this file's findings.

Run this once per changed file at the start of Step 1 (change-scope understanding), not per finding.

---

## Config loading step (both agents)

Both agents load the effective config **before Step 2 (Review)**.
Add this step immediately after Step 1.6 (lens loading), labelled **Step 1.7: Load review config**.

```bash
# Step 1.7 — Load review config
CHANGED_FILES=$(git diff --name-only origin/main...HEAD 2>/dev/null || \
  gh api repos/$REPO/pulls/$PR_NUMBER/files --jq '.[].filename')

declare -A FILE_CONFIGS  # path → effective profile/threshold

for f in $CHANGED_FILES; do
  # Walk upward from file's directory and collect .review.yaml files
  dir=$(dirname "$f")
  configs=()
  while [[ "$dir" != "." && "$dir" != "/" ]]; do
    [[ -f "$dir/.review.yaml" ]] && configs=("$dir/.review.yaml" "${configs[@]}")
    dir=$(dirname "$dir")
  done
  [[ -f ".review.yaml" ]] && configs=(".review.yaml" "${configs[@]}")
  # configs is now root-first (lowest precedence first) — merge later
  FILE_CONFIGS["$f"]="${configs[*]}"
done

# If no .review.yaml found anywhere: defaults to profile: balanced
# (threshold 80, per-file cap 5/10, no filters, no path instructions)
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
            (default: 80 when .review.yaml absent or profile: balanced)
```

The `per_comment_confidence_threshold` override in `.review.yaml` (previously documented in `per-comment-confidence.md`) is now superseded by the `profile` field.
For backwards compatibility, a bare `per_comment_confidence_threshold: N` without a `profile:` field is honoured as a direct threshold override (equivalent to a custom profile with that threshold and the balanced caps).

---

## What this rule does not do

- Define how rubrics are authored or loaded — that is `rubric-composition.md`.
- Govern posting authorization — that is `authorization-gate.md`.
- Replace per-run flags — `--no-holistic`, `--no-critical`, `--with` still override on a per-invocation basis and take precedence over `.review.yaml` profile settings.
