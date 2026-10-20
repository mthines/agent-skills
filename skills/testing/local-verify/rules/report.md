---
title: Report — one consistent shape, three destinations, real screenshots
impact: MEDIUM
tags:
  - report
  - pr-comment
  - screenshots
  - attach-media
---

# Report

Phase 6 renders [`templates/report.md.template`](../templates/report.md.template) from `intent.md`, `findings.jsonl`, `probes.jsonl`, and the git log.
Same sections in the same order every run, so two reports compare line by line.
Prose is conclusion-first, with no filler.

## Verdict

| Verdict | Condition |
| --- | --- |
| `✅ verified` | Every AC passes, no `open`/`escalated` finding of severity `high` or `critical` |
| `⚠️ verified with open items` | Every AC passes; some `medium`/`low` findings open, or any finding escalated |
| `❌ not verified` | An AC fails after the fix loop, or a `critical`/`high` finding is still open |
| `⛔ blocked` | A phase could not run (stack, auth, checkout); name the phase and the fix |

## Placeholders

| Placeholder | Content |
| --- | --- |
| `{{BLUF}}` | Two sentences max: the verdict in words, what was fixed, what needs a human |
| `{{AC_ROWS}}` / `{{EC_ROWS}}` | One row each; Result is `pass`, `fixed → pass (F-n)`, `fail (F-n)`, or `skipped (reason)`. Evidence is a screenshot ID (`S-n`), a trace ID, or an HTTP status — never a file path |
| `{{FINDING_ROWS}}` | Every finding by severity; `in_scope: false` rows prefixed `pre-existing:` |
| `{{FIX_ROWS}}` | Short SHA, finding ID, one-line change, the probe that re-verified it. Empty → "No code changes." |
| `{{TELEMETRY}}` | The backend and its scope, e.g. `dash0-mcp · dataset alice-local` or `logs`; Phase 4 skipped → `not reviewed: <reason>` |
| `{{FLOW_LINES}}` | Phase 4 Step 4's flow picture, one line per AC |
| `{{SCREENSHOTS}}` | The Markdown lines `attach-media` returned, one per screenshot, each captioned `S-n — <probe id>: <title>`; or `not attached (<reason>)` |
| `{{OPEN_ITEMS}}` | Each open or escalated finding: what is needed, the options, your recommendation. Empty → "None." |
| `{{LESSON_LINES}}` | Lessons written this run (key only) and promotion-eligible lessons with the suggested edit. Empty → "None." |

## Screenshots

1. Gather every image path from `findings.jsonl` `evidence` and `probes.jsonl` `screenshots`, ordered findings-by-severity → AC → EC, deduplicated; number them `S-1`, `S-2`, ….
2. With a PR and `report.pr_comment` allowing a comment, upload them in one call and embed what it returns:

   ```text
   Skill("attach-media", "<pr-url> <path>#S-1 — EC-9: Save while the API fails  <path>#S-2 — AC-1: … --to urls")
   ```

   `attach-media` opens every image before upload and skips any that shows a secret or personal data; carry its `skipped (<reason>)` lines into `{{SCREENSHOTS}}`.
3. No PR, comment disabled, or `attach-media` reports `not attached (<reason>)` → `{{SCREENSHOTS}}` is `not attached (<reason>)`, and the terminal lists every image's absolute path.

## Destinations

1. **File:** `.agent/{branch}/local-verify/report.md` — always.
2. **PR comment** — when the run has a PR, per `report.pr_comment`, and not under `--no-comment`.
   Upsert one comment identified by the `<!-- local-verify:report -->` marker, after the fix loop has pushed, so it describes the final head SHA:

   ```bash
   id=$(gh api "repos/{owner}/{repo}/issues/$PR/comments" --paginate \
     --jq '[.[] | select(.body | startswith("<!-- local-verify:report -->"))][0].id // empty')
   if [ -n "$id" ]; then
     gh api -X PATCH "repos/{owner}/{repo}/issues/comments/$id" -F body=@"$REPORT" --jq .html_url
   else
     gh pr comment "$PR" --body-file "$REPORT"
   fi
   ```

   The comment never contains a local file path, a token, a cookie, or a full request body.
3. **Terminal** — printed last: the verdict line, the BLUF, the findings table, the report path, the comment URL (or `not posted — <reason>`), and the absolute path of every screenshot that was not attached.

## `report` mode

Re-render from the existing run directory, re-run the Screenshots steps, upsert the comment per policy, and print the terminal block.
Missing run directory → `no local-verify run found for <branch>`.
