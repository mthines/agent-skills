---
name: verify
description: >
  Proves a feature works end to end, locally or on the PR preview: reuses the
  brief and specs `/aw` wrote, gets the environment ready, runs the browser
  witness (ui-verify) and the telemetry witness (telemetry-verify) in parallel,
  fixes what it finds on a local stack one commit per finding, and reports with
  real screenshots. `setup` writes the committed `.agents/aw/` config every
  suite skill reads. Triggers on "/verify".
disable-model-invocation: false
argument-hint: '[run [local|preview]|setup|report] [<pr-url>|<pr-number>|<ticket-id>] [--no-fix] [--no-push] [--no-comment] [--loops <n>] [--keep-stack] [--foreign-stack teardown|ask|abort]'
license: MIT
metadata:
  author: mthines
  version: '4.0.0'
  workflow_type: orchestrator
  tags: [verify, e2e-verification, ui-verify, telemetry-verify, autonomous-workflow, stack-drivers, fix-loop, setup]
---

# Verify

Prove a feature works on a real environment, try hard to break it, read what the services recorded while you did, fix what is wrong, and report it in one shape.
Three witnesses must agree: the checks pass, the browser shows it, and the telemetry confirms it.
Nothing in `rules/` names a repo: repo values come from `.agents/aw/` ([`rules/config.md`](./rules/config.md)), repo facts from `.agents/aw/notes.md`.

## One spec contract

| Artifact | Written by | Read by |
| --- | --- | --- |
| `.agent/{branch}/plan.md` (`AC-{n}`, Guardrails) | `/aw` | Phase 1, verbatim |
| `.agent/{branch}/specs.md` (`Format: intent`, one spec per `ui:` AC) | `/aw`, else Phase 1 | `aw-tester`, `ui-verify author` (PR body), `ui-verify run` |
| `.agent/{branch}/verify/edge-specs.md` (`Format: intent`) | Phase 1 | Phase 3 only — never the PR body |

`ui-verify`'s `rules/spec-format.md` is the format authority. When `/aw` wrote `plan.md` and `specs.md`, reuse them; never describe the same behavior twice.

## Modes

| Mode | Default | Trigger | Does |
| --- | --- | --- | --- |
| `run` | **yes** | `run`, `local`, `preview`, a reference, or nothing | The pipeline below on `local` (default) or `preview`. No reference → the current branch's PR; no PR → its `plan.md` |
| `setup` | | `setup` | Writes `.agents/aw/` and `~/.agents/aw/config.yml`: [`rules/setup.md`](./rules/setup.md) |
| `report` | | `report` | Re-renders the last report from `.agent/{branch}/verify/` and re-upserts the PR comment; no stack, browser, or telemetry calls |

| Flag | Effect |
| --- | --- |
| `--no-fix` | Report findings, change no code |
| `--no-push` | Commit fixes, do not push |
| `--no-comment` | Skip the PR comment |
| `--loops <n>` | Verification loops (default `telemetry.yml` `loops`, `2`; max `4`) |
| `--keep-stack` | Never tear the local stack down |
| `--foreign-stack <teardown\|ask\|abort>` | Overrides `policies.foreign_stack` for this run; `aw` passes `abort` |

`preview` never fixes: it reports, and its blocking findings go to `review-loop --ui` as review threads.

## Pre-flight

