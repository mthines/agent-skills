---
title: Delegation — the spec contract, who owns each concern, and what to avoid
impact: MEDIUM
tags:
  - delegation
  - spec-contract
  - aw-verify
---

# Delegation

## One spec contract

| Artifact | Written by | Read by |
| --- | --- | --- |
| `.agent/{branch}/plan.md` (`AC-{n}`, Guardrails) | `/aw` | Intent, verbatim |
| `.agent/{branch}/specs.md` (`Format: intent`, one spec per `ui:` AC) | `/aw`, else Intent | `aw-tester`, `ui-verify author` (PR body), `ui-verify run` |
| `.agent/{branch}/verify/edge-specs.md` (`Format: intent`) | Intent | Probes only — never the PR body |

`ui-verify`'s `rules/spec-format.md` is the format authority.
When `/aw` wrote `plan.md` and `specs.md`, reuse them; never describe the same behavior twice.

## Owners

| Concern | Owner | If missing |
| --- | --- | --- |
| Local stack | `environments.local.stack.driver`: [`cli`](./stack/cli.md), [`compose`](./stack/compose.md), [`command`](./stack/command.md), [`none`](./local-stack.md#the-none-driver) | Driver tool missing → `blocked (<install hint>)` |
| Login | [`auth.md`](./auth.md), the environment's `auth` block | Specs run without login; say so |
| Specs, browser run, adversarial pass, preview URL | `ui-verify`, which dispatches `aw-tester` | Drive the browser with `playwright-cli`, same specs, same evidence |
| Telemetry | `telemetry-verify` | `telemetry: skipped (telemetry-verify not installed)` |
| Screenshots and recordings on the PR | `attach-media` (`--to urls`), embedded by [`pr-comment.md`](./pr-comment.md) | List local paths in the terminal; `not attached (<reason>)` in the comment |
| UX judgment | `ux` | Decide from the repo's existing components and say so |
| Commit messages | The repo's `commit` skill, `notes.md`, or `CONTRIBUTING.md` | Recent `git log` style, then Conventional Commits |
| Lessons | LoreKit `memory.*` | Silent no-op |

A repo skill may be slash-only so `Skill()` refuses it; then follow its `SKILL.md` in place — [`fix-loop.md § Delegates`](./fix-loop.md#delegates-that-refuse-skill).

## Anti-patterns

- Reporting a pass from a stack started in another worktree.
- Writing a repo's ports, commands, datasets, or component names into `rules/` instead of `.agents/aw/`.
- Rewriting an `/aw` `specs.md` instead of running it; edge cases go in `edge-specs.md`.
- Treating "no ERROR spans" as proof when the services emitted nothing.
- Wrapping a failure in a catch-all to make a probe pass.
- Tearing down a stack someone else is using when the policy says `ask`.
