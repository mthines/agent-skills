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
- [Layout: summary, then one section per spec](#layout-summary-then-one-section-per-spec)
- [Media](#media)
- [Write the region](#write-the-region)
- [Report line](#report-line)

## Regions and owners

| Region | Owner | Written when |
| --- | --- | --- |
| `aggregate` | `aw-verify` | Every run with a PR, always — `policies.pr_comment` never suppresses it; `--replace-all` drops the other regions, because the aggregate already holds the browser, adversarial, and telemetry proof |
| `ui` | `ui-verify` | A standalone `run` or `verify` with a PR |
| `telemetry` | `telemetry-verify` | A standalone run with a PR |

A later standalone run adds its region beside the aggregate; each region names the head SHA it verified, so a reader can tell which is newer.
A comment written before regions existed is kept as the `aggregate` region.
Each author has their own verify comment: the script reads the viewer through GraphQL `viewer` (never `/user`), edits only the newest marker comment whose author matches it (both lowercased, one trailing `[bot]` stripped), and posts a new comment otherwise, so a write-access run on someone else's PR never overwrites the author's.
An unknown viewer posts a new comment rather than guess.

## When to post

Take the first row that applies.

| Condition | Result |
| --- | --- |
| `ui-verify` with `--post-findings` and a PR | Post, whatever `--no-comment` or the policy says: `review-loop --ui` reads the region's status lines |
| `aw-verify`'s `aggregate` region and a PR resolves | Post. `pr_comment` does not apply; `--no-comment` only defers it to the caller's `report <pr-url>` (`comment: deferred (--no-comment)`) |
| `--no-comment` was passed | `comment: not posted (--no-comment)` |
| No PR resolves (a local `specs-path`, no PR for the branch) | `comment: not posted (no PR)` |
| `policies.pr_comment: never` | `comment: not posted (pr_comment: never)` |
| `policies.pr_comment: own-prs` and the viewer is unknown (`gh api graphql -f query='{ viewer { login } }' --jq .data.viewer.login` fails or is empty) | `comment: not posted (pr_comment: own-prs, identity unknown)` |
| `policies.pr_comment: own-prs` and the PR author differs from the viewer, both lowercased with one trailing `[bot]` stripped | `comment: not posted (pr_comment: own-prs, not your PR)` |
| Otherwise, including no policy set (default `always`) | Post |

**A parent never lets a child post.** `aw-verify` passes `--no-comment` to every `ui-verify` and `telemetry-verify` call, `ui-verify` passes it to every `telemetry-verify` call, and so does every other skill or agent that calls `telemetry-verify` for its own receipt (`verify-behavior`, `measurable`, `fix-bug`, `pr-reviewer`); the parent posts the child's proof inside its own region.

```text
✗ the same call without --no-comment
  # ui-verify posts its own region, then aw-verify's aggregate replaces it — two writes, one wasted
✓ Skill("ui-verify", "run .agent/<branch>/specs.md --env local --url <url> --no-telemetry --no-comment")
```

## Layout: summary, then one section per spec

Media renders only outside a table: GitHub shows a bare video URL as a player only on its own line, and a table cell holds only links.
So a region has two parts.

1. **Summary** — a text-only table, one row per criterion or probe: `ID | Criterion | Result`. No media, no links but commit SHAs.
2. **What was tested** — one `####` heading per spec, edge case, or probe that has evidence: `#### <ID(s)> · <short name> · <result emoji> <result>`.
   Under it, one or two sentences: what the user did, why (the `AC-n`, guardrail, or risk class it proves), and what happened.
   Then its media, each on its own line: screenshots as `![<caption>](<url>)`, then the recording as its bare URL.

| Part | Holds | Never |
| --- | --- | --- |
| Result | `pass`, `fixed → pass (F-n)`, `fail (F-n)`, `skipped (<reason>)`, or the telemetry verdict word | A softened word for a `fail` |
| Why | The `AC-n` or requirement it proves, the guardrail it breaks on purpose, or the risk class (`Concurrency`, `Failure`, `xss-executed`) | Empty, or "edge case" |
| Evidence | The embedded screenshot and recording, plus the HTTP status, trace, or Dash0 link | A local path, a bare ID, or media only inside a table cell or a closed `<details>` |

```markdown
<!-- ✗ Media as links in a table: the reader sees "S-3", not the page -->
| EC-9 | PUT /api/views → 500 | fixed → pass (F-2) | [S-3](https://github.com/user-attachments/assets/…) · [▶ R-2](https://…) |

<!-- ✓ The summary row stays text; the section shows the evidence -->
| EC-9 | A failed save keeps the user's input | ✅ fixed → pass (F-2) |

#### EC-9 · failed save · ✅ fixed → pass (F-2)
I blocked `PUT /api/views` and clicked Save. A toast says the save failed and the typed name stays.

![EC-9: failed save keeps the name](https://github.com/user-attachments/assets/…)

https://github.com/user-attachments/assets/…
```

## Media

1. **Collect** every screenshot and recording the run produced: finding evidence first, by severity, then acceptance specs, then edge and adversarial probes.
   Cap at 12 images and 4 recordings; past the cap, keep the findings' media and say `+<k> more not attached (cap)`.
2. **Recordings are `.mp4`.** Both runners record through `screencast`; a `.gif` (the Chrome runner's fallback) is converted before upload: `ffmpeg -i x.gif -movflags +faststart -vf "scale=1280:-2,format=yuv420p" -c:v libx264 -crf 28 -an x.mp4`.
   Open each video's `<id>.sheet.png` first and drop a video whose frames do not show the spec.
3. **Upload in one call**, with a caption per file:

   ```text
   Skill("attach-media", "<pr-url> <path>#EC-9: failed save keeps the name <path>#Spec-1: rename a view --to urls")
   ```

   `attach-media` opens every image before upload and skips one that shows a secret or personal data; it re-encodes a video over 10 MB and skips what still does not fit.
4. **Embed** each returned URL once, in its spec's section (§ Layout). A recording that covers several specs gets its own section naming them.
5. A file `attach-media` skipped or could not upload → its section says `not attached (<reason>)`, and the terminal lists the file's absolute path; the comment never does.
6. **Recordings are never silently missing.** When the region holds no recording, say why on its own line under **What was tested**: `recordings: not attached (<reason>)` — `--no-recording`, `no UI criterion`, `screencast not installed`, the runner's `notes` line, or the upload failure.

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

- **`mcp` access path (no `gh`):** read the comments with `mcp__github__issue_read` (`method: "get_comments"`), and take the newest comment starting with the marker whose author matches `mcp__github__get_me` (normalized as above), run the script with `--dry-run --existing <its body>`, and write its stdout with `mcp__github__update_issue_comment`; when no comment matches or the viewer is unknown, run `--dry-run` without `--existing` and write it with `mcp__github__add_issue_comment`.
- **Script not found** (`aw-verify` not installed) → `comment: not posted (aw-verify not installed)`.
- Write after the fix loop pushed, so the region describes the final head SHA.

## Report line

Print one line after the skill's report: `comment: <comment-url> (region <section>)`, or the `not posted (<reason>)` / `failed (<reason>)` line.
