# Convergence Confirmation

## Contents

- [The bar depends on whether grading is deterministic or judge-based](#the-bar-depends-on-whether-grading-is-deterministic-or-judge-based)
- [The procedure](#the-procedure)
- [Composing `verify-behavior`](#composing-verify-behavior)
- [Why not majority-of-N instead of all-of-N](#why-not-majority-of-n-instead-of-all-of-n)

"Green" and "confirmed" are not the same claim. A single pass of a
stochastic eval (an LLM-as-judge call, a golden set with any model-driven
step) proves the eval passed once — it does not prove the fix holds. This
rule defines the minimum bar for `CONFIRMED` and how it composes with
`verify-behavior`.

## The bar depends on whether grading is deterministic or judge-based

Binomial statistics make this non-optional: at a 1-in-50 true flake rate,
passing twice in a row is close to indistinguishable from luck — the
standard error on a pass rate only shrinks with √N. Two consecutive
passes is adequate evidence for a **deterministic/code-graded** check
(an exit code, a type check, an assertion with no model call in the
grading path) because there is no sampling variance to rule out — a
second identical pass is genuinely redundant confirmation, not statistics.
It is **not** adequate for a check whose grading involves an LLM call
(an LLM-as-judge assertion, any golden-set item scored by a model) —
those are stochastic by construction, and practitioner guidance (AI
Codex) converges on running such an eval **5 times in a row** before
trusting it, not 2.

Decide which bar applies once per target, at Phase 1:

| Grading path | Confirmation bar |
| ------------- | ----------------- |
| Deterministic (exit code, type/schema check, string/regex assertion, no model call in the grading path) | 2 consecutive passes (N=2 in the procedure below) |
| LLM-judge-graded (any model call scores the output) | 5 consecutive passes, same `RUN_CMD`, same `JUDGE_MODEL` (see `rules/eval-bug-classification.md`) throughout |

## The procedure

After Phase 3 applies a fix, with `N` set by the table above (2 or 5):

1. Run `RUN_CMD`. Call this **Run 1**.
2. If Run 1 fails, the iteration failed — do not run again, go straight to
   Phase 5. Running until it happens to pass ("just retry until green") is
   the exact anti-pattern this rule exists to block.
3. If Run 1 passes, run `RUN_CMD` **again, unchanged** — no retries with a
   different seed, no re-scoping to fewer cases, no swapping in a
   cheaper/faster variant of the same suite — for a total of `N`
   consecutive runs.
4. All `N` runs must pass for the result to be `CONFIRMED`. A pass
   followed by any later failure is not a flake to wave away — it means
   the fix did not actually address the failure (or the eval genuinely is
   non-deterministic, which is itself an `eval-bug` per
   `rules/eval-bug-classification.md`). Treat it as a failed iteration,
   and stop at the first failure rather than continuing to N — a failed
   run inside the window already disproves `CONFIRMED`.

**Even N/N passes is not proof against a systematically wrong judge.**
Repeated sampling (self-consistency, majority voting) cancels *random*
judge noise; it does not catch a judge that is consistently miscalibrated
in the same direction every time. Treat N-of-N as confirmation that the
fix is not a fluke, not as independent validation that the judge itself is
right — that is a separate, periodic re-validation against human-labelled
anchors (`ai-engineering/rules/evals.md` §3), out of scope for a single
iteration of this loop.

A suite whose own documentation already reports a flake rate (e.g. an L2
golden set noted as "statistically noisy" below 50 cases) should be
treated with extra suspicion on a single Run 1 pass; prefer escalating to
`unsure` classification over accepting a marginal confirmation on a suite
already known to be noisy.

## Composing `verify-behavior`

Use `verify-behavior`'s `change` mode for the mechanic underneath both
runs rather than hand-rolling execution:

```
Skill("verify-behavior", "change")
  target: <the eval's run command / file>
  expected: "RUN_CMD exits 0"
```

`verify-behavior` returns a receipt (`confirms` / `contradicts` /
`ambiguous` / `null`) plus a green/red verdict against the `expected`
outcome supplied above. This skill's grading on top of that receipt is:

| This run's receipt | Result |
| -------------------- | ------ |
| `confirms`, and it was the last of the `N` required runs | `CONFIRMED` |
| `confirms`, and more runs remain | Continue to the next run |
| `contradicts` or `null`, at any run | Failed iteration — stop immediately, do not run the remainder of `N` |
| `ambiguous`, at any run | Treat as not-yet-confirmed — do not continue to the next run on ambiguous evidence; return to Phase 2 with it instead |

`verify-behavior`'s own hard invariant — a null or non-reproducing result
is never read as confirmation — applies unchanged here. This rule adds
the second-run requirement on top; it does not relax anything
`verify-behavior` already guarantees.

## Why not majority-of-N instead of all-of-N

A majority-vote confirmation (e.g. 3-of-5) trades a lower false-negative
rate for a real false-positive risk — declaring `CONFIRMED` while the fix
still fails 40% of the time. This rule requires **all** N runs to pass,
not a majority, because a re-run that fails even once means the failure
mode this loop exists to fix is still reachable. Majority-of-N is the
right bar for a *diagnostic* signal (is this eval flaky at all?), not for
the *confirmation* gate that ends the loop.

This N is a floor, not a ceiling. If the target eval's own documentation
specifies a larger required confirmation sample (for example, a suite
whose own CI gate already runs replicas and reports a pass-rate
threshold, like this repo's `EVAL_GATE`), honor that suite's own
documented bar instead — track pass rate across its own N and compare
against its own documented floor, rather than re-deriving a fresh
literal-pass/fail count with this rule's N.
