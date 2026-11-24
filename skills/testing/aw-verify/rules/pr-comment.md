---
title: PR comment — one verify report per PR (the description on your own PR, else a comment), one region per witness, progressive disclosure
impact: HIGH
tags:
  - pr-comment
  - attach-media
  - aw-verify
  - ui-verify
  - telemetry-verify
---

# PR comment

`aw-verify`, `ui-verify`, and `telemetry-verify` post their proof to **one** verify report per PR, whichever account the run posts from; each witness owns one region of it.
[`scripts/verify-comment.mjs`](../scripts/verify-comment.mjs) is the only writer: it picks where the report lives, splices a region, keeps the others, records the run it replaced under **Previous runs**, and refuses a local path.

## Where the report lives

| PR | The report is |
| --- | --- |
| Your own (the PR author is the GraphQL `viewer`, both lowercased with one trailing `[bot]` stripped), or one whose body already holds the report and whose author is an app or has repo access (`author_association` `OWNER`, `MEMBER`, or `COLLABORATOR`) | A region at the end of the PR description, `<!-- verify:report -->` … `<!-- /verify:report -->`; no verify comment is posted |
| Anyone else's, or the PR cannot be read | One comment whose first line is `<!-- verify:report -->` |

`--to body` or `--to comment` overrides the choice; the default is `--to auto`.
Each marker counts only on a line of its own, so a description that quotes them inline holds no report; a report a fork author planted in their description is never adopted, the same trust rule the comment path applies.
In the body, the script replaces only its region and keeps every character outside it, so the author's text, the ui-verify spec, and the media region stay.
An own PR that already has a verify comment moves it once: the comment's regions and history seed the body, and the comment becomes a one-line pointer, first line `<!-- verify:moved -->`.
The comment takes the report instead when the body would pass GitHub's 65,536-character limit, or when the body edit is refused (HTTP 403 or 404); it starts from the body's report, and past the limit the body drops its copy. Any other GitHub failure exits `2`.

```text
✗ an own PR gets a verify comment, and the next run from Agent0 adds a second report in the body
✓ node "$VC" --pr <url> --section aggregate --file report.md --replace-all
  # own PR → the description's verify region; someone else's PR → the one verify comment
```

## Visible, collapsed

Everything a skill writes into the PR description is readable by a reviewer and closed by default: the HTML-comment markers are the only invisible part, and the content sits in a `<details><summary>` that says what it is.
`verify-comment.mjs` refuses an `intent` region that holds an HTML comment or does not open with `<details><summary>`.

```text
✗ <!-- verify:section=intent -->\n<!-- AC-1 [ui:/x] … -->            (a reader sees nothing)
✓ <details><summary>📋 Acceptance criteria — 3 criteria · 1 guardrail</summary>\n\n| | Criterion | Proof |\n| ⬜&nbsp;AC‑1 | … | ui:/x · … |\n\n</details>
```

## Contents

