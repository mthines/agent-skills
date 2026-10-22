---
name: aw-verify
description: >
  Proves a feature works end to end, locally or on the PR preview: reuses the
  brief and specs `/aw` wrote, gets the environment ready, probes it in the
  browser (ui-verify) with concurrency and fault cases, then reads what the
  services recorded (telemetry-verify), fixes what it finds on a local stack one
  commit per finding, and reports with real screenshots. `setup` writes the committed `.agents/aw/` config every
  suite skill reads. Triggers on "/aw-verify".
disable-model-invocation: false
argument-hint: '[run [local|preview]|setup|report] [<pr-url>|<pr-number>|<ticket-id>] [--no-fix] [--no-push] [--no-comment] [--loops <n>] [--keep-stack] [--foreign-stack teardown|ask|abort]'
license: MIT
metadata:
  author: mthines
  version: '4.1.0'
  workflow_type: orchestrator
  tags: [verify, e2e-verification, ui-verify, telemetry-verify, autonomous-workflow, stack-drivers, fix-loop, setup]
---

# aw-verify

Prove a feature works on a real environment, try hard to break it, read what the services recorded while you did, and report it in one shape.
The checks, the browser, and the telemetry must agree.
Repo values come from `.agents/aw/` ([`rules/config.md`](./rules/config.md)); repo facts from `.agents/aw/notes.md`.
Who owns what, the spec contract, and the anti-patterns: [`rules/delegation.md`](./rules/delegation.md); why it is shaped this way: [`references/design.md`](./references/design.md).

## Modes and flags

