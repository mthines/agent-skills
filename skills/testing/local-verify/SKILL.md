---
name: local-verify
description: >
  Verifies a feature end-to-end on a local stack and fixes what it finds, in any
  repo. Reuses the brief and intent specs `/aw` wrote (else derives them from the
  PR, ticket, and diff), starts the PR's checkout through a stack driver, runs the
  specs plus edge-case probes through `ui-verify run --url`, reads each probe window
  back through telemetry, fixes each finding as its own commit, and reports with
  real screenshots via `attach-media`. Slash-only. Triggers on "/local-verify".
disable-model-invocation: true
argument-hint: '[setup|run|report] [<pr-url>|<pr-number>|<ticket-id>] [--no-fix] [--no-push] [--no-comment] [--loops <n>] [--keep-stack]'
license: MIT
metadata:
  author: mthines
  version: '3.0.0'
  workflow_type: orchestrator
  tags:
    - e2e-verification
    - ui-verify
    - autonomous-workflow
    - telemetry
    - stack-drivers
    - edge-cases
    - fix-loop
    - lorekit
---

# Local Verify

Prove a feature works on a real local stack, try hard to break it, read what the services said while you did, and fix what is wrong — then report it in one consistent shape.

This `SKILL.md` is an index: each phase lives in [`rules/`](./rules) and loads on demand.
Nothing in `rules/` names a repo; every repo-specific value comes from config written by `setup`, and repo facts from the notes file it points at.
Why it is shaped this way: [`references/design.md`](./references/design.md).

## One spec contract with `/aw` and `/ui-verify`

| Artifact | Written by | Read by |
| --- | --- | --- |
| `.agent/{branch}/plan.md` (Acceptance Criteria `AC-{n}`) | `/aw` | `local-verify` Phase 1 — the acceptance criteria, verbatim |
| `.agent/{branch}/specs.md` (`Format: intent`, one `## Spec N:` per `ui:` criterion) | `/aw` (correction C5), else `local-verify` Phase 1 | `aw-tester`, `ui-verify author` (lifts it into the PR body), `ui-verify run` / `local-verify` Phase 3 |
| `.agent/{branch}/local-verify/edge-specs.md` (`Format: intent`) | `local-verify` Phase 1 | `local-verify` Phase 3 only — never the PR body |

The format of both spec files is `ui-verify`'s intent format; `ui-verify`'s `rules/spec-format.md` § Writing an intent spec (v2) is the authority, and this skill adds no fields.
When `/aw` already wrote `plan.md` and `specs.md` on this branch, reuse them; never write a second description of the same behavior.

## Modes

The first token of `$ARGUMENTS` selects the mode.

| Mode | Default | Trigger | Does |
| --- | --- | --- | --- |
| `run` | **yes** | `run`, a PR / ticket reference, or nothing | The pipeline below. No reference → the open PR of the current branch; no PR → the current branch's `plan.md`. |
| `setup` | | `setup` | Detects the repo, picks the stack driver and telemetry backend, asks only what it cannot detect, writes config. Idempotent. [`rules/setup.md`](./rules/setup.md). |
| `report` | | `report` | Re-renders the last report from `.agent/{branch}/local-verify/` and re-upserts the PR comment; no stack, browser, or telemetry calls. |

| Flag | Effect |
| --- | --- |
| `--no-fix` | Report findings, change no code (Phase 5 skipped). |
| `--no-push` | Commit fixes, do not push. |
| `--no-comment` | Skip the PR comment. |
| `--loops <n>` | Telemetry review loops (default `telemetry.loops`, `2`; max `4`). |
| `--keep-stack` | Never tear down at the end, whatever the config says. |

## Pre-flight (every `run`)

