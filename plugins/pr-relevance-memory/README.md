# pr-relevance-memory plugin

A GitHub Actions reusable workflow that records PR comment resolution signals
into LoreKit whenever a reviewer resolves a thread or a PR is merged.

The `reviewer` and `pr-reviewer` agents read these signals at the start of every
review run to suppress recurring noise patterns and reinforce reliably-resolved
ones — making every review progressively more accurate for your specific codebase.

## How it works

```
PR thread resolved / PR merged
        ↓  (GitHub webhook → this workflow)
LoreKit: reviewer-comment-relevance::suggestion:null-check-guaranteed-upstream
        ↓  (seen 3 times)
Next review run on same repo
        ↓  (Step 0.7 / Step 1.0)
Reviewer drops / downgrades the finding automatically
```

Three resolution outcomes carry signal:

| Outcome | Detection | LoreKit signal |
|---|---|---|
| **Fixed** | Thread resolved, anchor still live, and a fix commit touches the commented line ± 10 rows | `relevant / fixed` |
| **Won't fix** | Author 👎 reacts, or replies "won't fix / by design / n/a" | `not-relevant / wont-fix` |
| **Ignored at merge** | PR merged, thread still open and unresolved, anchor live, no fix, no decline | `weak-not-relevant / ignored-at-merge` |
| **Missed** | A human comments on a changed line the agent did not flag | `hotspot::<path>` `missed` counter |
| **Undecidable** | Anchor gone (`isOutdated`), region edited with no decline, thread already recorded on resolve, or thread state unreadable | **nothing is written** |

That last row is the one that makes the others trustworthy. A directional record needs
corroborated evidence; where the evidence cannot decide, the recorder writes nothing. Silence
costs one signal, while a wrong signal trains the reviewer's suppressor against a finding class
nobody rejected — and it does so for 60 days.

## Installation

### Step 1 — Add the caller workflow to your repo

Copy `templates/pr-relevance-caller.yml` to your repository as:

```
YOUR_REPO/.github/workflows/pr-relevance-memory.yml
```

The caller is ~30 lines. The actual logic lives in `mthines/agent-skills` and
is referenced via `uses: mthines/agent-skills/.github/workflows/reviewer-comment-relevance.yml@main`.
Updates to the logic propagate automatically without touching your caller.

### Step 2 — Add the LoreKit API key secret

In your repository: **Settings → Secrets and variables → Actions → New repository secret**

| Secret name | Value |
|---|---|
| `LOREKIT_API_KEY` | Your LoreKit API key |

Without the secret the workflow runs but skips the write (graceful no-op — it won't break your CI).

### Step 3 — Done

The workflow fires automatically on `pull_request_review_thread: resolved` and
`pull_request: closed` (merged). No further configuration needed.

## What accumulates in LoreKit

Memories are stored under `repo::your-org/your-repo` in the
`reviewer-comment-relevance` bucket with a 60-day TTL, refreshed on each sighting.

| After N resolutions/dismissals | Effect on next review |
|---|---|
| 1–2 × not-relevant | Finding downgraded from `issue`/`suggestion` to `nitpick` |
| ≥ 3 × not-relevant | Finding dropped entirely (logged in Quality Gate) |
| ≥ 2 × relevant | Finding promoted from `nitpick` to `suggestion` (terminal only) |
| ≥ 3 × concordant either direction | Promotion suggestion surfaced — consider adding to `.github/review.yaml` |

## Full documentation

See [`agents/shared/rules/comment-relevance-memory.md`](../../agents/shared/rules/comment-relevance-memory.md)
for the complete schema, read/write pipeline, and promotion rules.
