# How other skills call polish

Read on demand; polish's own behaviour is in [`SKILL.md`](../SKILL.md).

`review-loop` calls only `Skill("polish", "simplify")` — never full `polish` or `polish review`.
This is the anti-circularity guarantee: `review-loop` drives `pr-reviewer` itself each iteration, so `polish review` re-entering `pr-reviewer` would create a dispatch cycle.

`/create-pr` delegates its post-draft quality step to `review-loop` (the bounded convergence loop), not directly to `polish`.
`polish` stays useful standalone as a pre-draft local check.

| `review-loop` invocation             | Delegates to                    |
| ------------------------------------ | ------------------------------- |
| `review-loop` (each iteration step C) | `Skill("polish", "simplify")` only |

| `/create-pr` flag         | Post-draft quality path                        |
| ------------------------- | ---------------------------------------------- |
| `/create-pr` (default)    | `Skill("review-loop")` (full convergence loop) |
| `/create-pr --no-review`  | `Skill("polish", "simplify")` — simplify only, one pass |
| `/create-pr --no-simplify`| `pr-reviewer` agent (Task tool) one-shot only  |
| `/create-pr --quick`      | `Skill("polish", "quick")` on the draft diff   |
| `/create-pr --no-quality` | *(quality skipped)*                            |

## Why full mode runs review before simplify

The review pass surfaces correctness and obvious cleanups; simplify then applies structural refactors to the already-cleaner code, so the confidence gates evaluate the final shape.
