---
title: Deep flag — widen the alternative search with critical deep
impact: MEDIUM
tags:
  - optimize-approach
  - deep
  - critical
  - multi-lens
  - end-of-feature
---

# Deep Flag

`--deep` widens O2's search for a better approach: before judging, it runs `critical` in `deep` mode and feeds every lens's alternative into the optimality rubric as a candidate.
It is the end-of-feature check — "was this feature built the best way, judged from several angles?" — in one command.
**Why:** a single context proposes the alternatives it already thought of; independent persona lenses surface approaches the author and a single reviewer both missed.

## Contents

- [Who may set it](#who-may-set-it)
- [Procedure](#procedure)
- [What changes and what does not](#what-changes-and-what-does-not)
- [Standalone output](#standalone-output)
- [Common mistakes](#common-mistakes)

## Who may set it

| Context | `--deep` allowed? |
| --- | --- |
| Standalone `/optimize-approach [report\|apply\|plan] --deep` | Yes |
| `polish`, `pr-reviewer`, `aw-planner`, any calling agent | **No** — never set it; the default-on lens stays a single pass |

A calling agent that receives `--deep` from its own caller drops it and logs `optimize-approach --deep ignored (caller: <name>)` — the caller-side copy of this rule lives in `agents/shared/rules/optimality-review.md` § What this rule does not do.
`--deep` is unrelated to `pr-reviewer`'s `deep` depth tier: that tier runs this skill as a single pass.
**Why:** deep costs ~5 sub-agent dispatches; inside a default-on lens that runs on every review, that cost is paid on changes that do not need it.

## Procedure

`--deep` inserts step **O1b** between O1 and O2:

1. Map the mode to a `critical` target: `report`/`apply` → `code`; `plan` → `plan`.
2. Invoke `Skill("critical", "deep <target>")` on the same diff or plan.
   When `critical` is not installed, print `critical — skipped (not installed); --deep falls back to the single pass` and continue at O2 unchanged.
3. From the critical report, harvest the `Steelman alternative` and every line of `Other alternatives raised` into a candidate list: `{approach, lens, why_better}`.
4. Assign each candidate to the approach unit (from O1) it replaces; a candidate that replaces no unit is discarded.
5. Run O2 per unit with these candidates added to the ones this skill finds itself.
   Every candidate passes the same [optimality rubric](./optimality-rubric.md) — the four axes, all four anti-overlap guards, and the materiality bar — with no exemption for having come from a lens.

```text
✓ critical deep lens "performance-engineer" proposes: batch the per-item lookups into one query.
  Unit: per-item fetch loop in src/sync/pull.ts → performance axis fires, no guard, material → suboptimal → O4.
✗ critical deep lens "security-attacker" proposes: add rate limiting.
  No approach unit in the diff is replaced by it → discarded (a new concern, not a better approach to an existing unit).
```

## What changes and what does not

| Stays the same | Changes under `--deep` |
| --- | --- |
| The rubric, anti-overlap guards, and materiality bar | More candidates enter O2 |
| O4's `holistic-analysis` trace and `confidence(analysis)` gates (85 % report, 90 % apply) | The proposal record gains `source_lens: <name>` when the winning alternative came from a lens |
| The 2-proposal cap, and the quiet early-exit when every unit is `optimal` | Standalone output prints the critical deep findings in their own section |
| Apply-mode gates (`confidence(code) ≥ 90 %`, `apply_safe`, scoped check, revert-on-failure) | — |

Failure-mode findings from the critical report are **never** converted into optimality proposals — anti-overlap guard 2 still owns that line.

## Standalone output

Print, in this order:

1. The critical report's `Independence:` and `Lens discovery:` lines verbatim, so a reduced-independence or lost-lens run is never presented as a full multi-lens check.
2. The optimality cards and summary line exactly as [`report-mode.md`](./report-mode.md) defines them, with the summary extended: `· <k> lens candidate(s) judged`.
   When critical returned no `Steelman alternative` heading, print `critical deep: report unparseable — 0 lens candidates harvested` instead of a silent `0`.
3. A separate section with the critical report's `Must-fix` and `Should-fix` lists verbatim, under this heading:

```markdown
### Failure-mode findings (critical deep — not optimality proposals)
```

Omit that section when both lists are empty, and print `critical deep: no blocking concerns across <n> lenses.` instead.

## Common mistakes

- Treating every lens alternative as a proposal. **Fix:** each one is only a candidate; most correctly die at the anti-overlap guards or the materiality bar.
- Re-labelling a critical must-fix as a robustness proposal. **Fix:** robustness escalates only when the lens named a safer *approach* to an existing unit (guard 2).
- Setting `--deep` from `polish` or `pr-reviewer` "for a high-stakes PR". **Fix:** recommend `/optimize-approach --deep` to the human in the report instead.
