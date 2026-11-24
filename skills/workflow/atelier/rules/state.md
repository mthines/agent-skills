---
title: State — the stage machine lives in one sticky PR comment
impact: HIGH
tags: [atelier, state, resume, pr-comment]
---

# State

The run's state is one PR comment that starts with `<!-- atelier:v1 -->`, edited in place on every decision.
`scripts/state.mjs` is the only reader and writer of its format; never hand-edit the hidden state line.
**Why:** [`../references/design.md` § State in the PR](../references/design.md#state-in-the-pr).

## Shape

Per stage (`build`, `ready`, `merge`): `decision` (`proceed | skipped | refuse | hold | failed`), `at` (ISO 8601), `sha` (head the stage ran on), `reason`.
At the top: the last stage recorded and, after a `refuse`, the refusal reason.

## Resume

`state.mjs --next --head <current head>` returns the stage to run:

| State | Next |
| --- | --- |
| no comment | `build` (or `ready` once Build is recorded `skipped` for an existing PR) |
| a stage with no entry, or `refuse` / `hold` / `failed` | that stage |
| Ready `proceed` on a head other than the current one, merge not done | `ready` |
| merge `proceed` | `stop` |

```text
✗ head moved after Ready (a review fix was pushed) → run the merge gate on the old Ready result
✓ state.mjs --next --head <new sha> → ready → prepare runs again on the new head
```

```text
✗ gh pr comment <n> --body-file next.md          # a second comment; the next run reads the first
✓ state.mjs --upsert --pr <n> --body-file next.md  # edits the one marked comment
```