- [Where the report lives](#where-the-report-lives)
- [Regions and owners](#regions-and-owners)
- [When to post](#when-to-post)
- [Layout: criteria, verdict, media, then collapsed detail](#layout-criteria-verdict-media-then-collapsed-detail)
- [Media](#media)
- [Write the region](#write-the-region)
- [Report line](#report-line)

## Regions and owners

| Region | Owner | Written when |
| --- | --- | --- |
| `intent` | `aw-verify`, and `/aw` when it opens the PR (`--from-plan`) | Every run with a PR, on the same trust rules as the report ([§ When to post](#when-to-post)), before the first probe; the criteria are a living checklist: each run changes only the leading status of each line through `--marks` (`⬜ ✅ ❌ ⏭️`, and `🚀` from `deployment-verify`), so `--replace-all` keeps it, it never folds as an older run, it never enters **Previous runs**, and once the PR is merged an existing one is frozen ([`intent.md § Step 6`](./intent.md#step-6--publish-the-criteria-on-the-pr)) |
| `aggregate` | `aw-verify` | Every run with a PR, on your own PRs and trusted bots' PRs without asking, on anyone else's after a yes — `policies.pr_comment` never suppresses it; `--replace-all` drops the other regions, because the aggregate already holds the browser, adversarial, and telemetry proof |
| `ui` | `ui-verify` | A standalone `run` or `verify` with a PR |
| `telemetry` | `telemetry-verify` | A standalone run with a PR |

A later standalone run adds its region beside the aggregate; each region names the head SHA it verified, so a reader can tell which is newer.
A comment written before regions existed is kept as the `aggregate` region.
On a PR whose report is a comment, the PR has one verify comment, whoever's account the run posts from: the script edits the PR's newest marker comment written by an app, by someone with access to the repo (`author_association` `OWNER`, `MEMBER`, or `COLLABORATOR`), or by the account running it (GraphQL `viewer`, so a fork author re-uses their own), so a run from Agent0 (a bot account) and a run from a local session (your own) update the same comment, and a drive-by commenter's fake report is never adopted.
Before it replaces a region, the script adds one line for the old run (`<sha7> · <section> · <headline> · replaced <date>`) to its own last region, `<!-- verify:history -->`, rendered as a collapsed **Previous runs** list of at most 10 entries; a region author never writes it.
A comment the token may not edit (HTTP 403 or 404) gets a new comment that carries its regions and history forward; any other GitHub failure exits `2` and posts nothing.
The script also does what a region author must not do by hand:

| It | Because |
| --- | --- |
| Replaces `{{UPDATED}}` with the write time (`YYYY-MM-DD HH:MM UTC`) | The time a reviewer sees matches **Previous runs** |
| Adds the blank lines GitHub needs after `</summary>` and before `</details>` | Without them the reviewer sees raw Markdown |
| Folds a `ui` or `telemetry` region on an older commit than the PR head (read from the PR; the region just written when it cannot be read) into one closed `Older run on <sha7>: <headline>` row, including a late run on an older commit. **The `aggregate` never folds**: on an older commit it stays open and gains one line, `Tested on <sha7>; the PR head is now <sha7>`, because a PR that holds only closed rows shows no verdict. Re-run on the head to clear the line |
| Refuses (CLI) an `aggregate` whose text outside `<details>` is only its headline: the summary, what needs a human and the findings go in the open, above **Details**. The gate (`--check`) fails the same report |
| Uploads every local image and recording the region names (`![alt](path)`, `<img src>`, or a bare `.mp4`, `.mov`, `.webm` line) to GitHub and swaps the path for its `user-attachments` URL, before the write. `--no-upload` turns it off. A file that is missing or over 10 MB stays a path, and the local-path refusal then names it | A stale ✅ never reads as the current verdict, and never takes space |
| Posts one notice comment, `Verify re-ran on <sha7>: ✅ → ❌. See the report`, first line `<!-- verify:notice -->`, when a run changes the verdict glyph a reader last saw (the section's own, else the report's first region), also when the report lives in the body | Editing a comment or a description notifies nobody; a changed verdict must |

## When to post

Take the first row that applies.

| Condition | Result |
| --- | --- |
| `ui-verify` with `--post-findings` and a PR | Post, whatever `--no-comment` or the policy says: `review-loop --ui` reads the region's status lines |
| `aw-verify`'s `aggregate` region, a PR resolves, and [the PR is trusted](#whose-pr-posts-automatically) | Post automatically, without asking. `pr_comment` does not apply; `--no-comment` only defers it to the caller's `report <pr-url>` (`comment: deferred (--no-comment)`) |
| `aw-verify`'s `aggregate` region, a PR resolves, the PR is not trusted (an unknown viewer trusts only `trusted_bots`), and `--no-comment` was not passed | Do not post. Write `report.md`, print `comment: not posted (not your PR — ask)`, and ask the user once whether to post; on a yes, run the same `verify-comment.mjs` command (§ Write the region) |
| `--no-comment` was passed | `comment: not posted (--no-comment)` |
| No PR resolves (a local `specs-path`, no PR for the branch) | `comment: not posted (no PR)` |
| `policies.pr_comment: never` | `comment: not posted (pr_comment: never)` |
| `policies.pr_comment: own-prs` and the viewer is unknown (`gh api graphql -f query='{ viewer { login } }' --jq .data.viewer.login` fails or is empty) | `comment: not posted (pr_comment: own-prs, identity unknown)` |
| `policies.pr_comment: own-prs` and [the PR is not trusted](#whose-pr-posts-automatically) (the author differs from the viewer after the same normalization, and is not in `trusted_bots`) | `comment: not posted (pr_comment: own-prs, not your PR)` |
| Otherwise, including no policy set (default `always`) | Post |

### Whose PR posts automatically

A PR is **trusted** when its author is the viewer, or a bot account listed in `policies.trusted_bots` (default `[]`; for example `[dash0-app]` for Dash0's own PR bot).
Compare logins after this normalization on both sides: lowercase, strip a leading `app/` (the `gh` CLI prints bots as `app/dash0-app`; GraphQL prints `dash0-app`), and strip one trailing `[bot]`.
Read the author with `gh pr view <pr> --json author --jq .author.login` and the viewer with `gh api graphql -f query='{ viewer { login } }' --jq .data.viewer.login`; an unknown viewer trusts only the listed bots.
Everyone else's PR is never posted to without a yes from the user, because a comment notifies the PR's author and its watchers.

### Always the same format, always from the script

The comment is the `aggregate` region of `<!-- verify:report -->`, and the only way to write it is `verify-comment.mjs` fed by a `report.md` rendered from [`templates/report.md.template`](../templates/report.md.template).
This holds when the run was driven by hand (a Chrome session, a single probe, a quick re-check): fill the template from what you observed, then run the script.
Never `gh pr comment` or `gh pr edit` a hand-written body, and never use `attach-media --to comment` for proof; upload the screenshot, put its URL in the media strip, and let the script write the comment.
When a hand-written comment already exists, post the real one first, then delete the hand-written one, but only when it does not start with `<!-- verify:report -->` and its URL differs from the one the script printed: the script edits a marked comment in place, so a marked one may now be the real comment.

**A parent never lets a child post.** `aw-verify` passes `--no-comment` to every `ui-verify` and `telemetry-verify` call, `ui-verify` passes it to every `telemetry-verify` call, and so does every other skill or agent that calls `telemetry-verify` for its own receipt (`verify-behavior`, `measurable`, `fix-bug`, `pr-reviewer`); the parent posts the child's proof inside its own region.

```text
✗ the same call without --no-comment
  # ui-verify posts its own region, then aw-verify's aggregate replaces it — two writes, one wasted
✓ Skill("ui-verify", "run .agent/<branch>/specs.md --env local --url <url> --no-telemetry --no-comment")
```

## Layout: criteria, verdict, media, then collapsed detail

A reviewer reads top-down and stops once they trust the result, so a green run shows four things and nothing else: the verdict with one sentence and the metadata line, what is worth a look in the preview, and a media strip (one recording, then up to two screenshot thumbnails).
The acceptance criteria sit once, above the verdict, in the collapsed `intent` region ([`intent.md § Step 6`](./intent.md#step-6--publish-the-criteria-on-the-pr)); the report never repeats them.
Everything else is one click away.

```markdown
<details><summary>📋 Acceptance criteria — 18 criteria · 15 ✅ · 3 ⏭️ · 3 guardrails</summary>

| | Criterion | Proof |
| :-- | :-- | :-- |
| ✅&nbsp;AC‑1 | An attached image renders inline where Agent0 places it | ui:/chat · w1 · [trace](https://app.dash0.com/…) |
| ⏭️&nbsp;AC‑14 | The card shows the artifact it read | ui:/chat · [test](https://github.com/…/card.test.tsx#L40) |
| 🛡️&nbsp;G‑1 | No other file changes | guardrail |

</details>

## ✅ Verified — images render where Agent0 places them

Agent0 shows an attached image inline wherever its answer places it. **Nothing needs your attention.**

<sub>`076fafc` · preview · 0 findings · updated {{UPDATED}}</sub>

#### Worth a look in the preview

- [ ] **AC-14:** the card shows the artifact it read (covered by tests only)

▶️ ✅ <b>Place an image in the answer</b> → it renders inline

https://github.com/user-attachments/assets/…

| ✅ Placed → inline | ✅ Made-up id → not shown |
| :---: | :---: |
| <img src="https://github.com/user-attachments/assets/…" width="420" alt="The chart renders inline in the answer"> | <img src="https://github.com/user-attachments/assets/…" width="420" alt="An unknown id shows an error"> |

<details><summary>Details</summary>

…

</details>
```

### Visible parts, in this order

| # | Part | Holds | Never |
| --- | --- | --- | --- |
| 1 | Headline | `## <emoji> <Verdict> — <what the change does, in the user's words>`, at most 70 characters; verdict words from [`report.md § Verdict`](./report.md#verdict). A standalone `ui` or `telemetry` region uses `###` | An agent name, a SHA, or an environment |
| 2 | Summary | One sentence on what works for the user; under a clean ✅, `**Nothing needs your attention.**` on the same line (§ Attention line) | The run's reasoning about its environment; an open item, a reason, or a next step |
| 2b | Attention section | Under every headline but a clean ✅: `#### Why not ✅` (or `#### Needs you` under ✅) and one bullet per item (§ Attention line) | Prose, or a bullet longer than one sentence |
| 3 | Metadata | One `<sub>` line: seven-character head SHA in backticks, environment, finding count (`<n> findings (<k> fixed)` after a fix loop), `updated {{UPDATED}}` (the script stamps it) | A URL, a time the agent typed, or a CI state |
| 3b | Worth a look | `#### Worth a look in the preview` and a `- [ ] **AC-n:** …` checklist for each criterion covered only by tests (`⏭️`); omitted when there is none | A table, or a criterion that already passed in the browser |
| 4 | Media strip | Directly under the verdict, worth-a-look list, and skipped line: one recording, then one row of up to two thumbnails, the rest one click away (§ Media strip) | A full-width screenshot, or a recording or screenshot inside a `<details>` row |
| 5 | Skipped line | `⏭️ *Not checked <where>: <what>; <what covers it instead>.*`; omitted when nothing was skipped | A skipped item as its own row |

### Attention line

A reviewer who sees anything but ✅ finds the reasons in the same place, in the same shape, every run: a section directly under the summary sentence, one bullet per reason.

| Headline | Renders |
| --- | --- |
| ✅, no bullets | `**Nothing needs your attention.**` on the summary's line; no section |
| ✅ with bullets | A `#### Needs you` section |
| ⚠️, ❌, ⛔, ⏭️ | A `#### Why not ✅` section, always with at least one bullet |

**Bullet shape**, every verdict and region:

```text
- **<what the user would notice>** (<tag>) → <next step>
```

| Field | Holds |
| --- | --- |
| `<what the user would notice>` | At most 15 words, in the user's words; one finding, check, or phase per bullet |
| `<tag>` | `failed check`, `blocked`, `not graded`, `inconclusive`, `ambiguous`, or the finding's severity (`critical`, `high`, `medium`, `low`) |
| `<next step>` | Exactly one of: `needs you: <the decision>`, `fix: <the change>`, `fine to merge as is`, or `follow-up: <what>` (an `in_scope: false` finding) |

**Bullets, in this order:**

1. Each failed check (❌), or the phase that could not run and its fix (⛔, ⏭️ `not graded`), then each flag left set because `restore` failed: `**<key> is still <value> in <service>** (blocked) → needs you: <the restore command>` ([`flags.md § Report`](./flags.md#report)).
2. Each open `in_scope: true` `critical`/`high` finding.
3. Each escalated finding, `needs you: <the decision>`.
4. Each open `in_scope: true` `medium` finding. An open `low` finding is a **Notes** line and never a bullet ([`report.md § What never caps the verdict`](./report.md#what-never-caps-the-verdict)).
5. In a `ui` region at ⚠️ (inconclusive): one bullet, the runner's `notes:` line, `(inconclusive)`, and the next step. In a `telemetry` region at ⚠️: one bullet per ambiguous journey, `(ambiguous)`, and what would settle it.
6. Last, every open `critical`/`high` finding that does not move the verdict — `in_scope: false` ([`findings.md` § in_scope](./findings.md)), or any finding in a `ui` or `telemetry` region — the `in_scope: false` ones starting `Outside this PR:`.

- At most five bullets; past five, a last bullet `+<n> more in Details`.
- One sentence per bullet: the evidence, the log line, and the reasoning go in **Details** or **Notes**, never in the bullet.
- Every other `in_scope: false` finding is a **Notes** line and never moves the verdict ([`report.md § Verdict`](./report.md#verdict)).
- Never a separate "Open items" block, and never a reason inline in the summary sentence: this section is the only place open items appear above **Details**.

```markdown
<!-- ✓ -->
## ⚠️ Verified with open items — Agent0 can start a test run after approval

Agent0 only gets `testAutomation` when write approval is on, and the card states the 5-runs/30-minutes limit.

#### Why not ✅

- **Testing a disabled automation fails with a 500 and "contact Dash0 support"** (medium) → fix: let a manual trigger start it, or drop the "runs whether or not enabled" promise and return a 4xx.

<!-- ✗ reasons inline after the summary, several findings and the evidence packed into one bullet -->
Agent0 only gets `testAutomation` when write approval is on. **Why not ✅:**
- Testing a disabled automation returns a 500, and Agent0 tells the user to "contact Dash0 support". The tool description promises it "runs whether or not the automation is enabled", and the failed call still uses up one of the approved runs (medium). Next step: …

<!-- ✗ the headline says open items, the next sentence says there are none -->
## ⚠️ Verified with open items — typed messages steer the running turn

A message typed while Agent0 works is read inside the same turn. **Nothing needs your attention.**
```

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

<!-- ✗ the recording inside a <details> row: closed by default, so nobody sees it -->
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
| **Edge cases and probes** | The table `ID \| What I tried \| Result \| Witness` for edge rows and probes, never per AC (text only); the region's status lines (`ui-verify`: its `rules/runner.md` § Step 5a); URL, driver, `recordings: not attached (<reason>)` when the region holds none, and the re-run command |

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
3. **Upload.** `verify-comment.mjs` uploads any local path left in the region when it writes, so a report written with `![caption](shots/a.png)` is never posted with a path. Look at every file first (no secrets). To choose captions and get the cap and re-encode handling, upload in one call before writing:

   ```text
   Skill("attach-media", "<pr-url> <path>#A failed save keeps the name <path>#Rename a view --to urls")
   ```

   `attach-media` opens every image before upload and skips one that shows a secret or personal data; it re-encodes a video over 10 MB and skips what still does not fit.
4. **Embed** each returned URL once, in the strip (§ Media strip); a recording that covers several checks is captioned with the first, and the others name it.
5. A file `attach-media` skipped or could not upload → **Details** says `<screenshot | recording> not attached (<reason>)`, and the terminal lists the file's absolute path; the comment never does.
6. **The tested commit is the PR head, or the report says so.** The `<sub>` line carries the commit you tested. When the head moved during the run, say which commit each result was seen on, and re-run what the newer commits touch.
7. **Recordings are never silently missing.** When the region holds no recording, **Details** says why: `recordings: not attached (<reason>)` — `--no-recording`, `no UI criterion`, `screencast not installed`, the runner's `notes` line, or the upload failure.

## Write the region

Write the region body (no marker) to `<run dir>/comment-<section>.md`, then:

```bash
VC="${CLAUDE_SKILL_DIR}/../aw-verify/scripts/verify-comment.mjs"   # inside aw-verify: ${CLAUDE_SKILL_DIR}/scripts/verify-comment.mjs
node "$VC" --pr <pr-url> --section <aggregate|ui|telemetry> --file <run dir>/comment-<section>.md [--replace-all]
```

| Exit | Meaning | Do |
| --- | --- | --- |
| `0` | Prints the PR URL (report in the description) or the comment URL | Report it |
| `1` | Refused: a local path, a verify marker, or a screenshot or recording a reviewer must click to see | Replace the path with its uploaded URL or `not attached (<reason>)`; move media into the strip under the verdict (an impact-map `<picture>` in Details is allowed); then write once more |
| `2` | `gh` failed | `comment: failed (<stderr first line>)`; never retry in a loop |

Pass `--to body` or `--to comment` only when the user asks for that place; the default picks it (§ Where the report lives).

- **`mcp` access path (no `gh`), report in the description:** read the PR with `mcp__github__pull_request_read` (`method: "get"`). Take this path when the PR is your own (its author is `mcp__github__get_me`), or when its body already holds the report on lines of their own and its author is an app or has `author_association` `OWNER`, `MEMBER`, or `COLLABORATOR`: the same choice the `gh` path makes, so a bot run never adds a second report beside one in the description. Run the script with `--dry-run --to body --existing <the PR body> --head <the PR's head SHA>`, plus `--seed <the verify comment's body>` when the body holds no report yet and a verify comment qualifies (below), and write its stdout, the whole new body, with `mcp__github__update_pull_request`. After a successful write, edit that seed comment to `<!-- verify:moved -->` and a one-line link to the description with `mcp__github__update_issue_comment`, and post `notice.md` as below. When the write is refused, take the comment path below.
- **`mcp` access path (no `gh`), any other PR:** read the comments with `mcp__github__issue_read` (`method: "get_comments"`) and take the newest comment starting with the marker whose author is an app, has `author_association` `OWNER`, `MEMBER`, or `COLLABORATOR`, or is `mcp__github__get_me`. Run the script with `--dry-run --existing <its body> --head <the PR's head SHA>` and write its stdout with `mcp__github__update_issue_comment`; when that update is refused as forbidden, post the same stdout with `mcp__github__add_issue_comment`, so the other regions and the history carry over. When no comment qualifies, run `--dry-run --head <sha>` without `--existing` and post it with `mcp__github__add_issue_comment`.
  With `--existing`, also pass `--notice-out <run dir>/notice.md --comment-url <that comment's html_url>`; after a successful update, when `notice.md` exists, post its contents with `mcp__github__add_issue_comment`, because an edit notifies nobody; after a refused update, post no notice, as the script's own fallback does, because the new comment already notifies.
  The `gh` path needs neither flag: the script posts the notice itself.
- **Script not found** (`aw-verify` not installed) → `comment: not posted (aw-verify not installed)`.
- Write after the fix loop pushed, so the region describes the final head SHA.

## Report line

Print one line after the skill's report: `comment: <comment-url> (region <section>)`, `comment: <pr-url> (region <section>, in the PR description)`, or the `not posted (<reason>)` / `failed (<reason>)` line.
