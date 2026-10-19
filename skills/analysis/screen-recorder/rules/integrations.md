---
title: Integrations — Handshake with `animations`, `pr-reviewer`, and `storybook`
impact: HIGH
tags:
  - integrations
  - animations
  - pr-reviewer
  - skill-call
---

# Integrations

This skill is callable by three other consumers via `Skill("screen-recorder")`.
Each consumer has a specific reason to invoke and a specific input shape.
The rule below is the **contract** — when changing this skill, update the
call sites listed at the bottom.

## Contents

- Contract — what callers pass
- Caller 1 — `animations` skill
- Caller 2 — `pr-reviewer` agent
- Caller 3 — `storybook` skill
- Downstream sink — `video-analyser` skill (record → analyse → iterate)
- Return value contract
- Call-site inventory
- Common mistakes

## Contract — what callers pass

All callers pass a JSON-shaped argument body to the `Skill()` call:

```json
{
  "url": "http://localhost:3000/services",
  "selector": "[data-testid=\"services-sidebar\"]",
  "interaction": "hover",
  "duration": 5000,
  "viewport": { "width": 1280, "height": 800 },
  "output-name": "services-sidebar-hover",
  "out-format": "webm",
  "reduced-motion": false,
  "caller": "animations",
  "context": { "pr": null, "finding-id": null }
}
```

Required fields: `url`, `selector`, `caller`.
All other fields fall back to the defaults in
[`../SKILL.md`](../SKILL.md) Phase 1.

This skill **never asks the calling skill questions**.
On any failure (selector brittle, dev server down, host needs consent),
it returns one explanatory line and a non-zero status — the caller decides
whether to retry or escalate.

## Caller 1 — `animations`

### When `animations` calls

After Phase 7 ("Measure") of the `animations` workflow, when:

- The animation is non-trivial (View Transition, Motion `layout`, scroll
  timeline, choreographed state morph).
- The user explicitly asked "show me" or "record this".
- The animation has a `prefers-reduced-motion` branch worth proving.

### Required inputs from `animations`

- `url` — usually `http://localhost:<dev-port>`.
- `selector` — the element scope of the animation under review.
- `interaction` — one of `hover`, `click`, `focus`, `scroll-into-view`,
  `idle`, or `multi`. Comes straight from the animation's trigger.
- `output-name` — the animation name from Phase 7 (so the artifact maps
  back to the rule that produced it).

### `animations` workflow pseudo-code

```js
// inside animations / Phase 7
const baseClip = await Skill('screen-recorder', {
  url,
  selector,
  interaction,
  'output-name': `${name}-default`,
  caller: 'animations',
});
const reducedClip = await Skill('screen-recorder', {
  url,
  selector,
  interaction,
  'output-name': `${name}-reduced`,
  'reduced-motion': true,
  caller: 'animations',
});
attachToDelivery({ default: baseClip, reduced: reducedClip });
```

Two recordings (`default` + `reduced`) is the canonical pattern — never
ship a `prefers-reduced-motion`-aware animation without both clips.

## Caller 2 — `pr-reviewer` agent

### When `pr-reviewer` calls

In PR Mode, when:

- The diff includes UI files (matches `*.tsx`, `*.jsx`, `*.vue`,
  `*.svelte`, or App-Router screens) **and**
- The diff touches motion-relevant patterns: `@keyframes`,
  `transition`, `animation:`, `motion/react`, `View Transitions`,
  `@starting-style`, `scroll-timeline`, `view-timeline`, Rive /
  Lottie imports.

Detection regex (run against the diff):

```bash
git diff origin/main...HEAD -U0 | grep -E \
  '@keyframes|transition:|animation:|motion/react|startViewTransition|@starting-style|scroll-timeline|view-timeline|@lottiefiles|@rive-app'
```

If the heuristic matches and the PR author has not already attached
recordings, `pr-reviewer` should invoke `screen-recorder`.
Count recordings as already attached when the PR body contains any of these:

