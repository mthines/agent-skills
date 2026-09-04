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

The prompt is a call to Agent0's **`/pr-fix`** skill plus an address — the PR, whose comments, and
(for **Fix this**) which one. The skill owns the method; the URL owns the target. See
§ Prompt templates.

**On by default; off only when a repo says so.** There is no configuration to add: a repo with no
review config at all, or one that never mentions Agent0, gets the buttons pointed at `production`
(§ Environment). The single way to turn them off repo-wide is to say so — `agent0_fix_links: false`
in `.github/review.yaml` — and `--no-fix-links` turns them off for one run.

The buttons were off unless a flag was passed, then on only where an `agent0_environment` was
named, and both defaults cost the same thing: the affordance that turns a review into an action was
absent from every run nobody had remembered to configure — including the runs a screenshot gets
taken of. A review that finds four real problems and offers no way to act on them is doing the hard
half and skipping the cheap one, and requiring a config line to fix that just moves the forgetting
one level up.

**What defaulting on costs, stated rather than buried.** `agent0_environment` no longer gates
anything, so it only picks the host, and its own default is `production`. A repo that has never
heard of Agent0 therefore renders buttons deep-linking to `app.dash0.com`, where the click lands a
reader without a Dash0 account on a sign-in page. That is a dead link for them, not a data leak —
the URL carries the PR reference and the reviewer's login, both already public on a public PR, and
nothing from the diff (§ Safety). Repos in that position set `agent0_fix_links: false` once.

## Contents

