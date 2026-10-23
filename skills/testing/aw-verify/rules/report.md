---
title: Report — one consistent shape, three destinations, real screenshots and recordings
impact: MEDIUM
tags:
  - report
  - pr-comment
  - screenshots
  - attach-media
  - recordings
---

# Report

Phase 5 renders [`templates/report.md.template`](../templates/report.md.template) from `intent.md`, `findings.jsonl`, `probes.jsonl`, `telemetry.md`, and the git log.
Same sections in the same order every run, so two reports compare line by line.
Prose is conclusion-first, with no filler.

## Verdict

| Verdict | Condition |
| --- | --- |
| `✅ verified` | Every AC passes in the browser, no telemetry journey `contradicts`, no `open`/`escalated` finding of severity `high` or `critical` |
| `⚠️ verified with open items` | Every AC passes; some `medium`/`low` findings open, or any finding escalated |
| `❌ not verified` | An AC fails after the fix loop, a brief `telemetry:` AC `contradicts`, or a `critical`/`high` finding is still open |
| `⛔ blocked` | A phase could not run (stack, auth, checkout); name the phase and the fix |

## Placeholders

The layout is [`pr-comment.md § Layout`](./pr-comment.md#layout-summary-then-one-section-per-spec): a text-only summary table, then one section per spec with its media inline.

| Placeholder | Content |
| --- | --- |
| `{{BLUF}}` | Two sentences max: the verdict in words, what was fixed, what needs a human |
| `{{CI_STATE}}` / `{{TELEMETRY}}` | `CI green` or the red checks; the telemetry backend and scope (`telemetry from dash0-dev, dataset alice-local`), or `telemetry not reviewed: <reason>` |
| `{{ENV}}` / `{{URL}}` | `local` or `preview`, and the URL the run used (`localhost` URLs are printed as text, not links) |
| `{{SUMMARY_ROWS}}` | One row per AC, then per probed edge row: ID, the criterion or probe in one line, and the result with its witnesses, e.g. `✅ browser · telemetry confirms`, `✅ after fix (F-1)`, `❌ fail (F-2)`, `✅ unit tests`. Text only — no media, no links |
| `{{SPEC_SECTIONS}}` | One `#### <IDs> · <name> · <result>` section per spec, edge row, or recording with evidence: one or two sentences (what the user did, why, what happened), then each screenshot as an image embed `![caption](https://…)` and the recording as its bare `.mp4` URL on its own line. A file not uploaded → `not attached (<reason>)` |
| `{{ADVERSARIAL}}` | The `adversarial:` summary line `ui-verify` printed, then one `####` section per finding in the `{{SPEC_SECTIONS}}` shape (before/after images, recording); or its `skipped (…)` line |
| `{{FLOW_LINES}}` | One bullet per journey from `telemetry.md`, latest window per AC, e.g. `Save: POST /api/views 201 → views-service PUT (21 ms) → postgres INSERT (4 ms)`; then the ERROR-span line. Skipped → `not reviewed: <reason>` |
| `{{FIX_ROWS}}` | Short SHA and the one-line user-visible change. Empty → "No code changes." |
| `{{OPEN_ROWS}}` | Every open, escalated, or out-of-scope finding by severity: ID, severity, what (`Outside this PR:` prefix when `in_scope: false`), next step. Empty → "None." |
| `{{NA_ROWS}}` / `{{LESSON_LINES}}` | Edge rows marked `n/a` with the reason; lessons written this run (key only) and promotion-eligible lessons. Empty → "None." |

## Media

Collect, upload, and embed every screenshot **and recording** per [`pr-comment.md § Media`](./pr-comment.md#media): image paths from `findings.jsonl` `evidence` and `probes.jsonl` `screenshots`, video paths from `probes.jsonl` `recordings` and the adversarial findings' `evidence`.
Upload only when the comment will post ([`pr-comment.md § When to post`](./pr-comment.md#when-to-post)); otherwise each section says `not attached (<reason>)` and the terminal lists every file's absolute path.

## Destinations

1. **File:** `.agent/{branch}/verify/report.md` — always.
2. **PR comment** — the rendered report is the `aggregate` region, written after the fix loop has pushed so it describes the final head SHA:

   ```bash
   node "${CLAUDE_SKILL_DIR}/scripts/verify-comment.mjs" --pr "$PR_URL" --section aggregate --file .agent/<branch>/verify/report.md --replace-all
   ```

   Gate, `mcp` path, and exit codes: [`pr-comment.md`](./pr-comment.md). The script refuses a region that holds a local path, a token is never rendered, and a request body is summarized, never pasted.
3. **Terminal** — printed last: the verdict line, the BLUF, the findings table, the report path, the `comment:` line, and the absolute path of every screenshot and recording that was not attached.

## `report` mode

Re-render from the existing run directory, re-run the Media steps, upsert the `aggregate` region (always, on any PR), and print the terminal block.
Missing run directory → `no verify run found for <branch>`.
