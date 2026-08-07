---
title: Visual Verification — Delegate to pr-reviewer / screen-recorder
impact: MEDIUM
tags:
  - storybook
  - pr-reviewer
  - screen-recorder
  - visual-diff
  - evidence
---

# Visual Verification

After scaffolding a story, the agent often needs to prove the
generated artefact is visually correct.
This skill does **not** run its own diff engine.
It delegates to one of two existing skills:

| Need                                                  | Delegate to                                            |
| ----------------------------------------------------- | ------------------------------------------------------ |
| Still screenshot of a story for PR evidence           | Playwright CLI (see [`playwright-cli.md`](./playwright-cli.md)) — `pr-reviewer` has no browser or screenshot capability. |
| Visual diff against a baseline (Chromatic, Loki, …)    | The repo's existing tool, not this skill.              |
| Short video of a multi-frame interaction              | [`screen-recorder`](../../../analysis/screen-recorder/SKILL.md). |
| Sanity check the story compiles and renders           | Playwright CLI (see [`playwright-cli.md`](./playwright-cli.md)). |

## Capturing a still screenshot for PR evidence

`pr-reviewer` has no browser or screenshot capability — its `tools:` list carries no browser and the agent never captures images.
Capture the anchoring screenshot yourself via the Playwright CLI, then attach it to the PR description or comment.
Do this when:

- The PR body says "screenshots please" (or the user does).
- The change touches motion, layout, or anything where a still
  screenshot is more informative than a diff.
- The story is brand-new and needs at least one anchoring screenshot
  in the PR description.

Capture form — run the Playwright CLI against the running Storybook (see [`playwright-cli.md`](./playwright-cli.md)):

```text
playwright screenshot \
  "http://localhost:6006/?path=/story/components-button--default" \
  .agent/storybook/.snapshots/button-default.png
```

If the Storybook target is behind auth, reuse the same `storageState.json` from
[`rules/auth.md`](./auth.md).

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
Attach the clip to a PR comment yourself — `pr-reviewer` does not capture or attach media.

## When neither is needed

If the user only wants to know "does this story compile and render at
all?", the Playwright CLI screenshot from
[`playwright-cli.md`](./playwright-cli.md) is sufficient.
Do not over-deliver by spinning up `pr-reviewer` for a sanity-check screenshot.

## Composition recipe

A common end-to-end pattern for a new story PR:

1. Scaffold the stories (this skill's main path).
2. Run Playwright CLI screenshot of `Default` and `Playground` — sanity check.
3. If the story includes motion or transitions, also run `screen-recorder`.
4. Open the PR via `/create-pr`.
5. Attach the final screenshots to the PR yourself (Playwright CLI output), then
   dispatch the `pr-reviewer` **agent** via the Task tool (`Task(subagent_type="pr-reviewer",
   prompt="<pr-url>")`) — it is an agent, not a skill, so `Skill("pr-reviewer", …)`
   errors. It posts its review immediately as a visible `COMMENT` review — nothing is
   left for the user to submit.

## Validation checklist

- [ ] Use Playwright CLI for still screenshots — sanity checks and PR evidence alike.
- [ ] Delegate to `screen-recorder` for any multi-frame interaction.
- [ ] If the URL is auth-gated, pass the `storageState.json` path to
      whichever delegate runs.
- [ ] Never check pixel diffs into the repo — they belong in
      `.agent/storybook/.snapshots/` (gitignored) or in the visual
      regression tool (Chromatic, Loki).
