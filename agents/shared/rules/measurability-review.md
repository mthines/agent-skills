---
title: Measurability review — will we be able to see this change work, and see it break (default on)
impact: HIGH
tags:
  - pr-reviewer
  - measurability
  - observability
  - telemetry
---

# Measurability review

Every other lens in this agent asks whether the code is *right*.
This one asks whether anyone will **know** — whether the change ships with the telemetry needed to
prove its impact and to surface its own regressions after merge.

The failure it exists to catch is the one no test can: a diff that is correct, reviewed, merged, and
then silently wrong in production, because nothing it added emits a signal anybody watches.
A reviewer is the last point at which that is cheap to fix — after merge, the missing signal is
discovered by a customer.

The lens is a thin adapter.
All judgment about *what* telemetry a change needs lives in the
[`measurable`](../../../skills/quality/measurable/SKILL.md) skill, invoked in **`audit` mode**; this
rule owns only when to call it, how to turn its output into review findings, and what it may never do.

## Contents

- [Default-on, opt-out via `--no-measurable`](#default-on-opt-out-via---no-measurable)
- [`audit` mode only — the read-only rule](#audit-mode-only--the-read-only-rule)
- [Two gates before the call](#two-gates-before-the-call)
- [When to run (the call)](#when-to-run-the-call)
- [Signal strength mapping](#signal-strength-mapping)
- [Placement and gates](#placement-and-gates)
- [What it can and cannot fail](#what-it-can-and-cannot-fail)
- [Seam with `telemetry.md`](#seam-with-telemetrymd)
- [No profile is not no lens](#no-profile-is-not-no-lens)
- [Logging](#logging)
- [What this rule does not do](#what-this-rule-does-not-do)

---

## Default-on, opt-out via `--no-measurable`

The lens runs on every invocation at the `deep` and `standard` tiers unless disabled, with a
**quiet early-exit**: when neither gate below passes, the step is a silent no-op and renders as a
footnote entry rather than a line.

| Condition | Behaviour |
| --- | --- |
| `--no-measurable` passed | Skip. Logged `skipped (flag)`. |
| `DEPTH_TIER == "quick"` | Skip. Logged `skipped (tier: quick)`. A `quick` tier means ≤ 10 delta lines, no new files, and no high-stakes paths — a shape that by construction adds no new observable behaviour. |
| `TRIVIAL_SKIP` (Step 1.7b) is true | Skip. Logged `skipped (trivial)`. |
| Both gates below pass | Run. |
| Either gate below fails | Quiet no-op. Logged `ran · 0 missing · 0 unlinked`. |

Mention the flag in the run announcement only when set.

## `audit` mode only — the read-only rule

`pr-reviewer` is read-only in **both** relations, so this lens may invoke exactly one mode:

```text
Skill("measurable", "audit")           # the only admissible call
```

**Never** `Skill("measurable", "implement")`, and never write instrumentation, a dashboard, a check
rule, or an Observability Profile as part of a review.
`audit` mode is documented as never auto-editing, which is why it is the mode this lens uses; a
review that instrumented the code it was reviewing would be authoring the diff it then judged.
Fixing a `missing` finding is the author's job, or `implement-suggestion`'s.

`setup` mode is likewise out of scope: a review is not the place to run an interview.
When no profile exists, see [No profile is not no lens](#no-profile-is-not-no-lens).

## Two gates before the call

Both must pass. They exist because "is this measurable?" asked of every diff is the fastest way to
make the lens ignored — and an ignored lens catches nothing.

### Gate 1 — the diff touches a path kind that needs a signal

Reuse the classification `measurable` already owns
([`rules/scope-detection.md`](../../../skills/quality/measurable/rules/scope-detection.md), reading
the committed Observability Profile when one exists).
The lens proceeds only when at least one changed path classifies as **`web`**, **`mobile`**,
**`api`**, or **`worker`**.

| Classification of every changed path | Gate 1 |
| --- | --- |
| any of `web` / `mobile` / `api` / `worker` | **pass** |
| only `infra` / `shared-lib` | fail — no user-facing or request-serving surface of its own |
| only test / fixture / generated / docs paths | fail — the same exclusion set [`severity`](../../../skills/quality/severity/SKILL.md) applies to its path floor |

A `shared-lib` change that *reaches* a `web` or `api` consumer is still gate-1 fail here.
The consumer's own signal already covers the call site, and Phase B's `impact.json` is the surface
that reports blast radius — duplicating it as a telemetry ask would flag every library commit.

### Gate 2 — the change adds or alters observable behaviour

A signal is owed for **new or changed behaviour**, not for touched lines.
Gate 2 passes when the diff, on a gate-1 path, contains at least one of:

| Trigger | Example |
| --- | --- |
| a new user-facing action or state | a new button, form submit, route, or screen |
| a new or changed request-serving operation | a new endpoint, handler, job, consumer, or a changed response contract |
| a **new failure mode** | a new `throw`, a new `catch`, a new error branch, a new timeout or retry |
| a changed performance characteristic the PR itself claims | "makes X faster", a new cache, a new query, a changed fan-out |

Gate 2 **fails** — quiet no-op, never a finding — for a pure rename, a type-only change, a
formatting pass, a dependency bump with no call-site change, or a refactor whose behaviour the diff
itself demonstrates is identical.
A change with no new behaviour needs no new signal, and saying otherwise is noise the author is
right to dismiss.

## When to run (the call)

Run **after** Phase B (`impact.json` supplies the changed exports and the classification input) and
in the same pass as the other body-level lenses, so one classification serves both gates:

```text
Skill("measurable", "audit", "<changed paths, gate-1 kinds only>")
```

Strict is the **default**. Pass `--strict` to `measurable audit` unless the repository or the
invocation opts down — and never change the level on the reviewer's own judgment:

| Source | Effect |
| --- | --- |
| nothing set (the default) | `--strict` is passed |
| `measurable: strict` in the review config (`review-config.md`) | `--strict` is passed |
| `--measurable-strict` on the invocation | `--strict` is passed |
| `measurable: advisory` in the review config | advisory — `--strict` withheld |
| `--measurable-advisory` on the invocation | advisory — `--strict` withheld |

Strictness is a repository policy about its own release bar, so it belongs to the repository, which
opts **down** to advisory when a missing signal should be surfaced but never gate a merge. The
reviewer never sets the level on its own judgment.

## Signal strength mapping

`measurable audit` returns each finding as `missing`, `unlinked`, or `pass`.
Map them:

| Skill verdict | Condition | Review finding |
| --- | --- | --- |
| `missing` | on a gate-1 path **and** the trigger was a new failure mode | `issue:` under strict (the default); `suggestion:` under advisory |
| `missing` | on a gate-1 path, any other trigger | `suggestion:` |
| `unlinked` | any | **aggregated** — see below. `suggestion:` under strict (the default), `nitpick:` under advisory. `unlinked` never blocks and is never an `issue:`, in either level |
| `pass` | any | nothing. Not a finding, not a line, not a comment |

`unlinked` means the signal exists but maps to no named regression detector.
It is real feedback and it is also the cheapest thing in this lens to over-report, so it is
**consolidated into exactly one finding per run**, naming every unlinked signal, anchored at the
first affected `path:line` — the same collapse [`rubric-composition.md § Consolidation pass`](./rubric-composition.md)
applies to cross-surface parity findings.
Cap: 1.

Each finding names **the signal, not the library** — "no event is emitted when this submit fails"
rather than "add `posthog.capture(...)`".
Which SDK is the repo's business and, absent a profile, is not something a review can know.

## Placement and gates

Findings from this lens are ordinary findings from Step 2.5 onward: dedupe (2.5), grounding (2.6),
the verification receipt (2.6b), suppression (2.7b), comment shape (2.8), conventional comments
(2.9), and line validity (3.5) all apply unchanged.

Two specifics:

- **Grounding is the changed line, not the missing code.** A finding about an *absent* signal still
  has to anchor somewhere real: the handler, the catch block, or the submit callback the signal is
  missing *from*. A finding with no such anchor is dropped at 2.6, exactly like any other.
- **Verification is Tier 1.** "No emit call exists on this path" is a `grep`/`ast-grep` claim, so the
  receipt is `confirms` or `contradicts` from Tier 1 alone
  ([`verification-receipt.md`](./verification-receipt.md)) — never `unobtainable`, and never a Tier 3
  run. The lens never needs to execute anything.

## What it can and cannot fail

The lens never **lowers** a verdict — like [`telemetry.md`](../../pr-reviewer/rules/telemetry.md) it
raises attention, never removes it.
What it may *fail* depends on the level, and only ever through a `missing` signal:

- **Strict (the default).** A `missing` finding on a gate-1 path with a **new failure mode** is an
  `issue:`, contributes a token to `SEVERITY_TALLY`, and can put a phrase in `FAIL_REASONS` — a new
  error branch nothing can see is the exact case this lens exists for, so under the default it
  carries weight. Every other `missing` is a `suggestion:` and does not block.
- **Advisory (opt-down).** No measurability finding contributes a token to `SEVERITY_TALLY` or a
  phrase to `FAIL_REASONS`. Every `missing` is a `suggestion:`. A repository sets `measurable:
  advisory` (or a run passes `--measurable-advisory`) when a missing signal should be surfaced but
  never gate the merge.

`unlinked` never blocks and is never an `issue:`, in either level — a `suggestion:` under strict and
a `nitpick:` under advisory, always aggregated to one finding per run. A signal that exists but is
unwatched is worth the author's attention; it is not worth failing a correct change.

Strict is the default rather than the opt-in because a change that ships a new failure mode with no
signal is silently wrong in production the first time it fires, and a reviewer is the last cheap point
to catch it. A repository that would rather not gate on that opts down in one line; the lens no longer
waits to be switched on before it can matter.

## Seam with `telemetry.md`

Two rules in this agent read the word "telemetry" and they ask opposite questions.
Neither may answer the other's:

| Rule | Question | Direction in time |
| --- | --- | --- |
| [`telemetry.md`](../../pr-reviewer/rules/telemetry.md) | how much traffic and error history does the code this diff touches carry **today**? | backwards — an exposure input to priority |
| this rule | will this change's own behaviour be visible **tomorrow**? | forwards — a coverage gap in the diff |

`telemetry.md` reads aggregates from Dash0 and cannot see the change at all, because no telemetry
exists for unmerged code — which is precisely why it cannot answer this lens's question.
Conversely this lens never reads live telemetry, never queries Dash0, and never cites a traffic
figure: a `missing` finding is a static fact about the diff.

A useful composition, and the only one permitted: when `telemetry.md` reports a **high**
`traffic_band` for a changed path *and* this lens reports `missing` on it, say so in the finding —
a blind spot on a hot path is worth more of the author's attention than one on a cold path.
That raises priority. It still does not block.

## No profile is not no lens

When no committed Observability Profile exists
([`setup-profile.md`](../../../skills/quality/measurable/rules/setup-profile.md)), the lens still
runs, with two constraints:

1. **Name signals, never stacks.** With no profile the review does not know the repo's vendor,
   wrapper, or conventions, so a finding says what must be observable, never which call to write.
2. **Never propose `setup` as a finding.** "Run `/measurable setup`" is not a review comment about
   this diff. Note the absent profile once in the log line
   (`no profile — signal-level findings only`) and leave it there.

## Logging

Emit the log block on every run, including quiet ones, so a skipped run and a silent run are
distinguishable:

```text
MEASURABILITY_LOG: <ran|skipped (<reason>)> · <N> paths classified · <M> missing · <U> unlinked
```

Pluralise the count naturally — `1 path classified` / `2 paths classified` — the same way
`STANDARDS_LOG` writes `1 doc` / `2 docs`; the renderer echoes the matched clause verbatim into the
footnote, so its wording is this rule's to own.
Append ` · no profile` when no Observability Profile was found, and ` · advisory` when the level was
opted down (strict is the default, so it is the silent case and needs no marker).
The renderer treats `skipped (…)` and `0 missing · 0 unlinked` as quiet and folds the lens into the
report's `Nothing to report` footnote ([`report-rendering.md`](../../pr-reviewer/rules/report-rendering.md)).

## What this rule does not do

- **It does not design events.** Frontend event naming and properties belong to
  [`rum-tracking`](../../../skills/analysis/rum-tracking/SKILL.md), reached through `measurable`, not
  from here.
- **It does not judge instrumentation quality.** A span with the wrong attribute name is a
  `code-quality` or standards finding; this lens only asks whether the signal exists and is watched.
- **It does not create or edit dashboards, alerts, SLOs, or check rules.** `measurable` itself
  forbids that in every mode, and a reviewer has even less business doing it.
- **It does not gate on test coverage.** A well-tested change with no production signal is exactly
  the case this lens exists for; conflating the two would let a green suite answer a question tests
  cannot.
- **It does not run at `quick` tier or on a `pass`-only audit**, and it produces no line in the
  report when it has nothing to say.
