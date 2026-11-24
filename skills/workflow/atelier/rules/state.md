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
A Ready `proceed` also carries `ci`: the `prepare` helper `ci-ran.mjs`'s verdict (`state`, `ran`, `head`, `reason`), passed as `--record … --ci-file ci.json`.
`--record` refuses Ready `proceed` (exit 2) unless that verdict is `green` with `ran: true` at `--head`.
At the top: the last stage recorded and, after a `refuse`, `hold`, or `failed`, its reason (`· refused: …`, `· held: …`, `· failed: …`).

```text
✗ node state.mjs --record --stage ready --decision proceed --head b56dfb5 --reason "16 checks skipped on draft"
✓ node ci-ran.mjs --pr <pr-url> --head b56dfb5 > ci.json   # CI: not-run → record Ready hold instead
```

## Resume

`state.mjs --next --head <current head>` returns the stage to run:

| State | Next |
| --- | --- |
| no comment | `build` (or `ready` once Build is recorded `skipped` for an existing PR) |
| a stage with no entry, or `refuse` / `hold` / `failed` | that stage |
| Ready `proceed` on a head other than the current one, merge not done | `ready` |
| Ready `proceed` with no `ci` evidence, or evidence that is not `green` on the current head | `ready` |
| merge `proceed` | `stop` |

```text
✗ head moved after Ready (a review fix was pushed) → run the merge gate on the old Ready result
✓ state.mjs --next --head <new sha> → ready → prepare runs again on the new head
```

```text
✗ gh pr comment <n> --body-file next.md          # a second comment; the next run reads the first
✓ state.mjs --upsert --pr <n> --body-file next.md  # edits the one marked comment
```
