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

| Placeholder | Content |
| --- | --- |
| `{{BLUF}}` | Two sentences max: the verdict in words, what was fixed, what needs a human |
| `{{AC_ROWS}}` | One row per criterion: ID, the criterion verbatim, Why (the requirement it covers, `R-n` or the PR's stated behavior), then the Checks, Browser, and Telemetry witnesses, then Evidence |
| `{{EC_ROWS}}` | One row per probed edge row: ID, the probe, Why (its class and what it protects, e.g. `Failure — guardrail: a failed save keeps the input`), Result, Evidence |
| Result cells | `pass`, `fixed → pass (F-n)`, `fail (F-n)`, or `skipped (reason)` |
| Evidence cells | Uploaded links per [`pr-comment.md § Rows`](./pr-comment.md#rows-what-why-result-evidence): `[S-n](https://…)`, `[▶ R-n](https://…)`, a trace link, or the HTTP status — never a file path |
| `{{FINDING_ROWS}}` | Every finding by severity, with its Evidence links; `in_scope: false` rows prefixed `pre-existing:` |
| `{{FIX_ROWS}}` | Short SHA, finding ID, one-line change, the probe that re-verified it. Empty → "No code changes." |
| `{{ADVERSARIAL}}` | The `adversarial:` summary line `ui-verify` printed, then one row per probe (`ADV-NN`, the probe, Why: its oracle, Result, Evidence with the before/after images and the recording); or its `skipped (…)` line |
| `{{TELEMETRY}}` | The backend and its scope from the `TELEMETRY` headers, e.g. `dash0-mcp · dataset alice-local` or `logs`; skipped → `not reviewed: <reason>` |
| `{{FLOW_LINES}}` | The `AC-n <verdict> — <journey>` lines from `telemetry.md`, latest window per AC, e.g. `AC-2 confirms — click "Save" → POST /api/views 201 → views-service PUT (21 ms) → postgres INSERT (4 ms)` |
| Witness columns | Checks: the AC's `run-checks` status from `.agent/{branch}/checks.yaml`, or `—` without a brief. Browser: the result. Telemetry: the AC's journey verdict (`confirms`, `contradicts`, `ambiguous`, `null`), or `—` when skipped |
| `{{ENV}}` / `{{URL}}` | `local` or `preview`, and the URL the run used (`localhost` URLs are printed as text, not links) |
| `{{MEDIA}}` | The gallery per [`pr-comment.md § Media`](./pr-comment.md#media); or `not attached (<reason>)` |
| `{{OPEN_ITEMS}}` | Each open or escalated finding: what is needed, the options, your recommendation. Empty → "None." |
| `{{LESSON_LINES}}` | Lessons written this run (key only) and promotion-eligible lessons with the suggested edit. Empty → "None." |

## Media

Collect, upload, and embed every screenshot **and recording** per [`pr-comment.md § Media`](./pr-comment.md#media): image paths from `findings.jsonl` `evidence` and `probes.jsonl` `screenshots`, video paths from `probes.jsonl` `recordings` and the adversarial findings' `evidence`.
Upload only when the comment will post ([`pr-comment.md § When to post`](./pr-comment.md#when-to-post)); otherwise `{{MEDIA}}` is `not attached (<reason>)` and the terminal lists every file's absolute path.

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
