---
title: 'Quality pass — report-only reuse and UX notes after verification'
impact: MEDIUM
tags:
  - autonomous-workflow
  - quality
  - reuse
  - ux
---

# Quality pass

Runs once on Lite (Phase 4b) and Full (Step 4.2), after verification and before the walkthrough and the PR — on Lite also before `create-pr`'s local `review-loop`; never on Micro.
It is report-only: it never fails the run, never edits code, never iterates, and never re-enters Phase 3 or Step 2.
Its output is `.agent/{branch}/quality-notes.md`, which the walkthrough and the PR body copy.
**Why:** [`../references/quality-pass.md`](../references/quality-pass.md).

```text
✗ Wrong — the reuse lane says "extend ActionBar", so the run goes back to Step 2 and rebuilds SaveBar
✓ Right — the row lands in quality-notes.md and the PR body; the reviewer decides
```

## Lanes

Run both lanes; each is one call and runs at most once.

| Lane | Trigger | Call | Missing → |
| --- | --- | --- | --- |
| Reuse | always | `Skill("fit", "--inventory --base <base sha>")` — the inventory script lives in `fit`'s `scripts/reuse-inventory.mjs` | `Degraded: quality reuse — not run (<reason>)` |
| UX | the diff touches UI files **and** `aw-verify` ran in this run | one fresh-context sub-agent: `Agent(prompt="Skill(\"ux\", \"audit <changed UI files> --screenshots <aw-verify image paths>\") — report only, at most 6 findings")` | `Degraded: quality ux — not run (<reason>)` |

1. The UX lane runs in a dispatched sub-agent, never in this context: the builder grading its own UI is the bias the lane exists to remove. No dispatch tool → `Degraded: quality ux — not run (sub-agent dispatch unavailable)`.
2. Pass the screenshot paths `aw-verify` already captured — the image paths listed in `.agent/{branch}/verify/findings.jsonl` `evidence` and `.agent/{branch}/verify/probes.jsonl` `screenshots` (on the `aw-executor` route, the `aw-tester` capture paths); never start a browser or a stack for this lane.
3. `ux` grades against `.agents/aw/ux.md` when the repo has one (format: the `ux` skill's `rules/house-rubric.md`), else with its own defaults.
4. A UI diff where `aw-verify` did not run → `quality ux — skipped (trigger not met: aw-verify did not run)`; no UI file → `skipped (trigger not met: no UI file)`.
5. Each lane's result is a `companion:` line ([`companion-skills.md` § The companion report](./companion-skills.md#the-companion-report)); a failed lane is a `Degraded:` line, never a stop.

## Output — `.agent/{branch}/quality-notes.md`

```markdown
## Quality notes

**Reuse** — <the fit count line, or "not run (<reason>)">
| Item | Verdict | Existing | Severity |
| --- | --- | --- | --- |
| <fit's reuse and extend rows, then new rows> |

**UX** — rubric: <.agents/aw/ux.md | none> · <N findings | not run (<reason>) | skipped (<reason>)>
- <Severity> · <title> · `<file:line>` — <fix in one line>
```

- Copy the lanes' rows verbatim; never re-judge them here.
- Write the file even when both lanes were skipped: the reviewer reads why.
- `aw-create-walkthrough` copies the file into `## Quality notes`; `create-pr` writes the `aw:quality-notes` PR-body block from it (the `create-pr` skill's `rules/description-contract.md`).
