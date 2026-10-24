---
title: Report — one consistent shape, progressive disclosure, real screenshots and recordings
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
Same blocks in the same order every run, so two reports compare line by line; a part with nothing to say is omitted only where the template marks it optional (`{{FIXES_PART}}`, `{{NOTES_PART}}`, `{{SKIPPED_LINE}}`).
Prose is conclusion-first, with no filler.

## Verdict

Every condition counts only findings with `in_scope: true`; an `in_scope: false` finding is a **Notes** line (`Outside this PR:`) and never moves the verdict. An open `critical`/`high` one still reaches the attention line ([`pr-comment.md § Attention line`](./pr-comment.md#attention-line)).

| Verdict | Condition |
| --- | --- |
| `✅ verified` | Every AC passes in the browser, no telemetry journey `contradicts`, no `open`/`escalated` finding of severity `high` or `critical` |
| `⚠️ verified with open items` | Every AC passes; some `medium`/`low` findings open, or any finding escalated |
| `❌ not verified` | An AC fails after the fix loop, a brief `telemetry:` AC `contradicts`, or a `critical`/`high` finding is still open |
| `⛔ blocked` | A phase could not run (stack, auth, checkout); name the phase and the fix |

## Placeholders

The layout is [`pr-comment.md § Layout`](./pr-comment.md#layout-verdict-checks-then-collapsed-detail): a green run shows the verdict, one sentence, the metadata line, a media strip (one recording, then up to two screenshots), and closed check rows; everything else sits in one closed **Details** block.

| Placeholder | Content |
| --- | --- |
| `{{VERDICT_EMOJI}}` / `{{VERDICT_WORDS}}` | `✅` `Verified`, `⚠️` `Verified with open items`, `❌` `Not verified`, or `⛔` `Blocked` (§ Verdict) |
| `{{HEADLINE}}` | What the change does, in the user's words; the whole `##` line under 70 characters |
| `{{SUMMARY}}` | One sentence: what works for the user |
| `{{ATTENTION}}` | The line [`pr-comment.md § Attention line`](./pr-comment.md#attention-line) picks for the verdict: ✅ `**Nothing needs your attention.**`; ⚠️ `**Why not ✅:**` and the open items; ❌ `**Needs you:**` and the failed checks, then in-scope `critical`/`high` findings; ⛔ `**Needs you:**`, the phase, and the fix. Under every verdict, an open `critical`/`high` finding that does not move it is a `**Needs you:**` bullet. At most three bullets, then `+<n> more in Details` |
| `{{HEAD_SHA7}}` / `{{ENV}}` / `{{CI_STATE}}` / `{{FINDING_COUNT}}` | Seven-character head SHA; `local` or `preview`; `CI green` or the red checks; `<n> findings` |
| `{{UPDATED}}` | Left as is: `verify-comment.mjs` stamps the write time |
| `{{MEDIA_STRIP}}` | Per [`pr-comment.md § Media strip`](./pr-comment.md#media-strip): one visible recording (caption line, then the bare `.mp4` URL), then one visible row of up to two `<img width="420">` thumbnails, failed checks first, headers under 40 characters; the rest in a closed `+<r> more recordings · +<n> more screenshots` block, recordings first, never more than two columns; nothing when the run has no media |
| `{{CHECK_ROWS}}` | One `<details>` per AC, spec, and probe that broke something, per [`pr-comment.md § Check rows`](./pr-comment.md#check-rows): `<emoji> <b><what I did></b> → <what happened>`; failed rows first and open, the rest closed; one or two sentences ending in `<sub>Proves AC-n</sub>`; no recordings or screenshots |
| `{{SKIPPED_LINE}}` | `⏭️ *Not checked <where>: <what>; <what covers it instead>.*`, or nothing |
| `{{APPROACH}}` / `{{IMPACT_MAP}}` | One paragraph on how the run tested the feature; the PR's impact map per [`pr-comment.md § Impact map`](./pr-comment.md#impact-map) |
| `{{PROBE_RESULT}}` / `{{PROBE_LINES}}` | `<n> probes, nothing broke`, `<n> probes, <k> broke`, or `skipped (<reason>)`; one `- what I tried → what happened` line per probe |
| `{{FIXES_PART}}` | When a fix was pushed: `**Fixed during the run**` and one `- <sha7> (F-n) <what changed for the user>` line each, the `F-n` matching the `✅ after fix (F-n)` row it fixed; otherwise nothing |
| `{{TELEMETRY_VERDICT}}` / `{{FLOW_LINES}}` | The verdict word or `not reviewed (<reason>)`; one `- <journey>` line per AC from `telemetry.md`, then the ERROR-span line |
| `{{NOTES_PART}}` | When there are any: `**Notes**` and one line per not-defect, `medium`/`low` finding, out-of-scope finding (`Outside this PR:`), `n/a` edge row, or lesson written; otherwise nothing |
| `{{TRACE_ROWS}}` | One row per AC, edge row, and probe: ID, criterion, result (`✅ pass`, `✅ after fix (F-1)`, `❌ fail (F-2)`, `⏭️ skipped (<reason>)`), witnesses (`browser · telemetry`, `unit tests`). Text only |
| `{{URL}}` / `{{DRIVER}}` / `{{RECORDINGS_LINE}}` | The URL the run used (`localhost` as text); the browser driver; `recordings: not attached (<reason>)` when the region holds none, else nothing |
| `{{TICKET_LINK}}` / `{{PR_LINK}}` | `· <ticket link>` from the brief, or nothing; the PR URL |

## Media

Collect, upload, and embed every screenshot **and recording** per [`pr-comment.md § Media`](./pr-comment.md#media): image paths from `findings.jsonl` `evidence` and `probes.jsonl` `screenshots`, video paths from `probes.jsonl` `recordings` and the adversarial findings' `evidence`.
Upload only when the comment will post ([`pr-comment.md § When to post`](./pr-comment.md#when-to-post)); otherwise each check row says `not attached (<reason>)` and the terminal lists every file's absolute path.

## Destinations

1. **File:** `.agent/{branch}/verify/report.md` — always.
2. **PR comment** — the rendered report is the `aggregate` region, written after the fix loop has pushed so it describes the final head SHA:

   ```bash
   node "${CLAUDE_SKILL_DIR}/scripts/verify-comment.mjs" --pr "$PR_URL" --section aggregate --file .agent/<branch>/verify/report.md --replace-all
   ```

   Gate, `mcp` path, and exit codes: [`pr-comment.md`](./pr-comment.md). The script refuses a region that holds a local path, a token is never rendered, and a request body is summarized, never pasted.
3. **Terminal** — printed last: the verdict line, the summary sentence, the attention line with every open finding, the report path, the `comment:` line, and the absolute path of every screenshot and recording that was not attached.

## `report` mode

Re-render from the existing run directory, re-run the Media steps, upsert the `aggregate` region (always, on any PR), and print the terminal block.
Missing run directory → `no verify run found for <branch>`.
