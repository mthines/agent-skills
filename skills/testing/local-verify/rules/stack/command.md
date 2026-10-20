---
title: Stack driver — shell commands
impact: HIGH
tags:
  - command
  - stack-driver
---

# Stack driver: `command`

Implements the [`local-stack.md`](../local-stack.md) contract for apps started by shell commands.
Component names are `stack.commands[].name`.

```yaml
stack:
  driver: command
  commands:
    - name: web
      run: pnpm dev                      # runs from cwd, in the background
      cwd: .                             # relative to the checkout root
      ready_url: http://localhost:3000   # polled until it answers
      port: 3000                         # used by the ownership check
    - name: api
      run: go run ./cmd/server
      cwd: services/api
      ready_url: http://localhost:8080/healthz
      port: 8080
  ready_timeout_seconds: 180
```

Run state lives in `.agent/{branch}/local-verify/procs/`: `<name>.pid`, `<name>.log`.

## Step 1 — Snapshot and ownership

For each command's `port`:

```bash
lsof -nP -iTCP:<port> -sTCP:LISTEN -Fp | sed -n 's/^p//p'     # listener PID, if any
lsof -a -p <pid> -d cwd -Fn | sed -n 's/^n//p'                # its working directory
```

| Observation | Contract result |
| --- | --- |
| No listener on any port | `empty` |
| `procs/<name>.pid` names a live process that owns the port | `same-checkout` (started by an earlier run of this skill) |
| A listener whose cwd is inside this checkout | `same-checkout`, but not owned: never stop it |
| A listener whose cwd is outside this checkout, or unreadable | `foreign` |

Foreign teardown: `kill <pid>` after naming the process and its directory; wait up to 10 s, then `kill -9`.
The listener PID can be a child of the started command, so stop the process group when this run started it (`kill -- -<pgid>`).

## Step 2 — Start

Start each selected command detached in its own process group, with output captured, then poll readiness:

```bash
# `set -m` gives the background job its own process group (PGID = PID) on macOS and Linux alike.
bash -c 'set -m; cd "<checkout>/<cwd>" && nohup sh -c "<run>" > "<procs>/<name>.log" 2>&1 < /dev/null & echo $! > "<procs>/<name>.pid"'
until curl -s -o /dev/null "<ready_url>"; do sleep 2; done     # bounded by ready_timeout_seconds
```

The PID in `<name>.pid` is also the process-group ID, so `kill -- -$(cat <procs>/<name>.pid)` stops the dev server and its children.

A command that exits before it is ready, or times out → read the last 50 lines of `<name>.log` for the cause.

## Step 4 — Rebuild

| Contract action | Command |
| --- | --- |
| Restart a component | Stop its process group, start it again (Step 2), poll `ready_url` |
| Env or config change | Restart every running component |

A `run` that watches files (`pnpm dev`, `air`, `nodemon`) belongs in `stack.hot_reload` for its `cwd` prefix.

## Cleanup

| Contract action | Command |
| --- | --- |
| Full teardown | Stop every process group recorded in `procs/*.pid` |
| Partial | Stop only the groups this run started |

Never stop a `same-checkout` listener this run did not start.

## Logs for the `logs` telemetry backend

`procs/<name>.log` is the log.
Before each probe, record each log's size in bytes as `log_offsets.start`; after it, as `log_offsets.end` (`stat -f%z` on macOS, `stat -c%s` on Linux), in the probe's `probes.jsonl` line.
The window is the byte range between them: `tail -c +$((start+1)) <log> | head -c $((end-start))`.

## Common mistakes

- Running `pnpm dev` in the foreground of the tool call. **Fix:** it never returns; always detach and poll `ready_url`.
- Killing only the shell PID. **Fix:** stop the process group; the dev server is a child.
