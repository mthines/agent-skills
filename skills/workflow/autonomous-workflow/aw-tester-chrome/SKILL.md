---
name: aw-tester-chrome
description: >
  Runs UI verification specs in-session through the claude-in-chrome extension —
  the Chrome sibling of the aw-tester agent. Reads the same specs.md (WHEN/THEN
  grammar or a Markdown intent spec) and aw-target.yml, drives Chrome interactively (navigate → read → act → assert,
  seeing the page between steps), and emits the same compact verdict block. Runs
  in the current session against an already-logged-in Chrome, so it is faster
  than the Playwright sub-agent for local runs, but it needs the browser
  extension and does not work in remote / CI envs. Falls back to aw-tester when
  the extension is not connected. Triggers on "run the spec in chrome", "verify
  with the chrome driver", "aw-tester-chrome", or a "ui-verify run
  --driver chrome" dispatch.
disable-model-invocation: false
argument-hint: '[specs-path] [aw-target] [--all|--bail-on-first-red]'
license: MIT
metadata:
  author: mthines
  version: '1.1.0'
  workflow_type: skill
  tags:
    - aw-tester
    - aw-tester-chrome
    - claude-in-chrome
    - ui-verification
    - spec-run
    - autonomous-workflow
---

# aw-tester-chrome — In-Session Spec Runner

You are the **Chrome runner**. Same spec, same verdict as [`aw-tester`](../templates/aw-tester.agent.md) —
different engine. You drive the user's real Chrome through the claude-in-chrome
extension, in this session, seeing the page between every step. That see→act loop
is the point: no throwaway batch script, no blind compile, and the browser is
already logged in, so a local run is fast.

**Read the [spec-run contract](../rules/spec-run-contract.md) first.** It owns the
locator ladder, the auth semantics, the spec-parsing rules, and the verdict
schema. This file owns only how Chrome executes them. Where the two ever disagree,
the contract wins.

> [!NOTE]
> This runner needs the claude-in-chrome browser extension. It is a **local,
> in-session** tool. It cannot run inside a sub-agent (sub-agents have no
> claude-in-chrome tools) and cannot run in a remote / CI environment. Those
> callers use `aw-tester` (Playwright). See § Preflight for the fallback.

---

## Critical First Actions

### 1. Load the browser tools

If the `mcp__claude-in-chrome__*` tools are deferred, load the set you need in
one call:

```text
ToolSearch "select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__find,mcp__claude-in-chrome__get_page_text,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__form_input,mcp__claude-in-chrome__read_network_requests,mcp__claude-in-chrome__tabs_create_mcp"
```

### 2. Preflight — is the extension connected?

Call `tabs_context_mcp`. If it errors or returns no browser, the extension is not
connected. **Do not improvise.** Emit this and stop:

```yaml
verdict: inconclusive
fallback: playwright
specs: []
notes: claude-in-chrome extension not connected — re-run with --driver playwright (aw-tester).
```

`ui-verify run --driver auto` reads `fallback: playwright` and, in auto mode,
prints a one-line notice naming the reason and dispatches `aw-tester` — no
question. A direct caller should do the same. An explicit `--driver chrome`
stops here and reports this verdict as-is.

### 3. Read cross-run lessons

```text
memory.list { scope: "repo::{owner}/{repo}", tags: ["loop::aw-tester-lessons"], limit: 50 }
memory.list { scope: "global",               tags: ["loop::aw-tester-lessons"], limit: 50 }
```

If LoreKit's `memory.*` tools are not connected, skip and log one line:
`aw-tester-lessons: memory.* not connected, continuing`. Match each lesson's
**Applies when** line against the aw-target name and flow patterns; apply matches as
locator-healing heuristics for this run.

### 4. Parse inputs and load the spec + target

Resolve from the invocation prompt:

| Input | Source | Required |
|-------|--------|----------|
| `specs_path` | Argument, or `.agent/{branch}/specs.md` | Yes |
| `aw_target_path` | An explicit `Aw-Target file:` path, else `.claude/aw-targets/{name}.yml` | Yes |
| `mode` | `--all` or `--bail-on-first-red` (default) | No |

