---
title: Lens invocation — resolving pr-reviewer's composed skills across harnesses
impact: HIGH
tags:
  - pr-reviewer
  - lens-invocation
  - cross-harness
  - self-concealing-degradation
---

# Lens invocation

`pr-reviewer` composes six repo-owned quality lenses through `Skill()`: `severity`, `optimize-approach`, `measurable`, `confidence`, `holistic-analysis`, and `verify-behavior`.
In the Claude Code CLI and the Claude Agent SDK harness behind Claude Code on the web, `Skill()` resolves these names directly, because both harnesses discover skills from the filesystem the agent is installed into.
A third harness does not: the Agent0 Automation sandbox's `skill` tool only accepts names from a fixed enum of roughly 45 Dash0 built-in skills, and none of these six names is in that enum.

The observed failure (`dash0hq/dash0#19751`, a real "Agent0 | review" run) had two distinct shapes, and this rule exists because neither is safe to handle the same way:

1. Five lenses — `severity`, `optimize-approach`, `confidence`, `holistic-analysis`, `verify-behavior` — return an explicit error, `Skill "<name>" not found`.
2. The sixth, `measurable`, does **not** error.
   It silently name-collides with an unrelated Dash0 built-in skill of the same name and returns that skill's recipe instead — wrong content, no error, no signal to catch.

The run's own verdict was `success`.
Every lens had silently degraded to skipped, and nothing in the pipeline noticed — a self-concealing degradation, the same failure shape this repo's `F6`/`F7` doctrine already names for dispatch-availability checks ([`autonomous-workflow/rules/diagnostic-surface.md`](../../../skills/workflow/autonomous-workflow/rules/diagnostic-surface.md)).

## Contents

