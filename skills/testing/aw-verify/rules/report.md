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
Same blocks in the same order every run, so two reports compare line by line; a part with nothing to say is omitted only where the template marks it optional (`{{ATTENTION_PART}}`, `{{FIXES_PART}}`, `{{NOTES_PART}}`, `{{SKIPPED_LINE}}`).
Prose is conclusion-first, with no filler.

## Verdict

Every condition counts only findings with `in_scope: true`; an `in_scope: false` finding is a **Notes** line (`Outside this PR:`) and never moves the verdict.
An open `critical`/`high` one still reaches the attention line ([`pr-comment.md § Attention line`](./pr-comment.md#attention-line)).

| Verdict | Condition |
| --- | --- |
| `✅ verified` | Every AC passes in the browser on its own changed target, or is covered only by committed unit or component tests and listed under **Worth a look in the preview** ([§ Substitution](#substitution)); none is `⏭️` on any other stand-in, no telemetry journey `contradicts`, no `open`/`escalated` finding of severity `medium`, `high`, or `critical`. Open `low` findings, a telemetry witness that could not confirm a path with no `telemetry:` AC, and failures outside the PR do not count ([§ What never caps the verdict](#what-never-caps-the-verdict)) |
| `⚠️ verified with open items` | Every AC that ran passes; some `medium` findings open (a `criterion-quality` finding is `medium`), any finding escalated, an AC is `⏭️ not verified on target` on a stand-in other than committed tests, or a brief `telemetry:` AC has no confirming receipt after `telemetry-verify` tried every backend it could reach (`telemetry-verify` falls back to its `logs` backend for a `telemetry:` criterion instead of skipping) |
| `❌ not verified` | An AC fails after the fix loop, a brief `telemetry:` AC `contradicts`, or a `critical`/`high` finding is still open |
| `⛔ blocked` | A phase could not run (stack, auth, checkout), or no AC was verified on its target; name the phase and the fix |

The headline uses exactly one row's words: `Verified`, `Verified with open items`, `Not verified`, or `Blocked`.
Free text such as "works" or "verified on the scratch branch" is not a verdict.
A run on a merged PR starts `{{SUMMARY}}` with `Run after merge —` and lists every open `medium`-or-higher finding as a `Needs you` bullet ending `→ follow-up PR`.

## What never caps the verdict

A ✅ with a few notes is a pass: the verdict answers "does the change do what it promised", and a reviewer who sees ⚠️ expects a promise that went unchecked or a defect worth a decision.
None of these moves a run off ✅; each is a **Notes** line, never a `Why not ✅` bullet:

| Not a cap | Why | Where it goes |
| --- | --- | --- |
| An open `low` finding (copy, spacing, a rough edge, an observation) | Polish, no AC affected | **Notes**, `fine to merge as is` |
| Telemetry could not confirm a path that emits no signal (client-side), or no `telemetry:` AC exists and the server was unreachable | No promise rests on it | **Telemetry** line `no regression observed (path emits no signal)` or `not reviewed (<reason>)` |
| A test, check, or CI failure in code the PR did not change (`in_scope: false`) | Not this change | **Notes**, `Outside this PR:` |
| CI state, whether green, red, or not run on a draft | Not this run's result; CI has its own check on the PR | Nowhere: the report never mentions CI |
| An AC covered only by committed unit or component tests | A reviewer can look at it in the preview | `Worth a look in the preview`; the AC stays `⏭️` |

```text
✗ ⚠️ Verified with open items — one low rough edge open (a generic error toast), telemetry not connected
✓ ✅ Verified — Nothing needs your attention.   Notes: a generic toast when control-plane-api is down (low)
✗ ⚠️ … — 17 unrelated agents snapshot tests fail
✓ ✅ Verified …   Notes: Outside this PR: 17 agents snapshot tests fail on main
✓ ⚠️ Verified with open items — AC-5 not verified on target (no message sent)    # a promise went unchecked
```

A `low` finding becomes `medium` and caps the run only when it breaks a guardrail, loses data, or sits on an AC's own target.

## Substitution

A `ui:` AC is `✅ pass` only when the run exercised its own `Changed` target, performed its `[must-follow]` step there, and observed its outcome with evidence there.
An `api:` or `worker:` AC is `✅ pass` only when a probe hit its own endpoint or component and observed the outcome with evidence.
Anything else is `⏭️ not verified on target (<what ran instead>)`:

| What stood in | Example |
| --- | --- |
| A sibling surface | The automation edit form was checked; the SLO form was not reachable |
| Unit tests | `vitest` covers the fill; no browser run reached it (a **tests-only** criterion; see below) |
| A scratch branch carrying commits the PR lacks | The fix was verified on `main` plus a merge, not on the PR head |
| Demo or seeded data for a live source | A fixture bridge log, not a live bridge |
| A witness with no answer | The receipt's `[receipt] verdict:` is `ambiguous` or `null`, or the line is absent, for a `telemetry:` AC |

**Tests-only criteria.** An AC proved only by committed unit or component tests, with no stand-in from another row, stays `⏭️` and is listed under **Worth a look in the preview**, but does not cap the verdict: the run says plainly what a reviewer can still look at, and the test link in the criteria table is its proof.
Every other stand-in caps the run at `⚠️`.

Such an AC never shows `✅ pass`; its Proof cell in the criteria table names the substitute (`tests`, `sibling surface`, …). For a stand-in that caps the run, the `Why not ✅` bullet names the AC and the surface left uncovered; for a tests-only AC, **Worth a look in the preview** names it instead and no `Why not ✅` bullet is written.
`{{TELEMETRY_VERDICT}}` is copied from the receipt's `[receipt] verdict:` line, never re-derived from the per-AC lines.

```text
✗ AC-2 ✅ pass — automation edit form fills (SLO form unreachable)
✓ AC-2 ⏭️ not verified on target (SLO form unreachable; automation form checked instead)
✗ Telemetry: confirms (5 of 5 signals)        [receipt verdict: ambiguous, 1 signal missing]
✓ Telemetry: ambiguous (4 of 5 signals; AC-4 signal missing)
```

## Placeholders

The layout is [`pr-comment.md § Layout`](./pr-comment.md#layout-criteria-verdict-media-then-collapsed-detail): a green run shows the verdict, one sentence, the metadata line, the worth-a-look checklist when it has items, and a media strip (one recording, then up to two screenshots); the criteria sit above it in the `intent` region; everything else sits in one closed **Details** block.

| Placeholder | Content |
| --- | --- |
| `{{VERDICT_EMOJI}}` / `{{VERDICT_WORDS}}` | `✅` `Verified`, `⚠️` `Verified with open items`, `❌` `Not verified`, or `⛔` `Blocked` (§ Verdict) |
| `{{HEADLINE}}` | What the change does, in the user's words; the whole `##` line under 70 characters |
| `{{SUMMARY}}` | One sentence: what works for the user |
| `{{ATTENTION}}` | `**Nothing needs your attention.**` under a ✅ with no bullets; otherwise nothing |
| `{{ATTENTION_PART}}` | Per [`pr-comment.md § Attention line`](./pr-comment.md#attention-line): `#### Why not ✅` under ⚠️, ❌, and ⛔ (`#### Needs you` under a ✅ with bullets), then one `- **<what the user would notice>** (<tag>) → <next step>` bullet per item, a flag left set included, at most five; otherwise nothing |
| `{{HEAD_SHA7}}` / `{{ENV}}` / `{{FINDING_COUNT}}` | Seven-character head SHA; `local` or `preview`; `<n> findings` (`<n> findings (<k> fixed)` after a fix loop). Never a CI state |
| `{{WORTH_A_LOOK}}` | When a criterion is `⏭️` and covered only by tests: `#### Worth a look in the preview`, then one `- [ ] **AC-n:** <what to look at and where>` line each; otherwise nothing. A plain checklist, never a table |
| `{{UPDATED}}` | Left as is: `verify-comment.mjs` stamps the write time |
| `{{MEDIA_STRIP}}` | Per [`pr-comment.md § Media strip`](./pr-comment.md#media-strip): one visible recording (caption line, then the bare `.mp4` URL), then one visible row of up to two `<img width="420">` thumbnails, failed checks first, headers under 40 characters; the rest in a closed `+<r> more recordings · +<n> more screenshots` block, recordings first, never more than two columns; nothing when the run has no media |
| `{{SKIPPED_LINE}}` | `⏭️ *Not checked <where>: <what>; <what covers it instead>.*`, or nothing |
| `{{APPROACH}}` / `{{IMPACT_MAP}}` | One paragraph on how the run tested the feature; the PR's impact map per [`pr-comment.md § Impact map`](./pr-comment.md#impact-map) |
| `{{PROBE_RESULT}}` / `{{PROBE_LINES}}` | `<n> probes, nothing broke`, `<n> probes, <k> broke`, or `skipped (<reason>)`; one `- what I tried → what happened` line per probe |
| `{{FIXES_PART}}` | When a fix was pushed: `**Fixed during the run**` and one `- <sha7> (F-n) <what changed for the user>` line each, the `F-n` matching the `✅ after fix (F-n)` row it fixed; otherwise nothing |
| `{{TELEMETRY_VERDICT}}` / `{{FLOW_LINES}}` | Never blank: the verdict word or `not reviewed (<reason>)` (a connected MCP server is not a reason). An AC whose path emits no signal gets `no regression observed (path emits no signal)`, not `confirms`; one `- <journey>` line per AC from `telemetry.md`, then the ERROR-span line |
| `{{NOTES_PART}}` | When there are any: `**Notes**` and one line per not-defect, open `low` finding, `medium` finding already shown above, out-of-scope finding (`Outside this PR:`), `n/a` edge row, lesson written, or flag the run set ([`flags.md § Report`](./flags.md#report)); otherwise nothing |
| `{{TRACE_ROWS}}` | One row per edge row and probe, never per AC (the criteria live once, in the `intent` region): ID, what I tried, result (`✅ pass`, `✅ after fix (F-1)`, `❌ fail (F-2)`, `⏭️ skipped (<reason>)`, `⏭️ not verified on target (<what ran instead>)`), witnesses (`browser · telemetry`, `unit tests`). Text only |
| `{{URL}}` / `{{DRIVER}}` / `{{RECORDINGS_LINE}}` | The URL the run used (`localhost` as text); the browser driver; `recordings: not attached (<reason>)` when the region holds none, else nothing |
| `{{TICKET_LINK}}` / `{{PR_LINK}}` | `· <ticket link>` from the brief, or nothing; the PR URL |

## Media

Collect, upload, and embed every screenshot **and recording** per [`pr-comment.md § Media`](./pr-comment.md#media): image paths from `findings.jsonl` `evidence` and `probes.jsonl` `screenshots`, video paths from `probes.jsonl` `recordings` and the adversarial findings' `evidence`.
Upload only when the comment will post ([`pr-comment.md § When to post`](./pr-comment.md#when-to-post)); otherwise **Details** says `not attached (<reason>)` and the terminal lists every file's absolute path.

## Destinations

1. **File:** `.agent/{branch}/verify/report.md` — always.
2. **PR** — the rendered report is the `aggregate` region, written after the fix loop has pushed so it describes the final head SHA; the script puts it in the description on your own PR and in the verify comment on anyone else's:

   ```bash
   node "${CLAUDE_SKILL_DIR}/scripts/verify-comment.mjs" --pr "$PR_URL" --section aggregate --file .agent/<branch>/verify/report.md --replace-all
   ```

   Where it lands, gate, `mcp` path, and exit codes: [`pr-comment.md`](./pr-comment.md). The script refuses a region that holds a local path, a token is never rendered, and a request body is summarized, never pasted.
3. **Terminal** — printed last: the verdict line, the summary sentence, the attention bullets with every open finding, the report path, the `comment:` line, and the absolute path of every screenshot and recording that was not attached.

## `report` mode

Re-render from the existing run directory, re-run the Media steps, upsert the `aggregate` region (always, on any PR), and print the terminal block.
Then make the criteria current: when the PR has no `intent` region, publish it ([`intent.md § Step 6`](./intent.md#step-6--publish-the-criteria-on-the-pr)); either way set each row's **Status** from the run's results, so a PR `/aw` opened ends with every criterion ticked.
Missing run directory → `no verify run found for <branch>`.
