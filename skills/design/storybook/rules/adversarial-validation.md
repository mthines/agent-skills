---
title: Adversarial Validation — Break-and-Fix Loop (opt-in, --validate)
impact: HIGH
tags:
  - storybook
  - playwright
  - adversarial
  - edge-cases
  - confidence-gate
  - validation
---

# Adversarial Validation

Phase 6 runs only when `--validate` is passed (flag) or the skill is
invoked as `/storybook validate <component>` (standalone). It is a
**local, interactive** phase — it drives Playwright against the running
Storybook, so it does not run in CI.

The scaffold phases prove the story renders. This phase proves the
component **works** and then tries to **break it**: feed it hostile
inputs, hammer its interactions, and drive it by keyboard only. Each
defect it finds is triaged, fixed behind a confidence gate, pinned with
a regression test, and re-validated.

This is the same tool as [`playwright-cli.md`](./playwright-cli.md), not
a second browser path. Phase 5's render check is the cheap gate; this
phase is the deep pass on top of it. Read `playwright-cli.md` first —
prerequisites, story URL shapes, background-process hygiene, and the
determinism flags all carry over.

## Why Playwright and not the Chrome extension

A story is a component at a deterministic URL in an iframe: no auth, no
real page state, no browser extensions in play. That is the controlled
case Playwright owns. The Chrome extension's real edge — driving the
user's actual Chrome with its live session and extensions — buys nothing
against an isolated story, and it cannot run headless or in CI. Playwright
covers the whole loop (interact, read console, read network, assert)
reproducibly, and reuses the auth `storageState` the skill already
manages. Do not reach for the extension here.

## Preconditions

- Phases 2–4 completed for the target component (a `.stories.tsx` and,
  unless `--no-interactions`, a `.test.stories.tsx` exist). In standalone
  mode against an existing story, read both before probing.
- Storybook running and reachable (see `playwright-cli.md` §Iteration
  loop for the background-start recipe).
- Playwright installed. Do not install silently — ask.
- If the URL is auth-gated, a `storageState.json` from
  [`rules/auth.md`](./auth.md) is on disk.

The adversarial probes need interaction, console, and network capture, so
they run as a **short Playwright script**, not the bare `screenshot` /
`open` CLI. Keep the script under `.agent/storybook/.probe/` (gitignored);
it is scaffolding, not a committed artefact.

## Probe harness

A single script pattern captures everything a probe needs. It fails the
run on any console error, page error, or failed request — the three
signals that a "rendered" story is actually broken.

```ts
// .agent/storybook/.probe/probe.spec.ts — ephemeral, not committed
import { test, expect } from "@playwright/test";

const STORY = "components-button--playground";
const url = (args = "") =>
  `http://localhost:6006/iframe.html?id=${STORY}&viewMode=story${args}`;

