---
title: Stack driver — docker compose
impact: HIGH
tags:
  - docker-compose
  - stack-driver
---

# Stack driver: `compose`

Implements the [`local-stack.md`](../local-stack.md) contract with Docker Compose v2.
Component names are compose service names.

| Config | Meaning | Default |
| --- | --- | --- |
| `environments.local.stack.compose.files` | Compose files, passed as repeated `-f` | `[]` → compose's own lookup (`compose.yaml`, `docker-compose.yml`, …) |
| `environments.local.stack.compose.project` | Project name, passed as `-p` | Directory name of the checkout |
| `environments.local.stack.compose.profiles` | Profiles, passed as repeated `--profile` | `[]` |

Use one shell variable for the prefix in every command:

```bash
DC="docker compose -p <project> -f <file> …"
```

`docker compose version` failing, or `docker info` failing → `blocked — Docker is not running`.

## Step 1 — Snapshot and ownership

```bash
$DC ps --format json                                     # services of this project
docker ps --filter "publish=<app port>" \
  --format '{{.Names}} {{.Label "com.docker.compose.project.working_dir"}}'
lsof -nP -iTCP:<app port> -sTCP:LISTEN                   # a non-Docker listener
```

| Observation | Contract result |
| --- | --- |
| No containers in the project, nothing on the app port | `empty` |
| Containers in the project, `working_dir` is this checkout | `same-checkout` |
| A container on the app port whose `working_dir` is another checkout | `foreign` |
| A non-Docker process on the app port | `foreign` |

Foreign teardown: `docker compose -p <their project> stop` for a compose stack (never `down -v`), `kill <pid>` for a plain process, after naming it.
Two worktrees of one repo share a project name when it defaults to the directory name only if the directories match; set `environments.local.stack.compose.project` when they collide.

## Step 2 — Start

```bash
$DC up -d --build --wait <services>      # --wait blocks until healthchecks pass
```

Services without a healthcheck count as ready when running; Step 3 proves them usable.
Diagnostics on a failed start: `$DC ps -a --format json` and `$DC logs --no-color --tail 50 <service>`.

## Step 4 — Rebuild

| Contract action | Command |
| --- | --- |
| Restart a component | `$DC up -d --build --wait <service>` (rebuilds the image, recreates the container) |
| Env or config change | `$DC up -d --force-recreate --wait <services>` |

A bind-mounted source directory with a watching dev server belongs in `environments.local.stack.hot_reload`.

## Cleanup

| Contract action | Command |
| --- | --- |
| Full teardown | `$DC down` (no `-v`; volumes stay) |
| Partial | `$DC stop <services>` |

## Logs for the `logs` telemetry backend

```bash
$DC logs --no-color --timestamps --since <window_start> --until <window_end> <services>
```

The window bounds are the ISO timestamps from `probes.jsonl`; no byte offsets are needed.

## Common mistakes

- `down -v` to get a clean slate. **Fix:** never; the developer's seeded data lives in those volumes.
- Testing a stale image. **Fix:** always `--build`; a `same-checkout` stack started before the last commit still runs old code, so recreate the services the diff touches.
