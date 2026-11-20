---
title: Plan mode — an impact map for a plan, a design, or a branch with no PR
impact: MEDIUM
tags:
  - impact-map
  - plan
---

# Plan mode

Read when the request names a plan, a design, or a branch and no PR exists (`--plan <file>`, `--branch <ref>`, or a request such as "show me the change for this plan").
The six-part result, the diagram grammar, and the decision rules are the same; only the source of the facts and the places that name a PR change.

## Contents

- [Sources](#sources)
- [Phases that change](#phases-that-change)
- [Page slots](#page-slots)
- [What plan mode never does](#what-plan-mode-never-does)
- [Report](#report)

## Sources

| Argument | The change is | Facts come from |
| --- | --- | --- |
| `--plan <file>` | What the plan says will change | The plan, plus the code it names, read at a base commit |
| `--branch <ref>` | `git diff $(git merge-base origin/<base> <ref>)...<ref>` | The diff, as in PR mode |
| a plan in the conversation | What was discussed | Write the plan to `.agent/{branch}/impact-map/plan.md` first, then use `--plan` |

The base commit is the checkout the code was read at: `git rev-parse --short HEAD` of the worktree, or the base branch's head.
Record it; the links and the footer need it.
A link only works when GitHub has that commit: check `git branch -r --contains <sha>`. When the commit exists only locally, link the merge base with the default branch instead, and write a planned or unpushed file's path as `<code>`.

## Phases that change

| Phase | In plan mode |
| --- | --- |
| 0 Fetch | Skip `gh pr view` and `gh pr diff`. Read the plan, list the files and tables it names, and read each one at the base commit. Record `BASE_SHA` in place of `HEAD_SHA` and the file count in place of the PR's |
| 1 Candidates | Walk the same rows against the **planned** change. A row stays empty when the plan does not touch it. Mark a surface as planned, never as live |
| 2 Verify | Read the code the plan builds on. A claim in the plan that the code contradicts is a decision. Nothing is "verified by the author": use `Verified: read <files> at <sha>` and `Not run: nothing is built yet` |
| 3 Decide | Unchanged: at most three decisions, each What / Risk / Ask. An Ask the code already answers moves to Already settled |
| 4 Diagram | Unchanged, plus the [compare view](./compare.md): a plan almost always changes an existing flow, so build Today and After on the same layout. Boxes the plan creates are `new`, boxes it edits are `mod`, edges to code that does not exist yet are dashed. Never `risk`: nothing is exposed until it ships |
| 4b Migration | Only when the plan adds or alters a table; draw it from the plan's columns and say `planned` in the verdict line |
| 5 Page | [Page slots](#page-slots) |
| 6 Post | Never runs ([What plan mode never does](#what-plan-mode-never-does)) |

## Page slots

Keep the stylesheet unchanged. Fill the slots that name a PR as follows.

| Slot | Plan mode value |
| --- | --- |
| Eyebrow | `Impact map · plan, no PR yet` and, when known, the branch the code was read on |
| Title (`<title>`) | `<Subject> Impact Map` |
| Why | The plan's purpose in one sentence |
| Meta | `base <short sha>` and `about <n> files (estimate)`; no author and no `+/−` counts |
| Line links | A blob link at `BASE_SHA` (a pushed commit, see [Sources](#sources)) for code that exists today: `https://github.com/<o>/<r>/blob/<sha>/<path>#L<a>-L<b>`. Add a line anchor only for a line you read. A planned file has no link, so write its path as `<code>` |
| Proof line | Replace the label `Verified by the author:` with `Verified:` |
| Legend | Drop `Exposed on merge`; use `Planned, not built` for the dashed edge |
| Local file | `.agent/{branch}/impact-map/plan.html` when the host has no Artifact tool |
| Footer | `Built from the plan and the code at <sha>, <date>. File counts are estimates. Nothing was run.` |

Say "planned" or "proposed" wherever the Where it shows up table names a gate, so a reader never takes it for something live.

## What plan mode never does

- No `--comment` and no `--body`: there is no PR to write to, and nothing is uploaded.
- No `line-link.mjs` PR anchors (`#diff-…`): they need a PR.
- No claim that something ships, is gated, or is exposed. The plan is a proposal.
- No invented numbers. A count the plan does not give is an estimate, labelled as one.

## Report

```text
impact-map: plan <path or branch> · <n> decisions · <n> settled
  page:    <artifact-url | local path>
  comment: not applicable (no PR)
  body:    not applicable (no PR)
  pngs:    <rendered | not rendered (no Chrome)>
  migration: <planned: safe | needs care | unsafe | none in plan>
```
