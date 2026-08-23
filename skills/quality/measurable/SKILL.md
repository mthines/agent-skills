---
name: measurable
description: >
  Ensures every delivery ships with the telemetry needed to prove its
  impact and catch its own regressions: RUM/analytics events for
  user-facing web changes (delegates to rum-tracking), OpenTelemetry
  traces/metrics/structured logs for new or changed API endpoints, and
  explicit error/warning signal paths so failures surface instead of
  going silent. Modes: guide (default), implement, audit, setup.
  `setup` runs a first-time interview that records the project's
  telemetry stack, per-package instrumentation approach for monorepos,
  and regression-detection expectations as a committed Observability
  Profile. Triggers on "is this measurable", "add telemetry",
  "instrument this endpoint", "check observability coverage",
  "add RUM and API telemetry", "will we know if this regresses",
  "set up observability profile", "/measurable".
disable-model-invocation: false
argument-hint: '[guide|implement|audit|setup] [<target>] [--strict]'
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: gate-and-applied
  tags:
    - observability
    - telemetry
    - instrumentation
    - opentelemetry
    - rum
    - regression-detection
    - monorepo
    - dash0
    - quality-gate
---

# Measurable

Makes "we shipped it" and "we can see it" the same statement. A change is
only done when its impact is measurable and its regressions are visible —
this skill decides what telemetry a diff needs, writes or audits it, and
records a per-repo profile so the answer doesn't have to be re-derived
every time.

