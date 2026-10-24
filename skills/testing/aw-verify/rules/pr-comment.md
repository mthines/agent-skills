---
title: PR comment — one verify comment per PR, one region per witness, progressive disclosure
impact: HIGH
tags:
  - pr-comment
  - attach-media
  - aw-verify
  - ui-verify
  - telemetry-verify
---

# PR comment

`aw-verify`, `ui-verify`, and `telemetry-verify` post their proof to **one** comment per PR, whichever account the run posts from.
Its first line is `<!-- verify:report -->`; each witness owns one region of it.
[`scripts/verify-comment.mjs`](../scripts/verify-comment.mjs) is the only writer: it splices a region, keeps the others, records the run it replaced under **Previous runs**, and refuses a local path.

## Contents

- [Regions and owners](#regions-and-owners)
- [When to post](#when-to-post)
- [Layout: verdict, checks, then collapsed detail](#layout-verdict-checks-then-collapsed-detail)
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
A PR has one verify comment, whoever's account the run posts from: the script edits the PR's newest marker comment written by an app, by someone with access to the repo (`author_association` `OWNER`, `MEMBER`, or `COLLABORATOR`), or by the account running it (GraphQL `viewer`, so a fork author re-uses their own), so a run from Agent0 (a bot account) and a run from a local session (your own) update the same comment, and a drive-by commenter's fake report is never adopted.
Before it replaces a region, the script adds one line for the old run (`<sha7> · <section> · <headline> · replaced <date>`) to its own last region, `<!-- verify:history -->`, rendered as a collapsed **Previous runs** list of at most 10 entries; a region author never writes it.
A comment the token may not edit (HTTP 403 or 404) gets a new comment that carries its regions and history forward; any other GitHub failure exits `2` and posts nothing.
The script also does what a region author must not do by hand:

| It | Because |
| --- | --- |
| Replaces `{{UPDATED}}` with the write time (`YYYY-MM-DD HH:MM UTC`) | The time a reviewer sees matches **Previous runs** |
| Adds the blank lines GitHub needs after `</summary>` and before `</details>` | Without them the reviewer sees raw Markdown |
| Folds a region on an older commit than the PR head (read from the PR; the region just written when it cannot be read) into one closed `Older run on <sha7>: <headline>` row, including a late run on an older commit | A stale ✅ never reads as the current verdict, and never takes space |
| Posts one notice comment, `Verify re-ran on <sha7>: ✅ → ❌. See the report`, first line `<!-- verify:notice -->`, when a run changes the verdict glyph a reader last saw (the section's own, else the comment's first region) | Editing a comment notifies nobody; a changed verdict must |

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

## Layout: verdict, checks, then collapsed detail

A reviewer reads top-down and stops once they trust the result, so a green run shows five things and nothing else: the verdict, one sentence, the metadata line, a media strip (one recording, then up to two screenshot thumbnails), and one closed row per check.
Everything else is one click away.

```markdown
## ✅ Verified — images render where Agent0 places them

Agent0 shows an attached image inline wherever its answer places it. **Nothing needs your attention.**

<sub>`076fafc` · preview · CI green · 0 findings · updated {{UPDATED}}</sub>

#### What I checked

| ✅ Placed → inline | ✅ Made-up id → not shown |
| :---: | :---: |
| <img src="https://github.com/user-attachments/assets/…" width="420" alt="The chart renders inline in the answer"> | <img src="https://github.com/user-attachments/assets/…" width="420" alt="An unknown id shows an error"> |

<details><summary>✅ <b>Place an image in the answer</b> → it renders inline</summary>

I gave Agent0 an attachment id; it wrote the tag and the chart renders between its sentences. <sub>Proves AC-1</sub>

</details>
<details><summary>✅ <b>Use a made-up image id</b> → "not available", nothing fetched</summary>

…

</details>

⏭️ *Not checked on the preview: backend tag text and link expansion; unit tests and CI cover them.*

<details><summary>Details</summary>

…

</details>
```

### Visible parts, in this order

| # | Part | Holds | Never |
| --- | --- | --- | --- |
| 1 | Headline | `## <emoji> <Verdict> — <what the change does, in the user's words>`, at most 70 characters; verdict words from [`report.md § Verdict`](./report.md#verdict). A standalone `ui` or `telemetry` region uses `###` | An agent name, a SHA, or an environment |
| 2 | Summary | One sentence on what works for the user, then on the same line the attention line for the headline's emoji (§ Attention line) | The run's reasoning about its environment; an attention line that disagrees with the headline |
| 3 | Metadata | One `<sub>` line: seven-character head SHA in backticks, environment, CI state, finding count, `updated {{UPDATED}}` (the script stamps it) | A URL, or a time the agent typed |
| 4 | Media strip | Directly under **What I checked**: one recording, then one row of up to two thumbnails, the rest one click away (§ Media strip) | A full-width screenshot, or a recording or screenshot inside a check row |
| 5 | Check rows | One `<details>` per check (§ Check rows) | A results table, or a `####` heading per check |
| 6 | Skipped line | `⏭️ *Not checked <where>: <what>; <what covers it instead>.*`; omitted when nothing was skipped | A skipped item as a check row |

### Attention line

The headline's emoji picks the line, so a reviewer who sees anything but ✅ learns why in the next sentence.

| Headline | Attention line |
| --- | --- |
| ✅ | `**Nothing needs your attention.**` |
| ⚠️ | `**Why not ✅:**` then one bullet per escalated finding, `<what the user would notice> (<severity>) — needs you: <the decision>`, then one per open `in_scope: true` `medium`/`low` finding, `<what the user would notice> (<severity>) — <next step, or "fine to merge as is">`. In a `ui` region, where ⚠️ means inconclusive, one bullet: the reason (the runner's `notes:` line) and the next step. In a `telemetry` region, where ⚠️ means ambiguous, one bullet per ambiguous journey and what would settle it |
| ❌ | `**Needs you:**` then one bullet per failed check, then per open `in_scope: true` `critical`/`high` finding, each with its next step |
| ⛔ / ⏭️ | `**Needs you:**` then the phase that could not run and the fix |

- At most three bullets; past three, `+<n> more in Details`.
- An open `critical`/`high` finding that does not move the verdict, one with `in_scope: false` ([`findings.md` § in_scope](./findings.md)) or any finding in a `ui` or `telemetry` region, is a bullet in a `**Needs you:**` list under every headline, after the headline's own items.
- Under ✅ that list replaces `**Nothing needs your attention.**`; under ⚠️ it follows the `**Why not ✅:**` list; an `in_scope: false` one reads `Outside this PR: <what the user would notice> (<severity>) — <suggested follow-up>`.
- Every other `in_scope: false` finding is a **Notes** line and never moves the verdict ([`report.md § Verdict`](./report.md#verdict)).
- Never a separate "Open items" block: the attention line is the only place open items appear above **Details**.

```markdown
<!-- ✓ -->
## ⚠️ Verified with open items — typed messages steer the running turn

A message typed while Agent0 works is read inside the same turn. **Why not ✅:**
- A double-clicked × sends two withdraw requests (low) — fine to merge as is.

<!-- ✗ the headline says open items, the next sentence says there are none -->
## ⚠️ Verified with open items — typed messages steer the running turn

A message typed while Agent0 works is read inside the same turn. **Nothing needs your attention.**

**Open items** (none blocks a merge):
```

### Check rows

One row is one thing the reviewer would try by hand: an acceptance criterion, a spec, or a probe that broke something.
Its `<summary>` is `<emoji> <b><what I did></b> → <what happened>`, under 80 characters, with no ID.

| Rule | Correct | Incorrect |
| --- | --- | --- |
| Action → outcome | `✅ <b>Type a tag in my own message</b> → it stays plain text` | `✅ AC-3 · rejected tags · pass` |
| One behaviour per row | Separate rows for "made-up id" and "my own message" | `AC-2 · AC-3 · rejected tags` |
| A failed row names the break | `❌ <b>Rename a view and save</b> → the old name comes back` | `❌ fail (F-2)` |

- **Order:** failed, then fixed (`🔧`), then passed, each group in the brief's order.
- **Open state:** a failed row is `<details open>`; every other row is closed.
- **Body:** one or two sentences (what I did, what happened, with the HTTP status or event name when that is the proof), ending on the same line with `<sub>Proves <AC-n></sub>` so the row traces to its criterion.
- **No media in a row:** recordings and screenshots live in the strip; a row whose check is shown there names it (`see the made-up-id recording`).

### Media strip

A recording shows the change working in a few seconds, so it leads; thumbnails make the rest scannable without a click.

1. **Order:** failed checks first, then the brief's acceptance criteria in order, then probes; within that order, recordings before screenshots.
2. **Visible recording:** the first recording in that order, as one caption line `▶️ <emoji> <b><what I did></b> → <what happened>` and, on the next line, its bare `.mp4` URL. GitHub renders a bare URL on its own line as a player and a URL in a table cell as a plain link, so a recording never goes in a table.
3. **Visible screenshots:** one table of at most two columns, the first two screenshots. Never more than two columns: a narrower thumbnail is too small to read without opening it. Header cell: `<emoji> <short action → outcome>`, under 40 characters so it does not wrap. Body cell: `<img src="<url>" width="420" alt="<caption>">`. Align columns `:---:`.
4. **The rest,** directly under it: one closed `<details><summary>+<r> more recordings · +<n> more screenshots</summary>`, holding the other recordings first (caption line, then URL), then tables of two columns in the same shape. Drop the half of the summary that is zero.

| Media | Shown |
| --- | --- |
| 1 recording, ≤ 2 screenshots | All visible |
| More | One recording and one row of two visible; the rest under `+<r> more recordings · +<n> more screenshots` |

```markdown
<!-- ✓ -->
▶️ ❌ <b>Use a made-up image id</b> → it is fetched (404)

https://github.com/user-attachments/assets/…

| ❌ Made-up id → fetched | ✅ Placed → inline |
| :---: | :---: |
| <img src="https://github.com/user-attachments/assets/…" width="420" alt="A request for an unknown id"> | <img src="https://github.com/user-attachments/assets/…" width="420" alt="The chart renders inline"> |

<details><summary>+1 more recording · +6 more screenshots</summary>

▶️ ✅ <b>Reload the chat</b> → the image stays in place

https://github.com/user-attachments/assets/…

| ✅ Turn ends → collapse | … |
| :---: | :---: |
| <img src="https://github.com/user-attachments/assets/…" width="420" alt="Tool rows collapsed"> | … |

</details>

<!-- ✗ the recording inside a check row: closed by default, so nobody sees it -->
<details><summary>✅ <b>Reload the chat</b> → …</summary>

https://github.com/user-attachments/assets/…

<!-- ✗ four columns: each thumbnail is too small to read without opening it -->
| ❌ Made-up id | ✅ Placed | ✅ Never placed | ✅ Own message |

<!-- ✗ full width: each screenshot is 1,000 px tall -->
![AC-1](https://github.com/user-attachments/assets/…)
```

### Details

One closed `<details><summary>Details</summary>` holds the rest, each part a `**bold**` lead-in and omitted when it has nothing to say:

| Part | Holds |
| --- | --- |
| **How I tested it** | One paragraph: the environment, how state was set up, and which ways the feature can go right and wrong. Then the PR's impact map, when one exists (§ Impact map) |
| **Tried to break it** · `<n> probes, nothing broke` / `<k> broke` | One line per probe: what I tried → what happened; or `skipped (<reason>)` |
| **Fixed during the run** | One line per pushed fix: short SHA, the finding ID it fixed (`F-n`), what changed for the user |
| **Telemetry** · `<verdict>` | One line per journey, e.g. `Save: POST /api/views 201 → views-service PUT (21 ms) → postgres INSERT (4 ms)`; or `not reviewed (<reason>)` |
| **Notes** | Not-defects, `medium`/`low` and out-of-scope findings (`Outside this PR:`), one line each |
| **Run details** | The traceability table `ID \| Criterion \| Result \| Witness` (text only); the region's status lines (`ui-verify`: its `rules/runner.md` § Step 5a); URL, driver, `recordings: not attached (<reason>)` when the region holds none, and the re-run command |

### Impact map

Reuse the PR's impact map; never draw one per run.
Look for the `<!-- impact-map:v1 -->` region in the PR body, then a comment starting with it.
Found → copy its `<picture>` block and add `[Impact map](<link to the body or comment>)` under it.
None → the line `No impact map on this PR (/impact-map <pr> --body draws one).`

## Media

1. **Collect** every screenshot and recording the run produced: finding evidence first, by severity, then acceptance specs, then edge and adversarial probes.
   Cap at 12 images and 4 recordings; past the cap, keep the findings' media and say `+<k> more not attached (cap)`.
2. **Recordings are `.mp4`.** Both runners record through `screencast`; a `.gif` (the Chrome runner's fallback) is converted before upload: `ffmpeg -i x.gif -movflags +faststart -vf "scale=1280:-2,format=yuv420p" -c:v libx264 -crf 28 -an x.mp4`.
   Open each video's `<id>.sheet.png` first and drop a video whose frames do not show the spec.
3. **Upload in one call**, with a caption per file:

   ```text
   Skill("attach-media", "<pr-url> <path>#A failed save keeps the name <path>#Rename a view --to urls")
   ```

   `attach-media` opens every image before upload and skips one that shows a secret or personal data; it re-encodes a video over 10 MB and skips what still does not fit.
4. **Embed** each returned URL once, in the strip (§ Media strip); a recording that covers several checks is captioned with the first, and the others name it.
5. A file `attach-media` skipped or could not upload → its check row says `<screenshot | recording> not attached (<reason>)`, and the terminal lists the file's absolute path; the comment never does.
6. **Recordings are never silently missing.** When the region holds no recording, **Run details** says why: `recordings: not attached (<reason>)` — `--no-recording`, `no UI criterion`, `screencast not installed`, the runner's `notes` line, or the upload failure.

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

- **`mcp` access path (no `gh`):** read the comments with `mcp__github__issue_read` (`method: "get_comments"`) and take the newest comment starting with the marker whose author is an app, has `author_association` `OWNER`, `MEMBER`, or `COLLABORATOR`, or is `mcp__github__get_me`. Run the script with `--dry-run --existing <its body> --head <the PR's head SHA>` and write its stdout with `mcp__github__update_issue_comment`; when that update is refused as forbidden, post the same stdout with `mcp__github__add_issue_comment`, so the other regions and the history carry over. When no comment qualifies, run `--dry-run --head <sha>` without `--existing` and post it with `mcp__github__add_issue_comment`.
  With `--existing`, also pass `--notice-out <run dir>/notice.md --comment-url <that comment's html_url>`; after a successful update, when `notice.md` exists, post its contents with `mcp__github__add_issue_comment`, because an edit notifies nobody; after a refused update, post no notice, as the script's own fallback does, because the new comment already notifies.
  The `gh` path needs neither flag: the script posts the notice itself.
- **Script not found** (`aw-verify` not installed) → `comment: not posted (aw-verify not installed)`.
- Write after the fix loop pushed, so the region describes the final head SHA.

## Report line

Print one line after the skill's report: `comment: <comment-url> (region <section>)`, or the `not posted (<reason>)` / `failed (<reason>)` line.