1. Resolve the repo slug from `git remote get-url origin` (`<owner>/<name>`) and load config in the layer order of [`rules/setup.md § Config files`](./rules/setup.md#config-files).
   No config covers this repo, or `app_url` is empty → run `setup` inline first. Never guess a dataset or a start command.
   `notes` is set → read that file; it holds the repo's facts (auth quirks, commit format, test commands) for every phase.
2. Read lessons — [`rules/lessons.md § Read`](./rules/lessons.md#read-step).
3. Create `.agent/{branch}/local-verify/` and record `run_started_at` (ISO, UTC).

## Pipeline

| Phase | Name | Rule | Gate |
| --- | --- | --- | --- |
| 1 | Intent | [`rules/intent.md`](./rules/intent.md) | `intent.md` maps every AC to a surface and has an edge-case matrix; `specs.md` covers every `ui:` AC; the change is proven present in the checkout |
| 2 | Stack | [`rules/local-stack.md`](./rules/local-stack.md) + the driver file | The stack serves the PR checkout; `app_url` answers a real request |
| 3 | Browser | [`rules/browser-verification.md`](./rules/browser-verification.md) | Every AC has a verdict with evidence; every edge case probed or `n/a` with a reason |
| 4 | Telemetry | [`rules/telemetry-review.md`](./rules/telemetry-review.md) + the backend file | Every probe window read (or `SKIPPED (<reason>)`); ingest delay respected |
| 5 | Fix | [`rules/fix-loop.md`](./rules/fix-loop.md) | Every in-scope finding fixed and re-verified, or escalated with a reason; one commit each |
| 6 | Report | [`rules/report.md`](./rules/report.md) | Report file written; PR comment upserted with screenshots attached (or `not attached (<reason>)`) |
| 7 | Learn + clean up | [`rules/lessons.md § Write`](./rules/lessons.md#write-step), [`rules/local-stack.md § Cleanup`](./rules/local-stack.md#cleanup) | Lessons written for each failure point hit; stack left per policy |

Phases 3 → 4 → 5 form the verification loop: after a fix, re-run the affected probes and re-read their windows.
Stop when a loop finds nothing new, or at `--loops`; a finding still open at the cap is reported `open`, never dropped.

## Delegation

| Concern | Owner | If missing |
| --- | --- | --- |
| Starting the stack | `stack.driver`: [`cli`](./rules/stack/cli.md), [`compose`](./rules/stack/compose.md), [`command`](./rules/stack/command.md), or [`none`](./rules/local-stack.md#the-none-driver) | Driver tool missing → `blocked (<install hint>)` |
| Spec format, browser run, adversarial pass | `ui-verify` (`run <specs-path> --url <app_url>`), which dispatches `aw-tester` | Drive the browser with the `playwright-cli` skill, same spec, same evidence rules |
| Login | the `aw_target` aw-target, written by `/aw-setup` | Specs run without login; say so |
| Screenshots on the PR | `attach-media` (`--to urls`) | List local paths in the terminal; report `screenshots: not attached (<reason>)` |
| UX / a11y judgment on a finding | `ux` skill | Decide from the repo's existing components and say so |
| Telemetry | `telemetry.backend`: [`dash0-mcp`](./rules/telemetry/dash0-mcp.md) or [`logs`](./rules/telemetry/logs.md) | Configured backend unreachable → Phase 4 `SKIPPED (<reason>)`; never swap backends silently |
| Commit messages | The repo's `commit` skill, the notes file, or `CONTRIBUTING.md` | Recent `git log` style, then Conventional Commits |
| Lessons | LoreKit `memory.*` tools | Loop is a silent no-op |

A repo skill may be slash-only, so `Skill()` may refuse it; then read the repo's copy of its `SKILL.md` and follow it here — [`rules/fix-loop.md § Delegates`](./rules/fix-loop.md#delegates-that-refuse-skill).
The findings record every phase writes is [`rules/findings.md`](./rules/findings.md).

## Core principles

1. **Intent before clicks.** The brief, PR, and ticket define "works"; the diff only shows where to look.
2. **The running code is the PR's code.** Prove the change is in the checkout and the stack serves that checkout before trusting a result.
3. **Evidence or it did not happen.** Every pass and every finding cites a screenshot, a response, a span, or a log line.
4. **Graceful is a requirement.** A crash, a blank screen, an unhandled rejection, a raw stack trace, or a silent no-op on bad input is a finding, even when the happy path passes.
5. **Telemetry is the second witness.** A green UI with an ERROR span behind it is a finding.
6. **Fix at the root, one commit per finding**, then re-verify the exact probe that found it.
7. **One spec, many runners.** The `specs.md` you verify locally is the same file `ui-verify` lifts into the PR body and runs on the preview.

## Anti-patterns

- Reporting a pass from a stack started in a different worktree.
- Writing a repo's ports, commands, datasets, or component names into `rules/` instead of config.
- Rewriting an `/aw` `specs.md` instead of running it; add edge cases to `edge-specs.md`.
- Querying telemetry the moment a probe ends (ingest takes up to `telemetry.ingest_wait_seconds`).
- Treating "no ERROR spans" as proof when the service emitted no spans at all.
- Wrapping a failure in a catch-all to make a probe pass.
- Tearing down a stack someone else is using when the policy says `ask`.

## Definition of done

- [ ] `intent.md`, `findings.jsonl`, and `report.md` exist under `.agent/{branch}/local-verify/`; `specs.md` exists for a UI change.
- [ ] Every acceptance criterion: `pass`, `fixed → pass`, or `fail` with evidence.
- [ ] Every edge case: probed with an outcome, or `n/a` with a reason.
- [ ] Telemetry reviewed for every probe window, or `SKIPPED` with the reason.
- [ ] Each fix is its own commit; pushed per policy; tests touched by a fix pass.
- [ ] Report written and commented per policy, with screenshots attached or `not attached (<reason>)`; no local path in the comment.
- [ ] Lessons written for every failure point hit; stack left per policy.
