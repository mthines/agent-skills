---
title: Record → Analyse → Iterate — Closed-loop animation validation
impact: HIGH
tags:
  - feedback-loop
  - validation
  - screen-recorder
  - video-analyser
  - iteration
---

# Record → Analyse → Iterate

Closes the feedback loop on a non-trivial animation by recording the
running animation, feeding the recording into the `video-analyser`
skill, and iterating on findings.
The loop runs after Phase 7 ("Measure") and replaces eyeballing
DevTools traces with structured per-frame analysis.

## Contents

- When the loop applies
- The four-step cycle
- Recording inputs (analyser-optimal defaults)
- Analyser goal — what to ask
- Iteration policy (max 3 rounds)
- Escalation on round 4
- Examples
- Common mistakes

## When the loop applies

Run the loop when **any** of the following holds:

- The animation is **non-trivial**: View Transition, Motion `layout`,
  scroll timeline, state-choreography morph, or any animation longer
  than 400 ms.
- The animation has a **branch** the human cannot eyeball in one pass
  — usually a `prefers-reduced-motion` variant.
- A reviewer or user reports motion that "feels wrong" without naming
  a specific frame.
- The change touches code in [`rules/state-choreography.md`](./state-choreography.md)
  or [`rules/external-engines.md`](./external-engines.md).

Skip the loop for trivial CSS-only transitions on `transform` /
`opacity` that the eye can verify in one viewing — burning ~$0.02 per
analyser pass on a 200 ms fade is wasteful.

## The four-step cycle

```text
   ┌──────────────┐    Skill("screen-recorder")   ┌────────────────┐
   │  Build /     │ ─────────────────────────────▶│  .agent/       │
   │  edit anim.  │                               │  recordings/   │
   └──────┬───────┘                               │  <slug>.webm   │
          │                                       └────────┬───────┘
          │                                                │
          │              Skill("video-analyser",           ▼
          │                      <recording path>) ┌──────────────┐
          │                                        │  Structured  │
          │ ◀──────────────────────────────────────┤  findings    │
          │   Apply fix from "Recommended next     │  + next-     │
          │   steps" — return to Build (max 3×)    │  step list   │
          ▼                                        └──────────────┘
   ┌──────────────┐
   │  Ship the    │
   │  clip + diff │
   └──────────────┘
```

1. **Build / edit** — make the change.
2. **Record** — `Skill("screen-recorder")` (one default, one
   `reduced-motion: true`).
3. **Analyse** — `Skill("video-analyser")` with a contract-shaped goal.
4. **Iterate** — apply the analyser's top-priority "Recommended next
   step"; loop. Cap at 3 rounds.

## Recording inputs

The `screen-recorder` defaults are already tuned for the analyser
(`max-width: 768`, `keyint: 15`, `duration: 5000`). Pass only what is
animation-specific:

```json
{
  "url": "http://localhost:3000/<page>",
  "selector": "[data-testid=\"<animation-target>\"]",
  "interaction": "<recipe matching the trigger — hover | click | tab-to | scroll-into-view | idle | multi>",
  "output-name": "<animation-name>-default",
  "caller": "animations",
  "reduced-motion": false
}
```

Then record a second clip with `reduced-motion: true` and
`output-name: "<animation-name>-reduced"`.
Two recordings are mandatory for any `prefers-reduced-motion`-aware
animation — never ship a single-variant claim.

## Analyser goal — what to ask

The default goal in
[`video-analyser`](../../video-analyser/SKILL.md) is "identify bugs,
errors, UI state issues, and reproduction steps".
That is right for a bug report; it is **wrong** for animation
validation because it scores against a generic rubric.

Pass a **contract-shaped goal** that names the animation's invariants:

```text
USER_GOAL = "Verify the <animation name> animation.

Contract:
  - Total duration: <T> ms ± 50 ms.
  - Animated properties: <transform | opacity | filter>. Flag any
    frame where layout (`width`, `height`, `top`, `left`, `margin`,
    `padding`) appears to change.
  - Easing role: <ease-out | spring | bezier(x,y,x,y)>. Flag visible
    linear motion if the contract calls for ease-out.
  - At t > <T+100 ms> the element must be at its final state. Flag any
    frame past that point that shows an in-progress value.
  - Focus ring (if interaction is `tab-to` or `focus`): the ring must
    be visible from the first frame after focus through the final
    frame. Flag any frame where the ring is missing.
  - For the reduced-motion variant: any frame where the element
    transitions through intermediate `opacity` between 0.05 and 0.95
    is a defect (reduced-motion should be near-instant or a fade).

Return findings under the schema in your Step 9, prioritising violations
of the contract above over generic UI commentary."
```