test("no console errors, page errors, or failed requests", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => problems.push(`requestfailed: ${r.url()}`));

  await page.goto(url());
  // …adversarial interaction goes here…
  expect(problems, problems.join("\n")).toEqual([]);
});
```

Override `args` on the URL (`&args=label:...;disabled:!true`) to drive
the component into a hostile state without editing the story. That is the
cheapest way to reach an edge case — no new story, no source change.

## Adversarial catalog

Run the probes that apply to the component's actual surface. Do not run
all of them mechanically — a stateless label has no "rapid event" axis.
Pick from the component's props and states enumerated in Phase 1.

| Axis                | Probe                                                                                          | A pass looks like                                    |
| ------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Hostile text        | Very long string, emoji, RTL, and a literal `<script>alert(1)</script>` into every text prop. | No overflow past the container; input rendered as text, never executed. |
| Numeric bounds      | `0`, negative, huge, and `NaN` into every numeric prop via the args URL.                       | No crash; clamps or degrades gracefully.             |
| Empty / missing     | Render with only required props; omit every optional one.                                       | No crash; sensible empty state.                      |
| Rapid / duplicate   | Double- and triple-click the primary action; spam a toggle.                                     | Handler fires the intended number of times, not once per pixel; no duplicate submit. |
| Disabled / loading  | Click the action while `disabled` or `isLoading` is true.                                       | The spy is **not** called; the click is a no-op.     |
| Keyboard only       | Tab to every interactive element, activate with Enter/Space, close with Escape.                 | Full reach by keyboard; visible focus ring; logical focus order; no focus trap. |
| Viewport extremes   | Render at 320 px wide and at a very wide viewport.                                              | No horizontal scroll, no clipped or overlapping content. |
| Error / async       | Drive an `error` prop or a rejected async path.                                                 | The component shows its error state; it does not throw. |
| Theme               | Run under `--color-scheme=dark` if the component is themed.                                      | Readable; no invisible-on-invisible text.            |

## Triage — story bug vs component bug

Every failure is one or the other. Decide before fixing:

- **Story / test bug.** Bad args, a missing decorator (theme, router,
  query client), a wrong locator, a probe that asserts the wrong thing.
  The component is fine. Fix the `.stories.tsx` / `.test.stories.tsx` or
  the probe. No gate needed — these are the artefacts the skill owns.
- **Component bug.** A crash, unescaped input, a handler firing while
  disabled, a focus trap, layout overflow, an unhandled rejection. The
  component source is wrong. This is the gated path below.

If a probe fails because the probe itself is wrong (e.g. asserting a
disabled button *should* fire), that is not a finding — fix the probe and
move on. Do not log it.

## Fixing a component bug — the confidence gate

Component source has a larger blast radius than a story, so it is gated:

1. For anything past a one-line, obviously-correct fix, run
   [`holistic-analysis`](../../../analysis/holistic-analysis/SKILL.md) in
   `fix` mode to find the root cause, and [`critical`](../../../quality/critical/SKILL.md)
   to pressure-test the fix direction. Do not patch the symptom at the
   call site when the cause is upstream.
2. Score the fix with [`confidence`](../../../quality/confidence/SKILL.md)
   in `analysis` mode.
   - **≥ 90.** Apply the fix to the component source.
   - **< 90.** Do not edit the component. Record the finding — repro
     steps, the failing probe, and the proposed fix direction — and move
     to the next finding. The user decides.
3. After applying a fix, **pin it**: add a regression case to the
   committed `.test.stories.tsx` under the `/Tests` namespace that
   reproduces the original failure. The ephemeral probe proved the bug;
   the committed test proves it stays fixed. Follow the hard rules in
   [`interaction-tests.md`](./interaction-tests.md) for the added case.
4. Re-run the full probe set against the fixed component.

Never widen a `try/catch` to swallow the error, delete a failing probe,
or mark it `.skip` / `.only` to make the run green. A green run earned by
hiding the signal is a false pass.

## Loop cap

Cap the probe → fix → re-validate loop at **two rounds per finding**. If a
finding survives two fix attempts, stop and escalate via
`confidence(analysis)` — a third attempt on the same defect almost always
means the root cause is elsewhere, not that the last patch was close.

Across the whole phase, if the catalog surfaces more than a handful of
independent component bugs, stop and report the set rather than fixing all
of them in one pass — that many defects is a signal the component itself
needs review, not a scaffold's validation loop.

## Report

End the phase with a compact findings report, whatever the outcome:

- Probes run, and which axes were skipped as not-applicable.
- Findings, each tagged `story` or `component`, with repro steps.
- For component findings: the confidence score, and whether it was fixed
  (≥ 90) or handed back (< 90).
- Regression tests added.

The report is the evidence. A bare "validated, all good" is not — say
which probes ran and which passed.

## Cleanup

Reuse the background-process hygiene from `playwright-cli.md`: kill the
Storybook process on exit and remove the PID file. Delete the ephemeral
`.agent/storybook/.probe/` script — it is not a committed artefact. Keep
only the regression tests added to `.test.stories.tsx`.

## Validation checklist

- [ ] Ran only in local / interactive use, never CI.
- [ ] Probes ran as a Playwright script with console + pageerror +
      requestfailed capture, not a bare screenshot.
- [ ] Only applicable catalog axes were probed; skipped axes named in the
      report.
- [ ] Each finding triaged as `story` or `component` before any edit.
- [ ] Component edits applied only at confidence ≥ 90; sub-90 findings
      reported, not patched.
- [ ] Every applied component fix pinned by a regression case in
      `.test.stories.tsx`.
- [ ] Loop capped at two rounds per finding.
- [ ] No probe deleted, skipped, or `try/catch`-swallowed to force green.
- [ ] Ephemeral probe script deleted; Storybook process killed on exit.
