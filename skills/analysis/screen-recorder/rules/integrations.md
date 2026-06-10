---
title: Integrations — Handshake with `animations`, `ux`, and `reviewer`
impact: HIGH
tags:
  - integrations
  - animations
  - ux
  - reviewer
  - skill-call
---

# Integrations

This skill is callable by four other consumers via `Skill("screen-recorder")`.
Each consumer has a specific reason to invoke and a specific input shape.
The rule below is the **contract** — when changing this skill, update the
call sites listed at the bottom.

## Contents

- Contract — what callers pass
- Caller 1 — `animations` skill
- Caller 2 — `ux` skill
- Caller 3 — `reviewer` agent
- Caller 4 — `storybook` skill
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

## Caller 2 — `ux`

### When `ux` calls

When a finding's severity is Critical or High **and** the finding
concerns one of:

- Timing claims (response thresholds, debounce, perceived latency).
- Motion claims (entry / exit animations, choreography).
- Focus order / focus-ring visibility.
- Hover- or focus-revealed information.
- Interaction feedback (haptics-equivalent: press states, ripple,
  highlight).

Lower-severity findings get a still screenshot, not a recording.

### Required inputs from `ux`

- `url` — the page hosting the component.
- `selector` — the component's stable handle (raise the `data-testid`
  recommendation if it does not have one — see
  [`interactions.md`](./interactions.md)).
- `interaction` — encoded from the finding type:

  | Finding concerns… | `interaction` recipe    |
  | ----------------- | ----------------------- |
  | Hover reveal      | `hover`                 |
  | Focus ring        | `tab-to`                |
  | Entry animation   | `idle`                  |
  | Modal entrance    | `click` (on the opener) |
  | Drag affordance   | `drag-to`               |

- `context.finding-id` — the finding's `[file:line]` from the `ux`
  report, so the artifact filename references back to the finding.

### `ux` report integration

The `ux` skill emits findings under `### Critical (must fix)` and
`### High (should fix)`.
When a recording is produced, append a line under the finding:

```markdown
- **services/Sidebar.tsx:42** — Hover reveal hides primary nav
  Principle: Fitts's Law / discoverability
  Issue: …
  Fix: …
  Recording: `.agent/recordings/<slug>/<slug>.webm`
```

## Caller 3 — `reviewer` agent

### When `reviewer` calls

In **PR Mode**, when:

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
recordings (check PR body for `.webm` / `.mp4` links), the `reviewer`
agent should invoke `screen-recorder`.

### Required inputs from `reviewer`

- `url` — usually a preview deploy URL (Vercel `--prebuilt`, Netlify
  preview, …). The `reviewer` agent extracts this from PR comments or
  asks the user.
- `selector` — derived from the changed component name:

  ```bash
  # Find a stable handle in the diff
  git diff origin/main...HEAD | grep -oE 'data-testid="[^"]+"' | head -1
  ```

- `out-format` — `mp4` (GitHub previews `.mp4` inline; `.webm` is
  downloaded).
- `context.pr` — the PR number, used to slug the artifact and to attach
  the recording as a PR comment.

### `reviewer` attachment flow

After the recording is produced, the `reviewer` agent attaches it as a
PR comment via `gh`.

`$REC_RELEASE_TAG` must be derived before the upload step.
Use a deterministic tag scoped to the repository and PR number so
re-runs overwrite the previous artifact (`--clobber`) without
accumulating stale assets:

```bash
# Derive a deterministic release tag for this PR's recordings.
# Create the release if it does not exist (--target main is a safe default;
# the release holds only ephemeral recording artifacts, not code).
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
REC_RELEASE_TAG="screen-recorder-pr-${PR_NUMBER}"
gh release view "$REC_RELEASE_TAG" --repo "$REPO" >/dev/null 2>&1 || \
  gh release create "$REC_RELEASE_TAG" \
    --repo "$REPO" \
    --title "Screen-recorder artifacts for PR #${PR_NUMBER}" \
    --notes "Auto-generated by the reviewer agent. Safe to delete." \
    --prerelease

# Upload the artifact (--clobber overwrites on re-run)
REC_PATH=$(< /tmp/screen-recorder-result grep 'RECORDING_PATH=' | cut -d= -f2)
gh release upload "$REC_RELEASE_TAG" "$REC_PATH" --clobber --repo "$REPO"
ASSET_URL=$(gh release view "$REC_RELEASE_TAG" --repo "$REPO" --json assets \
  --jq ".assets[] | select(.name == \"$(basename "$REC_PATH")\") | .url")

# Comment with embedded video
gh pr comment "$PR_NUMBER" --body "Visual evidence: $ASSET_URL"
```

The `screen-recorder` skill does not itself touch `gh` — the `reviewer`
agent owns the attachment.
This skill produces the file and returns the path via `RECORDING_PATH=`.

**Note on Step 5.7 wiring:** The `reviewer` agent's Step 5.7 covers
pending-review resumption (the general PR comment system), not video
upload. Video attachment is a separate step that runs _after_ the
pending review is filed, using the snippet above. The `reviewer` agent
should surface the returned `RECORDING_PATH=` in its `### Motion evidence`
subsection and then execute the upload snippet as a post-review step.

## Caller 4 — `storybook`

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
caller (animations / ux / reviewer)
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
| [`skills/design/ux/SKILL.md`](../../../design/ux/SKILL.md)                 | Phase 3 "Report" — invoke for Critical / High findings on motion concerns. |
| [`agents/reviewer.md`](../../../../agents/reviewer.md)       | Step 2 "Analysis" — after UX rubric, when motion heuristics match.         |
| [`skills/design/storybook/rules/visual-verification.md`](../../../design/storybook/rules/visual-verification.md) | "When `screen-recorder` is the right tool" — `Skill()` call for multi-frame interactions. |

## Common mistakes

- **Recording with `out-format: webm` when delivering to GitHub.**
  GitHub does not preview `.webm` inline — `.mp4` is required.
  **Fix:** the `reviewer` caller sets `out-format: mp4` by default.
- **Calling without `caller:`.**
  The skill cannot disambiguate default behaviour (e.g., `mp4` for
  reviewer, double-recording for `animations`).
  **Fix:** every call site sets `caller:`.
- **Skipping the `data-testid` ladder when `ux` calls.**
  The skill rejects brittle selectors; the `ux` caller must propose a
  source diff first.
  **Fix:** if no stable handle exists, surface the recommendation in
  the `ux` finding instead of recording.
- **Recording without the dev server / preview deploy reachable.**
  Caller responsibility — the skill probes but does not start servers.
  **Fix:** caller ensures reachability before invoking.
