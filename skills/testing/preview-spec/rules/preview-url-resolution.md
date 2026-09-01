---
title: Preview URL resolution — GitHub deployments API
impact: HIGH
tags:
  - preview-spec
  - github-deployments
  - preview-deployment
  - vercel
  - netlify
---

# Preview URL resolution

The runner needs the PR's **live preview deployment URL** — the one Vercel, Netlify, Cloudflare Pages, or any GitHub-integrated host posts as a deployment.
This resolves it from the **GitHub deployments API**, which every such host writes to, rather than from a specific bot's comment format.

## Inputs

- `<owner>/<repo>` — from the PR reference or `gh repo view --json nameWithOwner -q .nameWithOwner`.
- `<head-sha>` — the PR's head commit: `gh pr view <pr> --json headRefOid -q .headRefOid`.
- `<head-ref>` — the PR's head branch: `gh pr view <pr> --json headRefName -q .headRefName`.

## The override

If the invocation passed `--url <preview-url>`, use it directly and skip every step below.
The caller has told you the URL; do not second-guess it.

## Resolution steps

1. **List deployments for the head SHA.** Prefer the SHA over the branch — a force-push leaves stale branch deployments.

   ```bash
   gh api "repos/<owner>/<repo>/deployments?sha=<head-sha>&per_page=20" \
     --jq '[.[] | {id, environment, created_at}] | sort_by(.created_at) | reverse'
   ```

   Empty result → retry once with `?ref=<head-ref>`. Still empty → **not deployed yet**; report `inconclusive: preview not deployed` and stop.

2. **Prefer a preview environment over production.** From the list, drop any deployment whose `environment` is exactly `production` or `Production`. Keep the newest of the rest (Vercel names them `Preview`, Netlify `deploy-preview`, others vary). If every deployment is production, there is no preview to test — report `inconclusive: no preview environment` and stop.

3. **Read that deployment's statuses newest-first and take the URL of the newest success.**

   ```bash
   gh api "repos/<owner>/<repo>/deployments/<deployment-id>/statuses?per_page=20" \
     --jq '[.[] | {state, environment_url, target_url, created_at}]
           | sort_by(.created_at) | reverse'
   ```

   Do not filter to `state == "success"` before sorting — that collapses a
   pending-only list and a failed-only list to the same empty result, so the
   state handling below could never tell them apart. Keep every status.

   - Find the first entry (newest-first) whose `state == "success"`. Take its
     `environment_url`; if null or empty, fall back to `target_url`.
   - **State handling:** the newest entry (index 0) is `pending` / `in_progress`
     and no `success` entry exists anywhere in the list → the build is still
     running; report `inconclusive: preview building` and stop. The newest
     entry is `failure` / `error` and no `success` entry exists anywhere in
     the list → report `inconclusive: preview deploy failed` and stop.
   - Both URLs empty on the only `success` entry → report `inconclusive:
     preview URL not published` and stop.

4. **Return the resolved URL** (no trailing slash) to the runner. State it in the report: `Preview URL: <url> (deployment <id>, environment <environment>)`.

## Do not

- **Do not parse a bot comment for the URL** unless the deployments API returns nothing *and* the user asks you to. The API is the host-neutral source; a comment grep couples you to one bot's wording.
- **Do not poll in a tight loop.** One retry against `?ref=` is the only retry. If the preview is still building, report `inconclusive` and let the caller re-run once it is ready — the runner is on-demand, not a watcher.
- **Do not guess a URL from a template** (`https://<repo>-git-<branch>.vercel.app`). A guessed URL that 404s or hits the wrong environment produces a false red. Resolve it or report `inconclusive`.
