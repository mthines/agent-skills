# Why `aw` stalls on Claude Code for web / mobile

Field-report analysis of the reported symptom: **an `aw` run in Claude Cloud (web or mobile) stalls, produces no output for long stretches, and never terminates until the user interrupts it.**

This is a **reference** — the diagnosis and the record of what was tried. The runtime rules live in the phase files.

---

## Contents

- [Executive summary](#executive-summary)
- [Evidence base](#evidence-base)
- [Root causes](#root-causes)
- [What was fixed, and what was deliberately not](#what-was-fixed-and-what-was-deliberately-not)
- [The rejected design, and why it is recorded](#the-rejected-design-and-why-it-is-recorded)
- [Still open](#still-open)

---

## Executive summary

The stall is **not** a planner→executor handoff defect.
That contract is sound.

It is the workflow assuming a local developer laptop.
Two assumptions are wired into the hot path and are false in the cloud:

| Assumption | Cloud reality | Blast radius |
| ---------- | ------------- | ------------ |
| `gh` CLI exists and is authenticated | **Absent.** GitHub is reachable only via `mcp__github__*` | ~169 `gh` invocations across `autonomous-workflow`, `create-pr`, `review-loop`, `implement-suggestion`, `ci-auto-fix`, and the agents |
| A Bash call may block for 30 minutes | The Bash tool **defaults to 120 s** and caps at 600 s | Every CI watch and poll loop |

The second is the one that produces the silent hang.
It has a subtlety that cost several review rounds to pin down: **`timeout 1800` and `timeout 540` fail for the same reason** if the tool call itself is issued at the default timeout.
The harness kills the call before the inner `timeout` fires, so the documented `exit 124` handling is dead code and the agent sees an opaque timeout with no instruction.
Fixing the number without fixing the *level* changes nothing.

---

## Evidence base

Verified inside a live Claude Cloud session on 2026-08-15:

```bash
which gh   # exit 1 — not installed
which gw   # exit 1 — not installed
```

The Bash tool contract states `timeout` is *"in milliseconds: default 120000, max 600000"*, that *"foreground `sleep` is blocked"*, and *"never use Bash `sleep` to wait for external events."*

**A premise that did not survive contact.** The workflow's v3.19.0 single-context-Full fallback, and a `loop::aw-lessons` lesson, both state that **Claude Code on the web disables the `Task` tool**. In the probed cloud session `Task` **was** available and `pr-reviewer` was dispatched successfully six times. The lesson originated on a different harness that it describes as "a CLI variant without sub-agent support". The claim is harness-variant-specific, not a property of "the web" — do not plan around it without probing. The generalisable form is *a capability absence discovered at Phase 6 instead of Phase 0*; which capability varies.

---

## Root causes

### RC-1 — `gh` is absent and the documented remedy is impossible

[`rules/prerequisites.md`](../rules/prerequisites.md) runs `which gh` at the start of Phase 2 and prescribes **"STOP — install via Homebrew"**. The agent cannot install it and neither can the user, so the documented path is un-actionable. The observed path is improvisation: the agent notices `mcp__github__*`, proceeds, and every one of ~169 call sites becomes an ad-hoc re-derivation with no mapping table. Each failing call is a fresh retry-or-improvise decision. This is the dominant source of "spins without visible progress".

### RC-2 — Waits that exceed the tool ceiling, with "retry the wait" as the recovery

- [`create-pr`](../../../delivery/create-pr/SKILL.md) Step 7 used `timeout 1800`; the tool caps at 600 s, so the expiry path never ran. Step 8's flake path then said to *re-watch* with the same cap — unbounded alternation, no counter.
- [`phase-7-ci-gate.md`](../rules/phase-7-ci-gate.md) Step 1 had **no** bound at all.
- The `implement-suggestion --watch` poll sleeps up to 25 minutes producing nothing.
  Its `INTERVAL=300` also exceeds the 120 s tool default, so the harness killed the call before the loop's own `NO_FEEDBACK` break could fire — the internal bound was dead code.
  In the cloud its `gh api` calls all fail too, so it was *guaranteed* to burn the full interval.
  Now bounded: the call declares `timeout: 600000` and `--interval` is clamped to 540 s.

### RC-3 — `gh pr checks` semantics were not accounted for anywhere

Two facts the rules depended on without stating:

- It **exits non-zero while checks are merely pending** (exit 8), printing them to stdout — so non-zero does not mean failure, and classifying on "was there output" is not decidable.
- It **does not wait for checks that do not exist yet**; with none registered it errors immediately. The deleted `sleep 10` was covering that, unremarked.

### RC-4 — `pr-reviewer` is `Task`-only with no fallback

`review-loop` documents an inline fallback for `implement-suggestion` and **none** for `pr-reviewer`, so on a harness without sub-agent dispatch the loop failed as a mid-Phase-6 tool error the caller had to interpret.

### RC-5 — The dispatcher had no terminal contract

`aw-executor` has an explicit four-point completion contract; `aw` had none, and its Full-tier dispatch ended at `Task(aw-executor)` with no instruction about what to emit. For a sub-agent **the final message is the return value**, so a run could end with nothing — indistinguishable from a hang. This is the direct cause of "doesn't consistently return a response".

---

## What was fixed, and what was deliberately not

**Fixed:**

1. **Every wait bounded at both levels** — inner `timeout` under the cap *and* the explicit `timeout: 600000` tool parameter, at all **nine** sites — including `implement-suggestion`'s poll loop, which the first version of the guard could not see — enforced per-site by L1 check `G22` (proximity-scoped, count pinned; mutation-tested).
2. **Correct `gh pr checks` handling** — a bounded registration poll before watching, and classification by exit code plus literal stderr match rather than output volume.
3. **Phase 7 queries CI state** (`gh pr checks`, no `--watch`) instead of carrying a verdict across the phase boundary.
4. **`review-loop` self-reports a clean skip** when sub-agent dispatch is unavailable, with a `NOT REVIEWED` slot in every caller's report. Deliberately *not* an in-context substitute: `pr-reviewer`'s independence comes from the isolated context, so playing the role would be a self-review wearing a reviewer's label.
5. **`aw` terminal contract** — `AW RUN COMPLETE` with a mandatory `Degraded:` line, in every form including the Micro/Lite collapse.

**Deliberately not built:**

- **A capability probe.** Its premise (no `Task` on the web) was falsified; a probe from depth 1 cannot see a depth-3 refusal; and a probe that gates quality companions fails *open* — a false negative silently skips `pr-reviewer` on every laptop run while everything still appears to work.
- **A `gh` → MCP degradation matrix.** A second source of truth about what each agent needs, guaranteed to drift from the agent definitions. See [Still open](#still-open) for the better idea.
- **A compaction re-anchor.** Never observed; covers only Full tier, since Lite and Micro have no `plan.md`.

---

## The rejected design, and why it is recorded

A first implementation threaded a **shared CI-watch budget** through a state file (`.agent/ci-watch-<pr>.state`) across `create-pr`, `phase-7-ci-gate`, and the `ci-auto-fix` fan-out. It took six adversarial review rounds and was ultimately reverted. Every round after the second found a defect the *previous round's own fix* had introduced, and all were the same shape — one file of a multi-file contract edited while a sibling was not:

| Defect | Shape |
| ------ | ----- |
| A shell variable as the counter | Shell state does not persist between Bash calls |
| The Progress Log as the fallback carrier | It is Full-tier only; `create-pr` also runs standalone and from Micro/Lite |
| `git rev-parse HEAD` as the freshness check | The pushers run in other worktrees; their commits reach the remote without advancing local `HEAD` |
| `observed_sha` written only on success | A spent budget recorded no SHA, so the next reader could not distinguish "spent" from "different commit" and re-spent it |
| One counter for registration and completion waits | Registration retries ate the completion budget; completion retries were later misread as "no CI" |
| Single-writer rule in one file, "write the shared file" in another | Racing subagents could record one of two commits and let a caller skip a watch |

**The lesson, kept because it is more valuable than the mechanism:** the failure was not any single bug but the *shape* — cross-context mutable state coordinated by prose, in files that are edited one at a time. The replacement is stateless: each skill counts its own attempts inside its own invocation, and any phase that needs CI's state **asks CI**. Re-watching costs time; a remembered verdict costs correctness.

The corresponding hard invariant — *watch state is queried, never carried* — is in [`diagnostic-surface.md`](../rules/diagnostic-surface.md) so a future diagnoser does not propose reintroducing it.

---

## Still open

- **A `gh` shim.** The highest-value remaining fix: a shim on `PATH` translating the ~12 `gh` verbs actually used into `mcp__github__*` calls, installed via the `session-start-hook` mechanism. It deletes RC-1 for *every* skill without touching 169 call sites, needs no capability probe, and rolls back by removing one file. This session is itself the argument for it — `/create-pr` had to be hand-substituted at every step, and a dispatched `pr-reviewer` could not post any of its six reviews.
- **A real transcript of a stalled cloud run.** Everything above is mechanism reasoned to and partly verified by probing. No direct observation of the reported stall was ever obtained, and the one premise inherited without checking turned out to be wrong.
