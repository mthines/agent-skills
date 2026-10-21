---
name: impact-map
description: >
  Builds an impact-first view of a GitHub PR: a verdict with expandable What/Risk/Ask rows,
  one diagram colored new/changed/removed, at most three decisions with linked lines, and
  what is already settled. Every claim is checked against code, tests, and docs first.
  --comment or --body posts it to the PR with light and dark PNGs. Triggers on
  "impact map", "visualize this PR", "/impact-map".
argument-hint: '<pr-url|#n> [--comment] [--body] [--dry-run] [--findings <report-body.md>]'
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: advisory
  tags:
    - pull-request
    - impact-analysis
    - code-review
    - architecture-diagram
    - risk
    - visualization
---

# Impact Map

Turns a PR into the few things a reviewer must decide, with the system change drawn once and every decision linked to the lines that carry it.
The reader cares about impact, architecture, and risk, not line-by-line code.

> **This `SKILL.md` is a thin index.** Rules load per phase from `rules/`; the page and comment skeletons are in `templates/`.
> Why the format is this small, and the 2025–2026 research behind it: [`references/design-rationale.md`](./references/design-rationale.md).

Two scripts do the mechanical parts; run them, never hand-compute their output:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/line-link.mjs" locate pr.diff <path> '<regex>'   # new-side line numbers
node "${CLAUDE_SKILL_DIR}/scripts/line-link.mjs" url --repo <o/r> --pr <n> --sha <head> --path <p> --lines <a-b> --files <count>
node "${CLAUDE_SKILL_DIR}/scripts/render-png.mjs" <page.html> <out-dir>        # light + dark diagram PNGs
```

## Arguments

| Argument | Default | Effect |
| --- | --- | --- |
| `<pr-url\|#n>` | the current branch's PR | The PR to map. |
| *(none)* | yes | Build the page only: publish it as an Artifact when the host has the Artifact tool, else write `.agent/{branch}/impact-map/pr-<n>.html`. |
| `--comment` | — | Also post the map as a PR comment with the diagram as light and dark PNGs. A re-run edits the same comment. |
| `--body` | — | Also write the map into the PR description's owned region, above the author's text. A re-run replaces the region. |
| `--dry-run` | — | Build the page, the PNGs, and the comment Markdown; post nothing. |
| `--findings <report-body.md>` | — | Diagram only, for a `pr-reviewer` report: badge each box with the numbers of that report's findings table and print the PNG paths and the alt text. Skips phases 3 and 6, builds phase 5's page file locally (`.agent/{branch}/impact-map/pr-<n>.html`, never published as an Artifact) because `render-png.mjs` reads it, and writes nothing to GitHub. Procedure: [`rules/diagram.md § Badges from a pr-reviewer report`](./rules/diagram.md#badges-from-a-pr-reviewer-report). |

`--comment` and `--body` are the user's consent to write to GitHub.
Without either flag, write nothing to GitHub.

## Workflow

| Phase | Name | Rule | Gate |
| --- | --- | --- | --- |
| 0 | Fetch | [`rules/analysis.md § Fetch`](./rules/analysis.md#fetch) | Diff, description, head SHA, and merge base in hand |
| 1 | Candidates | [`rules/analysis.md § Candidates`](./rules/analysis.md#candidates) | Every live-on-merge surface walked |
| 2 | Verify | [`rules/analysis.md § Verify`](./rules/analysis.md#verify) | Every candidate classified open / settled / wrong, with evidence |
| 3 | Decide | [`rules/analysis.md § Decide`](./rules/analysis.md#decide) | ≤ 3 decisions, each What / Risk / Ask and ≤ 3 linked lines |
| 4 | Diagram | [`rules/diagram.md`](./rules/diagram.md) | One SVG, ≤ 14 boxes, decision badges placed |
| 5 | Page | [`rules/outputs.md § Page`](./rules/outputs.md#page) | Page built from `templates/page.html` and published or written |
| 6 | Post | [`rules/outputs.md § Comment and body`](./rules/outputs.md#comment-and-body) | Only with `--comment` / `--body`: PNGs uploaded, posted, read back clean |

## Shape of the result

Every output has the same five parts, in this order, and nothing else:

1. **Title and Why** — the PR's purpose in one sentence a reviewer would say aloud.
2. **Verdict** — one sentence, then one expandable row per decision (badged ①②③) plus at most one unbadged "also live on merge" row.
   Each row opens to **What**, **Risk**, and **Ask**, one sentence each, and links to its lines.
   Under the rows, one **Verified / Not run** line.
3. **Diagram** — the system after merge, colored by what the PR did to each part, with decision badges on the boxes they concern.
4. **Decisions** — each with its linked lines and the question to answer at each line.
   In a PR comment the expandable rows *are* the decisions; do not repeat them.
5. **Already settled** — things that look risky but are intended, each citing the test, doc, or description line that settles it, plus one "safe to skim" line.

```text
✗ Wrong — a survey: risk matrix, LOC bars, contract tables, stack chips, 9-file tour, then decisions, then a separate "where to look" list
✓ Right — verdict rows → one diagram → three decisions holding their own links → settled
```

## Core rules

1. **No claim without evidence.** A risk that a test, doc, or the description already settles goes under "Already settled", never under a decision.
2. **Questions, not findings.** Each decision ends in an Ask the reviewer can answer yes/no or by choosing between two options.
3. **Red means exposure only** — a caller that can reach new code on merge, an unverified safety net, a "not in description" tag.
4. **Name description drift.** When the PR body says something the code does not do, tag the decision it belongs to.
5. **Never write to GitHub without `--comment` or `--body`.**

## Report

End with one block:

```text
impact-map: <pr-url> · <n> decisions · <n> settled
  page:    <artifact-url | local path>
  comment: <comment-url | not posted>
  body:    <updated | not written>
```
