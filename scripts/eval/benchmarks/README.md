# A/B benchmark runbook — reviewer-ab.manifest.json

Compares Arm A (single-dispatch `pr-reviewer` agent) against Arm B (`--fanout`
orchestration) on the same set of historical PR reviews, at the SAME reviewed
commit both arms are graded against (D8/D13's `--review-sha` mode).

**This file documents the paid A/B. Do not run the dispatch step (Step 3)
without explicit authorization** — every other step (`pick-review-sha`,
`plan`, `score` against already-collected runs) is either read-only against
GitHub or purely local and filesystem-only, and is safe to run any time.

## Safety contract

- `dash0hq/dash0` is **private and strictly read-only**. Every `gh` call this
  runbook's tooling makes against it is a `GET` (`gh api repos/...`,
  `gh api repos/.../pulls/...`) — never a comment, review, reaction, resolve,
  or any other write. `pick-review-sha` and `thread-outcomes.mjs` are both
  self-tested to contain no GitHub mutation verb in their own source (the
  `--self-test` "Read-only surface" case in each file).
- Every dispatch in the matrix carries `--dry-run --isolated`. `--dry-run`
  means **zero GitHub writes** — `finalize.mjs` refuses to write a
  `write-plan.json` for a historical context without it (D9), and
  `execute-write-plan.mjs` refuses to execute a plan marked `dry_run: true`
  or `historical` before it ever probes `gh` access, proven with a PATH-shim
  `gh` whose log stays empty (`--self-test` in both scripts, and L1 guard
  G80).
