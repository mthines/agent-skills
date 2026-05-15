---
title: animations — Diagnostic Surface
impact: HIGH
tags:
  - diagnose
  - animations
  - meta
---

# animations — Diagnostic Surface

## Contents

- [Source root](#source-root)
- [Phase model](#phase-model)
- [Existing guards per phase](#existing-guards-per-phase)
- [Failure taxonomy](#failure-taxonomy)
- [Hard invariants](#hard-invariants)
- [Artifacts](#artifacts)
- [Validators](#validators)

---

This file declares the contract `/create-skill diagnose animations` reads to parameterize the generic Diagnose Mode procedure for this skill.
The contract spec lives at [`skills/create-skill/rules/diagnostic-surface.md`](../../create-skill/rules/diagnostic-surface.md).

---

## Source root

`skills/animations/`

---

## Phase model

`animations` is a 15-step workflow.
Steps walk in order; conditional entry phases (A, B) and sub-phases (5.5–5.8, 7.5–7.6) only fire when their trigger applies, but the diagnoser walks every row to attribute findings.

| Phase | Name                       | Rule file                                                                                                 | Gate                                                                                                                                                                                         |
| ----- | -------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A     | Brainstorm feedback        | [interaction-feedback.md](./interaction-feedback.md)                                                      | If entry is "what feedback?" (verb-shaped), the five-question brainstorm is answered and the catalog row selected; skipped if entry is "fade in"-shaped                                       |
| B     | Manage perceived performance | [perceived-performance.md](./perceived-performance.md)                                                  | If the animation surrounds an async wait, the wait-duration ladder is consulted (p75-measured); loader floor + sub-200 ms skip in place; skeletons match content shape; optimistic UI rolls back visibly |
| 0     | Choose the property        | [safe-properties.md](./safe-properties.md)                                                                | Animated property is `transform`, `opacity`, or `filter`; otherwise justified with a layout-thrash measurement                                                                               |
| 1     | Choose the pattern         | [patterns.md](./patterns.md)                                                                              | Pattern (fade, stagger, slide, scale) matches the user signal                                                                                                                                |
| 2     | Reach for modern CSS       | [modern-css.md](./modern-css.md)                                                                          | If the need is "entry from hidden", "height auto", "DOM swap", or "scroll-tied", a CSS-only path is chosen                                                                                   |
| 3     | Wire interactivity         | [interactive-effects.md](./interactive-effects.md)                                                        | Pointer / scroll / sensor values flow through CSS variables; `@property` used for typed interpolation                                                                                        |
| 4     | Time it                    | [timing-easing.md](./timing-easing.md)                                                                    | Duration in the 150–500 ms band for UI motion; easing is named (not `linear` unless intentional)                                                                                             |
| 5     | Decide CSS vs JS vs 3D     | [when-to-use-js.md](./when-to-use-js.md), [three-d.md](./three-d.md)                                      | Decision flow walked top-to-bottom, first match wins; Motion / R3F is opt-in, not default                                                                                                    |
| 5.5   | Choreograph state morphs   | [state-choreography.md](./state-choreography.md)                                                          | Pre-code planning checklist run; tool (Motion `layout` / `layoutId` / View Transitions) matches the change set; layout properties never animated directly                                    |
| 5.6   | Wire React state           | [react-state.md](./react-state.md)                                                                        | State location decided (component / lifted / URL / context); 60 fps values held in refs or `useMotionValue`; `AnimatePresence` mode picked; Strict Mode + RSC boundaries respected           |
| 5.7   | Add advanced effects       | [advanced-effects.md](./advanced-effects.md)                                                              | Glass / glow / hover-expand / aurora / 3D tilt use the cheap pattern (pseudo-element + opacity, not animated `box-shadow` / `backdrop-filter`); `prefers-contrast` fallback in place         |
| 5.8   | External engines           | [external-engines.md](./external-engines.md)                                                              | Lottie / dotLottie or Rive runtime is lazy-loaded, paused off-screen, gated on `prefers-reduced-motion` with a static poster fallback                                                        |
| 6     | Respect motion prefs       | [accessibility.md](./accessibility.md)                                                                    | `@media (prefers-reduced-motion: reduce)` block present and tested; state morphs follow the dedicated accessibility section in [state-choreography.md](./state-choreography.md)              |
| 7     | Measure                    | [debugging.md](./debugging.md)                                                                            | DevTools Performance shows 60 fps; no purple Layout / green Paint bars during animated frames                                                                                                |
| 7.5   | Record evidence (optional) | [record-and-iterate.md](./record-and-iterate.md), [screen-recorder skill](../../screen-recorder/SKILL.md) | For non-trivial animations or on user request: `Skill("screen-recorder")` invoked twice (default + `prefers-reduced-motion: true`); skipped silently if not installed                        |
| 7.6   | Analyse and iterate        | [record-and-iterate.md](./record-and-iterate.md), [video-analyser skill](../../video-analyser/SKILL.md)   | Recordings fed into `Skill("video-analyser")`; contradicting findings loop back to 7.5 (cap 3 iterations, escalate via `confidence(analysis)` on the 4th); skipped silently if not installed |

The decision flow in [`SKILL.md`](../SKILL.md#decision-flow) is a cross-cutting routing gate — it precedes Phase 5 and decides which downstream sub-phase (5.5 / 5.6 / 5.7 / 5.8) fires.
The diagnoser treats a wrong tool choice (e.g. Motion for a CSS-only hover) as a Phase 5 finding, not a sub-phase finding.

---

## Existing guards per phase

| Phase | Existing guards                                                                                                                                                                                                                                                                                                      | Typical gaps                                                                                                                                                                                                                                                               |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A     | Five-question brainstorm (verb / reversibility / initiator / source / affordance load); catalog rows for discrete actions, lifecycle, status, gestures, navigation; direction principle; intensity ladder                                                                                                            | Brainstorm skipped on "obvious" interactions; intensity rung two levels above stakes shipped; asymmetric in/out shapes (modal opens with scale, closes with slide)                                                                                                          |
| B     | Wait-duration ladder (< 100 ms → nothing; 100–300 ms → press-state only; 300 ms–1 s → skeleton or floored spinner; 1–3 s → skeleton + progress; 3–10 s → determinate progress; > 10 s → async-out); 200 ms loader floor + sub-200 ms skip; skeleton matches final shape; reserved dimensions; optimistic-UI rollback animation contract; predictive prefetch debounce; `prefers-reduced-motion` gates shimmer/pulse | Local-dev "felt fast" used in place of p75 measurement; spinner shown for < 200 ms causing flash-and-glitch; skeleton dimensions mismatch real content causing CLS on swap; optimistic UI snaps back silently on rejection; shimmer animates `background-position` (paint-heavy) at high contrast; loud shimmer cycle (< 1 s); prefetch fires per-hover with no debounce; `font-display: block` shipped |
| 0     | Composite-only allowlist (`transform` / `opacity` / `filter`); `will-change` discipline; layout-thrash measurement required for any other property                                                                                                                                                                   | Justification accepted on assertion alone (no measurement attached); registered `@property` driving a layout property slipped past                                                                                                                                         |
| 1     | Pattern catalog in [patterns.md](./patterns.md) matched to user signal                                                                                                                                                                                                                                               | Pattern chosen by name overlap (e.g. "slide" picked for a list reorder that wanted View Transitions)                                                                                                                                                                       |
| 2     | Modern-CSS primitive catalog (`@starting-style`, `transition-behavior: allow-discrete`, `interpolate-size`, View Transitions, scroll/view timelines)                                                                                                                                                                 | Reached for Motion when `@starting-style` + `allow-discrete` would have shipped without a library                                                                                                                                                                          |
| 3     | CSS-variable flow for per-pointer / per-frame values; `@property` for typed interpolation; class toggles reserved for lifecycle state                                                                                                                                                                                | Unregistered custom property animated and snapped instead of interpolating; per-frame value pushed into React state                                                                                                                                                        |
| 4     | 150–500 ms duration band for UI; named easing curve enforced; `linear` flagged unless intentional                                                                                                                                                                                                                    | Duration tuned outside the band without rationale; named easing replaced by `transition: all` regression                                                                                                                                                                   |
| 5     | Top-to-bottom decision flow (rows 1–12); first match wins; lower-numbered row preferred on ties; GSAP and `framer-motion` explicitly excluded                                                                                                                                                                        | Two rows matched and the higher-numbered (more dependencies) won; `framer-motion` import sneaked in via stale snippet                                                                                                                                                      |
| 5.5   | Pre-code planning checklist; cataloged change set (list ↔ cards, full ↔ icon-only nav, grid ↔ detail, tab pill); layout-property direct animation refused; FLIP transit window guarded against parent clip masks (`overflow: hidden` / `clip-path` / `contain: paint` deferred until `onLayoutAnimationComplete`) | Checklist skipped on "small morph"; chosen `layoutId` mismatch caused unmount/remount instead of morph; layout properties animated via shorthand; parent `overflow: hidden` left on during the morph so FLIP children vanish mid-flight (see `F-flip-clipped-by-overflow`) |
| 5.6   | State location decision tree (component / lifted / URL / context); 60 fps values in refs or `useMotionValue`; `AnimatePresence` mode picked; RSC boundaries                                                                                                                                                          | 60 fps value held in `useState` causing render storm; `AnimatePresence` `mode="popLayout"` chosen when `"wait"` was correct; Strict-Mode regression                                                                                                                        |
| 5.7   | Cheap-pattern catalog (pseudo-element + opacity for glow, not animated `box-shadow` / `backdrop-filter`); `prefers-contrast` + `prefers-reduced-motion` fallbacks                                                                                                                                                    | Animated `box-shadow` shipped; `backdrop-filter` cross-faded causing paint storm; `prefers-contrast` fallback missing                                                                                                                                                      |
| 5.8   | Lazy-loaded runtime; paused off-screen; `prefers-reduced-motion` gate; static poster fallback                                                                                                                                                                                                                        | Lottie player loaded eagerly on first paint; Rive runtime running off-screen burning battery; poster fallback skipped                                                                                                                                                      |
| 6     | `@media (prefers-reduced-motion: reduce)` block present + tested; state-morph accessibility section in [state-choreography.md](./state-choreography.md)                                                                                                                                                              | `prefers-reduced-motion` branch present but identical to default (no actual reduction); focus ring dropped during morph; keyboard order changed                                                                                                                            |
| 7     | DevTools Performance capture; 60 fps check; absence of purple Layout / green Paint bars                                                                                                                                                                                                                              | Capture done on local dev server with cache hot, missing real-world frame budget; "felt smooth" accepted instead of measurement                                                                                                                                            |
| 7.5   | Two-recording handshake (default + `prefers-reduced-motion`); analyser-optimal `max-width: 768` and `keyint: 15` defaults; `caller: "animations"` handshake                                                                                                                                                          | Only one recording captured (default branch); recording skipped on a non-trivial animation because trigger condition was read too narrowly                                                                                                                                 |
| 7.6   | `video-analyser` structured findings (errors, UI state at key frames, recommended next steps); 3-iteration cap; `confidence(analysis)` escalation on 4th                                                                                                                                                             | Loop exited at iteration 3 without escalation; analyser finding contradicted contract but was treated as advisory                                                                                                                                                          |

The matrix is not exhaustive — when a real failure exposes a guard not listed here, add it as part of a confidence-gated, user-approved diagnosis.

---

## Failure taxonomy

| ID                         | Class                                   | Symptom                                                                                                                                                                                                                                                      | Primary phase | Primary gate / companion                                                                                    |
| -------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | ----------------------------------------------------------------------------------------------------------- |
| F-novel                    | Novel mode                              | Does not match any existing row                                                                                                                                                                                                                              | —             | Diagnosis proposes a new row inline (added on user approval only)                                           |
| F-flip-clipped-by-overflow | FLIP transit clipped by parent overflow | Motion `layout` children visibly vanish for the duration of the spring, then "pop in" at the end. Parent has `overflow: hidden` (or `clip-path` / `contain: paint`) while `isAnimating`; child FLIP transforms pass through positions outside the clip rect. | 5.5           | `state-choreography.md` `Common mistakes` (clip-mask bullet) + `Performance pitfalls` (FLIP transit window) |

The taxonomy is **append-only** and intentionally seeded with `F-novel` only.
Speculative categories were not pre-populated — they push the diagnoser toward forcing a match where none exists.
Real-world failure classes (e.g. "layout property animated via shorthand", "`@property` snap", "`framer-motion` import regression", "missing `prefers-reduced-motion` branch", "wrong tool from decision flow") will be added as confidence-gated, user-approved diagnoses produce them.

---

## Hard invariants

The diagnoser must not propose to relax any of these without explicit user confirmation:

- **Composite-only animation.** Only `transform`, `opacity`, `filter`, or a `@property`-registered custom property that drives one of those, may be animated on the hot path. Anything else requires a layout-thrash measurement that justifies the cost.
- **`will-change` is a scalpel.** Applied just before the animation and removed right after; never on idle elements; never on more than a handful of nodes at once.
- **`prefers-reduced-motion` is non-removable.** Every shipped animation has a `@media (prefers-reduced-motion: reduce)` branch. The reduced branch may fade or snap, but it never strips feedback entirely.
- **Decision flow is authoritative.** The 12-row table in [`SKILL.md`](../SKILL.md#decision-flow) is walked top-to-bottom, first match wins; on ties the lower-numbered row wins. Diagnoses may not propose to skip the flow.
- **GSAP and `framer-motion` are out.** GSAP is excluded from the decision flow on purpose (Motion's hybrid engine subsumes it at smaller bundle size). `framer-motion` is unmaintained — new code uses `motion` (`motion/react`). Diagnoses may not re-introduce either.
- **State-choreography planning checklist is mandatory.** Phase 5.5 never runs without first walking the pre-code checklist in [`state-choreography.md`](./state-choreography.md). Skipping it is the most common cause of `layoutId` mismatches.
- **Layout properties are never animated directly during a state morph.** Phase 5.5 routes through Motion `layout` / `layoutId` or View Transitions; direct animation of `width` / `height` / `top` / `left` is refused.
- **External-engine runtimes are lazy-loaded and pausable.** Lottie / dotLottie and Rive runtimes never load on first paint and never run off-screen. Diagnoses may not propose eager loading "for simplicity."
- **Phase 7 measurement is real.** Performance is verified in DevTools (or equivalent), not by inspection. "Felt smooth" is not a pass condition.
- **`screen-recorder` and `video-analyser` companions degrade silently.** Phases 7.5 and 7.6 skip if the companions are not installed; they never block. The two-recording handshake (default + `prefers-reduced-motion: true`) is mandatory when 7.5 fires.
- **Phase 7.6 iteration cap is load-bearing.** The record → analyse → fix loop is capped at 3 iterations; the 4th must escalate via `Skill("confidence", "analysis")`. Raising the cap requires updating [`record-and-iterate.md`](./record-and-iterate.md) and this surface in the same change.

---

## Artifacts

| File pattern                                                          | Produced by                 | When                                                                              |
| --------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------- |
| Source diff (CSS / JS / TSX edits in the user's repo)                 | The skill itself            | Phases 0–6                                                                        |
| DevTools Performance trace (referenced, not stored)                   | The user / Phase 7          | Phase 7 (measurement gate)                                                        |
| `.agent/recordings/{output-name}.{webm,mp4,gif}` (default branch)     | `screen-recorder` companion | Phase 7.5 (first call: `reduced-motion: false`)                                   |
| `.agent/recordings/{output-name}--reduced-motion.{webm,mp4,gif}`      | `screen-recorder` companion | Phase 7.5 (second call: `reduced-motion: true`)                                   |
| Structured analyser findings (errors, key-frame UI state, next steps) | `video-analyser` companion  | Phase 7.6 (consumed in-loop; persisted only if the analyser writes a report file) |
| `confidence(analysis)` evaluation                                     | `confidence` skill          | Phase 7.6 4th-iteration escalation only                                           |

The skill produces no orchestration artifact of its own (no `plan.md`, no ledger).
Diagnoses against animations runs rely primarily on the **source diff** plus any recordings produced by Phase 7.5.
A run that skipped Phase 7.5 has a thinner evidence trail and the report should call that out as a contributing factor.

---

## Validators

- `claude plugin validate skills/animations` — frontmatter + structure check.
- Re-run the failing scenario in DevTools Performance on the diagnosed branch — confirms the proposed change still hits 60 fps with no purple Layout / green Paint bars.
- Toggle `prefers-reduced-motion` in DevTools Rendering and re-verify — confirms the reduced branch still exists and still produces visible (but reduced) feedback.
- If Phase 7.5 was in scope, re-run `Skill("screen-recorder")` with the same `output-name` and diff the recording against the pre-diagnosis artifact — confirms the change did not introduce regressions in adjacent frames.
