---
title: Post findings — turn a run's blocking results into PR review threads a convergence loop resolves
impact: HIGH
tags:
  - ui-verify
  - review-loop
  - pull-request
  - review-threads
---

# Post findings

`run --post-findings` writes the run's blocking results to the PR as **file-level review threads**, and its summary lines to the `ui` region of the PR's one verify comment.
A thread is the one shape every fix loop in this repo already consumes: `implement-suggestion` applies it, replies, and resolves it, and `review-loop` counts it toward convergence.
This is how the `review-loop --ui` lane (`review-loop/rules/ui-lane.md`) hands its findings to the loop from a parallel session.
Without the flag, `run` posts no threads; it still posts its `ui` region per [`runner.md § Step 5a`](./runner.md#step-5a-post-the-ui-region).

## Contents

- [What is posted](#what-is-posted)
- [Anchor each thread to a file](#anchor-each-thread-to-a-file)
- [The finding body](#the-finding-body)
- [Dedupe by fingerprint](#dedupe-by-fingerprint)
- [Write calls by access path](#write-calls-by-access-path)
- [The summary lines](#the-summary-lines)
- [Report line](#report-line)

## What is posted

| Result | Posted as a thread |
| --- | --- |
| A spec with `result: fail` | Yes, severity `high` — the happy path the PR promises is broken |
| An adversarial finding rated `critical` or `high` | Yes, at its own severity |
| A `telemetry-verify` finding rated `critical` or `high` (`crash`, `telemetry-error`, `performance`, `missing-signal`, `unlinked`) | Yes, at its own severity |
| An adversarial or telemetry finding rated `medium` or `low` | No — the `ui` region only |
| `skipped`, `inconclusive`, `NOT RUN`, `unconfirmed`, a probe error | No — none is a defect in the PR |

The bar matches the loop's: a thread is a request to change code, so only what a reviewer would block on becomes one.

## Anchor each thread to a file

A file-level thread needs a path from the PR's changed files.
Pick the first that resolves:

1. The file that defines the spec's `**Changed:**` target — search the PR's changed files for the component, route, or handler it names.
2. For a telemetry `missing-signal` finding, the file whose added line emits the signal (its `file:line` is in the finding's evidence).
3. The first changed file `scripts/is-ui-diff.mjs` classifies as UI.
4. The first changed file.

## The finding body

```markdown
<!-- ui-verify:finding id=<fingerprint> head=<head-sha> -->
**ui-verify · <spec fail | adversarial <oracle> | telemetry <kind>> · <severity>**

<one line: what is wrong, as an observable fact>

**Steps:** <numbered steps from the spec or probe>
**Expected:** <the Expected item, or the oracle's expectation>
**Actual:** <what the run observed>
**Evidence:** <uploaded screenshot / recording lines, and the trace or event link>

Fix the code and resolve this thread. If this is not a defect, reply with why and resolve it.
```

The marker line is load-bearing: `implement-suggestion` includes any comment that carries `<!-- ui-verify:finding`, even when the current user posted it (`implement-suggestion/rules/comment-fetching.md` § Carve-out).
Upload a finding's before/after images and its recording before writing the thread, so a reviewer can see them: `Skill("attach-media", "<pr-url> <before.png>#Before <after.png>#After <clip.mp4> --to urls")`, then paste the lines it prints into **Evidence:**.
For a file it reports as `not attached`, keep the local path and add `(local to the ui-verify run)` after it.

## Dedupe by fingerprint

`fingerprint` = the first 8 hex characters of the SHA-1 of the key for its kind.
Every key part is a stable identifier; never hash `Actual` or any other prose the runner writes fresh each run, or the same failure stops matching its own thread.

| Kind | Key |
| --- | --- |
| spec fail | `spec\|<spec id>\|<1-based index of the first failing Expected item>` |
| adversarial | `adversarial\|<the finding's spec>\|<oracle>` — never the `ADV-NN` id, which is numbered per run |
| telemetry | `telemetry\|<kind>\|<service>\|<operation, signal name, or route>` |

Read the PR's review threads (resolved and open) before posting.
When several threads carry the fingerprint, judge only the **newest** one: an older fixed thread must not override a later decline.

| The newest thread with this fingerprint is… | Do |
| --- | --- |
| open | Skip — count it as `deduped` |
| resolved, and a reply in it starts with `Addressed in` (a fix landed) | Post again with the line `Recurred after a resolution — the previous fix did not hold.` after the heading |
| resolved with no `Addressed in` reply (declined or answered) | Skip — count it as `declined`; a decision someone already made is not re-litigated on every head |
| absent | Post |

## Write calls by access path

Resolve the path per [`SKILL.md` Step 0](../SKILL.md#step-0-resolve-your-github-access-path).

| Path | Call per finding |
| --- | --- |
| `gh` | `gh api repos/<owner>/<repo>/pulls/<n>/comments -f body=<body> -f commit_id=<head-sha> -f path=<file> -f subject_type=file` |
| `mcp` | `mcp__github__pull_request_review_write` `method: "create"` once, then `mcp__github__add_comment_to_pending_review` with `subjectType: "FILE"` per finding, then `pull_request_review_write` `method: "submit_pending"` with `event: "COMMENT"` |
| neither | Post nothing; report `posted: failed (no GitHub access path)` |

A failed write is reported verbatim, never retried in a loop and never dropped silently.

## The summary lines

The run's summary lives in the `ui` region of the PR's one verify comment (first line `<!-- verify:report -->`, region `<!-- verify:section=ui -->` … `<!-- /verify:section=ui -->`), written by [`runner.md § Step 5a`](./runner.md#step-5a-post-the-ui-region).
Under this flag the region always posts, and its status lines are the lane's contract:

```markdown
**ui-verify** · head `<head-sha>` · <preview-url> · driver <driver>

- verdict: <green | red | inconclusive> (<pass>/<total> specs)
- adversarial: <the summary line>
- telemetry: <each window's `findings:` line and `[receipt] verdict:`>
- threads: <N> posted, <D> deduped, <X> declined | failed (<reason>)
- finished: <UTC ISO-8601>
```

Write `threads: failed (<reason>)` whenever any thread write failed, so a caller that only reads this region can tell a red run that posted nothing from one with nothing to post.

`head` and `finished` are what a parallel caller polls for: the `ui` region for head `<sha>` with a `finished:` line means the run on that head is done.

## Report line

Print `posted: <N> threads, <D> deduped, <X> declined, summary <comment-url>` once Step 5a has posted the region, or `posted: failed (<reason>)`; `<comment-url>` is the verify comment holding the `ui` region.
