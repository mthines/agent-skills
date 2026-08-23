# Setup Mode: the Observability Profile

A first-time (or repo-onboarding) interview that records durable, per-repo
facts so `guide`/`implement`/`audit` never have to re-derive the telemetry
stack or the monorepo package map. Idempotent — re-running `setup` updates
the existing profile rather than creating a duplicate.

## Storage

Delegate persistence entirely to `persistent-memory`, `project-shared` tier
(committed, team-visible — this is project config, not a private agent
note):

```
Skill("persistent-memory", "write", "observability-profile", "--tier project-shared")
```

This lands at `<repo>/memory/observability-profile/`, following
`persistent-memory`'s own layout (`INDEX.md` + `entries/`). Read it back
with:

```
Skill("persistent-memory", "read", "observability-profile", "--tier project-shared")
```

If `persistent-memory` is not installed, fall back to writing the profile
directly at `<repo>/memory/observability-profile/INDEX.md` using
[`templates/observability-profile.template.md`](../templates/observability-profile.template.md)
as-is, and say so in one line — do not block setup on the companion.

## Interview (single batched message)

Ask these in **one** message so the user answers once:

1. **Telemetry stack** — what emits traces/metrics/logs today? (Dash0 SDK,
   raw OpenTelemetry SDK, Sentry, Datadog, none yet). Can be different per
   package in a monorepo — ask "one stack for everything, or does it vary
   by package?" first.
2. **RUM/analytics stack** — PostHog, Segment, Mixpanel, Amplitude, Dash0
   SDK Web, OTel browser, none yet. Same "one or varies by package?" framing.
3. **Monorepo package map** — is this a monorepo? If yes, list each
   package/app with: path glob, `kind` (`web` / `mobile` / `api` / `worker`
   / `infra` / `shared-lib` — see [`scope-detection.md`](./scope-detection.md)),
   and which stack (from Q1/Q2) applies. If not a monorepo, this is a single
   row covering the whole repo.
4. **Existing repo-level skills to defer to** — does this repo (or an
   installed skill set) already have a specialized instrumentation skill
   for a given package (e.g. a generated OTel wrapper skill, a
   framework-specific analytics skill)? Record the skill name per package
   so `guide`/`implement` delegate there instead of the built-in rule files.
5. **Regression-detection surface** — is there an existing Dash0 dashboard
   or set of check rules this project relies on for catching regressions?
   Record names/links if so; if not, note that `regression-signals.md`'s
   "propose via Dash0 chat" path is the current state and should stay
   flagged until one exists.

Confirm the answers back to the user verbatim before writing.
**Do not guess any of these** — a wrong package map silently misroutes
every future `guide`/`implement`/`audit` call.

## Writing the profile

Fill [`templates/observability-profile.template.md`](../templates/observability-profile.template.md)
from the confirmed answers and pass it as the entry content to the
`persistent-memory` write pipeline (Step 2 "Extract candidates" — this
profile *is* the candidate; there's no further extraction to do). The
Package Map table is the load-bearing part — keep it as the first table
in the file so [`scope-detection.md`](./scope-detection.md) Step 1 can read
it without scanning the whole document.

## Re-running setup

Re-run whenever:

- A new package/app is added to the monorepo.
- The telemetry or RUM stack changes for any package.
- A new repo-level instrumentation skill is installed that should be
  deferred to.

`persistent-memory`'s `write` pipeline already resolves ADD/UPDATE/DELETE
per entry — trust it rather than hand-diffing the profile.
