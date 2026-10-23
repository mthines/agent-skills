---
name: attach-media
description: >
  Uploads local screenshots and recordings to GitHub and embeds them in a PR or
  issue body or comment as inline-rendering user-attachments URLs, via `gh
  --attach` with a curl fallback; never writes placeholders. Triggers on "attach
  screenshots to the PR", "upload this recording to the PR", "/attach-media".
disable-model-invocation: false
argument-hint: '<pr-or-issue-ref> <file>[#alt] [<file>[#alt] ...] [--to body|comment|urls] [--heading <text>] [--dry-run]'
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: command
  tags:
    - github
    - pull-request
    - screenshots
    - recordings
    - media
---

# Attach Media

Put real screenshots and recordings into a GitHub PR or issue, so a reviewer sees the change without running it.
Every skill that wants media on a PR delegates here, so the upload method lives in exactly one place.

```text
Skill("attach-media", "<pr-url|#n> <file>[#alt] ... [--to body|comment|urls] [--heading <text>] [--dry-run]")
```

| Argument | Default | Meaning |
| --- | --- | --- |
| `<pr-or-issue-ref>` | the current branch's open PR | A PR or issue URL, or `#<n>` in the current repo. |
| `<file>[#alt]` | — (required, 1–50) | A local file. Text after `#` is the image's alt text; video has none. |
| `--to body` | yes | Write into the owned region of the PR or issue body. Re-runs merge into the region by filename. |
| `--to comment` | — | Post one new comment instead. Use for evidence attached to a specific event. |
| `--to urls` | — | Upload only, through rung 2, and print one Markdown line per file for the caller to embed. Use it for a review thread or any body the caller writes itself. Writes nothing to GitHub except the upload. |
| `--heading <text>` | `Screenshots` | The `###` heading inside the owned region. |
| `--dry-run` | — | Run the preflight and print the planned region. Upload nothing. |

## Step 1: Preflight every file

Drop a file from the run, and name it in the report, when any check fails:

| # | Check | On failure |
| --- | --- | --- |
| 1 | The file exists and is non-empty. | `skipped (missing)` |
| 2 | The extension is `png`, `jpg`, `jpeg`, `gif`, `webp`, `svg`, `mp4`, `mov`, or `webm`. | Convert other video (`avi`, `mkv`) with `ffmpeg -i in.avi -c:v libx264 -pix_fmt yuv420p -an out.mp4`; else `skipped (unsupported type)` |
| 2a | A recording is a video, not a GIF. | Convert an animated `.gif` (a browser-extension recording) to `.mp4`: `ffmpeg -i x.gif -movflags +faststart -vf "scale=1280:-2,format=yuv420p" -c:v libx264 -crf 28 -an x.mp4`. It is ~20× smaller, and its bare URL renders as a player; a GIF renders only as an image embed |
| 3 | An image or GIF is ≤ 10 MB; a video is ≤ 10 MB (100 MB on a paid plan). | Re-encode a video once: `ffmpeg -i in.webm -vf scale=1280:-2 -c:v libx264 -crf 30 -an out.mp4`; else `skipped (too large)` |
| 4 | **You looked at it.** Open every image with the Read tool; for a video, open the `screencast` contact sheet beside it (`<stem>.sheet.png`, one frame per step) when it exists, else extract three frames (`ffmpeg -i v.webm -vf fps=1/3 -frames:v 3 /tmp/f%d.png`) and open them. | `skipped (contains <secret/token/PII>)` — never upload it |

Check 4 is mandatory because an upload is permanent and visible to everyone who can read the repo.
Refuse any frame showing an API key, token, password, session cookie, a real customer's name or email, or a production data row.
A test fixture's fake data is fine.

## Step 2: Upload through the first rung that works

Full procedure: [`rules/upload-ladder.md`](./rules/upload-ladder.md).

| Rung | Condition | Method |
| --- | --- | --- |
| 1 | `gh pr edit --help` lists `--attach` (gh ≥ 2.99) and `gh auth status` passes | `gh pr edit` / `gh issue edit` / `gh pr comment` with `--body-file` and one `--attach` per file |
| 2 | Rung 1 fails, and a token resolves from `gh auth token`, `$GH_TOKEN`, or `$GITHUB_TOKEN` | `curl` POST to `https://uploads.github.com/user-attachments/assets`, then write the body over REST |
| 3 | Neither rung can run (no token, GitHub Enterprise Server, MCP-only host, no write access) | Upload nothing; report `not attached (<reason>)` with the local paths |

## Step 3: Write the owned region

Under `--to urls`, skip this step and print the lines from [`rules/upload-ladder.md § --to urls`](./rules/upload-ladder.md#--to-urls).

Full contract: [`rules/body-region.md`](./rules/body-region.md).
The region is delimited by `<!-- attach-media:v1 -->` … `<!-- /attach-media:v1 -->`.
There is at most one per body, and a re-run merges by filename.

```markdown
<!-- attach-media:v1 -->
### Screenshots

<!-- attach-media:file=revenue-widget.png -->
![Dashboard with the new revenue widget](https://github.com/user-attachments/assets/1f0c…)

<!-- attach-media:file=spec-1.webm -->
https://github.com/user-attachments/assets/9a2d…
<!-- /attach-media:v1 -->
```

## Step 4: Verify and report

Re-read the region or comment you wrote, then confirm both of these:

1. It contains one `https://github.com/user-attachments/assets/` URL per uploaded file.
2. It contains no local path, meaning no `./`, `/Users/`, `/home/`, `/tmp/`, or `.agent/` reference.

Remove any local path you find and list its file as `not attached (upload failed: <reason>)`.

```text
attach-media: <N> attached, <S> skipped, <F> not attached — <pr-url>
  attached: <file> → <asset-url>
  skipped:  <file> (<reason>)
  not attached: <file> (<reason>)   # rung 3 adds: run `gh pr edit <n> --attach <file>` on gh ≥ 2.99
```

Callers relay the first line verbatim.

## Hard rules

- **Never write placeholder text.** That means no `TODO: add screenshots`, no `<!-- screenshots here -->`, no `_Screenshots coming soon_`, and no local path a reader cannot open. An absent region is honest; a placeholder claims work that never happened.
- **Never commit media to the repo** to get a URL, and never upload to a third-party host. Rationale: [`references/rationale.md`](./references/rationale.md).
- **Never upload a file you have not looked at** (Step 1, check 4).
- **Attach after the PR exists.** Never fold `--attach` into a caller's `gh pr create`; one code path owns the region, so re-runs and refreshes stay idempotent.