- A `.webm` / `.mp4` link.
- An `<!-- attach-media:file=<basename> -->` marker whose basename ends in `.webm`, `.mp4`, or `.mov`.
- A `github.com/user-attachments/assets/` URL alone on its own line, which GitHub renders as a video player.

An uploaded video's asset URL has no file extension, so the extension check alone misses it.
An image embed of a `user-attachments` URL, or an `<!-- attach-media:v1 -->` region holding only screenshots, does not count as a recording.

```bash
# ✓ counts — a .webm/.mp4/.mov link or video marker, or a bare asset URL on its own line
BODY=$(gh pr view "$PR_NUMBER" --json body -q .body)
grep -qE '\.(webm|mp4|mov)([^[:alnum:]]|$)|^https://github\.com/user-attachments/assets/[^ ]+$' <<<"$BODY"
```

### Required inputs from `pr-reviewer`

- `url` — usually a preview deploy URL (Vercel `--prebuilt`, Netlify
  preview, …). `pr-reviewer` extracts this from PR comments or asks the user.
- `selector` — derived from the changed component name:

  ```bash
  # Find a stable handle in the diff
  git diff origin/main...HEAD | grep -oE 'data-testid="[^"]+"' | head -1
  ```

- `out-format` — `mp4` (GitHub previews `.mp4` inline; `.webm` is downloaded).
- `context.pr` — the PR number, used to slug the artifact.

The `screen-recorder` skill produces the file and returns the path via `RECORDING_PATH=`.
It does not touch `gh`, and `pr-reviewer` has no `Motion evidence` slot — its Step 4 body template forbids sections outside its defined slots, so it does not attach or render recordings.
The recording is a local artifact for the reviewer to inspect.
To put it on a PR, the caller that owns the PR, never `pr-reviewer`, delegates: `Skill("attach-media", "<pr-url> <RECORDING_PATH> --to comment")`. Never paste the local path into the PR.

## Caller 3 — `storybook`

### When `storybook` calls

During the `storybook` skill's visual-verification step, when a scaffolded story includes motion, transitions, focus-order changes, or hover-revealed UI — anything where the change exists between two static frames and a still screenshot cannot prove it.
The delegation rules live in
[`skills/design/storybook/rules/visual-verification.md`](../../../design/storybook/rules/visual-verification.md).

### Required inputs from `storybook`

- `url` — the story permalink on the running Storybook
  (e.g. `http://localhost:6006/?path=/story/components-card--default`).
- `selector` — the component's stable handle inside the story canvas.
- `output-name` — the story name, so the artifact maps back to the story
  that produced it.
- If the Storybook URL is auth-gated, the caller passes the
  `storageState.json` path from its auth profile.

## Downstream sink — `video-analyser` skill

`video-analyser` is **not a caller** of this skill — it does not invoke
`Skill("screen-recorder")`. It is the **downstream consumer** of the
recordings this skill produces, and the encode defaults are tuned for
it. The relationship is one-directional:

```text
caller (animations / pr-reviewer / storybook)
   │
   ▼  Skill("screen-recorder", { ... })
screen-recorder ──► .agent/recordings/<slug>/<slug>.webm
   │
   ▼  Skill("video-analyser", <recording path>)
video-analyser ──► structured findings
```

### Encode contract

The crop pass writes outputs that match `video-analyser`'s Pareto-optimal
ingest:

| Setting           | This skill default    | `video-analyser` Step                | Why it matters                                                           |
| ----------------- | --------------------- | ------------------------------------ | ------------------------------------------------------------------------ |
| Output width      | 768 px max            | Step 5 (`scale=768:-2` filter)       | One-pass: no second downscale needed on ingest; legibility preserved.    |
| Keyframe interval | 15 frames (0.5 s)     | Step 5a (`select='eq(pict_type,I)'`) | Guarantees ≥ 6 I-frames in a 3 s clip; analyser uses pure-keyframe path. |
| Duration          | 5 s default, 15 s cap | Step 3 (bail at 600 s)               | Always well under the 10-min ceiling; no trim needed.                    |
| Container         | `.webm` (default)     | Step 5a handles `.webm` directly     | `.mp4` works too; both honour the fixed-interval GOP.                    |
| Audio             | dropped (`-an`)       | Step 7 (audio-conditional)           | No-op for analyser; saves a few KB.                                      |