1. Resolve config per [`rules/config.md § Resolve`](./rules/config.md#resolve-the-config-every-skill-before-any-other-step). No `.agents/aw/environments.yml`, or the chosen environment is missing → run `setup` inline first. Never guess a URL, a dataset, or a start command.
2. Read lessons — [`rules/lessons.md § Read`](./rules/lessons.md#read-step).
3. Create `.agent/{branch}/verify/`, record `run_started_at` (UTC ISO-8601), and write `aw-tester`'s target `.agent/{branch}/aw-target.<env>.yml` from the environment per `config.md`.

## Pipeline

| Phase | Name | Rule | Gate |
| --- | --- | --- | --- |
| 1 | Intent | [`rules/intent.md`](./rules/intent.md) | Every AC has a surface and an edge-case matrix; `specs.md` covers every `ui:` AC; the change is in the checkout |
| 2 | Environment | `local`: [`rules/local-stack.md`](./rules/local-stack.md) + the driver file · `preview`: `ui-verify`'s `rules/preview-url-resolution.md` | The URL serves the PR's code and answers a real request |
| 3 | Witnesses | [`rules/browser-verification.md`](./rules/browser-verification.md) | Every AC has a browser verdict with evidence; every edge case probed or `n/a`; every closed window has a `TELEMETRY` block |
| 4 | Fix (`local` only) | [`rules/fix-loop.md`](./rules/fix-loop.md) | Every in-scope finding fixed and re-verified, or escalated; one commit each |
| 5 | Report | [`rules/report.md`](./rules/report.md) | Report written; PR comment upserted with screenshots, or `not attached (<reason>)` |
| 6 | Learn + clean up | [`rules/lessons.md § Write`](./rules/lessons.md#write-step), [`rules/local-stack.md § Cleanup`](./rules/local-stack.md#cleanup) | Lessons for each failure point; stack left per policy |

Phases 3 → 4 loop: after a fix, re-run the probe that found it and re-read its window.
Stop when a loop finds nothing new, or at `--loops`; a finding open at the cap is reported `open`, never dropped.

## The two witnesses

```text
Skill("ui-verify", "run .agent/<branch>/specs.md --env <env> --url <url> --no-telemetry")
Agent(subagent_type="general-purpose",
      prompt='Run Skill("telemetry-verify", "--env <env> --from <window_start> --to <window_end> [--host <preview host>] [--driver <driver>] --brief .agent/<branch>/plan.md --out .agent/<branch>/verify/findings.jsonl") and return only its TELEMETRY block')
```

Dispatch `telemetry-verify` for each window as soon as it closes, in parallel with the remaining browser work, so its ingest wait overlaps the edge and API runs. Both `ui-verify` runs pass `--no-telemetry`: `verify` owns the read, so no window is read twice.
It returns `TELEMETRY …`, `pipe:`, one `AC-n <verdict> — <journey>` line per AC, `signals:`, `findings:`, and `[receipt] verdict: confirms|contradicts|ambiguous|null`; its findings land in the same `findings.jsonl` as `T-<n>`.
On Dash0 Agent0 use the sub-agent type `general`; with no dispatch tool, run it in this context and say `telemetry: same-context (reduced independence)`.

## Delegation

| Concern | Owner | If missing |
| --- | --- | --- |
| Local stack | `environments.local.stack.driver`: [`cli`](./rules/stack/cli.md), [`compose`](./rules/stack/compose.md), [`command`](./rules/stack/command.md), [`none`](./rules/local-stack.md#the-none-driver) | Driver tool missing → `blocked (<install hint>)` |
| Login | [`rules/auth.md`](./rules/auth.md), the environment's `auth` block | Specs run without login; say so |
| Specs, browser run, adversarial pass, preview URL | `ui-verify`, which dispatches `aw-tester` | Drive the browser with `playwright-cli`, same specs, same evidence |
| Telemetry | `telemetry-verify` | `telemetry: skipped (telemetry-verify not installed)` |
| Screenshots on the PR | `attach-media` (`--to urls`) | List local paths; `not attached (<reason>)` |
| UX judgment | `ux` | Decide from the repo's existing components and say so |
| Commit messages | The repo's `commit` skill, `notes.md`, or `CONTRIBUTING.md` | Recent `git log` style, then Conventional Commits |
| Lessons | LoreKit `memory.*` | Silent no-op |

A repo skill may be slash-only so `Skill()` refuses it; then follow its `SKILL.md` here — [`rules/fix-loop.md § Delegates`](./rules/fix-loop.md#delegates-that-refuse-skill).
Every phase writes findings per [`rules/findings.md`](./rules/findings.md).

## Core principles

1. **Intent before clicks.** The brief, PR, and ticket define "works"; the diff only shows where to look.
2. **The running code is the PR's code.** Prove the change is in the checkout and the environment serves it.
3. **Evidence or it did not happen.** Every pass and finding cites a screenshot, a response, a span, or a log line.
4. **Graceful is a requirement.** A crash, blank screen, unhandled rejection, raw stack trace, or silent no-op on bad input is a finding.
5. **Telemetry is the second witness.** A green UI with an ERROR span behind it, or a request whose trace never reached the API, is a finding.
6. **Fix at the root, one commit per finding**, then re-verify the exact probe that found it.

## Anti-patterns

- Reporting a pass from a stack started in another worktree.
- Writing a repo's ports, commands, datasets, or component names into `rules/` instead of `.agents/aw/`.
- Rewriting an `/aw` `specs.md` instead of running it; edge cases go in `edge-specs.md`.
- Treating "no ERROR spans" as proof when the services emitted nothing.
- Wrapping a failure in a catch-all to make a probe pass.
- Tearing down a stack someone else is using when the policy says `ask`.

## Definition of done

- [ ] `intent.md`, `findings.jsonl`, and `report.md` exist under `.agent/{branch}/verify/`; `specs.md` exists for a UI change.
- [ ] Every AC: `pass`, `fixed → pass`, or `fail` with evidence from the browser and, when configured, telemetry.
- [ ] Every edge case probed or `n/a` with a reason.
- [ ] Every window read by `telemetry-verify`, or `skipped (<reason>)`.
- [ ] Each fix is its own commit, pushed per policy, touched tests passing.
- [ ] Report written and commented per policy; no local path in the comment.
- [ ] Lessons written for every failure point; stack left per policy.
