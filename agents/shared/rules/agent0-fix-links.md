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

**On wherever an Agent0 exists; off everywhere else.** The gate is whether the repo's review config
resolves an `agent0_environment` (§ Environment) — a repo that has said which Agent0 it uses has
already answered the only question the button depends on. Non-Dash0 repos configure no environment,
render no buttons, and are unaffected.

The buttons used to be off unless a flag was passed, and the cost of that was the whole point of
having them: the affordance that turns a review into an action was absent from every run nobody
remembered to flag — including the runs a screenshot gets taken of. A review that finds four real
problems and offers no way to act on them is doing the hard half and skipping the cheap one.

## Contents

- [Opt-in](#opt-in)
- [Deep-link format](#deep-link-format)
- [Click attribution](#click-attribution)
- [Prompt templates](#prompt-templates)
- [Button markup](#button-markup)
- [Relay length limit](#relay-length-limit)
- [Safety](#safety)

## Opt-in

Resolution order, first match wins:

| Signal | Result |
| --- | --- |
| `--no-fix-links` on the invocation | **off** — the explicit opt-out, and it beats everything below |
| `--fix-links` on the invocation | **on** |
| `agent0_fix_links: true` / `false` in the review config | as set — an explicit repo-wide answer |
| `agent0_environment` resolves in the review config | **on** — the default this section is about |
| nothing configured | **off** |

```yaml
# .github/review.yaml
agent0_environment: production      # this alone turns the buttons on
agent0_fix_links: false             # …unless the repo explicitly says otherwise
```

```text
Task(subagent_type="pr-reviewer", prompt="<PR-URL> --no-fix-links")   # opt out for one run
```

Two properties are worth stating because they are what make the default safe. A repo with no
`agent0_environment` still gets nothing, so the change is invisible outside Dash0. And the two
placements are governed by **one** flag, so a run either has both buttons or neither — a report
offering *Fix all* above findings with no *Fix this* was one of the inconsistencies this replaces.

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

Neither prompt embeds a finding *body*. **Fix this** embeds one finding's own `{path}:{line}`; **Fix
all** embeds no per-finding data at all — instead it embeds `{bot_login}` and a fixed, ready-to-run
GitHub GraphQL query (§ Prompt templates) that returns every one of this reviewer's threads, resolved
state included, in a single call. That makes the **Fix all** URL length **independent of the finding
count** — it no longer grows with how many findings are open, which is what let a large PR's worklist
crowd the 2500 target before. Measured from the live template with a realistic owner/repo/login: ~1100
chars, flat regardless of `{count}`. **Fix this** is ~880 at its worst case (a 94-char path plus the
full lead-line cap). The figures are not guesses — L1 `G32d` fills the live template and measures
it (the `&utm_source=...` tag from § Click attribution is a small, fixed addition on top and does not
move either shape closer to the target), so a clause added here is measured on the next run.

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

**Neither prompt embeds a finding body.** Bodies are re-read live — **Fix this** from the inline
comment at its given location, **Fix all** from the `body` field the embedded GraphQL query itself
returns — so a finding edited after the button was built is never stale, and no third-party text
rides into the URL. `{branch}` is omitted (Agent0 resolves the PR's head branch from `#{n}`). Do not re-add the old
boilerplate ("You are fixing one code-review finding…", the `<finding>` wrapper, an embedded
`{body}`) — it roughly doubled the URL for no added clarity.

**Fix this** (per inline finding) — location plus the finding's own lead line, so Agent0 knows the
subject without a fetch and reads the live comment only for the fix detail:

```text
Fix the pr-reviewer finding at {path}:{line} on {owner}/{repo}#{n} — "{lead}". Read the inline comment there for detail. Verify using the repo's own lint/typecheck scripts — never a raw tsc/eslint call or a whole-repo pass — skip verification if none exist — then commit to the same branch (no new PR).
```

`{lead}` is the finding's own first line as posted (the Conventional-Comments prefix plus its first
sentence, ≤ 200 chars by `comment-shape.md § Hard caps`, plus its ≤ 60-char title), with any double quotes dropped so it
cannot break out of its quoted span. It is the reviewer's own authored text, not a third party's.

Why `{path}:{line}` and not a `#discussion_r<id>` permalink: GitHub assigns the comment's `r<id>`
only on POST, so it is not known when the button's own body is built, and `pr-reviewer` never edits
an inline comment after posting to inject it. `{path}:{line}` is known at build time and points
Agent0 at the same comment.

**Fix all** (report) — hands Agent0 a ready-to-run query instead of a worklist, scoped to the
reviewer's OWN findings by an exact login match:

```text
Fix the {count} open pr-reviewer findings on {owner}/{repo}#{n}, authored by {bot_login}. List them with: gh api graphql -f query='{repository(owner:"{owner}",name:"{repo}"){pullRequest(number:{n}){reviewThreads(first:100){pageInfo{hasNextPage endCursor} nodes{isResolved comments(first:1){nodes{path line body author{login}}}}}}}}' — if hasNextPage, repeat with after:"<endCursor>" until false. Keep only isResolved:false nodes whose comment author.login is "{bot_login}", ignore every other author. Verify using the repo's own lint/typecheck scripts — never a raw tsc/eslint call or a whole-repo pass — skip verification if none exist — then commit to the same branch (no new PR).
```

- `{bot_login}` — this agent's own login, already resolved earlier in the run by the same identity
  ladder `prior-comment-awareness.md` uses (`ME` from Step 0.5, falling back to the PR-state record's
  `bot_login` from Step 0.7) — never a fresh API call to fill this slot, and never the PR author or
  any other third party. **Omit the Fix-all button entirely** when both rungs come back empty: an
  unresolved login has no safe filter value, and a wrong or empty one would either widen the query to
  every author or match nothing.
- `{count}` — the full open-finding count, so Agent0 can tell when it is done.
- The embedded `gh api graphql` call replaces what used to be a REST list plus a fallback sweep in one
  step. GitHub's REST comments endpoint has no `isResolved` field — only GraphQL's `reviewThreads`
  does — so a login-filtered REST call still cannot tell Agent0 which of this reviewer's threads are
  already closed; it would need a second GraphQL round trip to find out. Handing over the exact query
  removes that round trip **and** the need for Agent0 to compose its own — it runs the command as
  given rather than discovering or reconstructing it, which is the concrete "no wasted time" property
  this template is designed for. Because the query is fixed text, not a per-finding list, the URL
  no longer grows with the finding count.
- **The `pageInfo`/`endCursor` walk is not optional, even here.** `reviewThreads` caps at `first:100`
  and `--paginate` does not work for GraphQL — the guard `prior-comment-awareness.md § Thread state`
  states for this exact query, and which `thread-resolution.md` and `outcome-learning.md` both carry
  ("do not drop the walk"). It binds harder in this template than in those callers, not less: the
  query has **no server-side author filter** — GitHub offers none — so `{bot_login}` is applied
  client-side and the 100-cap therefore falls on the *unfiltered* thread list, every author's
  included. On a PR with several reviewers, this reviewer's own open threads can sit past the cap
  while the first 100 are someone else's. Dropping the walk there does not shorten a worklist, it
  silently truncates one, and Agent0 reports done having fixed a subset — the "an unseen thread must
  never be silently assumed unresolved" failure, one indirection further out. Any future reword keeps
  both halves: `pageInfo{hasNextPage endCursor}` in the selection **and** the `after:` clause after
  it. The ~130 chars this costs sit against ~1400 of headroom under the 2500 target.

**Fix all — CI-only** (report, `{count}` is 0) — the report can read WARN with **zero** findings:
Gate 2 (CI) is soft-warning-only (`pr-reviewer.md § Gate states`), so a PR with a clean Gate 6 (code
review) and a red CI check has nothing for Agent0 to fix via the findings-based prompt above, yet the
report is visibly not a clean pass. Omitting the button in that case leaves the one state a human is
most likely to click "fix" on with no button to click. Use this template instead of the findings-based
one when `{count}` would be 0 but CI is not green:

```text
Fix the failing CI checks on {owner}/{repo}#{n} — {failing_checks}. View the failing job's logs for the cause. Verify using the repo's own lint/typecheck/test scripts, scoped to what the failing check touches — never a raw tsc/eslint/test-runner call or a whole-repo pass — skip verification if none exist. Then commit a fix scoped to the files this PR changed (no new PR).
```

- `{failing_checks}` — the same failing check names already surfaced in the report's `CI_NOTE` slot
  (`report-rendering.md`) — reuse that value verbatim, do not re-derive it from a second CI query.

This template is never used when `{count}` is non-zero, even if CI is also red: a CI failure the diff
demonstrably causes is filed as a Gate 6 finding on the reviewer's own evidence (`pr-reviewer.md
§ Gate states`), which belongs in the findings-based prompt above, not this one. It is also never used
for a Gate-1-only warning (description vs. code) with clean CI and `{count}` at 0 — that gate is about
the human-authored PR description, not something an autonomous code-fix run can act on, so no Fix-all
button renders for a Gate-1-only WARN.

**Why an exact login match, and not a natural-language "that same reviewer".** An earlier revision of
this template handed Agent0 a list of locations and told it to resolve authorship from the comments at
those locations — a `{login}` placeholder was ruled out at the time because the reviewer's own login
was not reliably known at build time (`/user` 401s on some access paths). That gap has since closed:
`{bot_login}` now reuses the identity ladder `prior-comment-awareness.md` already resolves earlier in
the run (`ME`, falling back to the PR-state record's `bot_login`), so the exact login is normally on
hand with no new call. When it genuinely is not — both rungs empty — the button is omitted rather than
sent with a placeholder value, per the `{bot_login}` note in § Prompt templates above; an empty or
wrong login would either match nothing or widen the filter to every author.

**Do not send Agent0 to the report comment first.** An earlier template opened with *"open the
pr-reviewer report comment (marker `PR_REVIEWER_REPORT`)"*, which cost a list-and-scan over every
issue comment plus a read, and returned prose rather than a worklist. Worse, it was structurally stale
at exactly the moment the button mattered: Gate 3 counts *prior* open threads, and this run's own
findings post at Step 4b **after** the report renders at Step 4a — so a run whose findings are all new
rendered a report saying "No open review threads" directly above a Fix-all button for N of them.
Observed on `mthines/lorekit#594`: four discovery calls before the first edit, one of which told
Agent0 there was nothing to fix. The `gh api graphql` call above is the direct-fetch replacement for
that hop — one command, filtered server-side to this reviewer's own threads with resolution state
included, so there is nothing left to discover.

Scoping **Fix all** to the reviewer's own findings, by exact login rather than inference, is both
product and safety: it never asks Agent0 to act on another author's comment, so no untrusted text
drives the auto-submitted run.

**Verify with the repo's own scripts, never a raw tool call.** All three prompts (Fix this, Fix all,
Fix all — CI-only) keep a verification guardrail — the cheapest line that stops a broken auto-commit
— but it must send Agent0 to the repo's *own* lint/typecheck/test scripts (whatever its
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
local check would have. It is also wasted work by construction — a fix-link change is one finding at
one location. Keep this clause in any future rewording of any of the three templates; dropping the
"repo's own … scripts" / "never a raw … call" pair is what reopens the crash (the whole-repo half was
already fixed once, in review of `mthines/agent-skills#151`, where the first draft of the CI-only
template said "run the repo's checks locally first" — this second incident shows scoping by file
count was not sufficient on its own).

## Button markup

**Built by one function, `comment-spine.mjs`'s `fixButton()`, which both renderers call.** Never
hand-write this markup: the host validation, the `)`-in-URL rejection, the alt text and the theme
pair all live in that function, and a second copy is how the report's button and the inline one
drift into two different chips.

Each button is a **theme-aware** linked image:

```html
<a href="{DEEP_LINK}"><picture><source media="(prefers-color-scheme: dark)" srcset="{ASSET_BASE}/fix-this-agent0-dark.svg"><img alt="Fix with Agent0" src="{ASSET_BASE}/fix-this-agent0-light.svg" height="36"></picture></a>
```

**The anchor is HTML, not markdown link syntax, and it is one line.** Wrapping the `<picture>`
element in markdown link brackets puts a block of raw HTML inside a markdown link, and whether the
parser treats that HTML as the link's inline content is not something this repo can verify without
posting a comment — a broken
button reads as a broken reviewer. `<a href>` wrapping `<picture>` needs no markdown parsing at all,
and both elements are on GitHub's comment HTML allowlist. One line because a blank line inside
inline HTML ends the HTML block.

`<picture>` with `media="(prefers-color-scheme: dark)"` is how GitHub does theme-aware images, and
it is why there are two variants. A single dark chip reads as a near-black blob in GitHub's light
theme, where every other control is light — this is the primary call to action of the whole review,
so it should not be the one element that ignores the reader's theme. The light variant uses
GitHub's own control colours (`#d0d7de` border, `#1f2328` ink) so it reads as part of the page.

**Both variants are 36 px tall.** The originals were 28. WCAG 2.2 SC 2.5.8 sets a 24×24 floor
(28 cleared it, barely); SC 2.5.5 and the iOS HIG want 44×44 and Android 48 dp, which a chip sitting
beside body text cannot reach without dominating the comment. 36 is the compromise: comfortably
clear of the floor, and roughly as close to the platform minimum as this control can get. On the
GitHub mobile web view this is the tap target for the review's only action, so the extra 8 px is not
cosmetic.

**Width is derived, and the text width is pinned so it cannot depend on the reader's fonts.** The
geometry is `12` left pad + `12` mark + `8` gap + `TEXT_W` + `12` right pad, giving 140 for
`Fix with Agent0` (`TEXT_W` 96) and 158 for `Fix all with Agent0` (`TEXT_W` 114). Each `<text>`
carries `textLength="{TEXT_W}" lengthAdjust="spacingAndGlyphs"`, which is what makes the box the
same size in every renderer.

Without that pin, the width has to be guessed against a font the asset does not ship, and the guess
is wrong in both directions at once. Measured in Chromium at 13 px semibold, `Fix all with Agent0`
is 113.7 px under Helvetica/Arial (what macOS and Windows resolve) and 137.6 px under DejaVu Sans
(the Linux fallback) — a 24 px spread on a 158 px control. The first version of these assets was
sized for the wide case, so the button carried 38 px of right padding against 12 on the left
wherever the review is actually read, while `Fix with Agent0` at 152 px sat 4.6 px from clipping its
own label on Linux. One number cannot serve both, so it serves neither: pin the text and derive the
box.

When a label changes, re-measure rather than estimating — `getComputedTextLength()` on an SVG
`<text>` with the same `font-family` / `font-size` / `font-weight`, then round up to the next whole
pixel. Measuring with a metrics table for a font the asset does not name is how the spread above got
in.

`{ASSET_BASE}` is not a runtime setting — it is shorthand for the hardcoded `ASSET_BASE` constant in
`comment-spine.mjs`, and nothing exposes an override:

```text
https://raw.githubusercontent.com/mthines/agent-skills/main/agents/pr-reviewer/assets
```

The pre-theme `fix-this-agent0.svg` / `fix-all-agent0.svg` are **kept in place and unreferenced**.
Comments posted before this change embed those exact raw URLs, and deleting the files would 404 the
button image in every already-posted finding.

For production, Dash0 should host PNG equivalents on `app.dash0.com` (like Cursor's own CDN button)
— a brand-controlled PNG renders more reliably through GitHub's image proxy than a repo-hosted SVG,
and it does not 404 on branches before merge. Repointing production is a code change: edit
`ASSET_BASE` in `comment-spine.mjs`, which now moves **both** placements at once rather than one.

- **Fix this** — rendered from the inline payload's `FIX_URL` slot, after the fix block, on each
  `issue:` / `suggestion:` finding (`comment-shape.md § The payload`). The renderer **rejects** it on
  `nitpick` / `question` / `praise` — there is nothing for Agent0 to fix.
- **Fix all** — rendered in the report from the `FIX_ALL_URL` payload slot
  (`report-rendering.md`). Its `alt` is the asset's own rendered text, `Fix all with Agent0`, and the
  renderer rejects any other label: a count in the accessible name that no sighted reader can see
  fails WCAG 2.5.3 Label in Name. The renderer **rejects** it when there are zero
  findings and no `CI_NOTE`: a button that hands Agent0 an empty worklist is worse than no button,
  because it invites a click that spends a run discovering there is no work. The one legitimate
  zero-finding case is the CI-only template below, which requires a CI note to exist.

## Relay length limit

**Some write paths cannot carry these buttons at all, and the correct response is to withhold them
— never to shorten the prompt until it fits.**

A write path that carries the body as a **tool-call argument** rather than a file passes it through a
relay that rewrites long unbroken runs: it wraps the run in a `` `` `` code span, which closes the
`href` and escapes everything after it, so the button renders as a wall of `&gt;&lt;picture&gt;` text
with a dead link. The renderer's markup is correct — the transform happens after it, which is why
every pre-render guard passes and the damage is visible only in the **stored** body.

Measured on [`mthines/agent-skills#165`](https://github.com/mthines/agent-skills/pull/165) by posting
URLs through the relay and reading each stored body back. Lengths are of the URL **as it sits in the
body**: `&` is written `&amp;` inside an `href`, so a two-param URL is 8 chars longer here than
`url.length` reports — and measuring the unescaped form under-counts exactly the shape this pipeline
builds.

| URL under test | in body | stored |
| --- | --- | --- |
| Agent0 host + path, no query | 56 | intact |
| + `auto_submit=true` | 78 | intact |
| + short `initial_prompt` | 109 | intact |
| prose-encoded prompt | 140 | intact |
| prose-encoded prompt | 167 | wrapped |
| prose-encoded prompt | 200 | wrapped |
| a real `fix-this` link | 230 | wrapped |

**Length is the whole trigger.** Host, path, `auto_submit=true`, and prompt-like query content are
each innocent — every short URL survived, including ones carrying `initial_prompt=Fix…`. A run of
repeated identical characters trips it earlier (~75 chars), so the budget is stated against
prose-encoded URLs, the only shape this pipeline builds.

**No markup change evades it.** Breaking the tag across lines leaves the URL itself as one unbroken
run, and a pure-markdown linked image — no inline HTML at all — is rewritten too.

So `RELAY_SAFE_URL_MAX = 140` in `comment-spine.mjs` is a fact about the relay, not a budget to
design the link around. A `fix-this` link spends ~110 body chars before the prompt starts, leaving
~30 — enough for `Fix <basename>:<line>` and not the repo, the PR, or the finding. A button that
opens a session with no idea what to fix is worse than no button.

**The rule:**

```bash
# Before a relayed write, on the body that is actually about to be posted.
node "$AGENT_SUPPORT/pr-reviewer/scripts/comment-spine.mjs" --relay-check /tmp/report-body.md \
  || rerender_with --no-fix-links     # withhold the buttons; keep the report
```

- Exit 0 (`relay-safe`) — post as rendered.
- Exit 1 — **re-render with `--no-fix-links`** and post that. Both renderers already omit the button
  when the URL slot is absent, so this needs no renderer change and costs only the affordance.
- Note the withholding in the run line, so a reader who expects a button knows why there is none.

This is **advisory**, unlike `assertPostable`: it predicts what one write path would do, and a
file-based path (`gh --field body=@file`) does none of it — there the buttons post intact and stay.
The post-write verify in `agents/pr-reviewer.md` § *The bytes that get posted are the renderer's
bytes* remains the backstop for whatever this check does not predict.

## Safety

- The buttons only *prepare* a prompt; a human clicks, and Agent0 runs under its own guardrails and
  commits to the PR the human is already looking at. The reviewer never triggers a fix itself.
- **Fix this** embeds one line of text and it is always the reviewer's **own** — the finding's lead
  line, authored by this agent under `comment-shape.md`'s caps, never a quoted third party. The fix
  detail is still read live from the inline comment.
- The **Fix all** prompt embeds no comment text and no per-finding data at all — only the reviewer's
  own login and a fixed, read-only GraphQL query — and tells Agent0 to ignore every other author, so
  a hostile comment from a third party cannot ride into the run, and the exact-login filter means no
  other author's thread is ever touched.
- The deep link is a plain `https://app.dash0.com` URL; the renderer validates it as `http(s)` like
  every other URL slot.