### Record → analyse → iterate

The canonical loop a caller (typically `animations`) drives is:

```text
1. Build an animation.
2. Skill("screen-recorder")           ──► clip.webm
3. Skill("video-analyser", clip.webm) ──► findings
4. If findings name a defect (janky frame, missing reduced-motion
   branch, hidden focus ring): apply a fix; go to step 2.
   Else: deliver the clip alongside the change.
```

Cap the loop at **3 iterations**.
A 4th attempt usually means the fix is uncertain — escalate via
`Skill("confidence", analysis)` rather than burning more vision tokens.

The full call-site wiring lives in
[`skills/design/animations/SKILL.md`](../../../design/animations/SKILL.md) Phase 7.5
(default record) and Phase 7.6 (analyse + iterate).

### What `video-analyser` extracts from this skill's output

Given a 5 s clip at 768 px wide with 0.5 s GOP, `video-analyser`'s
default 8-frame pass returns:

- Per-frame UI state descriptions (cross-referenced with Tesseract OCR
  when available).
- Errors and exceptions surfaced in the frame (console overlays,
  toast errors, stack-trace text).
- Inferred reproduction steps.
- Recommended next actions — these are the inputs to the iteration loop.

Pass `video-analyser` a focused goal so it scores findings against the
animation contract, not against generic "find any bugs":

```text
USER_GOAL = "Verify the View Transition completes within 400 ms with no
intermediate layout flash. Flag any frame where opacity is between
0.05 and 0.95 (in-progress fade) at t > 0.4 s."
```

## Return value

On success, the skill prints:

```text
RECORDING_PATH=<absolute path>
RECORDING_FORMAT=<webm | mp4 | gif>
RECORDING_SIZE_KB=<size>
CROPPED=<yes | no>
```

Callers should parse the `RECORDING_PATH=` line; everything else is
diagnostic.

On failure, the skill prints `ERROR: <one-line reason>` and exits
non-zero. Callers must surface the error to the user, not retry blindly.

## Call-site inventory

When this skill's contract changes, update these call sites:

| Skill / agent                                             | Section that calls                                                         |
| --------------------------------------------------------- | -------------------------------------------------------------------------- |
| [`skills/design/animations/SKILL.md`](../../../design/animations/SKILL.md) | Phase 7 "Measure" — append two `Skill("screen-recorder")` calls.           |
| [`agents/pr-reviewer.md`](../../../../agents/pr-reviewer.md)  | Step 2 "Analysis" — after the rubrics, when motion heuristics match.         |
| [`skills/design/storybook/rules/visual-verification.md`](../../../design/storybook/rules/visual-verification.md) | "When `screen-recorder` is the right tool" — `Skill()` call for multi-frame interactions. |

## Common mistakes

- **Recording with `out-format: webm` when delivering to GitHub.**
  GitHub does not preview `.webm` inline — `.mp4` is required.
  **Fix:** the `pr-reviewer` caller sets `out-format: mp4` by default.
- **Calling without `caller:`.**
  The skill cannot disambiguate default behaviour (e.g., `mp4` for
  pr-reviewer, double-recording for `animations`).
  **Fix:** every call site sets `caller:`.
- **Skipping the `data-testid` ladder.**
  The skill rejects brittle selectors; the caller must propose a
  source diff first.
  **Fix:** if no stable handle exists, surface the recommendation in
  the caller's finding instead of recording.
- **Recording without the dev server / preview deploy reachable.**
  Caller responsibility — the skill probes but does not start servers.
  **Fix:** caller ensures reachability before invoking.