> **This `SKILL.md` is a thin index.** Detailed rules live in `rules/*.md`
> and load on demand. The profile template lives in `templates/*.md`.
>
> **Composes, does not duplicate.** Frontend event design is
> [`rum-tracking`](../../analysis/rum-tracking/SKILL.md)'s job — this skill
> only decides *whether* a user-facing change needs RUM and hands off to it.
> Backend span/metric semantic conventions belong to the `otel-instrumentation`
> and `otel-semantic-conventions` skills (from the
> [dash0 agent-skills repo](https://github.com/dash0hq/agent-skills)) when
> installed — invoked via `Skill()`, skipped silently otherwise, with
> [`rules/backend-instrumentation.md`](./rules/backend-instrumentation.md) as
> the built-in fallback. Persistence for the Observability Profile is
> [`persistent-memory`](../../authoring/persistent-memory/SKILL.md)'s
> `project-shared` tier — this skill never invents its own storage layer.

---

## Mode Detection

Parse `$1` as the mode.
State the detected mode in one line before continuing.

| Mode        | Default | Trigger                                                                  |
| ----------- | ------- | ------------------------------------------------------------------------- |
| `guide`     | **yes** | "is this measurable", "what telemetry do I need", default if no mode      |
| `implement` |         | "add telemetry", "instrument this", "add RUM and API telemetry"           |
| `audit`     |         | "audit observability", "check observability coverage", "--diff", aw Phase 4 gate |
| `setup`     |         | "set up observability profile", "first-time setup", "/measurable setup" |

If `$1` is a diff, PR, file, or directory, treat it as the scope for
`implement` or `audit`.

---

## Workflow by Mode

### Guide mode (default)

The user is deciding *whether* and *what* telemetry a change needs.

1. Load [`rules/scope-detection.md`](./rules/scope-detection.md) and classify
   the change: frontend (web), frontend (mobile), backend/API, infra, or
   mixed. In a monorepo, check for a committed Observability Profile first
   (see [`rules/setup-profile.md`](./rules/setup-profile.md)) so package
   boundaries and stack choices don't have to be re-guessed.
2. For a frontend classification, recommend the user-facing events per
   [`rules/frontend-rum.md`](./rules/frontend-rum.md) (thin pointer into
   `rum-tracking`).
3. For a backend/API classification, recommend the spans, metrics, and
   structured logs per
   [`rules/backend-instrumentation.md`](./rules/backend-instrumentation.md).
4. Regardless of classification, name the specific regression signal —
   the metric, alert, or dashboard panel that would turn red if this change
   broke — per [`rules/regression-signals.md`](./rules/regression-signals.md).
   "We added a log line" is not a regression signal; "P99 latency on
   `POST /checkout` is now tracked and alerts at 2× baseline" is.
5. Do not prescribe code yet — that's `implement` mode. Guide mode ends with
   a short, concrete list: signals to add, and why each one is the one that
   would catch a regression.

### Implement mode

The user (or the `autonomous-workflow` Phase 3 trigger) wants the
instrumentation written.

1. Run the Guide-mode classification (Step 1 above) first — never write
   telemetry code without first stating what kind of change this is.
2. Frontend user-facing change → delegate:
   ```
   Skill("rum-tracking", "implement", "<target>")
   ```
   This skill does not re-implement event design; it only confirms the
   delegation happened and that the resulting events map to a named
   regression signal (Step 4 above).
3. Backend/API change → follow
   [`rules/backend-instrumentation.md`](./rules/backend-instrumentation.md):
   a span per new/changed operation with OTel semantic-convention attributes,
   a RED metric (rate, errors, duration) if the operation is on a hot path,
   and a structured log at the point of failure. Prefer delegating to
   `Skill("otel-instrumentation")` / `Skill("otel-semantic-conventions")`
   when installed; the rule file is the fallback when they are not.
4. Either path → apply
   [`rules/regression-signals.md`](./rules/regression-signals.md) so errors
   and warnings are never silent: span status set on failure, a log at
   `error`/`warn` severity with enough context to triage without
   reproducing, and — when the Observability Profile names an existing
   dashboard or check rule for this package — a note that it now covers
   the new path (never auto-edit dashboards/alerts; that's `dash0`'s job
   in Dash0 chat, not this skill's).
5. Report what was added as a short "Observability" summary (one line per
   signal, with file:line) — `autonomous-workflow` Phase 6 folds this into
   the PR walkthrough.

### Audit mode

The user (or the `autonomous-workflow` Phase 4 gate) wants an existing diff
checked for coverage gaps, without writing anything.

1. Walk [`rules/audit-checklist.md`](./rules/audit-checklist.md) against the
   diff (or the target file/directory if no diff is given).
2. Classify each finding: `missing` (no signal at all for a changed path
   that needs one), `unlinked` (a signal exists but maps to no regression
   detector — Step 4 of Guide mode), or `pass`.
3. Cite a file path and line number for every finding.
4. Output a ranked list. **Advisory by default** — `missing` and `unlinked`
   findings are both reported, neither blocks. Pass `--strict` to make
   `missing` findings on `web`/`mobile`/`api`/`worker` paths block the
   caller's gate (`unlinked` stays advisory even in `--strict`, since not
   every signal needs a bespoke dashboard on day one). This mirrors how
   `critical` and `optimize-approach` ship non-blocking by default in this
   registry — a brand-new coverage heuristic earns a hard gate only once a
   team has opted in, not on day one.
5. Never auto-edit in `audit` mode — that is what `implement` mode is for.

### Setup mode

First-time (or repo-onboarding) interview that records durable project
facts so every later `guide`/`implement`/`audit` run stops re-deriving them.

1. Follow [`rules/setup-profile.md`](./rules/setup-profile.md) end to end:
   interview, monorepo package map, write via `persistent-memory`
   (`project-shared` tier), confirm.
2. Re-run any time the stack changes or a new package is added — `setup` is
   idempotent and updates the existing profile rather than duplicating it.

---

## Required Reading by Mode

Load on demand — do not preload.

| Mode        | Files                                                                                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `guide`     | [`rules/scope-detection.md`](./rules/scope-detection.md), [`rules/frontend-rum.md`](./rules/frontend-rum.md), [`rules/backend-instrumentation.md`](./rules/backend-instrumentation.md), [`rules/regression-signals.md`](./rules/regression-signals.md) |
| `implement` | Same as `guide`, plus the delegated skill's own required reading (`rum-tracking`, `otel-instrumentation` when installed)                                                                                       |
| `audit`     | [`rules/audit-checklist.md`](./rules/audit-checklist.md), [`rules/scope-detection.md`](./rules/scope-detection.md)                                                                                             |
| `setup`     | [`rules/setup-profile.md`](./rules/setup-profile.md), [`templates/observability-profile.template.md`](./templates/observability-profile.template.md)                                                          |

---

## Core Principles

1. **A signal without a regression detector is not coverage.** Emitting a
   span or a log is necessary but not sufficient — name what would alert or
   what dashboard would show the break. Anti-pattern: "instrumented" meaning
   only "some code now calls a tracer."
2. **RUM and API telemetry are two different jobs, not one.** Frontend
   product-analytics event design stays owned by `rum-tracking`; this skill
   decides *whether* a change needs it and folds it into the same coverage
   picture as backend spans/metrics/logs.
3. **The Observability Profile is the source of truth for "how does this
   repo do telemetry."** Never re-guess the stack or the monorepo package
   map when a profile exists; run `setup` once, `guide`/`audit` read it after.
4. **Errors and warnings are first-class deliverables.** A change that adds
   a new failure mode without a way to see that failure mode in production
   is incomplete, regardless of test coverage.
5. **Advisory on frontend/backend code, hands-off on Dash0 config.** This
   skill writes application-level instrumentation. It never creates or edits
   dashboards, alerts, or SLOs directly — those are proposed through Dash0
   chat (the `dash0` agent) so a human reviews and creates them there.
6. **Companions skip silently.** `rum-tracking`, `otel-instrumentation`,
   `otel-semantic-conventions`, and `persistent-memory` are all optional —
   degrade to the built-in rule files and say so in one line, never block.

## Anti-patterns (one-liners)

- Calling a change "instrumented" because a log line was added, with no
  metric or alert that would ever surface a regression.
- Re-deriving the monorepo package map or telemetry stack every run instead
  of running `setup` once and reading the profile.
- Writing frontend analytics events inline instead of delegating to
  `rum-tracking`'s centralized wrapper.
- Swallowing an error (`catch {}`) without a log at `error` severity and a
  span status flip.
- Editing a Dash0 dashboard or check rule directly from this skill instead
  of proposing it through Dash0 chat.
- Treating `audit` mode findings as blocking by default — they're advisory
  unless the caller explicitly passed `--strict`, and even then `unlinked`
  findings never block.