- [Opt-in](#opt-in)
- [Deep-link format](#deep-link-format)
- [Click attribution](#click-attribution)
- [Prompt templates](#prompt-templates)
- [Button markup](#button-markup)
- [Asset availability](#asset-availability)
- [Relay length limit](#relay-length-limit)
- [Safety](#safety)

## Opt-in

Resolution order, first match wins:

| Signal | Result |
| --- | --- |
| `--no-fix-links` on the invocation | **off** — the explicit opt-out, and it beats everything below |
| `--fix-links` on the invocation | **on** |
| `agent0_fix_links: true` / `false` in the review config | as set — the only repo-wide answer, and the only way to turn them off |
| nothing configured | **on**, at `agent0_environment`'s own default of `production` |

There is deliberately **no** `agent0_environment` row: naming an environment picks the host and says
nothing about whether the buttons render. It used to be the gate, and the two meanings riding on one
key made "which Agent0" and "buttons or not" impossible to set independently — a repo on
`development` could not turn the buttons off without also losing its host, and a repo wanting
buttons on the default host had to write a line whose value it did not care about.

```yaml
# .github/review.yaml
agent0_fix_links: false             # the only way to turn the buttons off repo-wide
agent0_environment: development     # host only — has no bearing on whether they render
```

```text
Task(subagent_type="pr-reviewer", prompt="<PR-URL> --no-fix-links")   # opt out for one run
```

The two placements are governed by **one** flag — there is no per-placement opt-out, so the *flag*
can never produce a report offering *Fix all* above findings with no *Fix this*, one of the
inconsistencies this replaces.

**The flag is the invariant's whole scope. One identity state diverges the placements anyway:** an
unresolved `{bot_login}` with a matched prior sticky renders *Fix all* through the
[login fallback](#prompt-templates) and skips *Fix this*, because the fallback names the reviewer's
own report comment and an inline comment has no permalink to itself — GitHub assigns a review
comment's id only on POST, and inline comments are append-only, so there is nothing to fill a
*Fix this* fallback with. That is the fallback's **entire** population, not a rare corner: every run
reaching it has one button. Said here rather than left to the reader, because an unqualified "both
buttons or neither" invites reading the absent *Fix this* as a defect and "fixing" it by inventing a
self-link that cannot exist.

## Environment

Which Agent0 the buttons link to is set by `agent0_environment` in the review config. It picks the
**host and nothing else** — it is not an on/off switch (§ Opt-in), so a repo that omits it gets
buttons on `production` rather than no buttons:

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

Both fix prompts are **one `/pr-fix` invocation plus an address** — no finding body, no worklist,
no embedded query, and no method. Agent0's `/pr-fix` skill owns everything the prompt used to
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

**Both fix prompts invoke Agent0's `/pr-fix` skill and pass it an address.** `/pr-fix` is the
skill that gathers a PR's comments, filters them to one author, applies the actionable ones, commits,
and pushes — so the prompt no longer describes that method, it names the target. Its argument grammar
is `/pr-fix [<pr>] [<author>|all]`, both optional and in any order, where `<pr>` is a PR number or
URL and `<author>` is a GitHub login. Fill exactly those two slots; do not narrate around them.

Three consequences of delegating to the skill, all of them the point of this design:

- **No embedded worklist and no embedded query.** `/pr-fix` gathers the comments itself. The
  earlier template handed Agent0 a fixed `gh api graphql` call with a `pageInfo`/`endCursor` walk and
  a client-side login filter, because nothing downstream owned that step; the skill owns it now, and
  duplicating it in the URL would be a second implementation that drifts.
- **No embedded finding body, and no `{lead}` line.** Bodies are read live from the comments
  `/pr-fix` gathers, so a finding edited after the button was built is never stale and no
  third-party text rides into the URL.
- **No verification clause.** The "verify with the repo's own scripts, never a raw `tsc`/`eslint`
  call" guardrail below applies only to the CI-only template now — the two `/pr-fix` templates
  delegate it with the rest of the method. That guardrail exists because a raw whole-graph `tsc`
  crashed the Agent0 runner live (§ Verify with the repo's own scripts); **if `/pr-fix` ever loses
  it, that crash regresses through these buttons**, and the fix is in the skill, not here.

Do not re-add any of the three, or the older boilerplate they replaced ("You are fixing one
code-review finding…", the `<finding>` wrapper, an embedded `{body}`). `{branch}` is likewise omitted
— Agent0 resolves the PR's head branch from the URL.

**Fix this** (per inline finding) — the PR, the reviewer's login, and the one location to scope to:

```text
/pr-fix https://github.com/{owner}/{repo}/pull/{n} {bot_login} — apply only the comment at {path}:{line}.
```

The trailing clause is the one thing outside `/pr-fix`'s two-argument grammar, and it is there
because the grammar has no per-comment scope: `/pr-fix <pr> <author>` means *every* comment by
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
/pr-fix https://github.com/{owner}/{repo}/pull/{n} {bot_login}
```

- `{bot_login}` — this agent's own login, already resolved earlier in the run by the same identity
  ladder `prior-comment-awareness.md` uses (`ME` from Step 0.5, falling back to the PR-state record's
  `bot_login` from Step 0.7) — never a fresh API call to fill this slot, and never the PR author or
  any other third party. Naming it is not decoration: `/pr-fix` defaults to a **single** author it
  resolves itself and **excludes bot authors unless one is named explicitly**, so a reviewer posting
  as `dash0-dev[bot]` would have every one of its findings skipped by a prompt that omitted the
  argument. It is also what keeps the run off every other author's comments.
- **No `{count}`.** The old template carried one as a checksum for the hand-rolled query walk;
  `/pr-fix` reports what it applied and what it did not, so a count in the URL would be a second,
  staler answer to the same question.

**Fix all — login fallback** (report, `{bot_login}` unresolved but the sticky's comment id is known):

```text
/pr-fix {report_comment_url}
```

`{report_comment_url}` is the report comment's own permalink —
`https://github.com/{owner}/{repo}/pull/{n}#issuecomment-{sticky_id}` — built from the id the run
already holds, since prior-run detection matched the sticky by marker in order to PATCH it (Step
0.7 / 4a). A comment permalink is a PR URL with a fragment, so it satisfies `/pr-fix`'s `<pr>`
slot, and the comment it names is the reviewer's own — which is how the author gets resolved, and
named explicitly, without a login on hand.

This form is a **fallback, not the default**: it is unavailable on a first run, where the sticky is
created by POST and its id does not exist until after the body that would have to contain it. Prefer
the explicit `{bot_login}` above whenever the identity ladder resolves.

**Identity and count are independent conditions, and both templates above need both.** This form
answers *how the author gets named*, not *whether there is anything to apply* — so it is reached only
when the open reviewer-finding count is **non-zero**, exactly like the `{bot_login}` form. At a count
of 0 the choice is between the CI-only variant below and omitting the button, and having a sticky id
on hand says nothing about which. Stated because the identity ladder is the newer condition and it is
the natural place to stop reading: a fallback that fired on identity alone would answer a question it
was never asked, and it would answer it with a `/pr-fix` call in the one state the next section
forbids one.

So the Fix-all button is omitted when the count is 0 **and** CI is green, and — at a non-zero count —
when *both* identity paths are unavailable (no login and no prior sticky). That second half is
strictly narrower than the old rule, where an unresolved login omitted the button outright.

**Fix all — CI-only** (report, zero open findings) — the report can read WARN with **zero** findings:
Gate 2 (CI) is soft-warning-only (`pr-reviewer.md § Gate states`), so a PR with a clean Gate 6 (code
review) and a red CI check has no comments for `/pr-fix` to apply, yet the report is visibly not a
clean pass. Omitting the button in that case leaves the one state a human is most likely to click
"fix" on with no button to click. Use this template instead of the `/pr-fix` one when the open
reviewer-finding count is 0 but CI is not green.

**This one is not a `/pr-fix` invocation, and must not become one.** `/pr-fix` applies a PR's
review comments; a red check with no findings has none to apply, so the task is a different task and
keeps its own method inline — including the verification clause the two `/pr-fix` templates
delegate to the skill:

```text
Fix the failing CI checks on {owner}/{repo}#{n} — {failing_checks}. View the failing job's logs for the cause. Verify using the repo's own lint/typecheck/test scripts, scoped to what the failing check touches — never a raw tsc/eslint/test-runner call or a whole-repo pass — skip verification if none exist. Then commit a fix scoped to the files this PR changed (no new PR).
```

- `{failing_checks}` — the same failing check names already surfaced in the report's `CI_NOTE` slot
  (`report-rendering.md`) — reuse that value verbatim, do not re-derive it from a second CI query.

This template is never used when the open-finding count is non-zero, even if CI is also red: a CI
failure the diff demonstrably causes is filed as a Gate 6 finding on the reviewer's own evidence
(`pr-reviewer.md § Gate states`), which is a review comment and therefore belongs to `/pr-fix`, not
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
sent with a placeholder value. An empty or wrong login does not fail loudly here: `/pr-fix` would
either match nothing or, worse, apply another author's comments.

**Do not send Agent0 to the report comment first.** An earlier template opened with *"open the
pr-reviewer report comment (marker `PR_REVIEWER_REPORT`)"*, which cost a list-and-scan over every
issue comment plus a read, and returned prose rather than a worklist. Worse, it was structurally stale
at exactly the moment the button mattered: Gate 3 counts *prior* open threads, and this run's own
findings post at Step 4b **after** the report renders at Step 4a — so a run whose findings are all new
rendered a report saying "No open review threads" directly above a Fix-all button for N of them.
Observed on `mthines/lorekit#594`: four discovery calls before the first edit, one of which told
Agent0 there was nothing to fix. `/pr-fix` is the replacement for that hop — it gathers the PR's
comments as its own first step, so there is nothing left for the prompt to send Agent0 looking for.
The one permitted mention of the report comment is the **login fallback** above, which passes its
permalink as an *address* rather than a place to go read: `/pr-fix` uses it to identify the PR and
the author, and never as a worklist to parse.

Scoping **Fix all** to the reviewer's own findings, by exact login rather than inference, is both
product and safety: it never asks Agent0 to act on another author's comment, so no untrusted text
drives the auto-submitted run. That is now `/pr-fix`'s `<author>` argument doing the work the
embedded query's client-side filter used to do — which is why the argument is always filled, never
left to `/pr-fix`'s own default author resolution.

**Verify with the repo's own scripts, never a raw tool call.** This clause now lives in the
**CI-only** template alone — the two `/pr-fix` templates delegate verification to the skill along
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
count was not sufficient on its own). And because the two `/pr-fix` templates no longer carry it,
**the same crash is now reachable through them if `/pr-fix` does not verify this way** — that is a
dependency on the skill, stated here so it is auditable rather than forgotten.

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

## Asset availability

**A button whose image 404s is not a working button.** The markup is intact and the link works, so
every offline guard passes — the reader sees a broken-image icon next to link text, which reads as a
broken reviewer just as badly as mangled markup does.

`ASSET_BASE` is pinned to this repo's **default branch**, so an asset added on a feature branch does
not exist at the URL the renderer builds until that branch merges. That is not a hypothetical: every
button on [`mthines/agent-skills#165`](https://github.com/mthines/agent-skills/pull/165) pointed at a
404 for the whole life of the PR, *including* the runs whose markup survived intact — the theme-aware
split introduced `fix-this-agent0-dark.svg` / `-light.svg`, and only the pre-existing unsuffixed
`fix-this-agent0.svg` was on the default branch. The buttons had worked before precisely because the
filename they named was already merged.

**`<picture>` does not rescue this.** It selects a `<source>` by media query and does **not** fall
back to `<img>` when the chosen resource fails to load. The `<img>` default is what renderers that
ignore `<source>` entirely display — GitHub notification emails and RSS among them, which is where an
inline finding is very often read first. So the default points at the unsuffixed `{stem}.svg`, the
one filename that predates any theme split, and the two `<source>` elements carry the themed
variants. Follow GitHub's
[documented form](https://github.blog/changelog/2022-08-15-specify-theme-context-for-images-in-markdown-ga/)
— dark `<source>`, light `<source>`, then the `<img>` default — rather than letting one variant do
double duty.

**The check:**

```bash
node "$AGENT_SUPPORT/pr-reviewer/scripts/comment-spine.mjs" --assets-check /tmp/report-body.md
```

| Exit | Meaning | Action |
| --- | --- | --- |
| 0 | every referenced asset answers 200 with an `image/*` content type | post as rendered |
| 1 | at least one 404s, or answers a non-image type | **re-render with `--no-fix-links`** |
| 3 | the network is unreachable | **post as rendered** — inconclusive is not a missing asset |

Exit 3 is a separate code on purpose. Withholding a button because a `HEAD` request failed would
degrade every offline or proxied run, so an inconclusive check never withholds; only an answer does.
The non-image content type is checked alongside the status because `raw.githubusercontent.com`
answers some missing paths with a `text/plain` body, and GitHub's image proxy enforces a
content-type allowlist of its own.

**When you add or rename an asset**, the buttons stay withheld until that change is on the default
branch. That is the correct behaviour, not a bug to work around — do not point `ASSET_BASE` at a
feature branch to make a screenshot look right, because every other repo's review would then depend
on a branch that gets deleted.

## Relay length limit

**Some write paths cannot carry these buttons at all, and the correct response is to withhold them
— never to shorten the prompt until it fits.**

**`--relay-check` is asked only on those paths — the condition is the feature.** Gate it on
`ACCESS_PATH == "mcp"`
([`github-access.md § Step 0`](./github-access.md#step-0--resolve-your-path-once-before-any-github-step)),
which is also where a caller learns whether its body travels as a file or as a tool-call argument.
Every fix link exceeds the 140-char budget by construction — the floor below is 164 — so a check run
**unconditionally** withholds the buttons on every run of every repo, `gh` runs included, where
nothing would have been rewritten. That is not a conservative default; it is a silent, permanent
opt-out of a default-on affordance, indistinguishable from the feature being off. It shipped exactly
that way: the consumer's report block carried *"on the `gh` path the buttons post intact and stay"*
as prose while the shell above it asked on every path, and its inline block had neither the
condition nor the sentence — so the buttons never rendered once anywhere. **A rule the shell does
not execute is a rule the run does not follow**, which is why this paragraph names a variable and a
comparison rather than describing an intent.

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

**On a relayed write the buttons are unreachable by construction — the floor is above the ceiling.**
The deep-link scaffold alone (`https://app.dash0.com/goto/agent0?auto_submit=true&initial_prompt=`
plus `&utm_source=pr-reviewer-fix-all`) is **105 body chars** empty, leaving 35 for the encoded
prompt. The shortest conceivable filled Fix-all — a one-character owner, repo and login, PR #1 —
measures **164**, and every realistic fill lands in **189–204**. Re-derive rather than trust those:

```bash
node agents/pr-reviewer/scripts/build-agent0-link.mjs --env production --source fix-all \
  "/pr-fix https://github.com/mthines/agent-skills/pull/168 <login>" \
  | perl -pe 's/&/&amp;/g' | tr -d '\n' | wc -c
```

The only variable is the login, and it moves the figure by its own length: `mthines` gives 189,
`claude[bot]` 197, `dash0-dev[bot]` 200, each **+4** on `development` (a longer host). Quote the
fill, never just the PR — an earlier revision cited `mthines/agent-skills#168` for **195**, which is
that PR with a 13-character bot login and not the 189 its actual reviewer login produces.

Every one of those is over 140 before any prompt content is chosen. That is why *"do not shorten the
prompt to fit"* is an absolute rather than a preference: no prompt exists that fits, so shortening
trades the affordance's usefulness for nothing. It also bounds what the `/pr-fix` rewrite bought.
Taking Fix-all from ~1100 to ~190 is a large win against the **2500 design target** and `MAX_URL`,
and **no** win against the relay budget, which it still exceeds by ~50. **The remedy is the write
path, not the link:** post
the body from a **file** (`gh api … --field body=@file`, `gh pr review --body-file`) and no rewrite
happens, so the buttons render intact. A caller that can only pass the body as a tool-call argument
gets a correctly-withheld button on every run, permanently — worth knowing before reading a missing
button as a bug in the renderer.

**The rule:**

```bash
# Before a relayed write, on the body that is actually about to be posted.
node "$AGENT_SUPPORT/pr-reviewer/scripts/comment-spine.mjs" --relay-check /tmp/report-body.md
case $? in
  1) rerender_with --no-fix-links
     # 1 outranks 3, so the exit-3 condition can SURVIVE the remedy — ask the re-rendered body.
     node "$AGENT_SUPPORT/pr-reviewer/scripts/comment-spine.mjs" --relay-check /tmp/report-body.md
     rc=$?; [ "$rc" -eq 3 ] && note_mangled_link ;;
  3) note_mangled_link ;;              # not a fix link — the remedy cannot reach it
esac
```

- Exit 0 (`relay-safe`) — post as rendered.
- Exit 1 — a **fix link** is over budget. **Re-render with `--no-fix-links`** and post that. Both
  renderers already omit the button when the URL slot is absent, so this needs no renderer change
  and costs only the affordance. Note the withholding in the run line, so a reader who expects a
  button knows why there is none. Then **re-check the re-rendered body**: the codes are one exit
  status, so a body carrying both kinds reports the remediable one — 1 says *this run* is
  remediable, never that the body is otherwise clean — and the surviving exit-3 condition would
  otherwise go unnamed on exactly the runs that had two problems rather than one.
- Exit 3 — something else is over budget: a cited doc URL, a `raw.githubusercontent.com` asset
  path, a permalink out of the diff. **Post as rendered** and name the mangled link in the run line.

**The two are separated because only one of them has a remedy, and conflating them is a dead end.**
The check first reported *every* long URL as exit 1, whose documented answer is `--no-fix-links` —
which removes Agent0 deep links and nothing else. A report citing a 169-char LoreKit URL therefore
failed the check, re-rendered without its buttons, failed the identical check again, and had
nothing left to try; the run could not distinguish that from a condition it could fix. `relayUnsafeFixLinks()`
is the partition, and exit 3 is the honest answer for the other half: a citation cannot be dropped
to satisfy a relay, and the damage is not symmetric — a mangled doc link is a URL the reader
retypes, while a mangled button is a primary CTA that silently does nothing.

This is **advisory**, unlike `assertPostable`: it predicts what one write path would do, and a
file-based path (`gh --field body=@file`) does none of it — there the buttons post intact and stay.
The post-write verify in `agents/pr-reviewer.md` § *The bytes that get posted are the renderer's
bytes* remains the backstop for whatever this check does not predict.

## Safety

- The buttons only *prepare* a prompt; a human clicks, and Agent0 runs under its own guardrails and
  commits to the PR the human is already looking at. The reviewer never triggers a fix itself.
- **Neither `/pr-fix` prompt embeds any comment text.** They carry a PR URL, the reviewer's own
  login, and — for **Fix this** — one `{path}:{line}` this agent authored. Bodies are read live by
  `/pr-fix` from GitHub, so a hostile comment from a third party cannot ride into the URL.
- Both name the author explicitly, so `/pr-fix` acts on **this reviewer's** comments and no one
  else's — the safety property the retired embedded query's client-side login filter provided. The
  login fallback (`#issuecomment-{sticky_id}`) preserves it by naming a comment the reviewer wrote.
- The deep link is a plain `https://app.dash0.com` URL; the renderer validates it as `http(s)` like
  every other URL slot.
