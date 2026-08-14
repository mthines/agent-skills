# BOOTSTRAP SEED — NOT A REAL BASELINE

This golden set is a **placeholder seed** for the `code-review-retrieval-relevance` L2 suite.
It is **NOT a statistically valid baseline**.
The real corpus is hosted-only (requires LoreKit history with real `origin_pr` + `seen_count` data).
Do not raise the `EVAL_GATE` floor for this suite until the golden set reaches ≥ 50 cases with real outcome-signal labels.

## Ground truth definition

Ground truth for this suite is **defined by the outcome signal**, never by hand-authored relevance labels.
A candidate memory is `surface` when:

- Its `tag` is `loop::reviewer-lessons` or `loop::reviewer-comment-relevance` (the two tags read at Step 1.0 via `mcp__lorekit__memory_list`), making it **list-reachable** within the top-50 per-tag window, OR
- The enriched `mcp__lorekit__memory_search` query at Step 1.2c — constructed from the PR diff's changed symbol names, synthesized intent, and integrations — would surface it.

A candidate memory is `skip` when:

- Its `tag` is outside the Step 1.0 read scope for `pr-reviewer` (e.g. `loop::fix-bug-lessons`), AND
- It is not reachable by the Step 1.2c enriched search for the given diff.

The outcome signal is: `loop::review-outcomes` / `loop::reviewer-comment-relevance` tags + `origin_pr` + `seen_count >= 3` marks a promotion-grade should-fire lesson.
Labels are derived from this signal, NOT from re-running the Step 1.0 / Step 1.2c read being measured.

## What this suite measures

Given a PR diff + a candidate memory (with its `tag`, `origin_pr`, `seen_count`, and gist), does the model — reading the live `## Step 1: Fetch all inputs + load memories` procedure from `agents/pr-reviewer.md` — correctly classify whether the documented Step 1.0 (`mcp__lorekit__memory_list`) + Step 1.2c (`mcp__lorekit__memory_search`, enriched by PR B0) read would surface that memory?

This is the agent-skills half of the LoreKit retrieval-relevance evals roadmap (PR6 code-review domain).

## Methodology: promotion → golden case

When a lesson is promoted via `diagnose`, add a golden case so the fix is locked.
Specifically: when a `loop::reviewer-lessons` or `loop::reviewer-comment-relevance` entry reaches `seen_count >= 3` and is promoted to a permanent guard through the slow tier, record the lesson's trigger context as an input in this JSONL.
Set `expected: "surface"` to lock that the retrieval procedure would fire on the relevant diff.
This makes the behavioral gate self-reinforcing — every promoted lesson grows the golden set.

## Suite metadata

- **Rubric read from:** `agents/pr-reviewer.md`, section `## Step 1: Fetch all inputs + load memories`
- **Choices:** `surface` | `skip`
- **Gate:** report-only until ≥ 50 real-corpus cases (current: 5 bootstrap cases)
- **Real corpus requires:** LoreKit instance with real `reviewer-lessons` + `reviewer-comment-relevance` history
