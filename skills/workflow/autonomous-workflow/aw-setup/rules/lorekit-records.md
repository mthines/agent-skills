---
title: 'Phases F and G — the UI surface and preview auth profile records'
impact: MEDIUM
tags:
  - aw-setup
  - lorekit
  - ui-surface
  - preview-auth
---

# Phases F and G — LoreKit records

Read when Phase D finished and LoreKit's `memory.*` tools are connected (Phase F), or when the `preview` target configured a gated preview (Phase G).
The committed aw-target YAML stays the source of truth the tools execute; these records are discovery indexes for agents.
Record shapes are owned by [`ui-verify/rules/memory.md`](../../../../testing/ui-verify/rules/memory.md).

## Contents

- [Phase F — the UI surface record](#phase-f--the-ui-surface-record)
- [Phase G — confirm the preview login and record the auth profile](#phase-g--confirm-the-preview-login-and-record-the-auth-profile)

## Phase F — the UI surface record

The `is-ui-diff` gate (used by `ui-verify author`, `aw-planner`, `create-pr`, and `review-loop`) works on broad defaults; this record refines what this repo counts as UI.

1. Without `memory.*`, log `aw-setup: memory.* not connected — UI surface not recorded, gate uses defaults` and stop.
2. Propose a surface from Phase A's detection and confirm it with the user. Ask only when the defaults would be wrong:
   - frontend-only repo where plain `.ts` / `.js` are UI → add them to `extensions`;
   - monorepo where only some packages are UI → pin `dirs` and `exclude` the backend (or `mode: "replace"`);
   - components under a non-default directory → add it to `dirs`.
3. On a re-run, `memory.read` the same scope and key first and show a diff before overwriting.
4. Write:

```text
memory.write {
  scope: "repo::{owner}/{repo}",
  key:   "ui-verify-lessons::ui-surface",
  value: "{ \"mode\": \"extend\", \"dirs\": [\"src/web\"], \"exclude\": [\"packages/api/**\"] }",
  tags:  ["loop::ui-verify-lessons", "kind::config"],
  source_agent: "aw-setup"
}
```

Never store a path that embeds a secret.
Log one of: `UI surface recorded (repo::{owner}/{repo}) — {summary}`, `UI surface unchanged — defaults fit this repo`, `memory.* not connected — UI surface not recorded`.

## Phase G — confirm the preview login and record the auth profile

Runs only when the `preview` aw-target has `auth.strategy` `bypass-header` or `storage-state`.
It proves the login authenticates, then records the confirmed shape.

Skip with one log line when:

| Condition | Log line |
| --- | --- |
| Preview auth is `none` / `manual` | `aw-setup: preview auth is <strategy> — nothing to confirm` |
| `memory.*` not connected | `aw-setup: memory.* not connected — auth profile not recorded` |
| The `refresh.env` variables are unset in this shell | `aw-setup: auth env vars absent — profile scaffolded unconfirmed (set <names> and re-run)` — write the record with `confirmed_at_setup: false`; never prompt for the values |

Credentials come from the environment only: never accept a password pasted into the session, and never read one from a tracked file.

1. **Establish `authed_check`** — ask for a locator present only when signed in (account menu, avatar, sign-out), in spec grammar: `{role: "button", name: "Account menu"}`. Without a stable element, record `authed_check: null` (the run falls back to the URL-not-login signal).
2. **Exercise the login once** — run `refresh.command`, load the preview, and look for `authed_check`:

   | Result | `confirmed_at_setup` | Action |
   | --- | --- | --- |
   | State written and `authed_check` visible | `true` | Record it |
   | Login ran, `authed_check` never appeared | `false` | Show the diagnostic; offer to redo step 1 or Phase B |
   | `refresh.command` failed | `false` | Report the failure verbatim; record the scaffolded shape |

3. **Record the auth profile** — names and selectors only, never a secret value, token, or captured state. On a re-run, read and diff first.

```text
memory.write {
  scope: "repo::{owner}/{repo}",
  key:   "ui-verify-lessons::auth-profile",
  value: "{ \"walls\": [\"bypass-header\", \"app-login\"], \"strategy\": \"storage-state\", \"authed_check\": \"{role: \\\"button\\\", name: \\\"Account menu\\\"}\", \"storage_state\": \".browser/auth-state.preview.json\", \"refresh_command\": \"node .claude/aw-targets/refresh-auth.mjs\", \"env\": [\"PREVIEW_USER\", \"PREVIEW_PASSWORD\", \"VERCEL_AUTOMATION_BYPASS_SECRET\"], \"confirmed_at_setup\": true, \"notes\": \"Clerk email-password test account; Vercel protection bypass on the outer wall\" }",
  tags:  ["loop::ui-verify-lessons", "kind::config"],
  source_agent: "aw-setup"
}
```

Log one of: `auth profile recorded, confirmed (repo::{owner}/{repo}) — {walls}`, `auth profile recorded, UNCONFIRMED (env vars absent / login unverified)`, or a skip line above.