Substitute the animation's actual numbers.
The analyser is more reliable when scored against a concrete contract
than against an open-ended "find any bugs" prompt.

## Iteration policy

| Round | Action                                                                                                                             |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Build → record default + reduced → analyse against contract.                                                                       |
| 2     | If analyser flags a contract violation, apply the top "Recommended next step" verbatim. Re-record only the variant that was flagged. |
| 3     | Same as round 2. If a *different* violation appears (i.e., the fix introduced a regression), record both variants — the regression matters. |
| 4     | **Stop and escalate.** Three rounds without a clean analyser pass means the model and the contract disagree. See "Escalation" below. |

Re-recording only the failed variant saves one analyser call per round
(~$0.019 on Sonnet 4.6).

## Escalation on round 4

If the analyser still flags violations after three iterations:

1. Surface all three iterations' findings side-by-side — the human
   reviewer needs to see whether the same violation persisted or
   whether each round introduced a new one.
2. Invoke `Skill("confidence", bug-analysis)` with:
   - The current animation code.
   - The contract from the analyser goal.
   - All three rounds of analyser findings.
3. If confidence < 70 %, halt and ask the user.
   If 70–89 %, apply the suggested next step but mark the change
   advisory. If ≥ 90 %, the analyser's confidence in the next step is
   high enough to apply unilaterally — go to round 4.

The single-shot fallback is intentional: an unconverged loop usually
means the *contract* is wrong, not the animation. Re-derive the
contract with the user before further rounds.

## Examples

### Good — View Transition contract

```text
Goal:
  Verify the search-page → detail-page View Transition. Contract:
    - Duration 350 ms ± 50 ms.
    - Only `transform` and `opacity` animate.
    - At t > 500 ms the destination view is fully opaque (no fade
      in-progress).
    - reduced-motion variant: ≤ 100 ms crossfade.

Findings round 1 (analyser):
  - Frame 3 (t≈180 ms): destination view's hero image at opacity 0.4
    while source view is still at opacity 0.6 — both visible
    simultaneously. Likely caused by overlapping ::view-transition
    pseudo-elements without `mix-blend-mode`.
  - Recommended next step: add
    `::view-transition-old(root) { mix-blend-mode: plus-lighter; }`.

Round 2: apply fix, re-record default only. Analyser: contract met.
Ship.
```

### Bad — open-ended goal

```text
Goal: "look for bugs in this video"

Findings:
  - "The page looks fine."
  - "There may be a slight flash at frame 2."
  - "Consider improving the loading spinner."

Result: three findings, none scored against the actual animation
contract. The "slight flash" may or may not be a real defect. The
iteration loop has nothing to act on.
```

**Fix:** every analyser call from this skill must include a
contract-shaped goal.

## Common mistakes

- **Single-variant recording.**
  Recording only the default variant when the animation has a
  `prefers-reduced-motion` branch.
  **Fix:** always record both; the analyser scores them independently.
- **Running the loop on a 200 ms fade.**
  Burns analyser tokens on something the human eye verified in one
  viewing.
  **Fix:** apply the "When the loop applies" gate above.
- **Generic analyser goal.**
  "Find bugs in this video" returns generic UI commentary, not
  contract violations.
  **Fix:** name the duration, the allowed properties, the easing role,
  the final-state assertion.
- **Looping past 3 rounds.**
  Diminishing returns; the analyser and the contract have already
  disagreed three times.
  **Fix:** escalate via `confidence(bug-analysis)`; re-derive the
  contract with the user if needed.
- **Overriding `max-width` to record at full viewport.**
  Doubles analyser cost (~$0.038) with no legibility gain on UI
  content.
  **Fix:** keep the 768 px default unless the analyser itself reports
  text-still-unreadable.
- **Forgetting to re-record after applying a fix.**
  Round-N analysis against a round-(N-1) recording is stale evidence.
  **Fix:** re-record before each analyser call; the recording is the
  evidence, not the diff.
