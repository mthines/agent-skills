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

Neither prompt embeds a finding *body*; both embed the finding **locations**, which are known at
build time and are what turns a multi-call discovery hunt into one fetch (§ Prompt templates). The
**Fix all** URL therefore scales with the finding count: measured worst case at the 15-location cap,
with pathological 94-character paths, is ~2350 chars; a typical PR lands nearer 1700, and a
three-finding PR near 850. **Fix this** is ~650 with a full-length lead line. The figures are not
guesses — L1 `G32d` fills the live template and measures it (the `&utm_source=...` tag from § Click
attribution is a small, fixed addition on top and does not change which side of the 2500 target
either shape lands on), so a clause added here is measured on the next run. If a template ever needs
to grow past the 2500 target, cut the location cap — do not raise `MAX_URL`.

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

**Neither prompt embeds a finding body.** Bodies are re-read live at the locations given, so a
finding edited after the button was built is never stale, and no third-party text rides into the
URL. `{branch}` is omitted (Agent0 resolves the PR's head branch from `#{n}`). Do not re-add the old
boilerplate ("You are fixing one code-review finding…", the `<finding>` wrapper, an embedded
`{body}`) — it roughly doubled the URL for no added clarity.

**Fix this** (per inline finding) — location plus the finding's own lead line, so Agent0 knows the
subject without a fetch and reads the live comment only for the fix detail:

```text
Fix the pr-reviewer finding at {path}:{line} on {owner}/{repo}#{n} — "{lead}" — read its inline review comment for the details. Lint and typecheck only the files you changed — never the whole repo — then commit to the same branch (no new PR).
```

`{lead}` is the finding's own first line as posted (the Conventional-Comments prefix plus its first
sentence, ≤ 240 chars by `comment-shape.md § Hard caps`), with any double quotes dropped so it
cannot break out of its quoted span. It is the reviewer's own authored text, not a third party's.

Why `{path}:{line}` and not a `#discussion_r<id>` permalink: GitHub assigns the comment's `r<id>`
only on POST, so it is not known when the button's own body is built, and `pr-reviewer` never edits
an inline comment after posting to inject it. `{path}:{line}` is known at build time and points
Agent0 at the same comment.

**Fix all** (report) — hands over the whole worklist by location, scoped to the reviewer's OWN
findings:

```text
Fix the {count} open pr-reviewer findings on {owner}/{repo}#{n}, at: {locations}. Read the inline review comments at those locations for the details (GET /repos/{owner}/{repo}/pulls/{n}/comments). Then sweep for any other unresolved thread by that same reviewer and fix it too. Ignore every other author. Lint and typecheck only the files you changed — never the whole repo — then commit to the same branch (no new PR).
```

- `{locations}` — comma-separated `{path}:{line}`, **capped at 15** (the cap that keeps the worst-case
  URL inside the 2500 target above). Past the cap, append ` (+{overflow} more)` after the list rather
  than growing the URL — the sweep clause already tells Agent0 to find them, so do not restate it
  here. Blocking findings are cap-exempt inline, so the count can exceed 15.
- `{count}` — the full open-finding count including any overflow, so Agent0 can tell when it is done.

**Fix all — CI-only** (report, empty worklist) — the report can read WARN with **zero** findings:
Gate 2 (CI) is soft-warning-only (`pr-reviewer.md § Gate states`), so a PR with a clean Gate 6 (code
review) and a red CI check has nothing in the finding worklist to hand Agent0 a `{path}:{line}` for,
yet the report is visibly not a clean pass. Omitting the button in that case leaves the one state a
human is most likely to click "fix" on with no button to click. Use this template instead of the
findings-based one when `{locations}` would be empty but CI is not green:

```text
Fix the failing CI checks on {owner}/{repo}#{n} — {failing_checks}. View the failing job's logs for the cause, then commit a fix scoped to the files this PR changed (no new PR) — never run a whole-repo lint/typecheck/test pass to verify, only what the failing check touches.
```

