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

Per stage (`build`, `ready`, `merge`, and display-only `deliver`): `decision` (`proceed | skipped | refuse | hold | failed`), `at` (ISO 8601), `sha` (head the stage ran on), `reason`.
A Ready `proceed` also carries `ci`: the `prepare` helper `ci-ran.mjs`'s verdict (`state`, `ran`, `head`, `reason`), passed as `--record … --ci-file ci.json`.
`--record` refuses Ready `proceed` (exit 2) unless that verdict is `green` with `ran: true` at `--head`.
The preflight line is stored at the top level of the state by the first `--record … --preflight "<line>"` and kept by every later record.
A Build `hold` for companions that did not run carries reason `skipped: <names>`, which `state.mjs --companions` prints.

```text
✗ node state.mjs --record --stage build --decision proceed --reason "Degraded: review-loop skipped"   # an unreviewed PR walks on
✓ node state.mjs --companions --aw-file aw.txt   # COMPANIONS: hold — skipped: review-loop → record Build hold with that reason
```

```text
✗ node state.mjs --record --stage ready --decision proceed --head b56dfb5 --reason "16 checks skipped on draft"
✓ node ci-ran.mjs --pr <pr-url> --head b56dfb5 > ci.json   # CI: not-run → record Ready hold instead
```

## Comment

`render()` writes, in order:

1. The status card: `assets/cards/<build>-<ready>-<merge>-<deliver>-<light|dark>.png` in a `<picture>`, picked by `card.mjs` from the last recorded stage (`state.stage`), linked from `main` on `raw.githubusercontent.com`.
   The card is the pipeline alone on a transparent background: one node per stage with its icon, a status badge, the stage name, and a status word, so the state never rests on colour alone.
2. The action, only when the last stage stopped: one GitHub alert, `[!CAUTION]` after `failed` or `refuse`, `[!WARNING]` after `hold`.
   A run that is moving on or done shows no alert, since the card already says so; its `**Next:**` or `**Done:**` line opens Run details.
   A stop leads with a bold `<Stage> <outcome>: <reason>.`, or `<Stage> <outcome>: fix N things, then re-run.` and one numbered line per problem when the reason holds several, then the re-run command on its own fenced line with the PR's URL.
   Preflight never shows above the footer: a gap that caused the stop is already a problem in the reason (Step 0's preflight table puts it there), and any other gap is in Run details.
3. A footer: the mascot's face in the state's mood (`assets/mascot/<mood>.png`), "Atelier" linked to the skill's [`README.md`](../README.md) (`README_URL`), the head, and `<relative-time>`, which GitHub shows as "2 minutes ago".
4. `Run details`, collapsed: one row per stage with `<relative-time>`, the `**Next:**` or `**Done:**` line, the CI evidence, the preflight line, and the re-run command.

### Reasons

Write a recorded reason as one clause per problem, separated by `; `, each naming what is wrong in words a reader can act on; the comment turns each clause into its own line.
A script's machine line (`CI_WAIT: …`, `APPROVAL_WAIT: …`, `PIPELINE: …`) stays one problem: its own `; ` joins parts of one result.

```text
✗ --reason "merge gate could not run, gh GraphQL is blocked (HTTP 403) and companions hold since review-loop hit its cap"
✓ --reason "merge gate could not run: gh GraphQL is blocked in this session (HTTP 403); review-loop hit its cap, so the last fixes are unreviewed"
```

`--record` refuses a stage and decision pair `card.mjs` has no card for (`ENDINGS`), and `--stage deliver` before a merge recorded `proceed`.
A change to `card.mjs` or `mascot.mjs` re-renders the cards (`render-cards.mjs`, needs Chrome) and the [gallery](../scripts/fixtures/comments/README.md) (`gallery.mjs`) in the same commit.

```text
✗ edit card.mjs, commit                         # comments link cards that no longer match the code
✓ node render-cards.mjs && node gallery.mjs      # gallery.mjs --self-test fails on a stale README or a missing card
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
