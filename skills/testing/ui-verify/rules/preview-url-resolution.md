---
title: Preview URL resolution — GitHub deployments API
impact: HIGH
tags:
  - ui-verify
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

## Repo-configured resolution (when previews aren't GitHub-integrated)

The generic steps below assume a GitHub-integrated host that registers a **deployment** or posts a **recognizable provider bot comment**. Some repos deploy previews another way — a CLI `vercel deploy` in the repo's own CI registers NO GitHub deployment and posts a `github-actions[bot]` sticky comment whose stable alias is not `*-git-*`. For these the generic resolver finds nothing and every run needs a manual `--url`. Instead, the committed aw-target (`.claude/aw-targets/preview.yml`, if the repo has one) may carry a `preview_url` block that tells the resolver where to look.

`--url` still overrides this. If `preview_url` is absent, skip to the precondition and generic steps below, unchanged. When it is present, try its sources in order and take the first that yields a **reachable** URL — this is a hint, never a dead end: if none resolves, FALL THROUGH to the generic steps.

1. **`preview_url.comment` — the sanctioned comment read, generalized.** Scan the PR's comments whose author matches the DEFAULT providers (`vercel|netlify|cloudflare|render`) OR any author in `authors`, and take the URL whose host matches `host_pattern`. This still reads a **real, published** URL; the config only says which author and host to trust, not what the URL is — so it is not the free-text grep the "Do not" section forbids.

   ```bash
   gh pr view <pr> --json comments \
     --jq '[.comments[] | select(.author.login|test("vercel|netlify|cloudflare|render|<authors>";"i")) | .body] | join("\n")' \
     | grep -oiE 'https://<host_pattern>' | head -1
   ```

   Unlike the deployments API, a comment read has an mcp equivalent (`mcp__github__pull_request_read`), so this source is reachable on the `mcp` path too.

