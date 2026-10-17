# Why attach-media works the way it does

## GitHub-hosted user attachments

The `github.com/user-attachments/assets/…` URLs are the ones the browser's drag-and-drop produces.
They inherit the repo's visibility, so private-repo media stays private.
They render inline: images as images, and a bare video URL as a player.
GitHub plays video only when GitHub hosts it, so a third-party video URL renders as a plain link.

## `gh --attach` is rung 1

gh 2.99.0 (released 2026-09-01) added a repeatable `--attach` flag to `gh pr create|edit|comment` and `gh issue create|edit|comment`.
It supports PNG, JPEG, GIF, WebP, SVG, MP4, MOV, and WebM.
The limits are 10 MB for images and GIFs, and 10 MB for video on Free plans or 100 MB on paid plans.
It requires write access, works on GitHub.com and GitHub Enterprise Cloud, and does not support GitHub Enterprise Server.
It rewrites a body reference whose path matches an attached file, matched by absolute path or relative to the body file's directory.
That makes `--body-file` plus `--attach` a single idempotent write.

Sources:

- [GitHub changelog, 2026-09-01: GitHub CLI media in issues, pull requests, and comments](https://github.blog/changelog/2026-09-01-github-cli-media-in-issues-pull-requests-and-comments/)
- [cli/cli v2.99.0 release notes](https://github.com/cli/cli/releases/tag/v2.99.0)
- [`internal/attachments/client.go`](https://github.com/cli/cli/blob/trunk/internal/attachments/client.go) shows the upload request, and [`references.go`](https://github.com/cli/cli/blob/trunk/internal/attachments/references.go) shows the body rewrite.

## The curl endpoint is rung 2, not rung 1

`POST https://uploads.github.com/user-attachments/assets?name=…&content_type=…&repository_id=…` with a bearer token and the raw bytes returns `{"url": …}`.
That is the exact request `gh` sends, so it is no more fragile than rung 1.
It is still undocumented, which is why it is the fallback for hosts whose `gh` predates 2.99, or that have a token but no `gh`.
Before mid-2026 it was believed to accept only browser-session cookies, and a 2026 write-up found that it accepts tokens.

Source: [island94.org — How to programmatically upload attachments to GitHub Issues, Pull Requests, and Comments](https://island94.org/2026/08/programmatically-upload-attachments-to-github-issues-pull-requests-comments)

## Rejected alternatives

| Alternative | Why not |
| --- | --- |
| Commit media to the branch, or to a side branch, and link the raw URL | Pollutes history. The raw URL breaks when the branch is deleted, and on private repos a `raw.githubusercontent.com` URL needs a token. |
| Release assets on a throwaway prerelease | Works on supported APIs, but leaves a release per PR to clean up, and videos render as links, not players. |
| Third-party hosts (uploads.sh, imgur, S3) | Public by default, which leaks private-repo UI. Another credential to manage, and video still is not a player. |
| Browser automation of the comment box's hidden file input | Needs a logged-in browser session. Slow and brittle, and it is what rungs 1 and 2 replace. |
| A placeholder for a human to fill | The failure this skill exists to remove. A placeholder reads as done and is rarely filled. |
