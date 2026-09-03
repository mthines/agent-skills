---
title: Agent0 fix links — opt-in "Fix with Agent0" deep-link buttons
impact: MEDIUM
tags:
  - pr-reviewer
  - agent0
  - deep-link
  - opt-in
---

# Agent0 fix links

Opt-in "Fix with Agent0" buttons on the reviewer's output — the Agent0 equivalent of Cursor's
"Fix in Cursor" button. Two placements: one **Fix all** button in the report, and one **Fix this**
button per inline finding. Each links to an Agent0 deep link that auto-submits a prompt which fixes
the finding and commits to the same PR.

The prompt is a call to Agent0's **`/implement`** skill plus an address — the PR, whose comments, and
(for **Fix this**) which one. The skill owns the method; the URL owns the target. See
§ Prompt templates.

This is **off by default**. Non-Dash0 repos have no Agent0, so the buttons only render when the
review config opts in.

## Contents

- [Opt-in](#opt-in)
- [Deep-link format](#deep-link-format)
- [Click attribution](#click-attribution)
- [Prompt templates](#prompt-templates)
- [Button markup](#button-markup)
- [Safety](#safety)

## Opt-in

Off by default. It is a **runtime mode**, enabled per-run with the `--fix-links` flag on the
`pr-reviewer` invocation:

```text
Task(subagent_type="pr-reviewer", prompt="<PR-URL> --fix-links")
```

`--fix-links` is the mode the Agent0 automation passes for the runs it owns, so nobody else's
reviews change and no repo has to commit a config file. A repo that *always* wants the buttons can
set the equivalent default in its review config instead:

```yaml
# .github/review.yaml
agent0_fix_links: true   # repo-wide default — equivalent to always passing --fix-links (default: false)
```

With neither the flag nor the config set (the default), the reviewer emits no buttons anywhere and
behaves exactly as before.

## Environment

Which Agent0 the buttons link to is set by `agent0_environment` in the review config:

```yaml
# .github/review.yaml
agent0_environment: production | development   # default: production
```

- `production` → `https://app.dash0.com`
- `development` → `https://app.dash0-dev.com`

`pr-reviewer` reads this and passes it to `build-agent0-link.mjs` as `--env <env>`; that script owns
the host map (the single source, so both button sites resolve the same host), and an unknown value
falls back to `production`. The report renderer rejects a `FIX_ALL_URL` whose host is neither
`app.dash0.com` nor `app.dash0-dev.com`.

## Deep-link format

```text
https://<app-host>/goto/agent0?auto_submit=true&initial_prompt=<ENCODED_PROMPT>&utm_source=pr-reviewer-<SOURCE>
```

`<app-host>` is `app.dash0.com` (production) or `app.dash0-dev.com` (development), per § Environment.
`<SOURCE>` is `fix-all` or `fix-this`, per § Click attribution.

`<ENCODED_PROMPT>` is built by `agents/pr-reviewer/scripts/build-agent0-link.mjs`'s `encodePrompt` —
the single source of truth for this encoding, so the report renderer and the inline-comment step
encode identically. Read that script for the exact escaping rule rather than re-deriving it here;
duplicating it in prose is how the two "single source" encoders drift apart. The reason it exists:
`encodeURIComponent` leaves `(`, `)`, and `'` literal, and a literal `)` would terminate the
`](url)` markdown link. The renderer rejects a `FIX_ALL_URL` that still contains a literal `)` as a
fail-closed guard.

Keep prompts compact. The hard bound is `build-agent0-link.mjs`'s `MAX_URL` (**4000** chars, applied
to the encoded URL — the thing that actually goes on the wire), and the design target for any
template is **≤ 2500**, leaving the guard as a guard rather than a routine ceiling.

**Why 4000 and not 8000.** Browsers are not the constraint — Chrome processes ~2 MB (its omnibox
merely *displays* up to 32 kB), Firefox handles 64 k+, Safari ~80 k. The first default-configured
proxy is: nginx's default `large_client_header_buffers 4 8k` requires the whole request line to fit
**one** 8 k buffer or it answers `414`, and raising the buffer *count* does not help; Apache's
`LimitRequestLine` defaults to 8190; CDNs and load balancers commonly sit at 8–16 k. An 8000-char
guard therefore sat exactly on that cliff — a 7999-char link passed and then 414'd. The often-quoted
"2048 everywhere" is IE's 2083 in disguise and no longer binds a known modern host.

Both fix prompts are **one `/implement` invocation plus an address** — no finding body, no worklist,
no embedded query, and no method. Agent0's `/implement` skill owns everything the prompt used to
spell out: gathering the PR's comments, filtering them to one author, applying the actionable ones,
committing, and pushing. The prompt's whole job is to say *which* PR and *whose* comments.

That is what took **Fix all** from ~1100 encoded chars to **~190** (flat) and **Fix this** from ~880
to **~360** at its worst case — a 94-char path; a typical path lands nearer 250. Both are flat in the
finding count: neither carries per-finding data beyond the one `{path}:{line}` **Fix this** exists to
name. The figures are not guesses: L1 `G32d` fills the live templates and measures them against the
2500 design target, and `G32k` holds both under a **500**-char regression bound so a re-added clause
is caught as a length regression rather than absorbed into 2000+ chars of headroom (the
`&utm_source=...` tag from § Click attribution is a small, fixed addition on top of each).

## Click attribution

Every deep link carries `&utm_source=pr-reviewer-<SOURCE>`, where `<SOURCE>` is `fix-all` or
`fix-this` — a static tag with no per-PR or per-finding data, existing solely so a click on either
button is distinguishable from the other in Dash0's own analytics (which button gets used tells the
product something the report's structure alone can't). It is **not** an environment or a repo
identifier — `app.dash0.com` vs. `app.dash0-dev.com` (§ Environment) already carries that.

`build-agent0-link.mjs`'s `buildLink()` takes `source` as a required third argument and **throws** if
it is missing or not one of the two known values — the CLI's `--source <fix-all|fix-this>` flag is
correspondingly mandatory, not optional-with-a-default. This mirrors `--env`'s own history: an
optional, silently-defaulted flag is exactly how the environment kept resolving to `production` long
after the config-reading side was fixed, because nothing forced every call site to actually pass it.
Making a click-tracking parameter optional reproduces the identical failure shape for analytics
instead of environment: a build succeeds, the button renders, and the click is silently
uncategorized (or, if the two sites drift to the same hardcoded string, uncategorizable) with no
symptom visible on the rendered link itself. Fail closed here for the same reason `--env` now does.

## Prompt templates

Keep these **compact**, and give Agent0 an **address, not an identity**. Every hop a prompt leaves
to be resolved — a marker to scan for, an unnamed "the reviewer", a location to go discover — is a
round trip before the first edit. A prompt carries only what Agent0 cannot infer, but it carries
*that* in fetchable form.

**Both fix prompts invoke Agent0's `/implement` skill and pass it an address.** `/implement` is the
skill that gathers a PR's comments, filters them to one author, applies the actionable ones, commits,
and pushes — so the prompt no longer describes that method, it names the target. Its argument grammar
is `/implement [<pr>] [<author>|all]`, both optional and in any order, where `<pr>` is a PR number or
URL and `<author>` is a GitHub login. Fill exactly those two slots; do not narrate around them.

Three consequences of delegating to the skill, all of them the point of this design:

- **No embedded worklist and no embedded query.** `/implement` gathers the comments itself. The
  earlier template handed Agent0 a fixed `gh api graphql` call with a `pageInfo`/`endCursor` walk and
  a client-side login filter, because nothing downstream owned that step; the skill owns it now, and
  duplicating it in the URL would be a second implementation that drifts.
- **No embedded finding body, and no `{lead}` line.** Bodies are read live from the comments
  `/implement` gathers, so a finding edited after the button was built is never stale and no
  third-party text rides into the URL.
- **No verification clause.** The "verify with the repo's own scripts, never a raw `tsc`/`eslint`
  call" guardrail below applies only to the CI-only template now — the two `/implement` templates
  delegate it with the rest of the method. That guardrail exists because a raw whole-graph `tsc`
  crashed the Agent0 runner live (§ Verify with the repo's own scripts); **if `/implement` ever loses
  it, that crash regresses through these buttons**, and the fix is in the skill, not here.

Do not re-add any of the three, or the older boilerplate they replaced ("You are fixing one
code-review finding…", the `<finding>` wrapper, an embedded `{body}`). `{branch}` is likewise omitted
— Agent0 resolves the PR's head branch from the URL.

**Fix this** (per inline finding) — the PR, the reviewer's login, and the one location to scope to:

```text
/implement https://github.com/{owner}/{repo}/pull/{n} {bot_login} — apply only the comment at {path}:{line}.
```

The trailing clause is the one thing outside `/implement`'s two-argument grammar, and it is there
because the grammar has no per-comment scope: `/implement <pr> <author>` means *every* comment by
that author, which is precisely what the **Fix all** button is for. Without the clause the two
buttons would do the same thing. Keep it to one short sentence after an em dash so the two positional
arguments still parse as the grammar's own.

Why `{path}:{line}` and not the inline comment's own `#discussion_r<id>` permalink — the shape **Fix
all** gets to use: GitHub assigns `r<id>` only on POST, so it is not known when the button's own body
is built, and `pr-reviewer` never edits an inline comment after posting to inject it (that invariant
is load-bearing elsewhere — inline comments are append-only). A comment cannot carry a link to
itself. `{path}:{line}` is known at build time and addresses the same comment.

**Fix all** (report) — the PR and the reviewer's login, and nothing else:

```text
/implement https://github.com/{owner}/{repo}/pull/{n} {bot_login}
```

- `{bot_login}` — this agent's own login, already resolved earlier in the run by the same identity
  ladder `prior-comment-awareness.md` uses (`ME` from Step 0.5, falling back to the PR-state record's
  `bot_login` from Step 0.7) — never a fresh API call to fill this slot, and never the PR author or
  any other third party. Naming it is not decoration: `/implement` defaults to a **single** author it
  resolves itself and **excludes bot authors unless one is named explicitly**, so a reviewer posting
  as `dash0-dev[bot]` would have every one of its findings skipped by a prompt that omitted the
  argument. It is also what keeps the run off every other author's comments.
- **No `{count}`.** The old template carried one as a checksum for the hand-rolled query walk;
  `/implement` reports what it applied and what it did not, so a count in the URL would be a second,
  staler answer to the same question.

**Fix all — login fallback** (report, `{bot_login}` unresolved but the sticky's comment id is known):

```text
/implement {report_comment_url}
```

`{report_comment_url}` is the report comment's own permalink —
`https://github.com/{owner}/{repo}/pull/{n}#issuecomment-{sticky_id}` — built from the id the run
already holds, since prior-run detection matched the sticky by marker in order to PATCH it (Step
0.7 / 4a). A comment permalink is a PR URL with a fragment, so it satisfies `/implement`'s `<pr>`
slot, and the comment it names is the reviewer's own — which is how the author gets resolved, and
named explicitly, without a login on hand.

This form is a **fallback, not the default**: it is unavailable on a first run, where the sticky is
created by POST and its id does not exist until after the body that would have to contain it. Prefer
the explicit `{bot_login}` above whenever the identity ladder resolves. **Omit the Fix-all button
entirely** only when *both* are unavailable — no login and no prior sticky — which is strictly
narrower than the old rule, where an unresolved login omitted the button outright.

**Fix all — CI-only** (report, zero open findings) — the report can read WARN with **zero** findings:
Gate 2 (CI) is soft-warning-only (`pr-reviewer.md § Gate states`), so a PR with a clean Gate 6 (code
review) and a red CI check has no comments for `/implement` to apply, yet the report is visibly not a
clean pass. Omitting the button in that case leaves the one state a human is most likely to click
"fix" on with no button to click. Use this template instead of the `/implement` one when the open
reviewer-finding count is 0 but CI is not green.

**This one is not an `/implement` invocation, and must not become one.** `/implement` applies a PR's
review comments; a red check with no findings has none to apply, so the task is a different task and
keeps its own method inline — including the verification clause the two `/implement` templates
delegate to the skill:

```text
Fix the failing CI checks on {owner}/{repo}#{n} — {failing_checks}. View the failing job's logs for the cause. Verify using the repo's own lint/typecheck/test scripts, scoped to what the failing check touches — never a raw tsc/eslint/test-runner call or a whole-repo pass — skip verification if none exist. Then commit a fix scoped to the files this PR changed (no new PR).
```

- `{failing_checks}` — the same failing check names already surfaced in the report's `CI_NOTE` slot
  (`report-rendering.md`) — reuse that value verbatim, do not re-derive it from a second CI query.

This template is never used when the open-finding count is non-zero, even if CI is also red: a CI
failure the diff demonstrably causes is filed as a Gate 6 finding on the reviewer's own evidence
(`pr-reviewer.md § Gate states`), which is a review comment and therefore belongs to `/implement`, not
here. It is also never used for a Gate-1-only warning (description vs. code) with clean CI and no
findings — that gate is about the human-authored PR description, not something an autonomous code-fix
run can act on, so no Fix-all button renders for a Gate-1-only WARN.

**Why an exact login, and not a natural-language "that same reviewer".** An earlier revision handed
Agent0 a list of locations and told it to resolve authorship from the comments at those locations — a
`{login}` placeholder was ruled out at the time because the reviewer's own login was not reliably
known at build time (`/user` 401s on some access paths). That gap has since closed: `{bot_login}`
reuses the identity ladder `prior-comment-awareness.md` already resolves earlier in the run (`ME`,
falling back to the PR-state record's `bot_login`), so the exact login is normally on hand with no new
call. When it genuinely is not, the report-comment permalink above resolves the author *by naming the
comment* instead — and only when there is no prior sticky either is the button omitted, rather than
sent with a placeholder value. An empty or wrong login does not fail loudly here: `/implement` would
either match nothing or, worse, apply another author's comments.

**Do not send Agent0 to the report comment first.** An earlier template opened with *"open the
pr-reviewer report comment (marker `PR_REVIEWER_REPORT`)"*, which cost a list-and-scan over every
issue comment plus a read, and returned prose rather than a worklist. Worse, it was structurally stale
at exactly the moment the button mattered: Gate 3 counts *prior* open threads, and this run's own
findings post at Step 4b **after** the report renders at Step 4a — so a run whose findings are all new
rendered a report saying "No open review threads" directly above a Fix-all button for N of them.
Observed on `mthines/lorekit#594`: four discovery calls before the first edit, one of which told
Agent0 there was nothing to fix. `/implement` is the replacement for that hop — it gathers the PR's
comments as its own first step, so there is nothing left for the prompt to send Agent0 looking for.
The one permitted mention of the report comment is the **login fallback** above, which passes its
permalink as an *address* rather than a place to go read: `/implement` uses it to identify the PR and
the author, and never as a worklist to parse.

Scoping **Fix all** to the reviewer's own findings, by exact login rather than inference, is both
product and safety: it never asks Agent0 to act on another author's comment, so no untrusted text
drives the auto-submitted run. That is now `/implement`'s `<author>` argument doing the work the
embedded query's client-side filter used to do — which is why the argument is always filled, never
left to `/implement`'s own default author resolution.

**Verify with the repo's own scripts, never a raw tool call.** This clause now lives in the
**CI-only** template alone — the two `/implement` templates delegate verification to the skill along
with the rest of the method (§ Prompt templates). Where it does apply it must send Agent0 to the
repo's *own* lint/typecheck/test scripts (whatever its
`package.json`/CLI already documents), never a raw `tsc`/`eslint`/test-runner invocation, and never a
whole-repo pass. Scoping by file count alone is not enough: `tsc --noEmit --project <tsconfig>`
type-checks the whole project graph regardless of which files changed, so even a single-package
invocation still crashes the Agent0 runner on a large monorepo. Observed live: with the earlier
wording ("lint and typecheck only the files you changed — never the whole repo"), a run scoped
correctly to the changed package but then reached for a raw `npx tsc --noEmit --project tsconfig.json`
on that package's own large graph, ran out of memory, retried with
`NODE_OPTIONS=--max-old-space-size=4096`, and still had to kill and retry a second time — the file-count
scoping was honored, but nothing told it to prefer the repo's documented (and presumably
already-scoped or cached) lint/typecheck script over a hand-rolled invocation. The fix is two-part:
route through whatever the repo already documents for a fast check, and make explicit that skipping
verification entirely is preferable to inventing a raw invocation — CI still catches what a skipped
local check would have. Keep this clause in any future rewording of the CI-only template; dropping
the "repo's own … scripts" / "never a raw … call" pair is what reopens the crash (the whole-repo half
was already fixed once, in review of `mthines/agent-skills#151`, where the first draft of the CI-only
template said "run the repo's checks locally first" — this second incident shows scoping by file
count was not sufficient on its own). And because the two `/implement` templates no longer carry it,
**the same crash is now reachable through them if `/implement` does not verify this way** — that is a
dependency on the skill, stated here so it is auditable rather than forgotten.

## Button markup

Each button is a linked image — the image is the button, the link is the deep link:

```text
[![Fix with Agent0]({ASSET_BASE}/fix-this-agent0.svg)]({DEEP_LINK})
[![Fix all with Agent0]({ASSET_BASE}/fix-all-agent0.svg)]({DEEP_LINK})
```

`{ASSET_BASE}` is not a runtime setting — it is shorthand in this doc for the hardcoded `ASSET`
constant in `render-report.mjs` (currently the committed SVGs below), and nothing exposes an
override for it:

```text
https://raw.githubusercontent.com/mthines/agent-skills/main/agents/pr-reviewer/assets
```

For production, Dash0 should host PNG equivalents on `app.dash0.com` (like Cursor's own CDN button)
— a brand-controlled PNG renders more reliably through GitHub's image proxy than a repo-hosted SVG,
and it does not 404 on branches before merge. Repointing production is a code change: edit the
`ASSET` constant in `render-report.mjs` directly (and wire the equivalent constant when the **Fix
this** per-finding button is implemented) rather than looking for a config flag — none exists. The
button source lives in `agents/pr-reviewer/assets/*.svg`.

- **Fix this** — appended after the fix block on each inline `issue:` / `suggestion:` finding, only
  when the flag is on (`comment-shape.md § Fix-with-Agent0 button`). Skipped for `nitpick` /
  `question` / `praise`.
- **Fix all** — rendered in the report via the `FIX_ALL_URL` payload slot
  (`report-rendering.md`), which the renderer turns into the linked button.

## Safety

- The buttons only *prepare* a prompt; a human clicks, and Agent0 runs under its own guardrails and
  commits to the PR the human is already looking at. The reviewer never triggers a fix itself.
- **Neither `/implement` prompt embeds any comment text.** They carry a PR URL, the reviewer's own
  login, and — for **Fix this** — one `{path}:{line}` this agent authored. Bodies are read live by
  `/implement` from GitHub, so a hostile comment from a third party cannot ride into the URL.
- Both name the author explicitly, so `/implement` acts on **this reviewer's** comments and no one
  else's — the safety property the retired embedded query's client-side login filter provided. The
  login fallback (`#issuecomment-{sticky_id}`) preserves it by naming a comment the reviewer wrote.
- The deep link is a plain `https://app.dash0.com` URL; the renderer validates it as `http(s)` like
  every other URL slot.
