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

**Back-compat & defaults:** with no `.github/review.yaml` and no legacy root `.review.yaml` (subtree files may still exist), configuration resolves to `profile: balanced`. The `medium`-tier confidence bar stays **80** (today's default for a typical finding) and the inline placement cap stays 5 per file, no filters, no path instructions. Severity-aware bars are on by default and fan out around the 80 anchor (high/critical lower, low higher); a flat `per_comment_confidence_threshold` override restores the uniform 80 with no fan-out.
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
- [High-stakes paths](#high-stakes-paths)
- [Standards](#standards)
- [What this rule does not do](#what-this-rule-does-not-do)

---

## Config schema

```yaml
# .github/review.yaml  (default location; legacy root .review.yaml still honoured)
# All fields are optional. With no .github/review.yaml AND no legacy root .review.yaml,
# configuration defaults to profile: balanced.

profile: chill | balanced | assertive   # default: balanced

effort: high                             # repo-wide default for the depth lever — equivalent to
                                         # always passing --effort high: forces DEPTH_TIER = deep,
                                         # enables Tier-2/3 receipts where the toolchain allows,
                                         # and widens diversify-then-vote to N=5. Omit for the
                                         # routed default. `high` is the only accepted value; the
                                         # routed tiers are not settable here, because pinning a
                                         # repo to `quick` would silently cap every review on it.
                                         # See agents/pr-reviewer/rules/depth-routing.md#--effort

severity_thresholds:                     # DEFAULT — values shown are the `balanced` defaults.
  critical: 65                           # The reviewer tiers every finding via
  high: 70                               # Skill("severity","finding") and gates it on the
  medium: 80                             # matching bar. `medium` anchors the profile's
  low: 90                                # historical flat threshold; high/critical get a
                                         # lower bar (surface more), low a higher one.
                                         # A flat per_comment_confidence_threshold: N
                                         # override collapses all tiers back to N.

agent0_fix_links: false                  # the ONLY repo-wide switch for the "Fix with Agent0"
                                         # buttons. They are ON by default, so this key exists
                                         # mainly to turn them off — false is equivalent to always
                                         # passing --no-fix-links, true to always passing
                                         # --fix-links (i.e. a no-op restating the default)
                                         # see agents/shared/rules/agent0-fix-links.md

agent0_environment: production           # which Agent0 host the fix buttons link to —
                                         # production → app.dash0.com, development → app.dash0-dev.com
                                         # (default production). HOST ONLY — it does not gate whether
                                         # the buttons render; see agents/shared/rules/agent0-fix-links.md

agent0_org: dash0-development            # OPTIONAL — which Dash0 organization the fix buttons open
                                         # Agent0 in, appended as &org=<slug>. Omit it (the default)
                                         # and no org param is sent at all, which is correct for
                                         # readers who have exactly one org. Like agent0_environment
                                         # it picks a destination and gates nothing. Must match
                                         # ^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$ — anything else is
                                         # ignored here and rejected by build-agent0-link.mjs

high_stakes_paths:                       # repo-specific critical paths (regex, case-insensitive)
  - "(^|/)ledger(/|$)"                   # EXTENDS the built-in list (auth, payments, migrations,
  - "(^|/)provisioning(/|$)"             # infra, secrets, …) owned by
                                         # agents/pr-reviewer/scripts/classify-shape.mjs — it can
                                         # add paths, never remove built-ins. A delta touching a
                                         # match always upgrades to a full review (§ High-stakes paths).

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
`balanced`'s `medium` tier equals today's default (80); severity fans the other tiers out around it by default.

| Profile | Generation aggression | Confidence bar — critical / high / **medium** / low | Inline placement cap per file |
| --- | --- | --- | --- |
| `chill` | Low — only high-confidence, high-severity findings | 75 / 85 / 90 / 95 | 3 |
| `balanced` | Medium — today's defaults | 65 / 70 / **80** / 90 | **5** |
| `assertive` | High — include lower-confidence and lower-severity findings | 60 / 65 / 70 / 85 | 7 |

The **medium** column is each profile's historical single threshold (`chill` 90, `balanced` **80**, `assertive` 70); severity fans the bar out around it by default. A flat `per_comment_confidence_threshold: N` override collapses all four tiers back to `N` (pre-severity behavior).

The cap column governs **placement only** — how many findings are posted as inline comments per file on the Step 4 review. It applies to every run; `pr-reviewer` runs the identical pipeline and posts in both relations (`rubric-composition.md § Placement (Step 2.9b)`).
It never discards a finding: overflow is deferred to the review body.
The confidence threshold is the only setting that decides whether a finding is reported at all, which is why the Step 3 terminal report (local output, no posting cost) has no cap in any profile.

The `balanced` row in the table is the definition of today's defaults — if any default changes in the agents, update this row to match and bump the config schema version.

`assertive` operationalizes Bugbot's "we turned aggression UP" insight as an explicit opt-in: lower threshold, more inline slots.
Use only in repos with high author trust in automated review (experienced team, high review culture).

`chill` is the inverse: conservative for repos where false positives are especially costly (public APIs, security-sensitive code, solo maintainer projects).

---

## Severity-aware thresholds (default)

`severity_thresholds` refines the single per-comment bar into one bar per severity tier,
and it is **on by default** — the goal is that what the reviewer surfaces is what an
author actually wants to react on.

`pr-reviewer` tiers every finding with `Skill("severity", "finding")` in the same pass as
the confidence rating (never a separate per-finding call — see `severity`'s cost note),
then uses `severity_thresholds[tier]` as the effective threshold in
`per-comment-confidence.md`. The `medium` tier anchors the profile's historical bar
(**80** for `balanced`), so a typical finding is gated exactly as before; `critical` /
`high` get a lower bar so a probable serious bug surfaces even at moderate confidence,
and `low` gets a higher bar so trivia needs near-certainty or is deferred. Set the map
explicitly to tune it, or set a flat `per_comment_confidence_threshold: N` to collapse
all tiers back to the pre-severity uniform bar.

```yaml
severity_thresholds:
  critical: 65
  high: 70
  medium: 80   # equals the balanced flat default
  low: 90
```

Two invariants keep this from re-deriving policy the `severity` skill deliberately does
not own:

- The **numbers live here**, not in the `severity` skill — it emits the tier only.
- The tier also drives the `(blocking)` decoration (`critical` / `high` ⇒ `(blocking)`),
  per `skills/quality/severity/SKILL.md` § Mapping to a reviewer's blocking flag — **except** a
  tier raised only by the Step 2 path floor, which stays non-blocking (see that section).

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
| `agent0_fix_links`, `agent0_environment`, `agent0_org` | **Base only, never subtree-merged** — these govern the whole run (buttons on or off, which Agent0 host, which organization), not one file's findings, so a subtree `.review.yaml` cannot opt a directory in or out, nor point one directory's buttons at a different org. Read from the repo-level base config alone; see § Run-level fields below. |
| `effort` | **Base only, never subtree-merged** — the depth tier is one decision per run, made at Step 1.2b before any file is read, so there is no point in the run at which a subtree's value could apply. Read from the repo-level base config alone. |

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
- `pr-reviewer.md`'s `Fix-with-Agent0 buttons` section (`agents/shared/rules/agent0-fix-links.md`) — reads `agent0_fix_links`, `agent0_environment`, and `agent0_org`, resolved per § Run-level fields below.

### Run-level fields (`agent0_fix_links`, `agent0_environment`, `agent0_org`)

Unlike `profile` / `filters` / `path_instructions`, these three are **not** part of the per-changed-file
walk above: they decide whether "Fix with Agent0" buttons render at all, which Agent0 host they
point at, and which organization they open — a property of the *run*, not of any one file's findings.
Resolve them once, from the repo-level base config only, before Step 0.5.

**Read the file via the GitHub API, never a local path check.** A local `[[ -f ".github/review.yaml" ]]`
assumes the shell's cwd is the reviewed repo's checked-out root. Nothing in this agent's definition
ever establishes that, and dispatch harnesses that clone this repo (for the agent's own definition)
without also cloning the *reviewed* repo — which is the normal case, since Step 1.2 already reads PR
files remotely via `gh api` rather than a local diff — leave that check permanently false. Observed
live: `mthines/agent-skills#153`'s own self-review read this as unset even though the file exists at
that exact repo's root, because the review sub-agent's cwd was never that checkout. Use `$RESOLVED_REPO`
(already resolved for every other `gh api` call in this doc) against the repo's default branch — this
is a repo-wide setting, not something that varies with one PR's diff, so there is no need to pin a ref:

```bash
# Run-level fields — read over the GitHub API, no local file check, no subtree walk, no per-file loop.
# Distinguish "no such file" from "could not read it". With the buttons ON by default,
# `agent0_fix_links: false` is the only thing standing between a repo and a deep link it did not
# ask for, so a swallowed read error would silently discard that opt-out: the config would say off
# and the run would render buttons anyway. A 404 is an *answer* (the file is absent, take the
# defaults); any other failure is not, and must not be read as one.
#
# The signal is the function's EXIT STATUS, never a variable it assigns. The call below is a
# command substitution, so the function runs in a subshell and any global it sets is discarded
# when that subshell exits — a `CONFIG_READ_FAILED=1` inside here would read as 0 at every use
# site, which is the fail-open outcome this whole branch exists to prevent.
# Exit 0 = answered (content on stdout, empty when the file is absent); 2 = unreadable.
# Keep stderr on its OWN channel — never `2>&1`. Folding it into stdout puts any `gh` warning
# emitted on a SUCCESSFUL call inside the JSON, `--jq` then fails, the content comes back empty,
# and an existing config carrying `agent0_fix_links: false` reads as "no config" — the fail-open
# outcome, arriving through the redirect rather than through the missing branch.
fetch_base_config() {  # $1 = path, e.g. ".github/review.yaml"
  local body status err
  err=$(mktemp)
  body=$(gh api "repos/$RESOLVED_REPO/contents/$1" --jq '.content' 2>"$err")
  status=$?
  if [ "$status" -ne 0 ]; then
    case "$(cat "$err")" in
      *"Not Found"*|*404*) rm -f "$err"; return 0 ;;   # absent — the defaults apply
      *) rm -f "$err"; return 2 ;;                     # unreadable — the caller withholds
    esac
  fi
  rm -f "$err"
  printf '%s' "$body" | base64 -d 2>/dev/null || true
}

CONFIG_READ_FAILED=0
BASE_CONFIG_CONTENT=$(fetch_base_config ".github/review.yaml") || CONFIG_READ_FAILED=1
if [ -z "$BASE_CONFIG_CONTENT" ] && [ "$CONFIG_READ_FAILED" -eq 0 ]; then
  # deprecated legacy location
  BASE_CONFIG_CONTENT=$(fetch_base_config ".review.yaml") || CONFIG_READ_FAILED=1
fi

AGENT0_FIX_LINKS="true"           # ON by default — `agent0_fix_links: false` is the only way off
AGENT0_ENVIRONMENT="production"
AGENT0_ORG=""                     # OPTIONAL and empty by default — no `org=` param is sent at all
# An unreadable config is not an absent one: it may have carried the opt-out. Fail SAFE — withhold
# the buttons — because a withheld button is recoverable (re-run, or pass --fix-links) and a deep
# link a repo explicitly declined is not.
[ "$CONFIG_READ_FAILED" -eq 1 ] && AGENT0_FIX_LINKS="false"
if [ -n "$BASE_CONFIG_CONTENT" ]; then
  # Strip a trailing `# comment` and surrounding quotes before comparing — the schema's own
  # documented style (§ Config schema above) puts an inline comment after the value, and an
  # end-of-line-anchored match against the raw line silently reads that as "unset" (found in
  # review of PR #149).
  strip() { sed -E 's/#.*$//; s/^[^:]+:[[:space:]]*//; s/["'"'"']//g; s/[[:space:]]*$//'; }
  # HOST ONLY. `agent0_environment` does not gate whether the buttons render — it used to, and
  # one key carrying both meanings made them unsettable independently (a repo on `development`
  # could not turn the buttons off without also losing its host). An unrecognised or absent value
  # leaves the `production` default in place.
  env=$(grep -E '^agent0_environment:' <<< "$BASE_CONFIG_CONTENT" | strip)
  case "$env" in
    development) AGENT0_ENVIRONMENT="development" ;;
    production)  AGENT0_ENVIRONMENT="production" ;;
  esac
  fl=$(grep -E '^agent0_fix_links:' <<< "$BASE_CONFIG_CONTENT" | strip)
  case "$fl" in
    true)  AGENT0_FIX_LINKS="true" ;;
    false) AGENT0_FIX_LINKS="false" ;;
  esac
  # DESTINATION ONLY, and OPTIONAL. Absent leaves AGENT0_ORG empty, and an empty AGENT0_ORG means
  # the link carries no `org` parameter at all — not `org=`, not a default slug. Validated with the
  # same pattern build-agent0-link.mjs enforces (agent0-fix-links.md § Organization), so a typo'd
  # slug leaves the variable empty here instead of reaching the script as a value that would append
  # a stray query parameter or break the button's href.
  #
  # NOT `strip()`, and the difference is load-bearing. `strip()` cuts at the first `#` unanchored,
  # so `agent0_org: org#123` would resolve to `org` — a valid-looking slug for a DIFFERENT
  # organization that sails through the check below. The two keys above can share `strip()` safely
  # because a mangled value simply fails their `case` and falls through to a safe default; a
  # free-form value has no such backstop — it BECOMES the setting. So `org` gets YAML's own comment
  # rule (a `#` opens a comment only after whitespace), which leaves `org#123` intact to be
  # rejected while still honouring the schema's documented ` # trailing comment` style.
  #
  # Anchoring the cut inside `strip()` itself would fix this key and break a more important one:
  # `agent0_fix_links: false#x` would stop matching `false` and fall through to the default — the
  # opt-out failing OPEN, the one direction this whole block exists to prevent.
  org_strip() { sed -E 's/^[^:]+:[[:space:]]*//; s/[[:space:]]+#.*$//; s/["'"'"']//g; s/[[:space:]]*$//'; }
  org=$(grep -E '^agent0_org:' <<< "$BASE_CONFIG_CONTENT" | org_strip)
  if [[ "$org" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$ ]]; then AGENT0_ORG="$org"; fi
