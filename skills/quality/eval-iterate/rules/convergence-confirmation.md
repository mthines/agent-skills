# Convergence Confirmation

"Green" and "confirmed" are not the same claim. A single pass of a
stochastic eval (an LLM-as-judge call, a golden set with any model-driven
step) proves the eval passed once — it does not prove the fix holds. This
rule defines the minimum bar for `CONFIRMED` and how it composes with
`verify-behavior`.

## The bar: two consecutive passes, same command

After Phase 3 applies a fix:

1. Run `RUN_CMD`. Call this **Run A**.
2. If Run A fails, the iteration failed — do not run again, go straight to
   Phase 5. Running until it happens to pass ("just retry until green") is
   the exact anti-pattern this rule exists to block.
3. If Run A passes, run `RUN_CMD` **again, unchanged** — no retries with a
   different seed, no re-scoping to fewer cases, no swapping in a
   cheaper/faster variant of the same suite. Call this **Run B**.
4. Both Run A and Run B must pass for the result to be `CONFIRMED`. A
   pass-then-fail is not a flake to wave away — it means the fix did not
   actually address the failure (or the eval genuinely is
   non-deterministic, which is itself an `eval-bug` per
   `rules/eval-bug-classification.md`). Treat it as a failed iteration.

This two-run minimum is deliberately cheap (one extra invocation, not a
statistical sample). It is calibrated to catch the common failure mode —
a fix that happens to land on the right side of a judge's or sampler's
variance once — not to replace a real flake-rate measurement. A suite
whose own documentation already reports a flake rate (e.g. an L2 golden
set noted as "statistically noisy" below 50 cases) should be treated with
extra suspicion on a single Run A pass; prefer escalating to `unsure`
classification over accepting a marginal two-run confirmation on a suite
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

| Run A receipt | Run B receipt | Result |
| -------------- | -------------- | ------ |
| `confirms` | `confirms` | `CONFIRMED` |
| `contradicts` or `null` | — | Failed iteration (Run B is not attempted) |
| `confirms` | `contradicts`, `null`, or `ambiguous` | Failed iteration — the fix did not hold |
| `ambiguous` | — | Treat as not-yet-confirmed; do not attempt Run B on an ambiguous Run A — return to Phase 2 with the ambiguous evidence instead |

`verify-behavior`'s own hard invariant — a null or non-reproducing result
is never read as confirmation — applies unchanged here. This rule adds
the second-run requirement on top; it does not relax anything
`verify-behavior` already guarantees.

## Why not just re-run N times and take a majority

A majority-vote-of-N confirmation is a heavier bar than this skill's
default, and is the right call for a suite already known to be noisy
(large N, expensive judge calls). It is not the default here because:

- It multiplies the cost of every iteration by N, against a 5-iteration
  hard cap — spending that budget on repeated confirmation runs instead
  of on genuine fix attempts is a worse trade for most evals.
- Two consecutive passes already rules out the common single-lucky-pass
  case that motivated this rule.

If the target eval's own documentation specifies a required
confirmation sample size (for example, a suite whose CI gate already runs
N replicas), honor that suite's own documented bar instead of this
default — this rule sets the floor, not a ceiling.
