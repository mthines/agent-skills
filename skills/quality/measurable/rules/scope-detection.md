# Scope Detection

Classify a change before recommending or auditing any telemetry. Never skip
this step — the wrong classification produces the wrong signal type (e.g.
recommending a RUM event for a cron job).

## Step 1: Check for an Observability Profile first

Look for a committed profile before inferring anything from file paths:

```text
<repo>/memory/observability-profile/INDEX.md
```

(the `project-shared` tier of `persistent-memory`, written by this skill's
`setup` mode — see [`setup-profile.md`](./setup-profile.md)).

If it exists, read the **Package Map** table in it first. It maps path
globs to `kind` (`web`, `mobile`, `api`, `worker`, `infra`, `shared-lib`) and
to the stack already in use for that kind — use that instead of guessing.

If no profile exists, fall through to Step 2 and suggest running
`Skill("measurable", "setup")` once at the end of the current
operation (do not block on it).

## Step 2: Infer from the diff when no profile exists

| Signal in the diff                                                        | Classification |
| --------------------------------------------------------------------------- | --------------- |
| `*.tsx`, `*.jsx`, React/Vue/Svelte components, Next.js `app/`/`pages/` routes rendered client-side | `web`           |
| Expo Router `app/**/*.tsx`, React Native `screens/**`                       | `mobile`        |
| REST/GraphQL/RPC handlers, `routes/`, `controllers/`, `handlers/`, `api/`, server actions, background job entry points | `api`           |
| Queue consumers, cron entry points, workers with no HTTP surface            | `worker`        |
| Terraform/Pulumi/Helm/CI config                                             | `infra`         |
| Types, utils, or a library package with no runtime entry point of its own   | `shared-lib`    |

A single diff can span more than one classification (e.g. a full-stack
feature touches both `web` and `api`) — evaluate each changed path
independently rather than picking one label for the whole diff.

## Step 3: Determine what "measurable" means for this classification

| Classification | Required signal category                          | Rule file                                                    |
| --------------- | -------------------------------------------------- | ------------------------------------------------------------ |
| `web`, `mobile` | RUM / product-analytics event for the new user flow | [`frontend-rum.md`](./frontend-rum.md)                        |
| `api`, `worker` | Trace span + RED metric + structured error log      | [`backend-instrumentation.md`](./backend-instrumentation.md)  |
| `infra`         | Advisory only — flag if the change removes an existing signal (e.g. deletes a Collector pipeline, drops a scrape target) | [`regression-signals.md`](./regression-signals.md) |
| `shared-lib`    | No new signal required unless it changes error/return contracts consumed by an instrumented caller | — |

Every classification, once it emits at least one signal, still needs a
named regression detector — that check is shared across all of them and
lives in [`regression-signals.md`](./regression-signals.md).
