---
title: pr-reviewer — fetch, workspace, shape, impact graph, and delta triage (Steps 1.1–1.2b)
impact: HIGH
tags:
  - pr-reviewer
  - prepare-review
  - delta-triage
  - fallback
---

# pr-reviewer — fetch, workspace, shape, impact graph, and delta triage (Steps 1.1–1.2b)

**Read when `prepare-review.mjs` did not run or its context lacks a field** — this is the manual fallback contract for every mechanical step from Step 1.1 through *Bind `DEPTH_TIER`*. A change here requires the same change in `prepare-review.mjs`, and the reverse.

## Contents

  - [1.1 Fetch PR data in parallel](#11-fetch-pr-data-in-parallel)
  - [1.1b Materialize the workspace (Phase A)](#11b-materialize-the-workspace-phase-a)
  - [1.2 Cache the patch list — single source of truth for line validity](#12-cache-the-patch-list--single-source-of-truth-for-line-validity)
  - [1.2b Delta triage and depth routing (Phase C)](#12b-delta-triage-and-depth-routing-phase-c)

---

### 1.1 Fetch PR data in parallel

**Mechanical home:** `prepare-review.mjs`'s `prepare()` (Step "fetch") issues the five calls below
concurrently, in one `Promise.all`, binding `context.meta` / `context.headSha` / `context.baseSha` /
`context.reviews` / `context.issueComments`. `node "$AGENT_SUPPORT/pr-reviewer/scripts/prepare-review.mjs"
--pr <ref> --out ctx.json` (never under `--context`) performs this step (and every mechanical step through "Bind `DEPTH_TIER`"
below) in one call. The manual form below is the literal fallback contract — a change to one
requires the same change to the other:

```bash
# A — PR metadata. Step 1.2 binds HEAD_SHA and BASE_SHA from THIS response's headRefOid /
# baseRefOid — never from a second read — so the diff, the head, and the base describe the same
# moment. `baseRefName` is the branch NAME, not a substitute for `baseRefOid`.
PR_VIEW_JSON=$(gh pr view $PR_NUMBER $GH_REPO_FLAG \
  --json title,body,headRefName,baseRefName,headRefOid,baseRefOid,files,author,additions,deletions,changedFiles,state,labels)

# B — Diff
gh pr diff $PR_NUMBER $GH_REPO_FLAG

# C — CI checks
gh pr checks $PR_NUMBER $GH_REPO_FLAG

# D — Prior reviews (non-dismissed)
gh api repos/$OWNER/$REPO/pulls/$PR_NUMBER/reviews \
  --jq '[.[] | select(.state != "DISMISSED") | {user: .user.login, state: .state, body: .body}]'

# E — Issue comments
gh api repos/$OWNER/$REPO/issues/$PR_NUMBER/comments \
  --jq '[.[] | {user: .user.login, body: .body}]'
```

### 1.1b Materialize the workspace (Phase A)

**Mechanical home:** `prepare-review.mjs`'s `materializeWorkspace()`. See
[`agents/pr-reviewer/rules/workspace.md`](./workspace.md) for the full capability
ladder, the disposal rule, and why each rung exists — this step only binds the result:

| `DEPTH_CAPABILITY` | How | What it unlocks |
|---|---|---|
| `checkout` | **rung 0** — `gw checkout --no-hooks <PR>`, else `git worktree add --detach <path> $HEAD_SHA` over the local object store | Everything — consumer tracing, Tier 2 checker receipts, running a covering test |
| `tarball` | `gh api .../tarball/<head>` | Consumer tracing and grep-based rungs; no git history |
| `diff-only` | Nothing materialized | Tier 1 grep only. **Caps `DEPTH_TIER` at `standard`.** |

Also bind `TIER2_CHECKER` (`tsc` / `go vet` / `cargo check` / `pyright` / none) and
`WORKSPACE_INSTALL` (review config `workspace.install`, forced `false` for a fork head in `cross`
relation — a fork's diff must not run through `npm install`).

Bind `WORKDIR_CLEANUP` ∈ `none` / `worktree` / `rm`, and dispose of the workspace on every exit path
by the method it names — `rm -rf` on a `gw` or plain-git worktree deletes uncommitted work or leaves
a stale `.git/worktrees` entry, breaking the repo the review was reviewing:

```bash
trap 'case "$WORKDIR_CLEANUP" in
        none)     : ;;
        worktree) git -C "$WORKDIR" worktree remove --force "$WORKDIR"; rmdir "$WORKTREE_PARENT" ;;
        rm)       rm -rf "$WORKDIR" ;;
      esac' EXIT
```

`gw` is preferred but not required — `git worktree add --detach` reaches the same rung, so its
absence never drops the review to a network clone — and whenever `gw` runs it is always
`--no-hooks`, since a hook running `pnpm install` would both contradict `workspace.install: false`
and execute a fork's install scripts. Announce: `Depth: <DEPTH_CAPABILITY> · Tier 2: <TIER2_CHECKER
or "none"> · Install: <on|off>.` (also `RUN.depth` in the Step 4 payload). **A failed ladder is not a
failed run** — every rung failing sets `DEPTH_CAPABILITY = diff-only` and the review proceeds at
`standard`.

### 1.2 Cache the patch list — single source of truth for line validity

**Mechanical home:** `prepare-review.mjs`'s `fetchFiles()` + `partitionUndiffable()`. See
`agents/pr-reviewer/rules/line-validity.md`. `RESOLVED_REPO` was set in Step 0.

```bash
# --paginate is mandatory: the endpoint pages at 30 files. `sha` is the file's blob SHA at the
# live head — Step 1.2b's divergence fallback compares it against the prior-review tree.
gh api repos/$RESOLVED_REPO/pulls/$PR_NUMBER/files --paginate \
  --jq '.[] | {filename, patch, status, additions, deletions, sha}' > /tmp/pr-files.json
HEAD_SHA=$(jq -r '.headRefOid' <<< "$PR_VIEW_JSON")   # from Step 1.1 command A — never a second read
BASE_SHA=$(jq -r '.baseRefOid' <<< "$PR_VIEW_JSON")   # ditto — an empty read fails quietly, see workspace.md
BASE_REF_NAME=$(jq -r '.baseRefName' <<< "$PR_VIEW_JSON")  # branch name, for `fetch` only, never a diff endpoint
```

Both SHAs are bound here or the pipeline runs blind — see
[`workspace.md`](./workspace.md#the-base-of-the-diff-and-the-empty-merge-base-trap)
for the empty-`BASE_SHA` failure mode. **`HEAD_SHA` is never re-read**: a second `gh pr view` moments
later opens a torn-state window where the diff and the head describe different commits, and
`HEAD_SHA` feeds both Step 4 (review body) and Step 5 (terminal report).

**Partition undiffable paths up front** — GitHub returns `"patch": null` for any added/modified
binary file while still listing it as reviewable:

```bash
jq '[.[] | select(.patch == null) | .filename]' /tmp/pr-files.json > /tmp/pr-undiffable-paths.json
```

A candidate finding about an undiffable path is still worth producing (Step 3.5), marked
`ANCHORLESS-BY-CONSTRUCTION` at birth rather than dying at line-validity as an ordinary casualty.

#### Change-shape classification (all modes)

**Mechanical home:** `classify-shape.mjs`, called internally by `prepare-review.mjs` and bound on
`context.shape`. Manual form — a pure local computation, no API calls:

```bash
# Optional per-repo extension: high_stakes_paths in the review config (review-config.md
# § High-stakes paths) — .agents/review/config.yaml, else the deprecated .github/review.yaml or root .review.yaml.
HS_CFG=".review.yaml"; for c in ".agents/review/config.yaml" ".github/review.yaml"; do [ -f "$c" ] && { HS_CFG="$c"; break; }; done
EXTRA_HS=$(test -f "$HS_CFG" && \
  awk '/^high_stakes_paths:/{f=1;next} /^[^ ]/{f=0} f && /^ *- /{sub(/^ *- */,""); sub(/ *#.*$/,""); gsub(/"/,""); sub(/ +$/,""); if (length($0)) printf " --extra-high-stakes %s", $0}' "$HS_CFG" || true)

# resolve() — portable readlink -f. DEFINED HERE, at its first call site, because shell
# state does not persist between this agent's tool calls. Step 4a re-executes this same
# block verbatim for the renderer; edit the two together.
resolve() {  # portable readlink -f
  [ -e "$1" ] || return 1
  ( cd "$(dirname "$1")" && t=$(basename "$1")
    while [ -L "$t" ]; do d=$(readlink "$t"); cd "$(dirname "$d")" || return 1; t=$(basename "$d"); done
    printf '%s/%s\n' "$(pwd -P)" "$t" )
}
AGENT_MD=$(resolve "${CLAUDE_AGENT_FILE:-$HOME/.claude/agents/pr-reviewer.md}" \
  || resolve "$(agent-skills-root 2>/dev/null)/agents/pr-reviewer.md" || echo "")   # plugin: bin/agent-skills-root
CLASSIFY="$AGENT_SUPPORT/pr-reviewer/scripts/classify-shape.mjs"
[ -n "$AGENT_MD" ] && PR_SHAPE_JSON=$(node "$CLASSIFY" /tmp/pr-files.json $EXTRA_HS)
```

An empty `AGENT_MD` is not fatal here — Step 4a's hard-stop contract still applies when the renderer
needs the value. On any resolution or exit failure, set
`PR_SHAPE_JSON='{"shapes":[],"risky":false,"risky_shapes":[],"high_stakes_files":[],"propagation":false}'`,
announce `Shape classifier unavailable — shape routing degraded to size-only.`, and continue — the
classifier adds depth, it never gates the run. Bind `PR_SHAPES` / `PR_RISKY_SHAPES` /
`PR_HIGH_STAKES_FILES` / `PR_PROPAGATION` from it — these describe the **whole PR** and feed the
correctness finder's shape checklists (Step 2); Step 1.2b re-runs the same script on the **delta**
file list to route incremental depth.

Announce: `Shapes: <PR_SHAPES joined> (risky: <PR_RISKY_SHAPES joined or "none">).`

#### 1.2a Build the impact graph (Phase B)

**Mechanical home:** `build-impact-graph.mjs`, called internally by `prepare-review.mjs` and bound
on `context.impact` / `context.impactSummary`. See
[`agents/pr-reviewer/rules/impact-graph.md`](./impact-graph.md). Manual form:

```bash
IMPACT="$AGENT_SUPPORT/pr-reviewer/scripts/build-impact-graph.mjs"
node "$IMPACT" /tmp/pr-files.json \
  --workdir "$WORKDIR" --base-ref "$BASE_SHA" \
  --repo "$RESOLVED_REPO" --pr "$PR_NUMBER" \
  ${DASH0_EXPOSURE:+--production "$DASH0_EXPOSURE"} > /tmp/pr-impact.json
```

Bind `IMPACT_SYMBOLS` (changed exports, consumers, `signature`/`body`/`removed`), `IMPACT_DEPS`
(resolved dependency deltas + usage sites), `IMPACT_OVERLAPS` (same symbol on another open PR),
`BLAST_RADIUS` (`none`/`low`/`medium`/`high`), and `TRAFFIC_BAND` per symbol
(`symbols[].production.traffic_band`; `unknown` is the expected default) — the Phase C routing
inputs, and what the consumer-impact finder (Step 2) walks. On `--workdir` absent (`diff-only`),
pass `--no-vcs`; on any failure, set the graph empty, announce `Impact graph unavailable —
<reason>; consumer and dependency finders degraded to diff-local.`, and continue — the graph adds
depth, it never gates the run. Announce: `Impact: <N> changed exports · <C> consumers · <D>
dependency deltas · <O> overlaps · blast_radius=<BLAST_RADIUS>.` **Nothing in the graph is a
finding** — it says a caller *exists*, never that it is broken; reporting graph edges as defects is
[forbidden](./impact-graph.md#the-graph-is-a-lead-never-a-verdict).


### 1.2b Delta triage and depth routing (Phase C)

Two halves with different scopes (confusing them leaves a `full` run unrouted):

- **Delta triage** (through *Tier rules* below) — **incremental modes only**, skipped when
  `RUN_MODE == "full"`. `PRIOR_SHA` and `HEAD_SHA` must both be set.
- **Depth routing** (*Bind `DEPTH_TIER`*) — **every mode, always**, including `full` and the
  zero-delta short-circuit. It is what binds the tier the whole review is priced and reported at.

**Mechanical home through *Bind `DEPTH_TIER`*:** `prepare-review.mjs` computes the divergence
pre-check, delta shape, cumulative churn (`delta-triage.mjs`), and `routeDepth()`, binding
`context.routing` (`{tier, triggers, override, sizeExcluded, capApplied, why}`), `context.deltaLines`
(the delta's count when incremental), `context.deltaRoute`, and `context.shape`. The manual contract
below is the fallback.

#### Divergence pre-check — never trust `compare/<PRIOR>...<HEAD>` blind

`compare/PRIOR_SHA...HEAD_SHA` is an authored delta only while history is intact. A rebase or
force-push sweeps in base noise (observed: 300 files on a 1-commit change). Fetch the **summary
fields first, never the full body**:

```bash
COMPARE_META=$(gh api repos/$RESOLVED_REPO/compare/$PRIOR_SHA...$HEAD_SHA \
  --jq '{status, ahead_by, behind_by}')
COMPARE_STATUS=$(jq -r '.status' <<< "$COMPARE_META")
BEHIND_BY=$(jq -r '.behind_by'   <<< "$COMPARE_META")
```

**Intact history** (`COMPARE_STATUS == "ahead"` and `BEHIND_BY == 0`) — fetch the real delta once:

```bash
DELTA_JSON=$(gh api repos/$RESOLVED_REPO/compare/$PRIOR_SHA...$HEAD_SHA \
  --jq '{
    delta_lines: ([.files[] | .additions + .deletions] | add // 0),
    new_files:   ([.files[] | select(.status == "added")] | length),
    files:       [.files[] | {filename, additions, deletions, status, patch}]
  }')
DELTA_LINES=$(jq -r '.delta_lines' <<< "$DELTA_JSON")
NEW_FILES=$(jq -r '.new_files'     <<< "$DELTA_JSON")
jq '.files' <<< "$DELTA_JSON" > /tmp/pr-delta.json
DELTA_SOURCE="compare"
```

A list of ≥ 300 rows (GitHub's cap), with a file absent from `/tmp/pr-files.json`, or over a
range with a merge commit or more commits than listed (250 cap) is untrusted — never filter it.
Recompute from a local checkout: files of `git log --no-merges PRIOR..HEAD --not BASE` plus
each merge's `--remerge-diff`, ∩ the PR's files, then `git diff PRIOR HEAD --` them; else the
blob route below. Churn: same rule (`resolveIntactDelta()` / `resolveChurnLines()`).

**Diverged history** (anything else) — substitute the rebase-immune **blob-SHA authored delta**:

```bash
# /tmp/pr-files.json (Step 1.2) carries head blob SHAs; one tree read at PRIOR_SHA gives the prior ones.
gh api "repos/$RESOLVED_REPO/git/trees/$PRIOR_SHA?recursive=1" \
  --jq '[.tree[] | select(.type == "blob") | {path, sha}]' > /tmp/tree-prior.json

jq -s --slurpfile prior /tmp/tree-prior.json '
  ($prior[0] | map({key: .path, value: .sha}) | from_entries) as $was
  | [ .[] | select(.status == "removed" or ($was[.filename] // "") != .sha) ]' \
  /tmp/pr-files.json > /tmp/pr-delta.json
# A removed file is kept unconditionally — its DELETED blob sha equals its prior-tree sha, so a
# blob-equality test alone would read every deletion as "unchanged".
DELTA_LINES=$(jq '[.[] | .additions + .deletions] | add // 0' /tmp/pr-delta.json)
NEW_FILES=$(jq '[.[] | select(.status == "added")] | length' /tmp/pr-delta.json)
DELTA_SOURCE="blob-diff (compare $COMPARE_STATUS, behind_by $BEHIND_BY)"
```

Per-file counts come from the PR-level patch, so `DELTA_LINES` over-counts toward `full` — the
safe direction. A **zero authored delta** means the push was a
rebase/amend/base-merge with no authored change; take the zero-delta short-circuit below. Passes
are non-deterministic, so a finding on unchanged code later is not a duplicate — **never write
"expect no new findings" into any dispatch**.

If `/tmp/pr-files.json` rows lack `sha`, or the tree read is truncated, upgrade `RUN_MODE = "full"`
and say why — never trust the diverged compare.

#### Delta shape classification

```bash
DELTA_SHAPE_JSON=$(node "$CLASSIFY" /tmp/pr-delta.json $EXTRA_HS)
```

Bind `DELTA_SHAPES`, `DELTA_RISKY_SHAPES`, `HIGH_STAKES_FILES` (`.high_stakes_files`), and
`DELTA_PROPAGATION`. On failure, degrade as Step 1.2 does; an unknown `HIGH_STAKES_FILES` upgrades
to `full` (the safe direction).

#### Cumulative churn since the last full pass

`FULL_REFRESH_DELTA` (150) and `FULL_REFRESH_RUNS` (3) are owned by the scripts, not restated here —
`delta-triage.mjs` and `route-depth.mjs` export them, and `route-depth.mjs`'s self-test asserts both
against `depth-routing.md`'s stated numbers. `prepare-review.mjs` computes `CUM_DELTA_LINES` via
`churnState()` with the same divergence rule as above (a non-`ahead` cumulative compare reads as
**over** the threshold, never guessed) and feeds it into `routeDepth()`. Manual fallback: read the
constants from the scripts and apply `churnState()`'s rule to the `LAST_FULL_SHA` compare.

**Upgrade rules — any one condition forces `RUN_MODE = "full"`:**
- `DELTA_LINES > 100`
- `NEW_FILES > 0`
- `HIGH_STAKES_FILES` is non-empty (auth, payments, migrations, infra, secrets, or a repo-configured
  `high_stakes_paths:` regex — the classifier owns the list)
- `DELTA_PROPAGATION` is true — the delta edits a governing document (`CLAUDE.md`, `AGENTS.md`,
  `.claude/rules/*.md`) alongside other files, since a delta-scoped scan structurally cannot see an
  induced contradiction in an untouched restatement
- `LAST_FULL_SHA` is empty — no full-mode review is detectable
- `CUM_DELTA_LINES > FULL_REFRESH_DELTA` — deep-lens refresh
- `INCR_RUNS_SINCE_FULL >= FULL_REFRESH_RUNS` — deep-lens refresh

**Risky content shapes escalate without upgrading.** When no upgrade rule fired but
`DELTA_RISKY_SHAPES` is non-empty (a concurrency primitive, an API-contract edit, or a schema
statement arrived by **content** rather than by path), set `ESCALATE_IN_INCREMENTAL = true`: the run
stays incremental-priced, but Step 2.4b runs its targeted escalation on the delta findings (cap 3)
and the correctness finder applies the matching shape checklist.

**Zero-delta short-circuit:** if `DELTA_LINES == 0 AND NEW_FILES == 0` (including the blob route's
zero authored delta):
- Set `RUN_MODE = "incremental-quick"`, `REVIEW_DIFF = ""`.
- Announce: `Delta is empty (source: <DELTA_SOURCE>) — skipping inline review, running gate checks only.`
- Skip Step 2 entirely; proceed to Step 1.8 (gate checks), then **Step 2.9c** (thread
  reconciliation — this is exactly the population it exists for), then Step 3 (no inline findings).

**Tier rules (no upgrade triggered, delta non-zero):**
- `DELTA_LINES <= 10`: `RUN_MODE = "incremental-quick"`.
- `11 <= DELTA_LINES <= 100`: keep `RUN_MODE = "incremental"`.

Announce:

```text
Delta: <DELTA_LINES> lines changed, <NEW_FILES> new files (source: <DELTA_SOURCE>).
Shapes: <DELTA_SHAPES joined>; high-stakes files: <count>; escalate-in-incremental: <true|false>.
Deep-lens refresh: <CUM_DELTA_LINES> cumulative lines / <INCR_RUNS_SINCE_FULL> incremental run(s) since last full (${LAST_FULL_SHA:0:7} or "none").
Run mode: <RUN_MODE> (prior SHA: ${PRIOR_SHA:0:7} → current: ${HEAD_SHA:0:7}).
```

Name the refresh trigger when it is what forced `full`, e.g. `Run mode upgraded to full —
deep-lens refresh (3 incremental runs since last full pass).`

**Set `REVIEW_DIFF`:**
- `RUN_MODE == "full"`: full PR diff (Step 1.1 command B); `REVIEW_DIFF_LABEL = "full PR"`.
- `RUN_MODE == "incremental"` / `"incremental-quick"`: delta patches from `/tmp/pr-delta.json`;
  `REVIEW_DIFF_LABEL = "delta since ${PRIOR_SHA:0:7}"`.

`/tmp/pr-files.json` is never replaced in incremental modes — inline comments must land on lines
that exist in the **full PR diff**, since the GitHub API validates positions against the full patch;
Step 3.5 continues to use it unchanged.

**Gate 4** scans `REVIEW_DIFF` (the delta) in incremental modes, not the full PR diff — the only
gate that changes scope between modes.

#### Bind `DEPTH_TIER` (all modes, including `full` and zero-delta)

See [`agents/pr-reviewer/rules/depth-routing.md`](./depth-routing.md) for the five
inputs and the first-match-wins table — **the table's executable home is `route-depth.mjs`'s
`routeDepth()`**; do not reimplement it here. Inputs are bound:

| Input | Bound at |
|---|---|
| `RUN_MODE` and `DELTA_LINES` | this step |
| `PR_HIGH_STAKES_FILES` / `HIGH_STAKES_FILES`, `DELTA_RISKY_SHAPES`, `DELTA_PROPAGATION` | Step 1.2 / this step |
| `BLAST_RADIUS`, `IMPACT_DEPS[].semver_delta` | Step 1.2a |
| `DEPTH_CAPABILITY` | Step 1.1b |
| `INCR_RUNS_SINCE_FULL`, `CUM_DELTA_LINES`, `LAST_FULL_SHA` | Step 0.7 / this step |
| `TRAFFIC_BAND` per changed symbol | Step 1.2a (`unknown` when no telemetry is configured) |
| `THREAD_OVERLAP` | **this step — compute it here, see below** |

`THREAD_OVERLAP` is the one input nothing else in the run produces (`prepare-review.mjs` computes it
via `computeThreadOverlap()` and binds `context.routing`'s input); bind it before reading the table —
the fraction of this delta's hunks that sit on top of existing review conversation:

```text
THREAD_OVERLAP = |{ hunk ∈ DELTA_HUNKS : ∃ t ∈ THREADS, matches(t, hunk) }| / |DELTA_HUNKS|

matches(t, hunk) = t.path == hunk.path
                   ∧ (t.anchor == null ∨ |t.anchor − hunk.anchor| ≤ 5)
t.anchor     = t.line ?? t.original_line          (null on a file-level thread)
THREADS      = open review threads + those resolved since `PRIOR_SHA` (Step 1.0), any author
DELTA_HUNKS  = the RIGHT-side hunks of this run's delta (Step 1.2)
THREAD_OVERLAP = 0 when |DELTA_HUNKS| == 0 or THREADS is empty
```

Three properties this must keep, because getting any wrong silently disables the `quick` override:

1. **Compute it here, not at Step 2.9c** — that step's predicate runs eight steps after the tier is
   bound, so reusing it directly would read a value that does not exist yet.
2. **Threads from any author count** — filtering to this agent's own threads makes the override fire
   on some review-answering pushes and not others.
3. **Read `line ?? original_line`, never `line` alone** — GitHub nulls `line` on an outdated thread,
   which is precisely what a review-answering push produces, so reading `line` alone drives
   `THREAD_OVERLAP` toward 0 on exactly the population the override exists for.

Two caps apply **after** the table, in order: (1) `DEPTH_CAPABILITY == "diff-only"` caps
`DEPTH_TIER` at `standard` — a `deep` review needs a workspace it does not have, announce the cap
when it fires; (2) `--effort high` raises `DEPTH_TIER` to `deep` and sets thoroughness 1 ([`depth-routing.md`](./depth-routing.md#--effort)), subject to cap 1.

Announce: `Depth tier: <DEPTH_TIER> — <the matching rule>; inputs: blast_radius=<BLAST_RADIUS>,
semver_delta=<max of IMPACT_DEPS[].semver_delta or "none">, high_stakes=<count>,
risky_shapes=<joined or "none">, capability=<DEPTH_CAPABILITY>.`

`DEPTH_TIER` and `DEPTH_CAPABILITY` become `RUN.tier` and `RUN.depth` in the Step 4 payload, and the
extra inputs go in `RUN_NOTE`. Nothing else in the review may re-derive the tier.
