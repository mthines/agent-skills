# Why the routing rule is shaped this way

Read on demand; the operative rule is `templates/routing.rule.md`.

## The vocabulary is duplicated on purpose

The trigger phrases appear twice: in `aw`'s `description:` frontmatter and in the routing rule.
Frontmatter cannot link a canonical home, and the routing rule is the live rubric the L2 `aw-should-trigger` suite reads, so neither copy can be deleted.
L1 `G2d` keeps them honest by assertion instead: every phrase quoted in `aw`'s description must appear in the rule, and the parent `autonomous-workflow` description must quote none of them.
When you add, remove, or reword a trigger phrase, update both in the same change.

## `aw` is the only natural-language destination

The parent `autonomous-workflow` skill is the phase machinery, reached by `/autonomous-workflow` or by `aw` itself.
Routing a trigger phrase straight to it skips tier detection and the lessons loop, which is the whole job of the dispatcher, and the two skills would compete for the same request.

## Why `aw` is a skill

Because the dispatcher runs in the caller's context, `aw-planner` and `aw-executor` are dispatched from the top-level session — one rung higher than they sat under the retired `aw` agent — so they keep whatever nested dispatch the harness grants.
There is no dispatch-unavailable branch for the dispatcher itself: a skill needs no dispatch tool to start, and `aw` handles a missing dispatch tool internally with the single-context Full path, which keeps the plan artifact and the `confidence(plan)` gate.

## Why "prefer triggering"

The user opted into this behaviour by installing the rule, and `aw`'s Phase 0 validation asks clarifying questions before any work at whatever tier it picks, so a false trigger costs one exchange while a missed trigger costs the whole autonomous run.
