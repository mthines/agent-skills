# Upload ladder

Take the first rung whose condition holds.
State the rung you took in the report.
**Why:** rung 1 is the supported path, and rung 2 calls the same endpoint as rung 1 for hosts with an older `gh` or no `gh` at all.

## Resolve the target once

```bash
REF="<pr-or-issue-ref>"                       # URL or number
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)   # or parse owner/repo from the URL
KIND=pr                                       # `issue` when the URL path has /issues/
N=$(basename "$REF" | tr -d '#')
WORK=$(mktemp -d)
```

Turn every file path into an absolute path before you use it.
`gh` matches a body reference to an `--attach` argument by absolute path.

```bash
ABS=$(cd "$(dirname "$f")" && pwd)/$(basename "$f")
```

## Rung 1 — `gh --attach` (gh ≥ 2.99)

Condition: `gh "$KIND" edit --help | grep -q -- '--attach'` and `gh auth status` exit 0.

### `--to body`

1. Read the current body: `gh "$KIND" view "$N" -R "$REPO" --json body -q .body > "$WORK/body.md"`.
2. Splice the owned region into `$WORK/body.md` per [`body-region.md`](./body-region.md).
   Precede each entry with its `<!-- attach-media:file=<basename> -->` marker, then reference the file by its **absolute local path**:
   - an image as `![<alt>](<abs-path>)`;
   - a video as `![](<abs-path>)` alone in its own paragraph, with a blank line above and below.
3. Upload and rewrite in one call:

   ```bash
   gh "$KIND" edit "$N" -R "$REPO" --body-file "$WORK/body.md" \
     --attach "/abs/spec-1-auto-final.png#Dashboard with the new revenue widget" \
     --attach "/abs/spec-1.webm"
   ```

   `gh` uploads each file and rewrites each local reference to its asset URL.
   A video paragraph becomes a bare URL, which GitHub renders as a player.
   A file the body does not reference is appended to the end of the body, which is outside the region, so reference every file.

### `--to comment`

```bash
gh "$KIND" comment "$N" -R "$REPO" --body-file "$WORK/comment.md" --attach "/abs/a.png#alt"
```

### Partial failure

A non-zero exit after some uploads succeeded still updates the body with the ones that worked.
Re-read the body and apply [Step 4 of `SKILL.md`](../SKILL.md#step-4-verify-and-report).
Do not retry a `422` or a `403`; retry a `429` once, after its `Retry-After`.

## Rung 2 — the upload endpoint over `curl`

Condition: rung 1's check failed, and a token resolves in this order: `gh auth token`, `$GH_TOKEN`, `$GITHUB_TOKEN`.
The token needs write access to the repo.
A classic PAT with `repo` scope works, and so does a `gh auth login` OAuth token.

This is the request `gh` itself sends.
It is undocumented, so treat a `404` as `not attached (upload endpoint unavailable)`, never as a reason to try another host.

```bash
TOKEN=$(gh auth token 2>/dev/null || echo "${GH_TOKEN:-$GITHUB_TOKEN}")
REPO_ID=$(curl -fsS -H "Authorization: Bearer $TOKEN" "https://api.github.com/repos/$REPO" | jq -r .id)

upload() {   # $1 = absolute path, $2 = MIME type → prints the asset URL
  curl -fsS -X POST \
    -H "Authorization: Bearer $TOKEN" \
    -H "Accept: application/vnd.github+json" \
    -H "Content-Type: application/octet-stream" \
    --data-binary "@$1" \
    "https://uploads.github.com/user-attachments/assets?name=$(basename "$1" | jq -sRr @uri)&content_type=$2&repository_id=$REPO_ID" \
  | jq -r .url
}
```

| Extension | MIME |
| --- | --- |
| `png` | `image/png` |
| `jpg`, `jpeg` | `image/jpeg` |
| `gif` | `image/gif` |
| `webp` | `image/webp` |
| `svg` | `image/svg+xml` |
| `mp4` | `video/mp4` |
| `mov` | `video/quicktime` |
| `webm` | `video/webm` |

Then splice the region, writing each entry's `<!-- attach-media:file=<basename> -->` marker and putting each returned URL where rung 1 put the local path, and write the body:

```bash
jq -n --rawfile body "$WORK/body.md" '{body: $body}' \
  | curl -fsS -X PATCH -H "Authorization: Bearer $TOKEN" \
      "https://api.github.com/repos/$REPO/$( [ "$KIND" = pr ] && echo pulls || echo issues )/$N" --data @-
```

For `--to comment`, POST `{body}` to `https://api.github.com/repos/$REPO/issues/$N/comments`.
That endpoint serves PR comments too.

```text
❌ WRONG — a URL that is not a user-attachments asset
![shot](https://raw.githubusercontent.com/acme/app/pr-123-media/shot.png)   # committed media
![shot](https://i.imgur.com/abc.png)                                         # third-party host

✅ RIGHT
![Dashboard with the new revenue widget](https://github.com/user-attachments/assets/1f0c…)
```

## `--to urls`

`gh --attach` uploads only as part of a body or comment write, so `--to urls` starts at rung 2.
Run `upload` for each file and print one line per file, in input order:

```text
![Before: empty name field](https://github.com/user-attachments/assets/1f0c…)
https://github.com/user-attachments/assets/9a2d…
```

An image line is `![<alt>](<asset-url>)`, and a video line is the bare URL.
When rung 2 cannot run, print `not attached (<reason>) — <abs-path>` for each file, using a rung 3 reason, so the caller can keep its local-path fallback.

## Rung 3 — no upload path

Upload nothing and leave the body untouched.
Report each file as `not attached (<reason>)`.
The reason is exactly one of the following:

| Reason | When |
| --- | --- |
| `no GitHub token` | `gh` is absent or unauthenticated and neither env var is set. The usual case is an MCP-only cloud session. |
| `GitHub Enterprise Server` | The repo host is not `github.com` and not a `*.ghe.com` Enterprise Cloud host. |
| `no write access` | Either rung returned `403`. |
| `upload endpoint unavailable` | Rung 2 returned `404`. |

Add the one command the user can run on a machine with gh ≥ 2.99: `gh pr edit <n> --attach <file>`.