- The manifest (`reviewer-ab.manifest.json`) carries only SHAs, PR numbers,
  the repo name, a `class` label, and a `status` — never a title, an excerpt,
  a comment count, or any other dash0 content (L1 guard G65e's allowlist).

## Step-by-step commands

### 1. Pick the reviewed commit per PR (read-only, `dash0hq/dash0`)

```bash
# Dry run — computes and prints every review_sha, writes nothing:
node scripts/eval/ab-review.mjs pick-review-sha \
  --manifest scripts/eval/benchmarks/reviewer-ab.manifest.json

# Persist the computed values into the manifest:
node scripts/eval/ab-review.mjs pick-review-sha \
  --manifest scripts/eval/benchmarks/reviewer-ab.manifest.json --write
```

Each entry's `review_sha` (D12) is the `original_commit_id` of the earliest
root inline review comment by a non-author, verified against the PR's own
commit list (`pulls/{n}/commits`). A PR with no non-author inline comments
(the docs-only / dependency-bump probes) gets `review_sha = head_sha`.

### 2. Build the dispatch matrix (local, no network)

```bash
node scripts/eval/ab-review.mjs plan \
  --manifest scripts/eval/benchmarks/reviewer-ab.manifest.json \
  --worktree "$PWD" \
  --arms A,B \
  --runs 3 \
  --out /path/to/scratch-dir
```

Writes `<out>/matrix.json`: one dispatch entry per (manifest entry with a
valid `review_sha`) x (arm) x (run) — 8+ PRs x 2 arms x 3 runs is 48+
entries. Every entry names the worktree definition by **absolute path**,
`subagent_type: "general-purpose"` — **never** the installed `pr-reviewer`
agent by name (dispatching by name resolves the symlinked-installed copy,
not this worktree's edited one, which is the entire point of an A/B on a
branch that changes the reviewer) — and the exact flags
`--dry-run --isolated --review-sha <40-hex>`.

### 3. Dispatch (the paid step — requires explicit authorization)

For each `matrix.json` entry, the caller (a top-level session holding the
Agent/Task tool — this script never dispatches anything itself) issues one
`general-purpose` sub-agent dispatch with that entry's `prompt`, and records
two artifacts per run under `<runs-dir>/<arm>/<pr-number>/run-<n>/`:

- `inline-comments.json` — the array a `--dry-run` review would have POSTed
  to `/pulls/{n}/reviews` (per `pipeline.md`'s artifact-flow table).
- `dispatch-meta.json` — `{tokens_used, wall_clock_ms, reviewed_sha}`. Write it
  with `node scripts/eval/ab-review.mjs record-meta --matrix <out>/matrix.json
  --index <i> --runs <runs-dir> --tokens <n> --wall-clock-ms <n>`: the
  dispatcher supplies the two figures (only it sees the Agent-tool result) and
  `reviewed_sha` is copied from that matrix entry's own `--review-sha` pin.
  `reviewed_sha` must equal the manifest's `review_sha` for that PR; `score`
  excludes a run whose `reviewed_sha` differs **or is missing**, and reports
  both counts.

### 4. Extract labels per PR (read-only, `dash0hq/dash0`)

```bash
node scripts/eval/thread-outcomes.mjs \
  --repo dash0hq/dash0 --pr <number> \
  --at-sha <that PR's manifest review_sha> \
  --out /path/to/labels-dir/<number>.json
```

`--at-sha` keeps only root comments whose `original_commit_id` is the
reviewed SHA (D13; case-insensitive, a unique >= 7-char prefix resolves, and an
ambiguous or unmatched SHA is an error rather than an empty label set) — a label extracted from a different commit is not a
claim about the diff the arms actually reviewed.

### 5. Score

```bash
node scripts/eval/ab-review.mjs score \
  --manifest scripts/eval/benchmarks/reviewer-ab.manifest.json \
  --runs /path/to/runs-dir \
  --labels /path/to/labels-dir \
  --out /path/to/scores.json
```

Emits, per arm: recall, precision, run-to-run stability (Jaccard), severity
agreement, mean tokens, mean wall-clock, and how many runs were excluded for
a `reviewed_sha` mismatch or a missing `reviewed_sha` — plus the **D1 gate verdict**: `insufficient`
below 8 PRs x 3 runs per arm with matched data, else `pass` when
`B.recall >= A.recall` and `B.precision >= A.precision - 0.05`, else `fail`.

## Rounds 2/3 — the thoroughness sweep

Round 1 (below) compared two **topologies** (single-dispatch vs `--fanout`) at each arm's default
thoroughness. Rounds 2/3 hold the topology fixed and sweep the **continuous** knob
(`agents/pr-reviewer/rules/depth-routing.md § Thoroughness budget`) to draw a recall-vs-wall-clock
curve instead of a two-point comparison.

`plan`'s new `--thoroughness <0..1|default>` flag is the harness's per-arm hook: it appends
`--thoroughness <n>` to every dispatch in that matrix (omit it, or pass the literal `default`, to
reproduce round 1's flags exactly — each PR routes its own tier default, unchanged). One `plan`
invocation is one sweep point; run the full plan → dispatch → extract-labels → score cycle **three
times**, once per point, against the **same** manifest and the **same** arm(s):

```bash
for t in 0.3 default 1.0; do
  node scripts/eval/ab-review.mjs plan \
    --manifest scripts/eval/benchmarks/reviewer-ab.manifest.json \
    --worktree "$PWD" --arms A --runs 3 --thoroughness "$t" \
    --out "/path/to/scratch-dir/t-$t"
done
```

Score each point's `matrix.json` independently (Step 3–5 above, one `runs-dir`/`scores.json` per
`t`), then plot `t` on the x-axis against each score file's `mean_wall_clock` and `recall` — three
points is enough to see whether the curve is monotone (thoroughness buys recall at a wall-clock
cost) or flat past a breakpoint (the budget's own breakpoints, § Thoroughness budget, predict
roughly where it should bend: `t=0.3` sits below the `0.4` parallel-topology breakpoint — in-context,
cheap, `votes=1` — while `t=1.0` is the ceiling on every lever at once).

## Per-arm cost table (measured, PR #205)

| Arm | Runs | Mean tokens | Mean wall-clock | Recall (pre-`--review-sha`, stale labels) |
| --- | --- | --- | --- | --- |
| A (single-dispatch) | 2 | 242,859 | 978 s | 0.1 |
| B (`--fanout`, no worker preamble) | 2 | 251,379 | 1,122 s | 0.0 |
| C (`--fanout`, in-repo cwd, 16 agents) | 1 | 2,805,217 (16 agents, each ~110k+ base) | 717 s | missed a finding A/B found |

The recall figures above are an artifact of grading against labels from
threads already fixed by the head the arms reviewed — this is exactly the
problem `--review-sha` (Step 1 + Step 4's `--at-sha`) exists to solve, and
this runbook's arms are expected to score meaningfully higher once graded
at the reviewed commit.

## Base overhead — what is and is not controllable

Arm C's 2,805,217 mean tokens is dominated by what the harness auto-loads
per sub-agent (~110k tokens each), not by the dispatch prompt itself:

- The repo `CLAUDE.md` is 160,590 bytes, about 40k tokens per sub-agent —
  **not controllable from this script**. The harness auto-loads `CLAUDE.md`
  by the session's cwd; this is harness behaviour, not something a prompt or
  a flag on this dispatch can turn off from inside the repo.
- The rest is the global rules/memory, the skill and agent listings, and
  tool schemas — likewise harness-loaded, not prompt-controllable.
- **Controllable:** the worker preamble (`--fanout`'s Worker preamble
  section) — absolute paths, an explicit read-list, no read of
  `agents/pr-reviewer.md`, no `Skill()` calls, write-to-path/return-path-only
  — removes redundant re-derivation inside each worker's own dispatch.

### Launch configurations that remove `CLAUDE.md` from the bill entirely

- **Neutral cwd** — dispatch from a working directory outside this repo
  (e.g., a scratch directory), passing the worktree only as an absolute path
  argument in the prompt. The harness never auto-loads a `CLAUDE.md` it has
  no cwd reason to load. This is the simplest fix and removes the ~40k
  tokens/sub-agent overhead from every arm identically.
- **`claude --bare --add-dir <worktree>`** — skips `CLAUDE.md` auto-discovery
  entirely; requires `ANTHROPIC_API_KEY` to be set (not set in this
  environment as of plan time — verify before relying on this option).
- **`--strict-mcp-config`** — pairs with an explicit `--mcp-config` /
  `--agents <json>` to avoid picking up any ambient MCP server config that
  might itself trigger extra tool-schema loading (verified available in
  `claude --help`, v2.1.280).

### No-op calibration dispatch

Before trusting any cost delta between arms, run one **no-op** dispatch per
launch configuration under test — a `general-purpose` agent given a prompt
that does nothing but immediately report back — and record its
`dispatch-meta.json` tokens. That number is the launch configuration's own
floor; subtract it from a real arm's mean before comparing configurations,
since otherwise a cheaper launch configuration looks like a cheaper REVIEW
when it is really just a cheaper harness.

### The CLAUDE.md-slimming decision (D10)

This PR does **not** slim the repo `CLAUDE.md` — the open restructure stack
(#207–#209) is already rewriting it, so doing so here would collide. The
neutral-cwd launch configuration above removes the overhead from the A/B
without touching `CLAUDE.md` at all, and in production a `pr-reviewer`
dispatch (via Agent0, or via a cross-repo review) never has this repo as its
cwd in the first place, so the overhead measured here does not describe a
real review's cost.

## Arm dispatch rule

Every arm dispatch — Arm A and every worker Arm B fans out — runs as a
**general-purpose** agent that reads the worktree's own copy of the relevant
file by **absolute path** (`<worktree>/agents/pr-reviewer.md` for Arm A,
`<worktree>/skills/quality/pr-review/SKILL.md` for Arm B), never as the
installed `pr-reviewer` agent by name and never via `Skill("pr-review", ...)`
— both of those resolve the symlinked-installed copy outside this worktree,
which defeats the entire point of an A/B measuring THIS branch's changes.
