---
title: PR comment — one sticky verify comment per PR, one region per witness
impact: HIGH
tags:
  - pr-comment
  - attach-media
  - aw-verify
  - ui-verify
  - telemetry-verify
---

# PR comment

`aw-verify`, `ui-verify`, and `telemetry-verify` post their proof to **one** comment per PR.
Its first line is `<!-- verify:report -->`; each witness owns one region of it.
[`scripts/verify-comment.mjs`](../scripts/verify-comment.mjs) is the only writer: it splices a region, keeps the others, and refuses a local path.

## Contents

- [Regions and owners](#regions-and-owners)
- [When to post](#when-to-post)
- [Rows: what, why, result, evidence](#rows-what-why-result-evidence)
- [Media](#media)
- [Write the region](#write-the-region)
- [Report line](#report-line)

## Regions and owners

| Region | Owner | Written when |
| --- | --- | --- |
| `aggregate` | `aw-verify` | Every run with a PR; `--replace-all` drops the other regions, because the aggregate already holds the browser, adversarial, and telemetry proof |
| `ui` | `ui-verify` | A standalone `run` or `verify` with a PR |
| `telemetry` | `telemetry-verify` | A standalone run with a PR |

A later standalone run adds its region beside the aggregate; each region names the head SHA it verified, so a reader can tell which is newer.
A comment written before regions existed is kept as the `aggregate` region.
Each author has their own verify comment: the script edits only one the viewer wrote, and creates one when the PR has none of theirs, so a run on someone else's PR never tries to edit the author's.

## When to post

Take the first row that applies.

| Condition | Result |
| --- | --- |
| `ui-verify` with `--post-findings` and a PR | Post, whatever `--no-comment` or the policy says: `review-loop --ui` reads the region's status lines |
| `--no-comment` was passed | `comment: not posted (--no-comment)` |
| No PR resolves (a local `specs-path`, no PR for the branch) | `comment: not posted (no PR)` |
| `policies.pr_comment: never` | `comment: not posted (pr_comment: never)` |
| `policies.pr_comment: own-prs` and the PR author is not `gh api user --jq .login` | `comment: not posted (pr_comment: own-prs, not your PR)` |
| Otherwise, including no policy set (default `always`) | Post |

**A parent never lets a child post.** `aw-verify` passes `--no-comment` to every `ui-verify` and `telemetry-verify` call, `ui-verify` passes it to every `telemetry-verify` call, and so does every other skill or agent that calls `telemetry-verify` for its own receipt (`verify-behavior`, `measurable`, `fix-bug`, `pr-reviewer`); the parent posts the child's proof inside its own region.

```text
✗ the same call without --no-comment
  # ui-verify posts its own region, then aw-verify's aggregate replaces it — two writes, one wasted
✓ Skill("ui-verify", "run .agent/<branch>/specs.md --env local --url <url> --no-telemetry --no-comment")
```

## Rows: what, why, result, evidence

Every row a reader must trust carries four things:

| Column | Holds | Never |
| --- | --- | --- |
| What | The criterion, spec, probe, or journey, in one line | A file path |
| Why | What it protects: the `AC-n` or requirement it proves, the guardrail it breaks on purpose, or the risk class (`Concurrency`, `Failure`, `xss-executed`) | Empty, or "edge case" |
| Result | `pass`, `fixed → pass (F-n)`, `fail (F-n)`, `skipped (<reason>)`, or the telemetry verdict word | A softened word for a `fail` |
| Evidence | Links to what proves it: `[S-1](<url>)` screenshot, `[▶ R-1](<url>)` recording, a trace or Dash0 link, or the HTTP status | A local path, or an ID with no link |

```markdown
<!-- ✗ Evidence the reader cannot open -->
| EC-9 | PUT /api/views → 500 | fail | S-3 |

<!-- ✓ What, why, result, and evidence a click away -->
| EC-9 | PUT /api/views answers 500 | Guardrail: a failed save keeps the user's input | fixed → pass (F-2) | [S-3](https://github.com/user-attachments/assets/…) · [▶ R-2](https://github.com/user-attachments/assets/…) |
```

## Media

1. **Collect** every screenshot and recording the run produced: finding evidence first, by severity, then acceptance specs, then edge and adversarial probes. Number screenshots `S-1…` and recordings `R-1…`.
   Cap at 12 images and 4 recordings; past the cap, keep the findings' media and say `+<k> more not attached (cap)`.
2. **Upload in one call**, with a caption per file:

   ```text
   Skill("attach-media", "<pr-url> <path>#S-1 — EC-9: Save while the API fails <path>#R-1 — Spec-1: rename a view --to urls")
   ```

   `attach-media` opens every image before upload and skips one that shows a secret or personal data; it re-encodes a `.webm` over 10 MB to `.mp4` and skips what still does not fit.
3. **Embed** each returned URL twice: as the link in its row's Evidence cell, and in a `<details><summary>Screenshots and recordings (<n>)</summary>` gallery at the end of the region, an image as `![S-n — caption](https://…)` and a recording as its bare URL on its own line, which GitHub renders as a player.
4. A file `attach-media` skipped or could not upload → its Evidence cell says `not attached (<reason>)`, and the terminal lists the file's absolute path; the comment never does.

## Write the region

Write the region body (no marker) to `<run dir>/comment-<section>.md`, then:

```bash
VC="${CLAUDE_SKILL_DIR}/../aw-verify/scripts/verify-comment.mjs"   # inside aw-verify: ${CLAUDE_SKILL_DIR}/scripts/verify-comment.mjs
node "$VC" --pr <pr-url> --section <aggregate|ui|telemetry> --file <run dir>/comment-<section>.md [--replace-all]
```

| Exit | Meaning | Do |
| --- | --- | --- |
| `0` | Prints the comment URL | Report it |
| `1` | Refused: a local path or a verify marker in the region | Replace the path with its uploaded URL or `not attached (<reason>)`, then write once more |
| `2` | `gh` failed | `comment: failed (<stderr first line>)`; never retry in a loop |

- **`mcp` access path (no `gh`):** read the comments with `mcp__github__issue_read` (`method: "get_comments"`), save the body of the one starting with the marker that you wrote (`mcp__github__get_me` gives your login), run the script with `--dry-run --existing <saved body>`, then write its stdout with `mcp__github__update_issue_comment`, or `mcp__github__add_issue_comment` when none exists.
- **Script not found** (`aw-verify` not installed) → `comment: not posted (aw-verify not installed)`.
- Write after the fix loop pushed, so the region describes the final head SHA.

## Report line

Print one line after the skill's report: `comment: <comment-url> (region <section>)`, or the `not posted (<reason>)` / `failed (<reason>)` line.