- [Resolution algorithm — file-presence, never an error string](#resolution-algorithm--file-presence-never-an-error-string)
- [In-context load vs. sub-agent dispatch — why this fallback is safe here](#in-context-load-vs-sub-agent-dispatch--why-this-fallback-is-safe-here)
- [The `measurable` collision — a silent wrong answer, not an error](#the-measurable-collision--a-silent-wrong-answer-not-an-error)
- [No self-concealing degradation — `RUN_ANOMALY` is mandatory](#no-self-concealing-degradation--runanomaly-is-mandatory)
- [Enhancement vs. spine — what a genuine skip costs](#enhancement-vs-spine--what-a-genuine-skip-costs)
- [The six invocation sites](#the-six-invocation-sites)
- [What this rule does not do](#what-this-rule-does-not-do)

---

## Resolution algorithm — file-presence, never an error string

Every lens site in this agent resolves a lens through the same three steps, in order, before it ever calls `Skill("<lens-name>", …)`:

1. Check whether `$HOME/.claude/skills/<lens-name>/SKILL.md` exists on disk.
   This is the deterministic, repo-owned installation path every one of the six lenses installs to (`scripts/sync-symlinks.sh`), and its presence or absence does not depend on which harness is running the agent.
2. If the file is present, read it and follow its instructions in-context, exactly as if `Skill("<lens-name>", …)` had loaded it.
   This is the authoritative path for all six lenses — not a fallback tried after an error, and not a catch block.
   See [In-context load vs. sub-agent dispatch](#in-context-load-vs-sub-agent-dispatch--why-this-fallback-is-safe-here) for why this substitution is legitimate here.
3. Only when the file is **absent** does the lens fall through to whatever the host's own `Skill()` resolution returns — which is the correct behaviour on a harness that has no local file at all, and functionally a no-op on one that does (steps 1–2 already ran the same content the host would have loaded).

The predicate is **file-presence**, never the literal error string `Skill "<name>" not found`.
Keying recovery on an error string is the `F6` anti-pattern this repo removed from dispatch-availability checks in v3.25 ([`autonomous-workflow/rules/diagnostic-surface.md`](../../../skills/workflow/autonomous-workflow/rules/diagnostic-surface.md)) — a check that greps for one specific failure string is blind to every other way a host can fail to return the right skill, and the `measurable` collision below is exactly such a way: it returns no error at all.
A predicate that must catch both the loud failure (five lenses) and the silent one (`measurable`) has to be evaluated **before** the call, not derived from how the call failed.

```text
resolve(lens_name):
  path = "$HOME/.claude/skills/" + lens_name + "/SKILL.md"   # never "~" — the Read tool does not expand it
  if file_exists(path):
    read(path) and follow it in-context      # authoritative — steps 1-2 above
  else:
    Skill(lens_name, ...)                    # host resolution — the only remaining option
```

`$HOME`, never `~`, in every step above and in every owner file's restatement below — this agent's own [Step 0 path-resolution convention](../../pr-reviewer.md) exists precisely because the `Read` tool requires an absolute path and does not expand a tilde, so a resolve step written against `~` never finds the file it names, `file_exists` is always false, and every run silently takes the host-fallback branch this rule exists to make loud, not the authoritative one.

## In-context load vs. sub-agent dispatch — why this fallback is safe here

Reading `$HOME/.claude/skills/<name>/SKILL.md` and following it in the current context is **behaviorally identical** to `Skill("<name>", …)` on a harness where `Skill()` works — both load the same markdown and execute the same instructions, in the same context, with the same tool grants.
The two differ only in *loader*: one goes through the host's skill-invocation mechanism, the other reads the file directly.
Neither isolates a context and neither delegates execution elsewhere, so substituting one for the other changes nothing about what runs.

This is why the fallback in this rule is safe, and it is also exactly the property that does **not** hold for `Task` / `Agent` sub-agent dispatch.
[`review-loop`](../../../skills/quality/review-loop/SKILL.md) and [`pr-review`](../../../skills/quality/pr-review/SKILL.md) both dispatch `pr-reviewer` as a **sub-agent**, and both correctly *refuse* to fall back when no available tool (`Task`, `Agent`, or another spelling) can dispatch one — because a review run in the caller's own context is a self-review wearing a reviewer's label, not the same operation through a different loader.
Context isolation is the whole point of that dispatch, so there is no in-context substitute for it.

Never generalise this rule's fallback to a dispatch site.
A lens resolves to a **skill definition** — inert markdown this agent already executes in its own context — while `pr-reviewer` itself is a **sub-agent** another caller dispatches for isolation it does not have.
Those are different operations, and only the first has a safe same-context substitute.

## The `measurable` collision — a silent wrong answer, not an error

Five of the six lenses fail loudly: the host's `skill` tool returns `Skill "<name>" not found`, and a check keyed on file-presence (never on that string) still catches it, because the failure and the fallback triggering condition happen to coincide.

`measurable` does not.
The Agent0 sandbox's built-in skill enum contains an unrelated skill also named `measurable`, and the host's resolver returns **that** skill's recipe with no error, no warning, and no signal distinguishable from a correct call.
A design that tries the deterministic file only inside a `catch` block never reaches this case, because nothing threw.

This is why the resolution algorithm above makes the repo-owned file **primary and authoritative**, not a recovery path.
It is read and followed *before* any host resolution is trusted, for every one of the six lenses, regardless of whether that particular lens is known to error or to collide.
The uniform treatment is what makes the collision harmless **whenever the local file exists** — the agent never even asks the host, so it does not matter that Agent0's `measurable` entry returns a wrong recipe instead of no recipe.
That harmlessness is scoped to the file-present branch, not to the whole algorithm: when the local file is genuinely absent (step 3), the agent has nothing to check the host's answer against, and it does depend on that answer being right with no way to verify it — which is exactly why [No self-concealing degradation](#no-self-concealing-degradation--runanomaly-is-mandatory) treats every use of the host fallback as reportable, not only its failures.

## No self-concealing degradation — `RUN_ANOMALY` is mandatory

A `RUN_ANOMALY` is required in **three** cases, not only the loud one:

1. **The lens still cannot run at all** — the file is absent and the host also has no usable answer.
   The obvious case, and the one every dispatch-availability check already covers for `Task`/`Agent`.
2. **Resolution fell through to host `Skill()` at all**, whether or not it appeared to succeed.
   A host answer for one of these six names is **unverifiable from this side of the call**, because this rule has no local copy to diff it against once the file-presence check has already found no local copy.
   The `measurable` collision is exactly a host answer that *looks* successful.
   Gating the anomaly on "no usable answer" would silently pass the collision straight through, since a wrong recipe with no error is, from the caller's vantage point, indistinguishable from a right one.
   The anomaly therefore fires on **use of the fallback**, not on its failure.
3. **The local file resolves and loads, but the loaded skill itself cannot serve this call.**
   Step 1 and step 2 above both find the deterministic file present and follow it in-context; step 3 above never runs, because no host call is needed or attempted.
   The lens is still unavailable for this run — it just failed one step later than case 1, inside the loaded skill's own mode dispatch rather than at file-presence.
   All six lenses take a mode argument (`severity`/`finding`, `optimize-approach`/`report` or `plan`, `measurable`/`audit`, `confidence`/`code`, `holistic-analysis`/`review`, `verify-behavior`/`claim`), so a skill version mismatch — a local install that predates a mode this rule or its caller expects — is a structural exposure shared by all six, not a `holistic-analysis`-specific one; see [`holistic-review.md`](./holistic-review.md#when-holistic-is-unavailable) for the shipped worked example.
   Silence here is the same shape case 2 exists to prevent, one layer later: a call that neither errored nor fell through to the host still produced no usable result, and a review reporting clean on that fact is self-concealing exactly as case 1 and case 2 are.

This repo already names the failure shape: a degraded path that reports as a legitimate outcome is self-concealing, and self-concealing degradation is exactly what `F6`/`F7` name in [`autonomous-workflow/rules/diagnostic-surface.md`](../../../skills/workflow/autonomous-workflow/rules/diagnostic-surface.md) — the run in `dash0hq/dash0#19751` is the same doctrine's failure mode, one layer down, in a lens call instead of a dispatch call.

`RUN_ANOMALY` is a **single-line** payload slot — [`render-report.mjs`](../../pr-reviewer/scripts/render-report.mjs) rejects a value containing a newline, the same constraint [`report-rendering.md`](../../pr-reviewer/rules/report-rendering.md) states plainly ("Both are single-line."), and it is the same slot the renderer already renders for a divergence-recovery note (`workspace.md`), so no renderer change is needed to surface it.
That constraint means **one call cannot emit one line per degraded lens.**
The motivating incident degraded all six lenses in the same run, which is the central case this rule exists to cover, not an edge case a single-lens example can stand in for.

When more than one lens degrades in the same run, aggregate every affected lens into **one** `RUN_ANOMALY` value, grouped by reason:

```text
RUN_ANOMALY: severity, verify-behavior unavailable (no local file, no host skill) — findings on this run carry no severity tier and behavioral claims have no executed proof; measurable resolved via host fallback (collision, unverified) — this run's measurability findings are unverified
```

A single degraded lens still gets its own unaggregated line:

```text
RUN_ANOMALY: severity lens unavailable on this host (no local file, no host skill) — findings on this run carry no severity tier
```

A review whose lenses silently dropped, or whose lens resolution ran on an unverifiable host answer, must not report clean.
Concretely: the run announcement, the terminal Quality Gate summary, and the posted report all carry the anomaly — never only the terminal output, which the PR author never sees.
A `success` / `PASS` verdict is never the correct rendering of a run that could not execute the lenses it depends on, or that executed them on an answer it could not verify; see [Enhancement vs. spine](#enhancement-vs-spine--what-a-genuine-skip-costs) for what else that run must do.

## Enhancement vs. spine — what a genuine skip costs

Not every lens costs the same when it cannot run.
Two are load-bearing enough that a genuine skip changes what the review is capable of claiming; the other four make the review worse, not wrong.

| Class | Lenses | A genuine skip means |
| --- | --- | --- |
| **Spine** | `severity`, `verify-behavior` | The review's own severity and behavioral-proof machinery cannot run — findings have no tier and behavioral claims have no executed proof. |
| **Enhancement** | `optimize-approach`, `measurable`, `holistic-analysis`, `confidence` | The rest of the pipeline still produces a useful, correctly-scored review; the review is smaller, not less trustworthy. |

**Neither class ever touches `RUN.tier`.**
`RUN.tier` is left exactly as normal depth routing set it for this run's mode; the degradation, spine or enhancement, is carried entirely by `RUN_ANOMALY`.

Two earlier designs for the spine case were tried and rejected, both instructive about why the field is never touched at all.
The first reused `workspace.md`'s `DEPTH_CAPABILITY: diff-only` precedent, which caps `RUN.tier` to `standard` when the workspace cannot support a deeper read.
That precedent's own worked example is an `incremental`-mode run, where `standard` is already `render-report.mjs`'s `TIER_FOR_MODE["incremental"]` — the cap changes nothing there.
On a `full`-mode run — the common case this fix targets, since a first review on a fresh PR is always `full` — `TIER_FOR_MODE["full"]` is hard-coupled to `"deep"`, and the renderer rejects any other pairing outright (`RUN.tier "standard" contradicts RUN.mode "full"`, verified by running `render-report.mjs` directly against that payload).
Overriding `RUN.tier` on a `full`-mode run does not degrade the report gracefully; it fails to render at all, trading a silently-clean review for no review whatsoever.
The second tried omitting the field instead, which does render, but contradicts [`report-rendering.md`](../../pr-reviewer/rules/report-rendering.md)'s and [`pr-reviewer.md`](../../pr-reviewer.md)'s own rule that every routed run supplies its detection-core slots on the stated ground that an omitted one "makes a shallow run indistinguishable from a deep one" — and a spine skip is still a routed run, so that rule applies to it too.

So `RUN.tier` is supplied on a spine skip exactly as it is on every other run, untouched by the skip.
The tier field answers *how deep this run was routed*; it was never the right place to answer *did every lens that tier implies actually run* — `RUN_ANOMALY` is, and it is the only slot this rule ever fills.

**Why `confidence` is enhancement, not spine.**
`confidence` looks load-bearing — it used to gate every posted comment — but [`finding-verifier.md`](./finding-verifier.md) § Step 4 moved the per-comment score's *source* from `Skill("confidence", "code")` to the in-agent verifier rubric (Reproducible 40 % / Attributable 30 % / Actionable 30 %).
[`per-comment-confidence.md`](./per-comment-confidence.md) § Where the score comes from now states plainly that `confidence(code)` is only the **fallback** path — a `quick`-tier run with no workspace, or a finding from a lens that emits outside the finder pipeline (`ux`, `--with …`).
Its one other use, the advisory overall-verdict check in `terminal-report.md`, is terminal-only and never posted.
Neither use sits on the critical inline-scoring path, so a genuine `confidence` skip degrades a fallback the run may not even need, not the spine — enhancement, same loud `RUN_ANOMALY` treatment as the other three, `RUN.tier` untouched either way.

## The six invocation sites

Each lens has exactly one canonical owner file that references this rule, chosen as the file that owns the consequence of that lens failing:

| Lens | Owner file |
| --- | --- |
| `severity` | [`conventional-comments.md`](./conventional-comments.md) |
| `optimize-approach` | [`optimality-review.md`](./optimality-review.md) |
| `measurable` | [`measurability-review.md`](./measurability-review.md) |
| `confidence` | [`per-comment-confidence.md`](./per-comment-confidence.md) |
| `holistic-analysis` | [`holistic-review.md`](./holistic-review.md) |
| `verify-behavior` | [`verification-receipt.md`](./verification-receipt.md) |

`finding-verifier.md` is deliberately **not** an owner or a reference site.
It is a `bug-detection` L2 rubric source (`suites.mjs` `DETECTION.rubrics`), and its existing statements about severity and confidence already agree with this rule without needing to restate it — editing its body for a reference would select the hard-gated `bug-detection` job for a change with nothing behavioral in it.

## What this rule does not do

- It does not change what any lens computes. Resolution decides *whether* a lens runs and *how loudly* a genuine skip is reported — never the lens's own judgment.
- It does not add a new report section. `RUN_ANOMALY` is an existing payload slot; this rule only says when to fill it. `RUN.tier` is a sibling existing slot this rule never fills — it is left to whatever Phase C routed, on every run, spine skip or not.
- It does not apply to `Task` / `Agent` sub-agent dispatch, ever. See [In-context load vs. sub-agent dispatch](#in-context-load-vs-sub-agent-dispatch--why-this-fallback-is-safe-here).
- It does not retry a failed host resolution. The file-presence check runs once, before the call; there is no second attempt to make.