- `{failing_checks}` — the same failing check names already surfaced in the report's `CI_NOTE` slot
  (`report-rendering.md`) — reuse that value verbatim, do not re-derive it from a second CI query.

This template is never used when the worklist is non-empty, even if CI is also red: a CI failure the
diff demonstrably causes is filed as a Gate 6 finding on the reviewer's own evidence (`pr-reviewer.md
§ Gate states`), which already has a `{path}:{line}` and belongs in the findings-based prompt above,
not this one. It is also never used for a Gate-1-only warning (description vs. code) with clean CI
and an empty worklist — that gate is about the human-authored PR description, not something an
autonomous code-fix run can act on, so no Fix-all button renders for a Gate-1-only WARN.

**The sweep goes after the list, never before it.** Handing over `{locations}` is what removes the
discovery round trips; the sweep is a completeness net for what the list cannot carry — findings
past the 15 cap, a thread opened between the render and the click, and anything a payload bug drops.
Both halves are needed: the list alone can be incomplete, and the sweep alone is the four-call
discovery hunt this template was rewritten to eliminate. Moving the sweep to the front re-creates
that hunt with extra steps, so keep the order — known work first, sweep second.

It is scoped by **author**, not by login: *"that same reviewer"* resolves against the authors of the
comments at `{locations}`, which Agent0 has just read. Do not substitute a `{login}` placeholder —
the reviewer's own login is not reliably resolvable at build time (`/user` 401s on some access
paths), and a wrong or empty login would either widen the sweep to every author or void it entirely.

**Do not send Agent0 to the report comment first.** The earlier template opened with *"open the
pr-reviewer report comment (marker `PR_REVIEWER_REPORT`)"*, which cost a list-and-scan over every
issue comment plus a read, and returned prose rather than a worklist. Worse, it is structurally
stale at exactly the moment the button matters: Gate 3 counts *prior* open threads, and this run's
own findings post at Step 4b **after** the report renders at Step 4a — so a run whose findings are
all new renders a report saying "No open review threads" directly above a Fix-all button for N of
them. Observed on `mthines/lorekit#594`: four discovery calls before the first edit, one of which
told Agent0 there was nothing to fix.

Scoping **Fix all** to the reviewer's own findings is both product and safety: it never asks Agent0
to act on another author's comment, so no untrusted text drives the auto-submitted run.

**Scope the checks to the files touched.** All three prompts (Fix this, Fix all, Fix all — CI-only)
keep a verification guardrail — the cheapest line that stops a broken auto-commit — but it must say
*"lint and typecheck only the files you changed — never the whole repo"* (or, for the CI-only
template with no `{path}:{line}` to anchor to, "scoped to the files this PR changed... never a
whole-repo ... pass"), not "run the repo's checks". A repo-wide `tsc` + `eslint` is what the earlier
wording invited, and the Agent0 runner does not have the headroom for it: on a large repo the
whole-project pass crashes the run, so the fix never lands. It is also wasted work by construction —
a fix-link change is one finding at one location. Keep this clause in any future rewording of any of
the three templates; dropping the "never the whole repo" half is what re-opens the crash (found live
in review of `mthines/agent-skills#151`, where the first draft of the CI-only template said "run the
repo's checks locally first").

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
- **Fix this** embeds one line of text and it is always the reviewer's **own** — the finding's lead
  line, authored by this agent under `comment-shape.md`'s caps, never a quoted third party. The fix
  detail is still read live from the inline comment.
- The **Fix all** prompt embeds no comment text at all — only `{path}:{line}` locations the reviewer
  itself produced — and tells Agent0 to ignore every other author, so a hostile comment from a third
  party cannot ride into the run.
- The deep link is a plain `https://app.dash0.com` URL; the renderer validates it as `http(s)` like
  every other URL slot.