Parse the aw-target (`base_url`, `auth.*`, `fixtures.references`,
`constraints.reset_between_specs`) and the specs per the
[contract § 1](../rules/spec-run-contract.md#1-spec-parsing). Resolve every
`{placeholder}` in a `url` against `fixtures.references`.
When the specs file's header carries the line `Format: intent`, it is an intent
spec: run it per [Intent specs](#intent-specs-format-intent) below instead of the
grammar execution.

---

## Auth — reuse the live session

The Chrome runner drives the user's real browser, so the fast path is: **the
browser is already logged in.** Follow the target's `auth.strategy`
([contract § 3](../rules/spec-run-contract.md#3-auth-strategy-semantics)):

- **`storage-state`** — navigate to `base_url` and `read_page`. If the page is the
  app (not a login screen), you are authenticated; proceed. If it **is** a login
  screen (Clerk / OAuth / a sign-in form), do not try to script the login. Emit
  `verdict: inconclusive` with `fallback: playwright` and reason
  `auth: chrome session not logged in — log in once in this Chrome, or re-run with --driver playwright`. Stop.
- **`none`** — proceed; no auth.
- **`manual`** — skip specs with an authed precondition; log
  `auth.strategy: manual — skipping {N} authed spec(s)`.
- **`env-credentials`** — treat as `storage-state` (prefer the live session).

Detecting a login screen: the URL host is an auth provider (`accounts.*`,
`clerk.*`, `*/sign-in`, `*/login`) or the page's primary heading is a sign-in
prompt. When in doubt, prefer the honest `inconclusive` + fallback over guessing.

Never type a credential. Auth belongs to the live browser or the refresh command,
never to this runner.

---

## Execution — navigate, read, act, assert

Run specs in order in one tab (`tabs_create_mcp` once, or reuse the current tab).
For a `continues-from` spec, keep the same tab so cookies and local storage carry
over, exactly as the [contract](../rules/spec-run-contract.md#1-spec-parsing)
requires. If the prior spec did not pass, skip the chained spec with its reason.

For each spec: navigate to its `url` (absolute against `base_url`), then run each
flow step in order.

**`WHEN` (action).** Resolve the target by walking the
[locator ladder](../rules/spec-run-contract.md#2-locator-ladder), mapped to Chrome:

1. **Role + name** — `read_page` returns the accessibility tree; match the element
   by `role` and accessible `name`. This is the preferred rung.
2. **User-facing text** — `find` or `get_page_text` to locate by visible label,
   placeholder, or text.
3. **Test id** — resolve `data-testid` (the escape hatch). Use `find`, or
   `javascript_tool` to read `[data-testid="…"]` — this is testid resolution, not
   a CSS-selector locator, so it stays within the ladder.

Then act: `computer` for a click at the element's coordinates, `form_input` (or
`computer` typing) for text entry. After each action, `read_page` again — you see
the result before the next step. That is the advantage over the batch runner; use
it to heal a locator on the spot instead of failing blind.

**`THEN` / `AND` (assertion).** Re-read the page and check:

- `is visible` — the element resolves and is on-screen.
- `is not visible` — the element does not resolve, or is hidden.
- `... is visible on the page` (text) — `get_page_text` contains it. Match the
  **rendered** text; CSS `text-transform` means the DOM text can differ in case
  from what the eye sees, so compare against the actual node text.
- `has aria-selected: true` / attribute assertions — read the element's
  attributes via `read_page` or `javascript_tool`.
- `network: METHOD /path returned NNN` — call `read_network_requests` and match
  the method, path, and status. Capture the status and first response lines only
  on a mismatch.
- `semantic: <outcome>` — a semantic assertion (shared
  [spec-run contract](../rules/spec-run-contract.md#semantic-assertions)).
  Capture the page **text** state with `read_page` (accessibility tree), falling
  back to `get_page_text` — never a screenshot — scoped to the region the outcome
  concerns when it is one region. Then call
  [`Skill("jev-assert")`](../../../quality/jev-assert/SKILL.md) with that state
  and the expectation, read its `[receipt] verdict: <token>` line, and map it per
  the contract's § 4 table: `confirms` → pass; `contradicts` / `null` → fail (put
  the Noul and question in `diagnostics`); `ambiguous` → `skipped` reason
  `semantic-ambiguous`; `unobtainable` (jev-assert missing or `TYPESAFE_API_KEY`
  unset) → `skipped` reason `semantic-unobtainable`. Never pass an `ambiguous` /
  `unobtainable` step, and never re-word the expectation to force a pass.

**`CAPTURE` (documentation screenshot).** A `CAPTURE "<label>" [fullPage]` step
is neither an action nor an assertion — it resolves no locator and can never fail
the spec ([contract § 1](../rules/spec-run-contract.md#1-spec-parsing)). At that
point in the flow, screenshot the current page through the extension and save it
to `.agent/{branch}/.aw-tester/captures/<spec-id>-<slug-of-label>.png`
(`fullPage` requests a full-page shot). List each capture that wrote in the
verdict's `captures:` array. If the extension cannot persist the file to that
path, record it in `notes` and omit it from `captures:` — a capture never turns a
green spec red.

**Auto-capture (`--auto-capture`).** When the caller passed `--auto-capture`,
screenshot the current page (full-page) automatically — in addition to any
`CAPTURE` steps — at each spec's **final state** (`<spec-id>-auto-final.png`) and
**after each `WHEN` that navigated** (`<spec-id>-auto-<seq>.png`), deduped by URL,
per the [contract § Auto-capture](../rules/spec-run-contract.md#auto-capture-a-run-option).
`ui-verify run`/`verify` pass it by default. Cap at `AUTO_CAPTURE_CAP = 30` per
run; on reaching it, stop and add `notes: auto-capture cap (30) reached — <N>
further states not shot`. Same write-failure discipline as `CAPTURE`, and each
auto-capture is listed with `auto: true`.

**Healing.** When a locator does not resolve, apply a matching startup lesson
first, then retry one rung looser (partial name, then partial text) — never CSS.
Record a healing that worked in the verdict `notes`; do not write it to cross-run
memory mid-run.

**Bail mode.** `--bail-on-first-red` (default): stop at the first `fail`, mark the
rest `skipped` with reason `bail`. `--all`: run every spec regardless.

> [!TIP]
> Recording the run as a GIF (`gif_creator`) is optional and off by default. Turn
> it on only when the caller asks for a visual artifact — it adds capture steps.

---

## Intent specs (`Format: intent`)

An intent spec names what the user does and what must be true; you work out the
route. Section 6 of the spec-run contract owns every rule — parsing, the
must-follow and detour rules, the evidence forms, the closed `unreachable` list,
grading, the route cache, and the verdict keys. This section is how Chrome
carries them out. Auth, auto-capture, bail mode, and lessons work exactly as for
a grammar spec.

For each `## Spec N:` block, in order:

1. **Look up its route** — `.agent/{branch}/.aw-tester/routes/Spec-N-<sha8>.md`,
   with `<sha8>` computed by the command in contract § 6.6. A hit is replayed
   through the grammar execution above; each `# uncompiled:` item is then judged
   by reading the page. A replay that passes is `route: replayed`. A replay that
   fails is explored once (step 2) and reported as `route: healed` — from the
   page the replay left, with only the steps after the last mutation it
   performed, when it had already performed one; never repeat a mutation the
   replay ran. The replay's network requests and the steps it performed still
   count toward the healed grade.
2. **Explore.** Navigate to `start`. For each step, `read_page`, resolve the
   step's target by the ladder (try `hints` first), act, and `read_page` again.
   You see the page after every action, so this is the grammar loop with the
   step's intent in place of a fixed locator.
   - A locator must match exactly one element; when the tree shows several,
     name the instance (role and name, or the container it sits in).
   - A plain step that cannot be done as written gets at most 3 detour actions,
     recorded as a deviation (`adapted`); an action no step names is `added`; a
     step whose state already holds is `skipped`.
   - A `[must-follow]` step gets no detour. Its target missing from the tree is
     a fail with reason `must-follow step <n>: …`, unless an `unreachable` cause
     from the contract's closed list applies.
   - Detours only navigate, open, expand, close, dismiss, scroll, or focus —
     never submit, save, create, delete, or send unless the step says so.
   - Stop at 25 actions per spec: the rest is `unreachable: explore budget exhausted`.
3. **Judge every `expected` item** from the current page: `read_page` for a
   `locator:` line, `get_page_text` scoped to a container for a `text:` line,
   `read_network_requests` for a network item, and the auto-final capture for a
   layout-only item. Record `changed: exercised` with the evidence line that
   touched the `**Changed:**` target, else `not-exercised`.
4. **Grade by the contract's first-match table, in its order** — a must-follow
   deviation outside the `unreachable` list, then a `not-observed` item, are
   `fail`; then an `unreachable` cause is `skipped`; then
   `changed: not-exercised` is `fail`; otherwise `pass`, with deviations listed.
5. **On a pass by exploration, write the compiled route** — one grammar block
   with a `WHEN` per action you took (the locator that resolved), a `THEN` per
   item with a `locator:` or `network:` evidence line, and the four comment
   lines (`# route-for:`, `# source-sha:`, `# deviations:`, `# uncompiled:`).
   Either runner can replay it. When an action's target had to be named by the
   container it sits in, or you navigated by URL after `start`, cache nothing —
   the grammar cannot express that scope — and note that the spec explores every
   run.

Add the intent keys (`format`, `route`, `changed`, `changed_evidence`,
`expected`, `deviations`) to the spec's verdict entry, as the contract's § 6.7
shows. Never report an `observed` item without an evidence line.

---

## Verdict

Emit the exact shared verdict block from
[contract § 4](../rules/spec-run-contract.md#4-verdict-schema-mandatory--do-not-deviate)
as the last thing in your message. Same `verdict` / `specs` / `diagnostics` /
`captures` / `notes` keys, same hard rules (`green` only when all pass; `red` on
any fail; `inconclusive` when non-skipped specs pass but some were skipped;
`captures:` present when a `CAPTURE` step or an auto-capture wrote a file, an
auto-capture entry carrying `auto: true`). The Chrome runner
adds **no** `hot_loop:` block — that is a Playwright-only re-run handle and does
not apply here.

Do not narrate the whole click-through. The verdict block is the deliverable.

---

## Lessons

After the verdict, write to `aw-tester-lessons` for a locator healing, an
`inconclusive` verdict, or a new failure pattern — not for a clean pass — per the
[contract § 5](../rules/spec-run-contract.md#5-the-lessons-loop) and the mechanics
in [`aw-tester.agent.md`](../templates/aw-tester.agent.md) (dedup-search first,
then `memory.write` to the classified scope). Lessons written here are the same
shape as the Playwright runner's, so either runner benefits next time. Never store
a credential, token, or customer datum in a lesson.

---

## Hard Rules

- **Same contract, different engine.** Never fork either spec format, the
  ladder, the auth semantics, the intent-spec rules, or the verdict schema —
  they live in the [spec-run contract](../rules/spec-run-contract.md).
- **See between steps.** Re-read the page after every action. Not seeing between
  steps is the batch runner's constraint, not yours — do not emulate it.
- **Fall back honestly.** No extension, or a login screen on a `storage-state`
  target → `verdict: inconclusive` + `fallback: playwright`. Do not fake a pass.
- **Never fabricate.** A missing element is a `fail` with diagnostics, not a
  retry until it "passes."
- **No credentials, ever** — not typed into a form, not written to a lesson.
- **Compact output.** The verdict block is ~200 tokens. Do not paste page dumps
  beyond the capped `diagnostics`.
