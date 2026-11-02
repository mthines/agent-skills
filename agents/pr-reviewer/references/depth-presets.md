# Why depth presets and an independent model axis

Operational rules: [`../rules/arguments.md`](../rules/arguments.md).
This file records why the surface has this shape.

## Why presets replace a number

The thoroughness budget has six columns separated by breakpoints (0.4, 0.5, 0.7, 0.8, 0.95), and each column bundles the finder set, the topology, the verifier tier, the lenses, and the tool-call budget.
A number does not say which column it lands in, so a user cannot predict a run's cost or reach from it: 0.45 and 0.5 sit in different columns, 0.5 and 0.55 in the same one.
Four named presets are the four columns users actually choose between, and each equals the budget of the routed-tier default of the same name, so no default run changed.

## Why `quick` and `standard` never lower the routed tier

Routing rules D1–D13 route risky diffs to `deep` for reasons a repo-wide `depth: quick` must not override.
A preset sets the budget; `deep` and `max` also force the tier because they are asks for more.

## Why a preset equal to the routed tier is the default

A defaulted `quick` budget is lean: no worker, no holistic broad pass, no impact image.
If `depth: quick` in a config produced a non-lean budget on a `quick` routing, writing the default value down would cost more than writing nothing.
Treating an equal preset as the default makes the same words give the same behaviour.
A preset below the routed tier's default is a deliberate ask, so it keeps `hybrid` even on a small re-review that the default would run in one context.

## Why the risk floor stays and is reported

A repo-wide low depth must not under-review auth, payments, migrations, secrets, infra, or a high blast radius.
A lift that nobody can see makes the review cost more than the user asked with no explanation.
The run prints the lift as `depth <requested> -> <effective> (floor: <reason>)` and records it as an anomaly, so a reader sees that the review ran deeper than asked.

## Why garbage is an error

A garbage depth value that failed closed to the maximum budget would let a typo buy the most expensive review without a word.
Failing closed protects quality and spends money silently; an exit before any model turn protects both.
Config values still fall back to the default with an anomaly, because a config is read after the run has started and a missing repo-wide setting must not block every review.

## Why the model is its own axis

A thoroughness value cannot mean both "do more work" and "use a cheaper model": the two trade differently.
Depth changes which finders run.
The model changes how well each finder runs and what it costs.
Keeping them apart lets a team pair a deep review with a cheaper worker model, or a quick review with the strongest reviewer, without learning a combined scale.

The reviewer's model comes from the caller's dispatch because that is the only mechanism the harness offers: a dispatch tool's `model` parameter.
An agent file's `model:` line sets the default when the caller passes none.
Where a harness lacks the parameter the model cannot be chosen, and the run says so rather than pretending.

## Why `--full` is not a depth alias

`--full` also selects non-incremental run mode (it skips the prior-run diff), so removing it would remove a capability that no depth value provides.
It stays as a run-mode flag; its depth effect is the `deep` tier, which `--depth deep` gives directly.

## Why validation lives in `prepare-review.mjs`

Prepare runs before the reviewer's first model turn in every entry point, so one check there protects the skill, the loop, and a direct dispatch.
The agent's Step 0 checks remain for a caller that skips prepare.
