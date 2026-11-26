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
A Ready `proceed` recorded with `--no-ci` stores `ci.no_ci: true` on `no checks reported` evidence; `--record` exits 2 when the repo (cwd, or `--repo-dir`) has a workflow on pull_request or push, and `--next` accepts the entry as Ready evidence only with that flag.

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

1. A title line: the mascot's face in the state's mood (`assets/mascot/<mood>.png`), a bold "Atelier" linked to the skill's [`README.md`](../README.md) (`README_URL`), and the state in a few words from `card.mjs`'s `verdict().title` ("Verified, merge next", "Held at Verify").
   It is plain bold text, not a heading, so it never outweighs the card or the action box.
2. The status card, its stages titled by `card.mjs`'s `STAGE_TITLE` ("Build & review", "Verify", "Merge", "Deliver"); the stored stage keys stay `build`, `ready`, `merge`, and `deliver`, so `--next`, `--record`, and old comments are unchanged: `assets/cards/<build>-<ready>-<merge>-<deliver>-<light|dark>.png` in a `<picture>` at `width="100%"`, picked by `card.mjs` from the last recorded stage (`state.stage`), linked from `main` on `raw.githubusercontent.com`.
   The card is the pipeline alone on a transparent background: one node per stage with its icon, a status badge, the stage name, and a status word, so the state never rests on colour alone.
   Nothing run-specific goes in the card: one PNG serves every PR in that state, so the head and the time stay text.
3. The action, only when the last stage stopped: one GitHub alert, `[!CAUTION]` after `failed` or `refuse`, `[!WARNING]` after `hold`.
   A run that is moving on or done shows no alert, since the title and card already say so; its `**Next:**` or `**Done:**` line opens Run details.
   A stop leads with a bold `<Stage> <outcome>: <reason>.`, or `<Stage> <outcome>: fix N things, then re-run.` and one numbered line per problem when the reason holds several, then the re-run command on its own fenced line with the PR's URL.
   Preflight never shows above the footer: a gap that caused the stop is already a problem in the reason (Step 0's preflight table puts it there), and any other gap is in Run details.
4. A footer: the head and `<relative-time>`, which GitHub shows as "2 minutes ago".
5. `Run details`, collapsed: one row per stage with `<relative-time>`, the `**Next:**` or `**Done:**` line, the CI evidence, the preflight line, and the re-run command.

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

## Checklist

The after-Build checklist (SKILL.md § After Build returns) runs before Build is recorded, so it has no comment to live in; `state.mjs --checkpoint` writes it to `<run dir>/checklist/<owner>-<repo>-<n>.json`, beside the telemetry ledger.
Steps run in order: `companions` (stores aw's hand-back, holds across heads), `sentinel`, and `early-gate` (each holds only for the head it ran on).
`state.mjs --resume-step --pr <url> --head <sha>` prints `RESUME: none` (no checkpoint), the first step not done, or `record` (every step done on this head); `--aw-out <f>` writes the stored hand-back back out.

```text
✗ /atelier <pr-url> on a PR whose run died after the companions check → Build skipped (existing PR)   # sentinel and early gate never ran
✓ /atelier <pr-url> → state.mjs --resume-step → RESUME: sentinel → Build resumes at step 3 with aw.txt
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
