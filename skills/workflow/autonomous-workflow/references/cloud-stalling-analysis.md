# Why `aw` stalls on Claude Code for web / mobile

Field-report analysis of the reported symptom: **an `aw` run in Claude Cloud (web or mobile) stalls, produces no output for long stretches, and never terminates until the user interrupts it.**

This document is the diagnosis and the proposed fix set.
It is a **reference**, not a runtime rule — nothing here changes behavior until the fixes in [Remediation](#remediation) land in the phase rules and agent templates.

---

## Contents

- [Executive summary](#executive-summary)
- [Evidence base](#evidence-base)
- [Root causes](#root-causes)
- [Why it is intermittent](#why-it-is-intermittent)
- [Remediation](#remediation)
- [Non-causes ruled out](#non-causes-ruled-out)

---

## Executive summary

The stall is **not** primarily a planner→executor handoff defect.
The handoff itself is well specified and has a documented single-context fallback (v3.19.0).

The stall is caused by **the workflow assuming a local developer laptop, and Claude Cloud not being one**.
Three environment assumptions are wired deep into the hot path and are all false in the cloud:

| Assumption | Cloud reality | Blast radius |
| ---------- | ------------- | ------------ |
| `gh` CLI exists and is authenticated | **Absent.** GitHub access is via `mcp__github__*` tools only | 169 `gh` invocations across `autonomous-workflow`, `create-pr`, `review-loop`, `implement-suggestion`, `ci-auto-fix`, and the agents |
| Sub-agent dispatch (`Task`) is available at any nesting depth | Disabled entirely, or allowed only at depth 1 | 19 `Task(subagent_type=…)` sites, several with **no** documented non-`Task` fallback |
| A Bash call may block for 30 minutes | Bash tool caps at **10 minutes** (600 000 ms); default 2 minutes | Every CI watch and every poll loop |

Each false assumption independently produces a stall, and the workflow has **no capability probe** that would catch any of them before Phase 6 — the phase where they all detonate at once.

The single highest-leverage fix is a **Phase −1 environment-capability probe** whose result is recorded in `plan.md` and consulted by every downstream `gh` / `Task` / blocking-wait dependency, replacing today's discover-at-call-time-and-improvise behavior.

---

## Evidence base

Verified inside a live Claude Cloud session on 2026-08-15:

```bash
which gh   # exit 1 — not installed
which gw   # exit 1 — not installed
```

The harness's own Bash tool contract states `timeout` is *"in milliseconds: default 120000, max 600000"* and that *"foreground `sleep` is blocked"* with *"never use Bash `sleep` to wait for external events."*

A `loop::aw-lessons` lesson already records the `Task`-absence failure **twice** and is marked `status: structural` (promotion-eligible at `seen_count >= 3`):

> On AI-2482 (dash0/dash0 PR #17107), the aw-executor's Phase 6.5 `review-loop` invocation failed because the `Task` tool for sub-agent dispatch was not available in that execution context. […] Earliest phase this should be caught: **Phase 0 / environment-detection, before Phase 6**.

That lesson's own recommendation is the fix proposed below.
It has been sitting in the fast tier without being promoted.

---

## Root causes

### RC-1 — The prerequisite check runs too late, checks too little, and prescribes an impossible remedy

[`rules/prerequisites.md`](../rules/prerequisites.md) runs `which gh` at **the start of Phase 2** and prescribes **"STOP — install via Homebrew or download"** when it fails.

Three problems, in ascending severity:

1. **Too late.** Phase 2 is after validation and planning. The run has already spent its most expensive phase.
2. **Impossible remedy.** The agent cannot install `gh` in the cloud sandbox, and the user cannot either.
   A hard-stop is the *documented* path; it is not the *observed* one.
3. **The observed path is improvisation.** Facing an un-actionable stop, the agent notices `mcp__github__*` tools are present, reasons that `gh` is not truly required, and proceeds.
   From that point every one of the **169 `gh` call sites** becomes an ad-hoc re-derivation into an MCP equivalent, mid-flight, with no mapping table and no budget.
   Each failing `gh` call is a fresh retry-or-improvise decision. This is the dominant source of the "spins without visible progress" symptom.

`Task` availability — which the entire Full-tier routing branches on — is **not probed at all**.

### RC-2 — `Task` availability is detected at the dispatcher but depended on five phases downstream

[`templates/aw.agent.md`](../templates/aw.agent.md) handles `Task` absence correctly *for routing*: it switches to single-context Full and preserves `plan.md` + the `confidence(plan)` gate.

But the detection result is **never propagated**.
It is not written to `plan.md`, not passed to the executor role, and not consulted by any companion.
Meanwhile the deepest `Task` dependencies live in Phase 6/7:

| Dependency | Dispatch form | Non-`Task` fallback documented? |
| ---------- | ------------- | ------------------------------- |
| `pr-reviewer` (via `review-loop` Step 1A) | `Task` only | **No** |
| `feature-pr-verifier` (Phase 7 Auto Verify) | `Task` only | **No** |
| `aw-tester` (Phase 4 cold pass, Phase 7 rehearsal) | `Task` only | Self-skip only |
| `ci-auto-fix` fan-out (Phase 7) | `Task` only | **No** |
| `create-pr` Step 6.7 background watch loop | `Task` only | **No** |
| `create-pr` Step 8 CI-log triage | `Task` only | **No** |
| `implement-suggestion` (via `review-loop` Step 1B) | `Skill()` | Yes — inline worker fallback |

[`review-loop/SKILL.md`](../../../quality/review-loop/SKILL.md) documents an inline fallback for `implement-suggestion` and **explicitly none** for `pr-reviewer`.
So `aw` correctly detects "no `Task`" at intake, runs single-context Full successfully through Phase 5, then walks into Phase 6 → `create-pr` → `review-loop` → `Task(pr-reviewer)` and hits the wall it already knew about.

**There is a second, subtler form of this.**
Even when `Task` *is* available, the Full path is `aw` (sub-agent) → `aw-executor` (sub-agent, depth 2) → `Skill("review-loop")` → `Task(pr-reviewer)` (**depth 3**).
Harnesses commonly permit depth 1 only.
So the failure appears *only* in Full tier, *only* at Phase 6, and *only* when dispatched through `aw` — which is precisely the intermittency the user describes.

### RC-3 — Blocking waits that structurally exceed the tool timeout, with "retry the wait" as the documented recovery

Three separate offenders:

**(a) Phase 7 has no timeout at all.**
[`rules/phase-7-ci-gate.md`](../rules/phase-7-ci-gate.md) line 52:

```bash
gh pr checks <pr-number> --watch     # unbounded
```

[`create-pr`](../../../delivery/create-pr/SKILL.md) wraps the same command in `timeout 1800`; Phase 7 does not.
The two surfaces disagree.

**(b) `timeout 1800` is unreachable.**
30 minutes exceeds the Bash tool's 600 000 ms ceiling by 3×.
The tool kills the call first, so the `timeout`'s own expiry handling (`exit 124` → report and escalate) **never runs**.
Instead the agent sees an opaque tool timeout — and `create-pr` Step 8's flake path explicitly instructs it to *"re-watch with `timeout 1800 gh pr checks --watch`"*.
That is an unbounded alternation between tool-timeout and re-watch, with no counter.

**(c) The watch-mode poll loop sleeps for 25 minutes producing nothing.**
[`implement-suggestion/rules/watch-mode.md`](../../implement-suggestion/rules/watch-mode.md) polls `sleep 30` inside a `while` loop up to `INTERVAL=300`s, for up to 5 iterations.
In the cloud the `gh api` calls inside that loop all fail, so `NEW`/`NEW_REVIEWS`/`NEW_ISSUE` evaluate to `0` and the loop **always** burns the full interval and **always** returns `NO_FEEDBACK`.
Worst case: 25 minutes of silent sleeping, guaranteed to accomplish nothing.
The harness guidance for this environment forbids exactly this pattern; the skill predates it.

### RC-4 — The composite cost of the delivery tail is uncapped

> **Correction.** An earlier draft of this section called the two `review-loop` passes redundant.
> They are not.
> [`phase-7-ci-gate.md`](../rules/phase-7-ci-gate.md) documents the rationale explicitly: Phase 6 reviews the pre-CI diff, Phase 7 reviews after CI is green *and after `ci-auto-fix` may have pushed further commits*.
> They review **different diffs at different lifecycle points**, and collapsing them would leave `ci-auto-fix` commits unreviewed.
> The real defect is that nobody caps the **composite**, and that in a degraded environment both passes fail identically.

Phase 6 and Phase 7 each invoke the full review convergence, and each watch CI:

```
Phase 6 → create-pr
            ├─ Step 6.5  review-loop            (cap 5 iterations)
            ├─ Step 6.7  implement-suggestion --watch   (5 iters × 5 min, background)
            └─ Step 7    gh pr checks --watch   (nominal 30 min)
Phase 7   ├─ Step 1     gh pr checks --watch    (unbounded)  ← second CI watch
          ├─ Auto Verify  feature-pr-verifier
          └─ Auto Review  review-loop           (cap 5)      ← second review loop
```

Each `review-loop` iteration is itself `pr-reviewer` + a full 7-phase `implement-suggestion` + `polish simplify`.
The composite worst case is **10 review iterations and two CI watches after the code is already written**.

[`phase-6-pr-creation.md`](../rules/phase-6-pr-creation.md) states *"One `review-loop` invocation per PR creation — the loop has its own cap"*, but that rule is scoped to `create-pr`; Phase 7's second invocation is outside its jurisdiction and no rule bounds the sum.

The **CI watch**, unlike the review passes, genuinely is uncoordinated duplication: `create-pr` Step 7 and Phase 7 Step 1 watch the same checks on the same PR with no shared budget and no record that the other ran.

On a laptop the review cost is merely slow, and is buying real coverage.
In the cloud, where every underlying `gh` call fails, it is 10 iterations of failure-and-improvise buying nothing.

### RC-5 — The dispatcher has no terminal contract

This is the direct cause of *"it doesn't always consistently return a response."*

[`aw-executor`](../templates/aw-executor.agent.md) has an explicit four-point completion contract (walkthrough exists, PR open, walkthrough shown inline, CI gate run at least once).

[`aw`](../templates/aw.agent.md) has **none**.
Its Full-tier dispatch snippet ends at `Task(subagent_type="aw-executor", …)` with no instruction about what to emit afterward, and its Hard rules never mention a final report.
For a sub-agent, **the final text is the return value** — so a dispatcher that finishes routing without emitting a summary returns the executor's raw trailing output, or nothing at all.

### RC-6 — Single-context Full has no compaction-survival anchor

The web fallback runs Phases 0–7 in one window: planner role, executor role, and every companion, against ~8 900 lines of on-demand rule files.

That window will compact mid-run on any real task.
Nothing instructs the agent to re-anchor after compaction on `plan.md`'s Progress Log or `checks.yaml` statuses to recover its phase position.
A compacted agent that has lost its place re-enters phases it already completed — the classic non-terminating shape.

The artifacts needed to recover exist. The instruction to use them for recovery does not.

### RC-7 — An unsatisfiable completion gate with no bounded give-up

The executor's handoff completes only when *"the draft PR is open and linked to the branch."*
With `gh` absent and no sanctioned MCP path, that condition is **unreachable**.

The counterweight is prose — *"Stop and ask when blocked"* — not a counter.
An unreachable gate plus an uncounted stop condition is an unbounded retry loop by construction.

---

## Why it is intermittent

The user reports "sometimes." The causes above predict exactly that distribution:

| Tier | Reaches Phase 6/7? | Uses nested `Task`? | Expected outcome |
| ---- | ------------------ | ------------------- | ---------------- |
| **Micro** | Yes, but no review-loop, no verifier | No | Usually completes; may stall at CI watch (RC-3) |
| **Lite** | Yes, `create-pr` runs the full loop | Depth 2 | Frequently stalls at Phase 6 |
| **Full via `aw`** | Yes, both loops, both watches | **Depth 3** | Nearly always stalls |
| **Full via direct `aw-planner`/`aw-executor`** | Yes | Depth 2 | Stalls less often than via `aw` |

Runs that finish quickly are the ones that never reach Phase 6, or that hit a repo with no CI configured (Phase 7 Step 1's *"No checks at all → treat as success"* short-circuit).
That is why the same skill "works sometimes" — the failure lives in the delivery tail, not the planning head.

---

## Remediation

Ordered by leverage. R1 alone removes most of the symptom.

### R1 — Add a Phase −1 Environment Capability Probe (highest leverage)

Run **once**, before Phase 0, in `aw` and in both specialist agents.
Record the result in `plan.md` frontmatter so it survives the handoff **and** compaction.

```yaml
capabilities:
  subagent_dispatch: false     # Task tool present and usable at this nesting depth
  gh_cli: false                # which gh
  github_mcp: true             # mcp__github__* tools present
  max_bash_block_seconds: 600  # harness tool ceiling
  probed_at: 2026-08-15T09:14:00Z
```

Every downstream `gh` / `Task` / blocking-wait site reads this block instead of discovering the limitation at call time.
This is the fix the structural `aw-lessons` lesson already asks for.

### R2 — Publish a capability→degradation matrix

One table, one home, referenced by every phase rule.
Critically, it must distinguish the two `Task`-absence responses — a distinction the LoreKit lesson already articulates and that no rule file currently encodes:

| Blocked dependency | Degraded path when `subagent_dispatch: false` |
| ------------------ | --------------------------------------------- |
| `aw-planner` / `aw-executor` | Single-context Full (already specified, v3.19.0) |
| `aw-tester`, `ci-auto-fix`, CI-log triage | **Play the role in-context** — their procedures are mechanical Bash+Read recipes |
| `pr-reviewer`, `feature-pr-verifier` | **Skip and log a deviation** — these depend on the isolated fresh context for their independence guarantee |

And for `gh_cli: false, github_mcp: true`, a `gh` → `mcp__github__*` mapping for the ~12 verbs actually used (`pr create`, `pr view`, `pr checks`, `run view`, `run rerun`, `api …`).
Without the mapping the agent re-derives it 169 times.

### R3 — Make every wait bounded, and make expiry terminal

1. Set the CI-watch budget to a value **below** the harness ceiling — `timeout 540` (9 min), not `1800`.
2. Apply it in Phase 7 too, which currently has no bound at all.
3. Change the documented recovery from *re-watch* to **report-and-escalate**. One watch attempt per PR; on expiry, print the pending checks and hand control back.
4. Delete the `sleep`-poll from `watch-mode.md` for cloud environments — when `capabilities.subagent_dispatch` is false or `gh_cli` is false, the watch loop cannot work and must self-skip with a logged line rather than sleep through five intervals.

### R4 — Cap the composite, deduplicate only the CI watch

**Do not** collapse the two `review-loop` passes — they review different diffs (see RC-4).
Instead:

1. **Deduplicate the CI watch only.** Phase 7 Step 1 becomes a no-op when `create-pr` Step 7 already drove the same checks to a terminal state, recorded in the Progress Log.
2. **Give Phase 7's pass a smaller cap.** It reviews a delta (post-CI commits), not the whole PR, so `--cap 2` is proportionate where Phase 6's `--cap 5` is not.
3. **Skip Phase 7's pass when the delta is empty** — if `ci-auto-fix` pushed nothing between Phase 6's convergence and CI green, there is no new diff to review. This is a mechanical check (`git rev-parse` comparison), not a judgment call, and it preserves the coverage the second pass exists for.

### R5 — Give `aw` an explicit terminal contract

Mirror the executor's four-point contract.
`aw` must emit a final block in **every** exit path — success, degraded, and blocked:

```
AW RUN COMPLETE
- Tier: [Micro|Lite|Full]
- Path: [split | single-context Full | single-pass]
- Capabilities: [any degraded path taken]
- Delivered: [PR URL | branch | artifact paths]
- Skipped: [companions skipped, with reason]
- Needs you: [blockers, or "nothing"]
```

An `aw` run that ends without this block is a defect, not a variation.

### R6 — Add a compaction re-anchor instruction to single-context Full

One paragraph in [`templates/aw.agent.md`](../templates/aw.agent.md):
on resuming after compaction, **before any other action**, read `.agent/{branch}/plan.md`'s Progress Log and `checks.yaml` statuses to determine the current phase, and continue from there rather than restarting.

### R7 — Promote the structural lesson

The `task-tool-unavailable-blocks-review-loop-pr-reviewer` lesson is `status: structural` with `seen_count: 2`.
It is promotion-eligible now on the `structural` tag alone.
Run `/create-skill diagnose autonomous-workflow --symptom "Task-tool absence discovered at Phase 6 instead of Phase 0"` so R1 and R2 land through the gated slow tier rather than as an unreviewed edit.

---

## Side effects and risks of the remediation

Every fix above has a cost.
The laptop path works today — these changes are all net-negative for it unless scoped carefully.

### The dominant risk: optimising for the cloud degrades the laptop

`gh`, `Task`, and long blocking waits are all **present and correct** on a developer machine, which is still the primary environment.
Four of the seven fixes change behavior for *both* environments.
Every one of them should be **conditioned on the probe result**, not applied unconditionally.

| Fix | Negative side effect | Mitigation |
| --- | -------------------- | ---------- |
| **R1** probe | A throwaway `Task` dispatch on **every** run, including Micro, where it can cost more than the task itself. A refused dispatch may be an uncatchable harness error rather than a return value. | Probe lazily — only before the first real `Task` site — and cache the result for the run. Never probe on Micro. |
| **R1** caching in `plan.md` | `.agent/` is gitignored per-developer scratch. A plan written in the cloud and resumed on a laptop (or the reverse) carries **stale capabilities** and would degrade a fully-capable environment. | Treat the block as a hint with a `probed_at` timestamp; re-probe on executor entry rather than trusting the cached value. |
| **R1** depth blindness | A probe from `aw` at depth 1 succeeds while the actual failure is at **depth 3** (`aw` → `aw-executor` → `review-loop` → `pr-reviewer`). A single probe returns a false green. | Probe at each dispatching layer, or record the *depth* at which dispatch was confirmed. |
| **R2** in-context role play | Directly contradicts `create-pr` Step 8's rationale — *"CI logs are huge […] don't pull them into the main thread"* — and the Sub-Agent Resource Discipline. Pulling `ci-auto-fix` and log triage in-context **increases** context pressure in single-context Full, which is exactly where RC-6 says pressure is already fatal. **R2 and R6 work against each other.** | Restrict in-context role play to procedures with bounded output (`aw-tester`). Keep log-heavy work out; summarise from `get_job_logs` with an explicit line budget instead. |
| **R2** `gh`→MCP mapping | The mapping is not total. `gh pr checks --watch` has **no** streaming MCP equivalent, and MCP GitHub access is scoped to allow-listed repos, so a mapping that silently works in one repo fails in another. | Map only the verbs that have true equivalents; make the unmappable ones (`--watch`) an explicit capability gap that triggers the bounded-poll path, not a silent substitution. |
| **R3** `timeout 540` | Real CI frequently exceeds 9 minutes. A hard 9-minute cap with terminal expiry means the workflow **escalates to the user on every slow-CI repo** — converting a working laptop flow into a nagging one. This is the single most likely regression in the set. | Keep the per-call cap under the tool ceiling but allow a **bounded number of re-watches** (e.g. 4 × 9 min = 36 min budget, counted and logged). The defect today is the *absent counter*, not the waiting itself. |
| **R3** deleting the sleep-poll | `watch-mode`'s entire purpose is waiting for external reviewers. Self-skipping in the cloud means cloud PRs **never absorb CodeRabbit or human feedback** — a capability loss, not just a stall fix. | Replace the poll with the harness-native event path where one exists (this environment ships `subscribe_pr_activity` with event-driven wakes, purpose-built for it). Self-skip only when neither polling nor events are available. |
| **R4** capping Phase 7's pass | Lowering the cap or skipping on an empty delta risks under-reviewing when `ci-auto-fix` pushed a **substantive** fix rather than a formatting nit. | Gate on delta *size*, not just presence: an empty delta skips, a non-trivial delta keeps the full cap. |
| **R5** terminal block | Output noise on Micro, where the summary may exceed the change itself. Cannot be enforced statically — no L1 eval can assert on runtime output. | Emit a one-line form for Micro/Lite, the full block for Full. Accept that this one is convention, not contract. |
| **R6** compaction re-anchor | Only works in **Full** — Lite and Micro have no `plan.md` and therefore no Progress Log to re-anchor on. Worse, the Progress Log is prose written by the agent and is **not reliably complete**; re-anchoring on an over-optimistic log could resume *past* an unfinished phase and silently skip testing. | Anchor on `checks.yaml` statuses (mechanical, self-validating) as the primary signal and the Progress Log only as a tiebreak. Resume at the **earliest phase not provably complete** — redoing work is safe, skipping it is not. |
| **R7** diagnose promotion | `diagnose` enforces **one proposal per report** ([`diagnose-mode.md`](../../../authoring/create-skill/rules/diagnose-mode.md)). R1 and R2 are two proposals and cannot be bundled into one run. | Run `diagnose` twice — probe first, degradation matrix second — or accept them as one "environment-capability" gap and let the gate judge. |

### Cross-cutting: lockstep-update risk

This repo's convention is that coupled surfaces move together — the stuck-loop cap alone spans **11 files**.
R3 touches `phase-7-ci-gate.md`, `create-pr`, `watch-mode.md`, and `ci-auto-fix`; R1 touches all four agent templates plus `aw-create-plan`, `prerequisites.md`, and `diagnostic-surface.md`.

L1's link/anchor integrity checks will catch broken anchors but **not** semantic drift between surfaces that now disagree about a timeout value.
Land these as separate PRs per fix, not one sweep — and add the new numbers to the coupled-surfaces list in [`CLAUDE.md`](../CLAUDE.md) so the next editor updates them together.

### What is safe to do first

**R5** (terminal contract) and the **CI-watch deduplication half of R4** are low-risk, environment-neutral, and independently valuable.
**R1** scoped as a lazy, non-cached probe is the high-leverage one and should land next, alone.
**R3** deserves the most care — it is the fix most likely to regress the working laptop path.

---

## Non-causes ruled out

Checked and found **not** responsible:

- **The planner→executor handoff contract.** [`planner-executor-handoff.md`](../rules/planner-executor-handoff.md) is complete; `plan.md` is self-contained and the executor's bail-out conditions are explicit. The handoff is not where runs hang.
- **Tier detection.** The tier table is identical across `SKILL.md` Step 1 and `aw.agent.md` (enforced by the `tier-table ≡ SKILL` L1 eval). Mis-tiering would cause wrong-sized work, not non-termination.
- **The Phase 4 stuck-loop cap.** The 3/5 cap plus one-shot auto-replan plus mandatory escalation is properly bounded. Phase 4 is not where these runs hang — they hang in the Phase 6/7 delivery tail.
- **The `confidence(plan)` gate.** Correctly preserved in the single-context fallback, and a below-threshold gate escalates rather than looping.
- **LoreKit reads/writes.** Documented to skip silently when `memory.*` is unavailable, and they were reachable in the probed session.
