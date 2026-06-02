---
title: Visual Verification — Delegate to reviewer / screen-recorder
impact: MEDIUM
tags:
  - storybook
  - reviewer
  - screen-recorder
  - visual-diff
  - evidence
---

# Visual Verification

After scaffolding a story, the agent often needs to prove the
generated artefact is visually correct.
This skill does **not** run its own diff engine.
It delegates to one of two existing skills:

| Need                                                  | Delegate to                                          |
| ----------------------------------------------------- | ---------------------------------------------------- |
| Still screenshot of a story for PR evidence           | [`reviewer`](../../../../agents/reviewer.md) — PR Mode. |
| Visual diff against a baseline (Chromatic, Loki, …)    | The repo's existing tool, not this skill.            |
| Short video of a multi-frame interaction              | [`screen-recorder`](../../../analysis/screen-recorder/SKILL.md). |
| Sanity check the story compiles and renders           | Playwright CLI (see [`playwright-cli.md`](./playwright-cli.md)). |

## When the `reviewer` agent runs the visual pass

The [`reviewer`](../../../../agents/reviewer.md) agent is the canonical
PR-time visual reviewer in this repo.
Hand off to it when:

- The PR body says "screenshots please" (or the user does).
- The change touches motion, layout, or anything where a still
  screenshot is more informative than a diff.
- The story is brand-new and needs at least one anchoring screenshot
  in the PR description.

Invocation form — dispatch the `reviewer` agent with `--pr` and the
story URLs in the prompt:

```text
Agent(
  subagent_type: "reviewer",
  description: "Storybook screenshots for PR",
  prompt: "--pr <PR-URL>
  Capture screenshots of the new stories at:
    - http://localhost:6006/?path=/story/components-button--default
    - http://localhost:6006/?path=/story/components-button--playground
  If auth-gated, reuse: .agent/storybook/.auth/default.storageState.json"
)
```

The reviewer agent posts the screenshots as part of a **pending** PR
review — the user submits it from the GitHub UI.
The skill never auto-submits visual reviews.

If the PR is gated (Storybook target is behind auth), the reviewer
needs the same `storageState.json` from
[`rules/auth.md`](./auth.md).
Pass the path explicitly in the prompt.

## When `screen-recorder` is the right tool

A still screenshot is enough for:

- Layout, typography, colour, spacing.
- Default / loading / error states that differ in static pixels.

A screen recording is required for:

- Transitions (View Transition, Motion `layout`, `@starting-style`).
- Hover-revealed UI (tooltips, popovers, animated reveals).
- Focus order and keyboard navigation flows.
- Scroll-driven timelines.
- Anything where the change exists between two static frames.

Invocation — `Skill()` call:

```text
Skill("screen-recorder",
  url: "http://localhost:6006/?path=/story/components-card--default",
  selector: '[data-testid="card-grid"]',
  action: "hover",
  duration: "3s"
)
```

The result lands under `.agent/recordings/`.
The clip can be attached to a PR comment by the reviewer agent.

## When neither is needed

If the user only wants to know "does this story compile and render at
all?", the Playwright CLI screenshot from
[`playwright-cli.md`](./playwright-cli.md) is sufficient.
Do not over-deliver by spinning up the reviewer agent for a
sanity-check screenshot.

## Composition recipe

A common end-to-end pattern for a new story PR:

1. Scaffold the stories (this skill's main path).
2. Run Playwright CLI screenshot of `Default` and `Playground` —
   sanity check.
3. If the story includes motion or transitions, also run
   `screen-recorder`.
4. Open the PR via `/create-pr`.
5. Invoke `reviewer --pr <url>` to capture the final screenshots, post
   a pending review with the inline images, and let the user submit
   it from GitHub.

## Validation checklist

- [ ] Use Playwright CLI for sanity-check screenshots only.
- [ ] Delegate to `reviewer` for PR-attached evidence.
- [ ] Delegate to `screen-recorder` for any multi-frame interaction.
- [ ] If the URL is auth-gated, pass the `storageState.json` path to
      whichever delegate runs.
- [ ] Never check pixel diffs into the repo — they belong in
      `.agent/storybook/.snapshots/` (gitignored) or in the visual
      regression tool (Chromatic, Loki).