2. **`preview_url.template` — a verified constructed URL.** Substitute `{pr}` (PR number), `{branch}` (slugified head ref), `{sha}` (head SHA). This is the ONE sanctioned way to CONSTRUCT a URL, and only because it is **read from the committed aw-target** (a human wrote and committed it) **and reachability-checked here before use** — not a slug rule you inferred. The check must tell a WRONG alias apart from a RIGHT-but-GATED one, or it rejects exactly the protected previews this feature exists for:
   - Send the aw-target's `auth.bypass_header` (name + the env-var's value) on the check request when one is configured — otherwise a protected preview redirects to its host-protection origin and looks unreachable.
   - **Accept** a `2xx`, and also a redirect to a KNOWN host-protection origin (e.g. `vercel.com/sso-api`, `*.netlify.app`'s password page): the alias is correct, just gated, and `aw-tester` applies the same bypass at run time.
   - **Reject** (fall through) only a real miss: `404` / `410`, `NXDOMAIN` / DNS failure, or a redirect to an UNRELATED origin. A miss means the template is wrong for this PR.

   Because it needs only the PR number plus this check, this source resolves even where the deployments API is unavailable (the `mcp` / `none` access path — see the precondition's exception below).

Name the source in the report: `repo-config-comment` or `repo-config-template`.

## The access-path precondition (check this before step 1)

Every step below reads the GitHub deployments API, and **no `mcp__github__*` tool exposes deployments**.
So the resolution steps are reachable only on the `gh` access path ([`SKILL.md` Step 0](../SKILL.md#step-0-resolve-your-github-access-path)).

| Resolved access path | `--url` passed? | What to do |
| --- | --- | --- |
| `gh` | either | Run the resolution steps below. |
| `mcp` or `none` | yes | Use the override above. The steps below never run. |
| `mcp` or `none` | no | Report `inconclusive: no access path for deployment lookup (pass --url)` and stop — UNLESS the repo's `preview.yml` configures a `preview_url.template` (see [Repo-configured resolution](#repo-configured-resolution-when-previews-arent-github-integrated) above), which resolves on this path without the deployments API. |

**Never report `inconclusive: preview not deployed` from the last row.**
That string asserts a fact about the deployment — that a lookup ran and found nothing — and on this path no lookup ran at all.
The two outcomes have different remedies, which is the whole reason they are different strings: the first is fixed by passing a URL, the second by waiting for a build.

This decision lands here rather than in `SKILL.md` Step 0 because its condition is *`run` invoked without an explicit `--url`*, and Step 0 resolves the access path before it knows the invocation's arguments.
[`runner.md § Step 2`](./runner.md) declares any `inconclusive: …` outcome from this file terminal, so this is the one place the branch has to exist for a run to honour it.

## Resolution steps

Reached only on the `gh` path, per the precondition above.

1. **List deployments for the head SHA.** Prefer the SHA over the branch — a force-push leaves stale branch deployments.

   ```bash
   gh api "repos/<owner>/<repo>/deployments?sha=<head-sha>&per_page=20" \
     --jq '[.[] | {id, environment, created_at}] | sort_by(.created_at) | reverse'
   ```

   Empty result → retry once with `?ref=<head-ref>`. Still empty → **not deployed yet**; report `inconclusive: preview not deployed` and stop.
   This outcome is only ever correct after both queries actually ran — it reports what the lookup found, so a path that could not perform the lookup reports the precondition's string instead.

2. **Resolve the STABLE branch preview, not a per-commit URL.** A preview URL must survive a re-push: the reviewer (and `review-loop`) re-run against the same PR after new commits land, so a per-commit deployment URL (`<project>-<hash>.<domain>`) is dead the moment the next commit builds. The stable one is the **branch alias** the provider publishes — Vercel's `<project>-git-<branch>.<domain>`, Netlify's `deploy-preview-<n>--<site>.netlify.app`, and equivalents. Prefer it, in this source order:

   a. **A branch-alias `environment_url` from the deployments API.** In step 3 you read the newest non-production deployment's success statuses; if a success `environment_url` host is a *branch* alias (contains `-git-` for Vercel, or `deploy-preview-` for Netlify) rather than a per-commit hash, take it. Some provider configs post the alias here directly.

   b. **The deployment provider's PR comment** — the one place the stable alias is reliably published. The GitHub deployments API frequently exposes **only** the per-commit URL (measured: on a real Vercel repo the `Preview` deployment's `environment_url` was `<project>-<hash>.<domain>`, and the stable `<project>-git-<branch>.<domain>` alias appeared **only** in the Vercel bot comment). So read the provider's bot comment and take its `Preview` / branch link:

      ```bash
      gh pr view <pr> --json comments \
        --jq '[.comments[] | select(.author.login|test("vercel|netlify|cloudflare|render";"i")) | .body] | last'
      ```

      Match the **branch-alias host pattern** in that body (`*-git-*`, `deploy-preview-*`), not arbitrary free text. This is not the fragility the deployments API was chosen to avoid — that was grepping an unknown bot's prose for *some* URL; this is reading the host's own canonical comment for the *stable* alias the API does not carry, and matching a structural host pattern.

   c. **Fall back to the per-commit URL only when no stable alias is obtainable** from (a) or (b), and label it in the report as commit-pinned (it will 404 after the next push). Take it from step 3.

3. **Read deployment statuses (source for 2a and the 2c fallback).** From the deployment list, drop any whose `environment` is exactly `production` / `Production`, then order the rest **preview-named first** (env matches `/preview/i` or equals `deploy-preview`), newest-first, then everything else (`Development`, `staging`, …) newest-first. Blind recency picks wrong here: a `Development` deployment is often newer *and* carries no app URL (its success status points at CI). Walk the ordered candidates; for each:

   ```bash
   gh api "repos/<owner>/<repo>/deployments/<deployment-id>/statuses?per_page=20" \
     --jq '[.[] | {state, environment_url, target_url, created_at}]
           | sort_by(.created_at) | reverse'
   ```

   Do not filter to `state == "success"` before sorting — that collapses a
   pending-only list and a failed-only list to the same empty result, so the
   state handling below could never tell them apart. Keep every status.

   - First `success` entry (newest-first): take `environment_url`, else fall back
     to `target_url` — **but never a `target_url` whose host is `github.com`**
     (a GitHub Actions run/job page, not an app; a spec against it is a false red).
     Treat "no usable URL" as no success for this candidate.
   - A usable URL → this candidate yields it (feed it to 2a's alias check first,
     else hold it as the 2c per-commit fallback). Otherwise record
     `building` / `failed` / `no app URL` and advance.
   - **State handling per candidate:** newest entry `pending` / `in_progress` with
     no `success` anywhere → `building`. Newest `failure` / `error` with no
     `success` anywhere → `failed`. A `success` with no usable URL → `no app URL`.

   If no candidate yields a usable URL **and** 2b found no alias, report the most
   informative single outcome, in precedence: any `building` →
   `inconclusive: preview building`; else any `failed` →
   `inconclusive: preview deploy failed`; else →
   `inconclusive: preview URL not published`. Stop.

4. **Return the resolved URL** (no trailing slash) to the runner, naming the source and stability so the resolution is auditable: `Preview URL: <url> (source: <branch-alias | provider-comment | commit-pinned>, deployment <id>, environment <environment>)`. Prefer a stable source; only emit `commit-pinned` when 2a and 2b both came up empty.

## Do not

- **Do not take a per-commit URL when a stable branch alias is available.** Step 2 exists for this: a re-push invalidates `<project>-<hash>.<domain>`, and the reviewer re-runs against the PR, so a commit-pinned URL is only the last resort — labelled as such.
- **Do read the provider's OWN comment for the stable alias** (step 2b) when the API carries only a per-commit URL — but only the provider's bot comment (`vercel` / `netlify` / `cloudflare` / …), and only a **branch-alias host pattern** (`*-git-*`, `deploy-preview-*`) within it. This is the one sanctioned comment read. Do **not** grep an arbitrary comment, or match free text, for *some* URL — that is the wording-coupling the deployments API is preferred to avoid.
- **Do not poll in a tight loop.** One retry against `?ref=` is the only retry. If the preview is still building, report `inconclusive` and let the caller re-run once it is ready — the runner is on-demand, not a watcher.
- **Do not fabricate a branch alias from a template you did not read** (`https://<repo>-git-<branch>.vercel.app`). Taking the alias from the provider's published comment (2b) is reading a real URL; *constructing* one from a slug rule you inferred is a guess that 404s when the project slug, preview domain, or branch sanitization differs. If neither the API nor the comment yields a URL, report `inconclusive` — never a guessed one. **The sole exception is a `preview_url.template` READ from the committed aw-target** (see [Repo-configured resolution](#repo-configured-resolution-when-previews-arent-github-integrated)): that is configuration a human wrote and committed, and the resolver reachability-checks it before use and falls through if it 404s — so it is neither inferred nor unverified.
