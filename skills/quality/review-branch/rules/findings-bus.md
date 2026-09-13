---
title: The findings bus — what replaces the GitHub review thread
impact: HIGH
tags:
  - review-branch
  - convergence
  - local
---

# The findings bus

[`review-loop`](../../review-loop/SKILL.md) converges on `unresolved_thread_count() == 0`.
The GitHub review thread is not decoration in that loop — it is the **bus**: the durable queue that
carries a finding from the reviewer's context to the applier's context, and the state machine whose
"is it resolved yet" answer is the loop's exit condition.

Remove GitHub and you have not removed a step. You have removed the bus, and you must supply another
one, or the loop has no memory between iterations and no way to know it is done.

This file owns that replacement. It is the **single source of truth** for the record shape, the
lifecycle, and the convergence predicate; the agent writes it and the skill reads it, and neither
restates it.

## Contents

- [Where it lives](#where-it-lives)
- [The record](#the-record)
- [Identity is the fingerprint](#identity-is-the-fingerprint)
- [The lifecycle](#the-lifecycle)
- [Append-only, and why](#append-only-and-why)
- [The convergence predicate](#the-convergence-predicate)
- [The no-green-wash valve](#the-no-green-wash-valve)
- [Worked example](#worked-example)

---

## Where it lives

```text
.agent/{branch}/findings.jsonl
```

One JSON object per line. Same `.agent/{branch}/` directory the `aw` artifacts use, so a branch's
plan, brief, and findings sit together, and the whole thing is disposable with the branch.

It is **scratch state, not a deliverable**: `.agent/` is gitignored in the repos that use it, and
nothing downstream may depend on the file surviving a branch delete. A finding worth keeping past
the branch is worth fixing on the branch.

## The record

```json
{
  "fp": "consumer-impact:contract-break:retryRequest@src/jobs/sync.ts",
  "iteration": 1,
  "state": "open",
  "prefix": "issue",
  "severity": "high",
  "blocking": true,
  "score": 91,
  "verdict": "confirmed",
  "path": "src/jobs/sync.ts",
  "line": 88,
  "title": "Caller still checks `=== null` after the throw",
  "body": "`retryRequest` now throws `RetryExhausted` instead of returning `null`; this caller checks `=== null` and never catches.",
  "fix": "try { … } catch (e) { if (e instanceof RetryExhausted) return markFailed(job); throw e }",
  "evidence": ["src/api/client.ts:214 (throw added)", "src/jobs/sync.ts:88 (null check)"],
  "note": null,
  "sha": "a1b2c3d"
}
```

Every field except `note` is written by the reviewer and is **reviewer-immutable** thereafter: the
loop may append a new record for the same `fp`, but it may never rewrite the reviewer's claim,
score, or severity. That is the same executor-immutable discipline `checks.yaml` uses, and for the
same reason — a loop that can edit the finding it is being graded on will eventually edit it.

`prefix`, `severity`, and `blocking` come from the unchanged gates:
[`per-comment-confidence.md`](../../../../agents/shared/rules/per-comment-confidence.md) for the
threshold and the crosswalk, `Skill("severity", "finding")` for the tier. `score` and `verdict` come
from [`finding-verifier.md`](../../../../agents/shared/rules/finding-verifier.md).

## Identity is the fingerprint

`fp` is built by the **same script** `pr-reviewer` uses, never by hand:

```bash
node agents/pr-reviewer/scripts/fingerprint.mjs build \
  --finder consumer-impact --defect-class contract-break \
  --symbol retryRequest --path src/jobs/sync.ts
```

It exits non-zero on an unknown finder or defect class rather than emitting a key nothing will match.

Fingerprinting by `<finder>:<defect-class>:<symbol>@<path>` rather than by line number is what makes
the bus survive the loop's own edits. Iteration 2 applies a fix, every line below it shifts, and a
line-keyed record would read as a brand-new finding on the next pass — so the loop would rediscover
what it just fixed and never converge. `symbol@path` is stable across exactly the edits the loop
makes.

## The lifecycle

A finding is in exactly one state, and the states map 1:1 onto what a GitHub thread can be:

| State | Thread analogue | Set by | Meaning |
| --- | --- | --- | --- |
| `open` | unresolved thread | reviewer | Raised, not yet acted on |
| `applied` | resolved by a fix | loop | A code change landed that addresses it |
| `declined` | resolved by a reply | loop | Not fixing, **and `note` states why** |
| `deferred` | below-threshold advisory | reviewer | Scored in the near-miss band; advisory only, never applied, never counted open |
| `flagged` | the open human-judgment flag | loop | Real, and the loop can neither apply it nor honestly decline it |

`declined` **requires** a non-empty `note`. A decline with no rationale is indistinguishable from a
finding the loop deleted because it was inconvenient, which is the exact move the no-green-wash rule
exists to prevent. A loop that cannot write the rationale must use `flagged` instead.

`flagged` is the safety valve, and it is a **terminal** state for the run: it keeps the loop from
spinning on something it cannot resolve while keeping the finding loudly visible in the report.

## Append-only, and why

**Never rewrite or delete a line.** A state change appends a new record with the same `fp`, a later
`iteration`, and the new `state`. Current state for an `fp` is the **last line carrying it**.

Three things this buys, each of which was a real loss under a rewrite model:

1. **The reviewer's original claim survives the loop's disposition of it.** You can always read what
   was found before reading what was done about it.
2. **A regression is visible as a shape, not inferred.** `applied` at iteration 2 followed by `open`
   again at iteration 3 on the same `fp` means the fix did not hold. Rewriting in place renders that
   as a single `open` record and loses the fact that anything was tried.
3. **A lost write cannot corrupt earlier state.** Appending is atomic enough for this; a
   read-modify-write over a whole file is not.

## The convergence predicate

```text
open_findings() = the set of fps whose LAST record has state `open`
```

The loop converges when:

```text
open_findings() is empty
  AND no new findings were raised by the latest review pass
  AND the repo's own fast checks are green
```

Exactly the three conjuncts `review-loop` uses, with `flagged` playing the part of the
human-judgment thread and the local fast checks playing the part of CI. `deferred` and `flagged`
records are **not** `open` and never block convergence — but both are reported, and a run that
converges with flags says so in its verdict rather than reporting a clean pass.

## The no-green-wash valve

The one invariant this whole file exists to protect:

> **A finding leaves `open` only through a fix that landed or a rationale that was written.**

Never by deletion, never by a state change with no `note`, never because the cap was reached, and
never because the run wanted to report convergence.

```text
✅ RIGHT — applied, with the commit that did it
{"fp":"correctness:nil-deref:load@src/config/load.ts","iteration":2,"state":"applied","sha":"9f2c1ab"}

✅ RIGHT — declined, with a reason a human can argue with
{"fp":"quality:naming:parseAll@src/parse.ts","iteration":2,"state":"declined",
 "note":"`parseAll` matches the three sibling parsers in this module; renaming one of four is worse than the inconsistency."}

✅ RIGHT — cannot fix, cannot honestly decline: stays visible
{"fp":"correctness:race:flush@src/queue.ts","iteration":3,"state":"flagged",
 "note":"Real, but the fix is a locking change across three modules — out of scope for this loop."}

❌ WRONG — resolved with no rationale
{"fp":"quality:naming:parseAll@src/parse.ts","iteration":2,"state":"declined","note":null}

❌ WRONG — the line deleted from the bus so the count reaches zero
```

The third right-hand example is the valve working. A loop that reports *converged, 1 flagged* is
telling the truth; one that reports *converged* having quietly declined the race is not.

## Worked example

Three iterations over one branch:

```jsonl
{"fp":"correctness:nil-deref:load@src/config/load.ts","iteration":1,"state":"open","prefix":"issue","severity":"high","blocking":true,"score":88,"verdict":"confirmed","path":"src/config/load.ts","line":41,"title":"`load()` dereferences a config that can be undefined","body":"…","fix":"…","evidence":["src/config/load.ts:41"],"note":null,"sha":"a1b2c3d"}
{"fp":"quality:naming:parseAll@src/parse.ts","iteration":1,"state":"open","prefix":"nitpick","severity":"low","blocking":false,"score":71,"verdict":"confirmed","path":"src/parse.ts","line":12,"title":"`parseAll` parses one item","body":"…","fix":null,"evidence":["src/parse.ts:12"],"note":null,"sha":"a1b2c3d"}
{"fp":"correctness:nil-deref:load@src/config/load.ts","iteration":2,"state":"applied","note":"Added an early return on an absent config.","sha":"9f2c1ab"}
{"fp":"quality:naming:parseAll@src/parse.ts","iteration":2,"state":"declined","note":"Matches the three sibling parsers; renaming one of four is worse than the inconsistency.","sha":"9f2c1ab"}
{"fp":"correctness:race:flush@src/queue.ts","iteration":3,"state":"open","prefix":"issue","severity":"high","blocking":true,"score":84,"verdict":"confirmed","path":"src/queue.ts","line":77,"title":"Concurrent `flush()` can double-send","body":"…","fix":null,"evidence":["src/queue.ts:77"],"note":null,"sha":"9f2c1ab"}
{"fp":"correctness:race:flush@src/queue.ts","iteration":3,"state":"flagged","note":"Real, but the fix is a locking change across three modules — out of scope for this loop.","sha":"9f2c1ab"}
```

Reading it: `open_findings()` is empty (the last record for each `fp` is `applied`, `declined`, and
`flagged`), so the loop may converge — and it must report **1 flagged**, naming the race, because a
run that stops with a real unfixed blocker has not produced a clean branch.

Note what iteration 3 shows: the race was **not** present in iteration 1's review. It was raised only
after the iteration-2 fix landed, which is exactly why the loop re-reviews after every apply instead
of reviewing once and working through a list.
