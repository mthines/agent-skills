---
title: The two-way memory loop — ui-verify-lessons + aw-tester-lessons
impact: HIGH
tags:
  - ui-verify
  - lorekit
  - lessons
  - self-improvement
  - two-way-loop
---

# The two-way memory loop

The point of this loop: what the **runner** learns about navigating the app becomes what the **author** knows before writing the next spec.
A spec that omitted a required step fails once; the runner records why; the next author reads that and writes the step in from the start.

Two buckets, split cleanly by concern.
The bucket taxonomy, the shared record schema, and the read/write shapes are owned by [`memory-buckets.md`](../../../../agents/shared/rules/memory-buckets.md) and [`write-pipeline.md § Lesson-scope entries`](../../../authoring/persistent-memory/rules/write-pipeline.md#lesson-scope-entries); this file states which bucket holds what and when this skill reads and writes.

| Bucket | Holds | Written by | Read by |
| --- | --- | --- | --- |
| **`ui-verify-lessons`** (new, `loop::ui-verify-lessons`) | Spec-quality and navigation knowledge — a required precondition, a route quirk, a preview-auth step. | the runner (this skill, `run`) | the author (this skill, `author`) |
| **`aw-tester-lessons`** (existing, `loop::aw-tester-lessons`) | Locator-healing and verification friction. | `aw-tester` | `aw-tester` at run start, **and the author at author time** (cross-bucket read) |

The cross-bucket read is the second half of the loop: locator friction `aw-tester` discovered informs which locators the author picks.
If `memory.*` is not connected, skip every step here silently and log one line: `ui-verify: memory.* not connected, continuing`.

## Read at author time

Before writing a spec (`author` Step 1), read both buckets narrow-to-broad — `repo::` first, then `global`:

```text
memory.list { scope: "repo::{owner}/{repo}", tags: ["loop::ui-verify-lessons"], limit: 50 }
memory.list { scope: "global",               tags: ["loop::ui-verify-lessons"], limit: 50 }
memory.list { scope: "repo::{owner}/{repo}", tags: ["loop::aw-tester-lessons"],    limit: 50 }
memory.list { scope: "global",               tags: ["loop::aw-tester-lessons"],    limit: 50 }
```

Apply matched lessons as authoring constraints:

- A `ui-verify-lessons` navigation lesson → write its step into the spec's `preconditions:` or `flow:` (e.g. dismiss the cookie banner first, add `?tab=settings` to the `url:`).
- An `aw-tester-lessons` locator lesson → prefer the locator form that healed reliably; avoid the one that drifted.

Lessons are **advisory**. They shape the spec; they never make you skip authoring a spec or invent a step you cannot justify from the diff.

## Write at run time

After the runner reports its verdict (`run` Step 6), write a `ui-verify-lessons` entry **only** when a spec failed for a reason a better spec would have avoided:

- A missing precondition every page needs (cookie banner, feature-flag cookie, org selector).
- A route that needs a query param or path segment to render the changed component.
- A preview-deployment access quirk (a protection-bypass header, an auth-refresh step specific to the preview environment).
- The spec's `Target: preview` resolved but the app required a navigation the spec did not encode.

**Do not write** when:

- The only failure was a locator miss `aw-tester` healed — that is `aw-tester-lessons`, and `aw-tester` writes it.
- Every spec passed cleanly.
- The run stopped at `inconclusive` because the preview was not deployed — that is a timing outcome, not a lesson.
- `memory.*` is not connected.

Dedup, then write:

```text
memory.search { q: "<lesson keywords>", scopes: ["repo::{owner}/{repo}", "global"], limit: 10 }
memory.write {
  scope: "<global | repo::{owner}/{repo}>",
  key:   "ui-verify-lessons::<kebab-slug>",
  value: "<lesson body — see schema below>",
  tags:  ["loop::ui-verify-lessons", "source::run"],
  source_agent: "ui-verify",
  trigger: "spec-navigation-friction",
  ttl_days: 90
}
```

Classify the scope: a quirk true of any app (dismiss a cookie banner before asserting) → `global`; a quirk of this app (`/dashboards` needs `?view=grid`) → `repo::{owner}/{repo}`.
A recurrence resolves to an UPDATE: the store increments `seen_count` by 1 for you, and re-passing `ttl_days` refreshes the expiry.
Never hand-write a count into the body.
That is how a recurring quirk reaches the store's own `seen_count >= 3` promotion gate.

## Lesson body schema

The body is **markdown and nothing else** — never a `<!-- meta: … -->` block, and never a hand-written count or expiry date.
Every store-backed fact has its own first-class `memory.write` field: the store owns `seen_count`, `ttl_days` sets the expiry, and `status::<value>` / `source::<trigger>` are tags; the concrete matching signal travels as a visible **Applies when:** line directly under the title.

```markdown
# <one-line lesson title>

**Applies when:** <concrete signal: route glob, component name, the `preview` target>

**What happened:** <the spec step that failed, and the observable>
**Why:** <the navigation / precondition cause, or "unknown">
**Do this instead:** <prescriptive, testable authoring instruction>
**Promotion target:** <where this would harden ui-verify authoring, or "none">
```

Schema authority: [`write-pipeline.md#lesson-scope-entries`](../../../authoring/persistent-memory/rules/write-pipeline.md#lesson-scope-entries).
The **Applies when** line must be a concrete matching signal (a route glob, a component name, the `preview` target), never a subjective condition — a lesson without one cannot be matched mechanically, so do not persist it.

## The UI surface record

This is the "learns what counts as UI, per repo" half of the loop. It is a **config record, not a friction lesson** — it carries a JSON body the `is-ui-diff` gate consumes, so it is the one record under this tag that is not markdown-only.

| Field | Value |
| --- | --- |
| Scope | `repo::{owner}/{repo}` — a UI surface is repo-specific by definition. |
| Key | `ui-verify-lessons::ui-surface` (exactly one per repo). |
| Tag | `loop::ui-verify-lessons` (so it is discoverable alongside the friction lessons) plus `kind::config`. |
| Written by | `/aw-setup` at setup time, and refined when the gate misclassifies (below). |
| Read by | `author` Step 0 — forwarded to the gate as `--surface-json`. |

The body is the surface JSON the gate accepts (every field optional):

```json
{
  "mode": "extend",
  "extensions": [".ts"],
  "dirExtensions": [],
  "dirs": ["src/web", "packages/ui/src"],
  "globs": [],
  "exclude": ["packages/api/**"]
}
```

`mode: "extend"` (default) merges with the gate's broad defaults; `mode: "replace"` pins the surface exactly (use for a repo whose layout the defaults get wrong). See the gate's own header for each field's meaning.

**The refine loop — this is how it learns.** The gate is deterministic, so a wrong answer is always a surface gap, never a coin toss:

- A **UI change classified `no`** (a spec that should have been authored was not) → widen the surface: add the missing `dirs` entry or promote the extension (e.g. a frontend-only repo adds `.ts` to `extensions`). Then re-run `author`.
- A **non-UI change classified `yes`** (a backend-only PR got a spec) → narrow it: add the path to `exclude`, or switch to `mode: "replace"` with the real UI dirs.

Write the correction back to this record (`memory.write` same scope + key updates it in place). The next PR in the repo — anyone's — decides correctly from the start. Never store a path that reveals a secret; a directory layout is not sensitive, a token embedded in one would be.

## The auth profile record

The second config record under this tag (alongside the UI surface). It captures the **confirmed shape** of the repo's preview auth so the author and runner never rediscover it, and so a run can tell a stale session from a broken app. `/aw-setup` writes it after exercising the login once (see [aw-setup Phase G]); the runner reads it to know which walls to clear and which selector proves a session.

| Field | Value |
| --- | --- |
| Scope | `repo::{owner}/{repo}` — auth is repo-specific. |
| Key | `ui-verify-lessons::auth-profile` (exactly one per repo). |
| Tag | `loop::ui-verify-lessons` plus `kind::config`. |
| Written by | `/aw-setup` after a confirming login (Phase G), refined when auth drifts. |
| Read by | `author` (to know auth is needed) and the runner / `aw-tester` (walls, `authed_check`). |

The body is JSON — **names and selectors only, never a secret value** (the privacy pre-flight below forbids it; a credential env-var *name* is not a secret, its value is):

```json
{
  "walls": ["bypass-header", "app-login"],
  "strategy": "storage-state",
  "authed_check": "{role: \"button\", name: \"Account menu\"}",
  "storage_state": ".browser/auth-state.preview.json",
  "refresh_command": "node .claude/aw-targets/refresh-auth.mjs",
  "env": ["PREVIEW_USER", "PREVIEW_PASSWORD", "VERCEL_AUTOMATION_BYPASS_SECRET"],
  "confirmed_at_setup": true,
  "notes": "Clerk email-password test account; Vercel protection bypass on the outer wall"
}
```

`authed_check` is a single-braces locator (the spec grammar's, not forked) that is present **only when signed in** — the positive signal that a session is valid, used to confirm the setup login and to detect an expired session before a run (see [`preview-auth.md § Confirming a session`](./preview-auth.md#confirming-a-session)). `confirmed_at_setup` records whether `/aw-setup`'s trial login actually reached that selector; `false` means the shape is scaffolded but never proven, so the first real run must not assume it works. Write the correction back (same scope + key) when auth drifts. Never store a credential value, a token, or a captured `storageState` in this record — only the *path* to the gitignored state and the env-var *names*.

## Entrenchment guards

The same five guards that govern `aw-tester-lessons` apply here: lessons are advisory (they never change the verdict or the grammar); recurrence (the store's own `seen_count >= 3`, or the `status::structural` tag) gates promotion; every lesson expires (`ttl_days: 90` on every write, re-passed on a recurrence); a contradicting lesson is surfaced, not overwritten; the privacy pre-flight is never bypassed — never store credentials, tokens, preview-auth secrets, customer names, or product data.
