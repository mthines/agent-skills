---
title: Step 1.6 — the report-only ui-verify run at exit
impact: MEDIUM
tags:
  - review-loop
  - ui-verify
  - preview
---

# Step 1.6: UI-verify run (report-only, once, on exit)

Read this file after the loop exits — however it exited — unless `SKILL.md` § Step 1.6 lists a skip condition that holds.
It runs the PR's embedded ui-verify spec **once** against the live preview: the run half of the `author` step `create-pr` performs at its Step 6.4.
Why it is shaped this way: [`references/design-rationale.md` § Step 1.6](../references/design-rationale.md#step-16).

Dispatch it **once**, regardless of iteration count, **always with `--unattended`**:

```text
Skill("ui-verify", "run <PR-URL> --unattended --attach-media")
```

- `--unattended` is mandatory: it is `ui-verify`'s guarantee that no path calls `AskUserQuestion`. Under it the run uses Chrome or Playwright, or returns `inconclusive: no driver available (…)`.
- `--attach-media` puts this final run's screenshots and passing-spec recordings into the PR body through `attach-media`. It runs here and never in the `--ui` lane.
- No `--url`. Resolving the preview URL is `ui-verify`'s own concern; never resolve it here. A caller that already holds a preview URL runs `/ui-verify run <PR-URL> --url <preview-url>` directly instead.

`ui-verify run` owns the whole procedure: it reads the committed `<!-- ui-verify:v2 -->` (or `v1`) block (the **only** source — never the gitignored `.agent/{branch}/specs.md`), resolves the preview URL, dispatches `aw-tester --all`, and returns a verdict.
This loop only records the outcome.

**Report-only — this step never gates.** The verdict does not block convergence, does not reopen the loop, and does not undraft the PR.
Convergence is already decided by threads-resolved + CI-settled before this step runs.

Map its outcome into the report:

| `ui-verify run` outcome | This loop records |
| --- | --- |
| `no spec` (no block — not a UI PR, or `author` never ran) | `not run (no ui-verify block)` — log and continue |
| `inconclusive: preview not deployed` | `inconclusive (preview not deployed at exit)` — note `re-run /ui-verify run <PR-URL> once the preview is up`. Never a red |
| `inconclusive: no access path for deployment lookup (pass --url)` | `inconclusive (no deployment lookup on this access path)` — note `re-run /ui-verify run <PR-URL> --url <preview-url>`. Never a red, and never recorded as `preview not deployed`: no lookup ran, so only an explicit URL changes the outcome |
| any other `inconclusive: <reason>` (`preview building`, `no preview environment`, `preview deploy failed`, `preview URL not published`, `no driver available (unattended — …)`) | `inconclusive (<reason> at exit)` — log the reason verbatim and continue. Never a red |
| `empty spec` (markers present, body empty) | `not run (empty ui-verify block)` — log and continue. Distinct from `no spec`: `author` ran and embedded nothing, a spec-authoring bug worth naming |
| `NOT RUN (<reason>)` (`sub-agent dispatch unavailable`, `no Chrome extension and no sub-agent dispatch available`) | `not run (<reason>)` — log the reason verbatim and continue. Never a red: no driver executed |
| `green` | `green (<N> specs on <preview-url>)` |
| `red` | `red (<N> failing on <preview-url>) — review before undrafting`. Report-only; does not reopen the loop |
| `ui-verify` not installed / `Skill()` refused | `skipped (ui-verify not available)` — log one line and continue |
| anything else | `not run (unrecognised outcome: <verbatim>)` — quote what it returned and continue. An unmapped return is never recorded as `green` and never as a skip |

**Relay the adversarial summary.** After the spec run, `ui-verify run` tries to break every passing spec and reports one `adversarial: …` summary line beside the verdict (`<N> probes, <F> findings (<C> critical, …)`, or a `skipped (…)` / `not run (…)` line).
Append that line verbatim to the `green` or `red` line recorded above, so adversarial findings — and the `report.md` path with their screenshots — reach the human.
It is report-only like the verdict: it never gates, never reopens the loop, and never turns a `green` into a `red`.

Run it **at most once** per `review-loop` invocation.