fi
```

**The buttons are on by default and the three keys are independent.** `AGENT0_FIX_LINKS` starts
`true` and only `agent0_fix_links: false` turns it off; `agent0_environment` picks the host and
defaults to `production` (`app.dash0.com`) when absent or unrecognised, and `agent0_org` picks the
organization and is simply absent when unset — neither has any bearing on whether anything renders. So a repo with no review config at all, or one that has never heard of Agent0,
gets buttons deep-linking to `app.dash0.com` — the cost of the default, stated in
`agent0-fix-links.md § Opt-in` rather than left to be discovered, and one line to decline.

Note the `case` rather than a `[ "$fl" = "true" ]` test: `false` and *absent* have to stay
distinguishable, because absent means "take the default" — which is now **on** — and `false` means
"no, really, off". A truthiness check would read every absent key as `false` and quietly restore the
old off-by-default behaviour, with the config, the table above and this paragraph all still claiming
otherwise.
`pr-reviewer.md` combines `AGENT0_FIX_LINKS` with the invocation flags to decide `FIX_LINKS`
(`--no-fix-links` wins, then `--fix-links`, then this value),
and passes `AGENT0_ENVIRONMENT` to `build-agent0-link.mjs` as `--env`, plus a non-empty
`AGENT0_ORG` as `--org` — **on both the Fix-all and
Fix-this call sites** (§ Config loading step above lists both consumers; `agent0-fix-links.md §
Button markup` and `comment-shape.md § Fix-with-Agent0 button` must not be read as excusing the
inline site from passing it — see the note in each). Pass `--org` only when `AGENT0_ORG` is
non-empty; the script treats an empty value as absent either way, but an unquoted `--org $AGENT0_ORG`
with an empty variable would swallow the next argument, so build the flag conditionally
(`${AGENT0_ORG:+--org "$AGENT0_ORG"}`) rather than interpolating it bare.

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

## High-stakes paths

`high_stakes_paths:` is an optional list of case-insensitive regexes naming this repo's critical
code beyond the built-in list — the paths where a small delta must never take the cheap review
path ("authorization", "payment", and whatever this repo's equivalents are).

- The **built-in list lives in one place** — `agents/pr-reviewer/scripts/classify-shape.mjs`,
  derived from its path-shape detectors for `auth` (auth/authz/authorization/authentication/
  oauth/sso/rbac/acl/permissions), `payments` (billing/payments/invoicing/checkout/subscription),
  `schema-migration` (migrations, `schema.*` files), `infra` (infra/infrastructure/terraform/
  helm/k8s/kubernetes, Dockerfiles, `*.tf`), and `secrets` (secrets/credentials/`.env*`) — and
  is matched on token boundaries, so top-level `auth/**` matches and `author/**` does not.
  (`api-contract` paths are deliberately not high-stakes: a contract edit escalates within
  incremental rather than forcing full.)
- Config entries **extend** that list; they can never remove a built-in.
- Effect: any delta file matching either list puts the file in `HIGH_STAKES_FILES`, which forces
  `RUN_MODE = "full"` at Step 1.2b and marks the change `high-stakes-path` for Persona 1's shape
  checklists.
- Merge rule across the discovery hierarchy: **union**, like `filters:`.

```yaml
high_stakes_paths:
  - "(^|/)ledger(/|$)"
  - "packages/tenant-isolation/"
```

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

## Measurable

`measurable:` sets how hard the measurability lens
([`measurability-review.md`](./measurability-review.md), Step 2.4e) presses on a missing signal.
It is a single scalar, not a list, because it configures a bar rather than a scope.

```yaml
measurable: advisory      # strict (default) | advisory
```

| Value | Effect |
|---|---|
| absent, or `strict` | `--strict` is passed to `measurable audit`. A `missing` signal on a path with a **new failure mode** is an `issue:` and counts like any other `issue:`; an `unlinked` signal is an aggregated `suggestion:`. This is the default. |
| `advisory` | The lens still runs and reports, but nothing it emits reaches `FAIL_REASONS`. A `missing` signal is a `suggestion:`; an `unlinked` signal is an aggregated `nitpick:`. Opt down here when a missing signal should be surfaced but never gate a merge. |

Two properties this field deliberately does **not** have:

- **It cannot make `unlinked` blocking.** A signal that exists but maps to no named regression
  detector is never an `issue:` and never blocks, in either level — the `measurable` skill's own
  rule, honoured here rather than re-litigated. Strict only raises it from a `nitpick:` to a
  `suggestion:` so a regression-detector gap carries weight without failing a correct change.
- **It has no reviewer-side self-escalation.** The level is a claim about the repository's release
  bar, so it comes from the default (strict), this field, or an explicit `--measurable-strict` /
  `--measurable-advisory` on the invocation; the reviewer never changes it on its own judgment.

To turn the lens off entirely, pass `--no-measurable` on the invocation. There is deliberately no
`measurable: off`: a repository silently disabling a lens for every reviewer is the shape that makes
a review's silence unreadable, whereas a flag is visible in the run announcement.

---

## What this rule does not do

- Define how rubrics are authored or loaded — that is `rubric-composition.md`.
- Govern how the review is posted — `pr-reviewer` posts one visible `COMMENT` review at Step 4 unconditionally, with no authorization gate.
- Replace per-run flags — `--no-holistic`, `--no-critical`, `--with` still override on a per-invocation basis and take precedence over the review config's profile settings.
