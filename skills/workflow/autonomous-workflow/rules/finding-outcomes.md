---
title: 'Finding outcomes — score each quality finding by what a human did, and record it'
impact: MEDIUM
tags:
  - autonomous-workflow
  - quality
  - lorekit
  - precision
---

# Finding outcomes

Scores each line of `.agent/{branch}/quality-findings.jsonl` ([`quality-pass.md` § Findings file](./quality-pass.md#findings-file--agentbranchquality-findingsjsonl)) after the PR is merged, writes one LoreKit bus event per finding, and summarizes per-type precision.
It is measurement only: nothing reads `eligible` yet, and no gate, verdict, or loop changes on it.
**Why:** [`../references/finding-outcomes.md`](../references/finding-outcomes.md).

```text
✗ Wrong — the quality pass rates its own reuse finding "high confidence" and records it as acted
✓ Right — the outcome comes only from the diff between the PR's opening head and its final head
```

## Outcomes

`scripts/finding-outcomes.mjs` decides each finding from git alone; no model, confidence, or severity is read.

| Outcome | When |
| --- | --- |
| `acted` | a line changed between `--since` (default `head_sha`) and the later ref names `symbol`, or a hunk falls within 3 lines of `line` (mapped through any edits before `--since`) |
| `dismissed` | the path survives (a rename is followed) and neither the symbol nor the lines changed |
| `unknown` | `head_sha`, `--since`, or the later ref is not in the repo; the path was absent at `head_sha` or deleted later; the finding names neither `symbol` nor `line`, or names only a symbol the file lacks at `head_sha`; or the symbol or lines changed between `head_sha` and `--since` |

`unknown` counts toward neither side of precision.

## When it runs — the call contract

Run it once per merged PR, by whoever merges: `atelier`'s Merge stage after a squash-merge, or a person by hand.
Pass the PR's **final head sha** as `--later`, never the squash commit: a squash commit on the base branch also carries other PRs' changes to the same file.
Pass the PR's **opening head** as `--since`: edits between the quality pass and the PR opening (the local `review-loop`, `polish simplify`) are the agent's, not a human's.

```bash
AW_SKILL_DIR="${AW_SKILL_DIR:-$HOME/.claude/skills/autonomous-workflow}"
BRANCH="feat/save-draft"; PR=342; REPO="acme/web"
F=".agent/${BRANCH}/quality-findings.jsonl"
HEAD_SHA=$(gh pr view "$PR" --repo "$REPO" --json headRefOid -q .headRefOid)
# The opening head: the last commit committed at or before the PR was created.
OPENED_SHA=$(gh pr view "$PR" --repo "$REPO" --json createdAt,commits \
  -q '.createdAt as $c | [.commits[] | select(.committedDate <= $c)] | last | .oid')
git fetch -q origin "pull/${PR}/head"
if [ -z "$OPENED_SHA" ] || [ "$OPENED_SHA" = null ]; then
  echo "Degraded: quality finding outcomes — not recorded (opening head not found: PR rebased)"
elif test -s "$F"; then
  node "$AW_SKILL_DIR/scripts/finding-outcomes.mjs" --record --findings "$F" \
    --since "$OPENED_SHA" --later "$HEAD_SHA" --repo "$REPO" --pr "$PR" --model "claude-opus-5-5"
fi
```

| Input | Contract |
| --- | --- |
| `--findings` | the branch's `quality-findings.jsonl`, read before the worktree is removed; a missing or empty file → skip the call, print nothing |
| `--later` | the PR's final head sha; fetch `pull/<n>/head` first so it exists after the branch is deleted |
| `--since` | the PR's opening head; required with `--record`. The query prints `null` when a rebase rewrote every commit date: then skip the call and print `Degraded: quality finding outcomes — not recorded (opening head not found: PR rebased)` — losing one PR's events beats recording the agent's own edits as human ones |
| `--repo`, `--pr` | `owner/name` and the PR number; they key the bus event |
| `--model` | the model id that ran the quality pass; a line's own `model` field wins |
| exit code | 0 whenever classification ran, including a `Degraded:` write; 2 only on a usage or malformed-findings error, which the caller prints as `Degraded: quality finding outcomes — not recorded (<stderr>)` |

1. The call never blocks a merge: run it after the merge, and print any `Degraded:` line it emits as the caller's own.
2. Without `--record`, the script prints the classified JSON and writes nothing — use it to inspect a PR.
3. `--events-from <file>` records an earlier run's printed JSON instead of classifying again; every event must carry the `since` it was classified with, else nothing is recorded and a `Degraded:` line prints.

## The bus event

| Field | Value |
| --- | --- |
| scope | `repo::{owner}/{repo}` |
| key | `quality-finding-outcomes::<pr>:<fp>` — re-recording one PR overwrites, never duplicates |
| tag | `loop::quality-finding-outcomes`, `kind: bus`, `host: aw` (set explicitly; only `loop::<x>-lessons` tags infer them) |
| attributes | `repo`, `pr`, `type`, `outcome`, `model` |
| TTL | 180 days |
| value | JSON: `v`, `repo`, `pr`, `fp`, `type`, `outcome`, `reason`, `model`, `path`, `symbol`, `head_sha`, `later`, `recorded_at` |

No `LOREKIT_API_KEY` (or `LOREKIT_TOKEN`) → `Degraded: quality finding outcomes — not recorded (LOREKIT_API_KEY not set)`, exit 0.

## Precision

Read the events back, then summarize:

```bash
AW_SKILL_DIR="${AW_SKILL_DIR:-$HOME/.claude/skills/autonomous-workflow}"
EVENTS=$(mktemp)
# list reads only LOREKIT_TOKEN and LOREKIT_MCP_URL; map the recorder's LOREKIT_API_KEY onto them.
LOREKIT_TOKEN="${LOREKIT_TOKEN:-$LOREKIT_API_KEY}" \
LOREKIT_MCP_URL="${LOREKIT_MCP_URL:-https://pqokxlhvnosogizsjztg.supabase.co/functions/v1/mcp}" \
  npx --yes @lorekit/cli@1.78.0 list --scope "repo::acme/web" --tags "loop::quality-finding-outcomes" --json > "$EVENTS"
node "$AW_SKILL_DIR/scripts/finding-outcomes.mjs" --precision "$EVENTS"
```

The input is a JSON array of events, or any JSON holding `entries` arrays of LoreKit records whose `value` is an event (`lorekit list --json`, MCP `memory.list`); a finding recorded twice counts once, zero events prints a `0 events read` warning, and `--json` prints rows instead of the table.
Each type prints `acted/(acted+dismissed)`, the precision, and its `unknown` count, and is `eligible` only at precision ≥ 0.6 **and** n ≥ 10 decided events (`PRECISION_THRESHOLD`, `MIN_SAMPLE` in the script).

```text
✗ Wrong — ux:copy at 9/9 is marked eligible: 1.00 precision on nine events
✓ Right — ux:copy 9/9 1.00 insufficient (n<10); reuse 6/10 0.60 eligible
```