`run [local|preview] [<pr>|<ticket>]` is the default (no reference → the branch's PR, else its `plan.md`).
`setup` writes `.agents/aw/` ([`rules/setup.md`](./rules/setup.md)); `report` re-renders the last report and re-upserts the PR comment, with no stack, browser, or telemetry calls.
Every run with a PR ends by posting its proof — what was tested, why, the result, and uploaded screenshots and recordings — as the `aggregate` region of the PR's one verify comment ([`rules/pr-comment.md`](./rules/pr-comment.md)); always, whatever `policies.pr_comment` says.
**Your own PR:** fix, push, and re-verify until the verdict is `✅ verified`, at most 3 iterations — on `local` and `preview` alike — then post ([`rules/fix-loop.md § Own PR`](./rules/fix-loop.md#own-pr-fix-until-verified)). Someone else's PR: report only.

| Flag | Effect |
| --- | --- |
| `--no-fix` | Report findings, change no code |
| `--no-push` / `--no-comment` | Commit fixes but do not push / defer the PR comment — only for a caller that runs `report <pr-url>` itself afterwards (`aw`) |
| `--loops <n>` | Fix-and-reverify iterations (default and max `3`; `telemetry.yml` `loops` may lower it) |
| `--keep-stack` | Never tear the local stack down |
| `--foreign-stack <teardown\|ask\|abort>` | Overrides `policies.foreign_stack`; `aw` passes `abort` |

Someone else's PR is never fixed, on `local` or `preview`: its blocking findings go to `review-loop --ui` as review threads.

## Run card

Do these in order; `Read` a step's rule before its first action when it is not already in context.
Everything this run writes goes under `.agent/{branch}/verify/`, never `/tmp`, where another run uses the same names.

0. **Config** ([`rules/config.md § Resolve`](./rules/config.md#resolve-the-config-every-skill-before-any-other-step)). No `.agents/aw/environments.yml`, or no entry for the environment → run `setup` first; never guess a URL, dataset, or start command. Read lessons ([`rules/lessons.md § Read`](./rules/lessons.md#read-step)).
1. **Intent** ([`rules/intent.md`](./rules/intent.md)). Write `intent.md`: the brief's `AC-n` verbatim, each tagged `ui:` / `api:` / `worker:`, and the edge-case matrix.
   The matrix always has a **Concurrency** row for any AC that creates a record (fire the trigger twice in parallel, count rows) and one **Failure** row per guardrail in the brief (break the dependency the guardrail names: make the file unwritable, block the route, stop the service).
2. **Stack** ([`rules/local-stack.md`](./rules/local-stack.md) + the driver file; login per [`rules/auth.md`](./rules/auth.md)). Start it detached, logs to `procs/<name>.log`, poll the ready URL. A sandbox that refuses `listen` → drive the app's own request handler in-process and say `browser: not run (no local port)`.
3. **Probe in windows** ([`rules/browser-verification.md`](./rules/browser-verification.md)). Per batch, append to `probes.jsonl`: `window_start`, run it, then `window_end` and each log's byte `log_offsets`. Batches: acceptance specs, then edge rows, then fault rows; restore every injected fault before the next batch.
   A defect that blocks the path (a 500, a build error, a crash) → record it, then route around it without changing code (another dev-server mode, a direct request, seeded state) and keep probing; one defect must not hide the next.
4. **Telemetry, once** ([The two witnesses](#the-two-witnesses)). After the last window closes, dispatch `telemetry-verify` over all of them; save its block to `telemetry.md`.
5. **Findings** ([`rules/findings.md`](./rules/findings.md)): one JSON line per defect in `findings.jsonl`, with its probe and evidence.
6. **Fix** (your own PR or no PR yet, `local` or `preview`; never someone else's PR; unless `--no-fix`: [`rules/fix-loop.md`](./rules/fix-loop.md)), then **report** ([`rules/report.md`](./rules/report.md)), **lessons and cleanup** ([`rules/lessons.md § Write`](./rules/lessons.md#write-step)). After a fix, re-run the probe that found it; stop at `✅ verified` or at `--loops`, and report a finding open at the cap as `open`.

The verdict is `BROKEN` when any AC fails or any guardrail does not hold; a defect outside them is reported but does not flip the verdict.

## The two witnesses

```text
Skill("ui-verify", "run .agent/<branch>/specs.md --env <env> --url <url> --no-telemetry --no-comment")
Agent(subagent_type="general-purpose",
      prompt='Run Skill("telemetry-verify", "--env <env> --windows .agent/<branch>/verify/probes.jsonl [--host <preview host>] [--driver <driver>] --brief <plan.md or verify/intent.md> --out .agent/<branch>/verify/findings.jsonl --no-comment") and return only its TELEMETRY block')
```

- Backend `dash0-mcp` → first check that `mcp__<telemetry.yml mcp_server>__getSpans` exists. Absent → `telemetry: skipped (Dash0 MCP server '<name>' not connected)`, no dispatch; never query another Dash0 server, whose empty answer proves nothing.
- One dispatch per run, after the last window: the sub-agent pays its setup once, and its ingest wait starts from the last window. A fix loop dispatches once more for the windows it re-probed.
- `ui-verify` always gets `--no-telemetry`, so no window is read twice; both witnesses always get `--no-comment`, so the PR holds one aggregate ([`rules/pr-comment.md`](./rules/pr-comment.md)).
- The block has `pipe:`, one `AC-n <verdict>` line per AC, `signals:`, `findings:`, and `[receipt] verdict: confirms|contradicts|ambiguous|null`; its findings join `findings.jsonl` as `T-<n>`.
- On Dash0 Agent0 the sub-agent type is `general`; with no dispatch tool, run it here and say `telemetry: same-context (reduced independence)`.

## Core principles

1. **Intent before clicks.** The brief, PR, and ticket define "works"; the diff only shows where to look.
2. **The running code is the PR's code.** Prove the change is in the checkout and the environment serves it.
3. **Evidence or it did not happen.** Every pass and finding cites a screenshot, a response, a span, or a log line.
4. **Graceful is a requirement.** A crash, blank screen, unhandled rejection, raw stack trace, or silent no-op on bad input is a finding.
5. **Telemetry is the second witness.** A green UI with an ERROR span behind it, or a request whose trace never reached the API, is a finding.

## Definition of done

- [ ] `intent.md`, `probes.jsonl`, `findings.jsonl`, and `report.md` under `.agent/{branch}/verify/`; `specs.md` for a UI change.
- [ ] Every AC and guardrail: `pass`, `fixed → pass`, or `fail`, with evidence; every edge row probed or `n/a` with a reason.
- [ ] A `TELEMETRY` block covering every window, or `telemetry: skipped (<reason>)`.
- [ ] Each fix its own commit, pushed per policy; stack left per policy.
- [ ] The PR comment's `aggregate` region posted with every screenshot and recording uploaded, or a `comment: not posted (<reason>)` line.
