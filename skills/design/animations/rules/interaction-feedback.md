---
title: Interaction Feedback — From Verb to Motion
impact: HIGH
tags:
  - brainstorm
  - feedback
  - microinteractions
  - affordance
  - interaction-design
---

# Interaction Feedback

Use this rule when the user describes an **interaction** ("what should happen when I press this button?", "how should closing a card feel?", "what's the natural feedback when a user toggles this?") instead of an **animation primitive** ("make this fade in", "stagger these"). It answers the prior question — *which* animation, *which* duration, *which* easing — before the rest of the skill picks *how* to implement it.

The catalog below maps common interactions to their natural feedback. The brainstorm framework below the catalog handles cases not in the catalog.

## Contents

- Brainstorm framework — five questions before you pick
- Catalog — interaction → recommended feedback
- Direction principle — motion should mirror the verb
- Intensity ladder — when to amplify, when to mute
- Multi-modal feedback — visual + haptic + sound
- Common mistakes

---

## Brainstorm framework

Before answering "what feedback should this have?", answer these five questions. The answers narrow the choice to one or two options from the catalog.

1. **What's the verb?** Press, open, close, dismiss, confirm, cancel, select, drag, drop, swap, expand, collapse, delete, save, load. The verb dictates the *shape* of motion (scale, translate, fade, morph) more than any other signal.
2. **Reversible or terminal?** A toggle reverses; a delete does not. Reversible actions get **symmetric** in/out motion (same shape, exit ~30 % faster). Terminal actions get **asymmetric** feedback — usually a brief settle plus a state confirmation (toast, list collapse).
3. **Who initiated it?** Direct user gesture (tap, drag, click) → immediate response, sub-100 ms. System or async event (notification arriving, data refreshing) → slower onset (200–400 ms) and gentler easing so it does not startle.
4. **Where is the spatial source?** Did the action originate from a point on screen (a tapped button, a dragged card edge, a clicked menu trigger)? Motion should radiate from that point or settle toward it. Modal opens from a button → scale + translate **from the button's position**, not the screen center.
5. **What's the affordance load?** Is the feedback *teaching* the user something (this is destructive, this saved successfully, you can swipe further) or just *confirming* (your tap registered)? Teaching feedback runs longer (250–500 ms) and may layer (motion + color + icon swap). Confirmation feedback stays under 200 ms and uses one property.

If two interactions share the same five answers, give them the same motion. Inconsistency is the bigger cost than imperfect choice.

---

## Catalog

Pick the row that matches the interaction. The "Animate" column lists the property; the "Why" column states the principle the choice is grounded in.

### Discrete actions (single-shot input)

| Interaction                  | Recommended feedback                                                                                  | Duration   | Easing                 | Animate                              | Why                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- | ---------- | ---------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| **Primary button press**     | `transform: scale(0.97)` on `:active`; settle back to `scale(1)` on release                           | 80–120 ms  | `ease-out`             | `transform`                          | Tactile confirmation; mimics physical depression. Sub-100 ms reads as instant.                       |
| **Destructive button press** | Same as primary press + brief background tint shift (e.g. red → darker red) over 100 ms on release    | 100–160 ms | `ease-out`             | `transform`, `background-color`      | Adds a "weight" beat that primes the user for an undo affordance.                                    |
| **Icon button press**        | `opacity` from 1 → 0.7 → 1 on tap; optional 0.96 scale                                                 | 100 ms     | `ease-out`             | `opacity` (+ `transform`)            | Icon buttons are smaller than text — opacity reads as press even without scale.                      |
| **Submit button (success)**  | Press scale + cross-fade label → checkmark icon; auto-revert after ~1 s                                | 200–300 ms | `ease-out`             | `opacity` on label/icon              | Inline confirmation removes the need for a separate toast for low-stakes saves.                      |
| **Submit button (loading)**  | Press scale + cross-fade label → spinner; **minimum 200 ms** visible even if request is faster        | 200 ms min | `ease-out`             | `opacity` on label/spinner           | Sub-200 ms spinner flashes look broken; enforce a floor.                                              |
| **Toggle / switch flip**     | Thumb translates between ends; track color cross-fades                                                | 150–200 ms | `cubic-bezier(0.2, 0.8, 0.2, 1)` | `transform` on thumb, `background-color` on track | Thumb travel + color is the universal toggle vocabulary (iOS, Material, Web).                        |
| **Checkbox check**           | Cross-fade or stroke-draw the checkmark; optional 1.1 → 1.0 box scale "pop"                            | 160–240 ms | `ease-out`             | `opacity` on glyph, `transform` on box | Stroke draw via SVG `stroke-dashoffset` is GPU-cheap when wrapped in a `transform`-only layer.       |
| **Radio select**             | Cross-fade the filled dot in; deselect the previous in parallel                                       | 160 ms     | `ease-out`             | `opacity`, `transform: scale`        | The pair is one beat, not two — animate concurrently.                                                 |
| **Copy to clipboard**        | Cross-fade icon → checkmark; auto-revert after ~1.5 s                                                  | 200 ms     | `ease-out`             | `opacity`                            | Confirms the click landed without stealing focus or covering content.                                 |

### Element lifecycle

| Interaction                       | Recommended feedback                                                                                     | Duration   | Easing                       | Animate                                | Why                                                                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Card opens from a trigger**     | Scale 0.96 → 1.0 with `transform-origin` set to the trigger position; opacity 0 → 1                       | 200–280 ms | `cubic-bezier(0.2, 0.8, 0.2, 1)` | `transform`, `opacity`                 | Origin anchored to the source teaches the user where the card came from.                                           |
| **Card closes (dismiss)**         | Inverse of open: scale 1 → 0.96, opacity 1 → 0; **exit ~30 % faster** than open                          | 160–200 ms | `ease-in`                    | `transform`, `opacity`                 | Symmetric reversal preserves the spatial memory; quicker exit respects the user's onward intent.                   |
| **Card closes (delete)**          | Slide out horizontally (200 ms) → height collapse to 0 (180 ms) on the row; siblings reflow              | 380 ms     | `ease-in` then `ease-out`    | `transform: translateX`, then `height` or Motion `layout` | Two-beat motion — "this item is leaving" then "the list rearranges". Use Motion `layout` to avoid hand-rolled height. |
| **Card swipe-to-dismiss**         | Card follows the finger (`transform: translateX`); threshold passed → continues off-screen; below → springs back | follow + 200–280 ms | `ease-out` (return), `ease-in` (commit) | `transform: translateX`, `opacity` | The follow is the affordance. The springback is the "you didn't commit" signal.                                    |
| **Notification appears (toast)**  | Slide in from screen edge + fade in                                                                       | 200–280 ms | `cubic-bezier(0.2, 0.8, 0.2, 1)` | `transform: translateY/X`, `opacity`   | Slide from edge teaches where future toasts will come from.                                                        |
| **Notification dismisses**        | Slide out the same edge + fade out; faster than entry                                                     | 160–200 ms | `ease-in`                    | `transform`, `opacity`                 | Reversing the entry vector preserves spatial logic.                                                                |
| **Tooltip show**                  | Scale 0.96 → 1 + fade in; anchor `transform-origin` to the trigger side                                   | 120–160 ms | `ease-out`                   | `transform`, `opacity`                 | Tooltips must feel "summoned by hover" — short, anchored, no bounce.                                               |
| **Tooltip hide**                  | Fade out only (no scale-down)                                                                             | 100–140 ms | `ease-in`                    | `opacity`                              | Scale-down on hide looks like a broken open; fade is cleaner.                                                       |
| **Modal opens**                   | Backdrop fades in (200 ms); panel scales 0.96 → 1 + fades in (240–320 ms); origin = trigger if known      | 240–320 ms | `cubic-bezier(0.2, 0.8, 0.2, 1)` | `opacity` on backdrop, `transform` + `opacity` on panel | Two-layer choreography: context dims first, then panel commits.                                                   |
| **Modal closes**                  | Panel scales 1 → 0.96 + fades out (180 ms); backdrop fades out (200 ms) starting slightly later           | 200 ms     | `ease-in`                    | `transform`, `opacity`                 | Panel leaves first so the user's eye is released before the context returns.                                       |
| **Drawer / side-sheet opens**     | Slide in from edge via `transform: translateX(-100%)` → `translateX(0)`                                   | 280–360 ms | `cubic-bezier(0.2, 0.8, 0.2, 1)` | `transform: translateX`                | Slide preserves the "this comes from off-screen" mental model — fade alone reads as appearing magically.            |
| **Drawer / side-sheet closes**    | Reverse the slide                                                                                         | 220–280 ms | `ease-in`                    | `transform: translateX`                | Symmetric exit; ~30 % faster than entry.                                                                            |
| **Item added to a list**          | Slot opens via `height: auto` (use `interpolate-size` or Motion `layout`); item fades + slides in         | 280–360 ms | `cubic-bezier(0.2, 0.8, 0.2, 1)` | `transform`, `opacity`; `layout` for the height | Layout shift is the most disorienting motion in UI — having the slot open first prevents the eye from losing its place. |
| **Item removed from a list**      | Item fades + slides out; slot collapses                                                                   | 260–320 ms | `ease-in`                    | `transform`, `opacity`; `layout` for the height | Item must finish leaving before the slot collapses, otherwise it looks "yanked".                                   |

### Status & feedback states

| Interaction                       | Recommended feedback                                                                                  | Duration         | Easing                   | Animate                                 | Why                                                                                                     |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------- | ------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Skeleton → content**            | Cross-fade skeleton out + content in; **do not** scale-pop the content                                | 200–280 ms       | `ease-out`               | `opacity`                               | Scaling content in reads as "fake polish"; a clean cross-fade respects the user's attention.            |
| **Inline success**                | Brief background tint flash (green at ~30 % opacity → 0) over 600 ms                                  | 600 ms           | `ease-out`               | `background-color` via pseudo-element   | Use a pseudo-element overlay so the host's `background-color` is untouched.                             |
| **Inline error**                  | Horizontal shake: `translateX` ±4 px three times; brief red border                                    | 320 ms total     | `ease-in-out` per cycle  | `transform: translateX`, `border-color` | The shake reads "you can't do this" without an alert. Cap at 3 cycles to avoid epileptic risk.          |
| **Loading (indeterminate)**       | Looping shimmer or spinner; min visibility 200 ms even if request is faster                            | loop             | `linear`                 | `transform: translateX` or rotation     | `linear` is correct here — the motion is continuous, not gestural.                                      |
| **Loading (determinate)**         | Progress bar `scaleX` from 0 → 1; optionally pulse the bar's color                                    | tied to progress | `linear`                 | `transform: scaleX`                     | `scaleX` with `transform-origin: left` is the GPU-cheap progress bar.                                   |
| **Empty state**                   | Single fade-in of the illustration + copy on first render; no looping motion                          | 280–400 ms       | `ease-out`               | `opacity`                               | A static empty state is restful; looping motion turns empty into "broken".                              |

### Continuous gestures

| Interaction                | Recommended feedback                                                                                  | Duration         | Easing                                 | Animate                              | Why                                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------- | -------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| **Drag start**             | Item lifts: scale 1 → 1.04 + shadow opacity 0 → 0.2 (via pseudo-element)                              | 120 ms           | `ease-out`                             | `transform`, pseudo-element opacity  | Lift teaches "this is now grabbable"; shadow is the depth cue.                                     |
| **Drag move**              | Item follows pointer (`transform: translate`); use `useMotionValue` not state for 60 fps              | continuous       | none (follow)                          | `transform: translate`               | Anything that re-renders per pointer move will jank. See [`react-state.md`](./react-state.md).      |
| **Drop (committed)**       | Spring settle to the new slot; siblings reflow via `layout`                                           | 280–400 ms       | spring (stiffness 300, damping 24)     | `transform`                          | The spring is the "landed" beat — fixed curves feel mechanical for a drop.                         |
| **Drop (cancelled)**       | Spring back to origin                                                                                  | 280–400 ms       | spring (same)                          | `transform`                          | Returning to origin = "didn't commit". Identical motion to commit, opposite vector.                |
| **Pull-to-refresh**        | Content translates down with the gesture; release past threshold → spinner + commit                   | follow + 240 ms  | `ease-out` (commit)                    | `transform: translateY`              | Continuous gesture + discrete confirm — the spinner is the affordance change.                       |
| **Hover reveal**           | Fade in the revealed layer via pseudo-element `opacity`                                               | 120–180 ms       | `ease-out`                             | `opacity` on pseudo-element          | Animating the host's `box-shadow` or `backdrop-filter` is paint-heavy. See [`advanced-effects.md`](./advanced-effects.md). |
| **Pinch-to-zoom**          | Live `transform: scale` follow; rubber-band beyond bounds                                              | follow + 200 ms  | spring on release                      | `transform: scale`                   | Rubber-band is the "you're past the edge" signal.                                                  |

### Navigation

| Interaction                  | Recommended feedback                                                                                | Duration     | Easing                       | Animate                              | Why                                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------- | ------------ | ---------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| **Tab switch**               | Pill slides between tabs (Motion `layout` or `layoutId`); content cross-fades                       | 200–280 ms   | `cubic-bezier(0.2, 0.8, 0.2, 1)` | `transform`, `opacity`               | Pill morph teaches "same control, different state"; cross-fade prevents content flash.              |
| **Route change (SPA)**       | View Transitions API; crossfade old → new with `view-transition-name` on shared elements            | 280–360 ms   | `cubic-bezier(0.2, 0.8, 0.2, 1)` | view-transition pseudo-elements      | Native VT runs on the compositor; manual fade-and-swap with `setTimeout` is the anti-pattern.       |
| **Accordion expand**         | `height: auto` morph (use `interpolate-size` or Motion `layout`); content fades in                  | 240–320 ms   | `cubic-bezier(0.2, 0.8, 0.2, 1)` | `height` (via `interpolate-size`), `opacity` | Animating raw `height` is layout work; `interpolate-size` opts into native compositor support.      |
| **Accordion collapse**       | Inverse; faster than expand                                                                          | 200 ms       | `ease-in`                    | same                                 | Faster close respects the user's intent to move on.                                                |
| **Step forward (wizard)**    | Slide current view out left + new view in right                                                      | 280 ms       | `cubic-bezier(0.2, 0.8, 0.2, 1)` | `transform: translateX`              | Direction = progress. Reverse for back.                                                            |
| **Step back (wizard)**       | Slide current view out right + previous view in left                                                 | 280 ms       | `cubic-bezier(0.2, 0.8, 0.2, 1)` | `transform: translateX`              | Reversing the entry vector reinforces direction.                                                   |

---

## Direction principle — motion should mirror the verb

Match the **motion vector** to the **interaction's semantic direction**:

- **Open / appear** → from the trigger (scale up from origin, slide from edge it's anchored to).
- **Close / disappear** → toward the trigger or off-screen (scale down toward origin, slide to edge).
- **Confirm / save** → forward, settled, with a "land" cue (slight scale settle, color tint).
- **Cancel / undo** → reverse, fast, no settle.
- **Delete / destroy** → away (slide off, collapse).
- **Create / add** → into place (slot opens first, then item lands).
- **Select** → toward (scale up slightly, color fill in).
- **Deselect** → release (scale to 1, color fill out).
- **Drag** → follow pointer; gravity-like settle on release.
- **Forward / next** → motion to the leading edge (LTR users: right; RTL: left).
- **Back / previous** → motion to the trailing edge.

When in doubt, ask: *"Where is this thing going, conceptually?"* — then animate it there.

---

## Intensity ladder

Not every interaction needs the same volume of feedback. Pick the rung that matches the stakes.

| Rung   | Use for                                                | Pattern                                                          | Duration   |
| ------ | ------------------------------------------------------ | ---------------------------------------------------------------- | ---------- |
| **1**  | High-frequency, low-stakes (hover, button press, focus) | Single property change, one beat                                  | 80–160 ms  |
| **2**  | State toggles (switch, tab, accordion)                  | One element morphs; siblings unchanged                            | 160–280 ms |
| **3**  | Modal-class openings (popover, drawer, dialog)          | Two-property morph (transform + opacity); origin anchored         | 200–360 ms |
| **4**  | Layout reflows (list add / remove, sort)                 | `layout` or View Transitions; two-beat (layout settle → content) | 280–400 ms |
| **5**  | Hero moments (route change, splash, big reveal)         | Multi-element choreography; lead-and-follow                      | 350–700 ms |

**Rule of thumb:** if a feedback rung is two levels above the stakes of the interaction, it feels over-designed. A toggle on rung 4 looks broken; a route change on rung 1 looks abrupt.

---

## Multi-modal feedback — visual + haptic + sound

Animation is one channel; for high-stakes interactions, layer it with others:

- **Haptic** (mobile only — `navigator.vibrate` on web, native APIs on Expo / RN). Match the haptic *length* to the visual *duration*: a 10 ms tap for press, a 20–40 ms confirmation buzz for commit. Never haptic-only for accessibility — sighted feedback must lead.
- **Sound** (rare on web; common in native). Use for *terminal* actions (delete, send) and *async-arrival* (notification). Avoid for high-frequency actions (typing, scrolling).
- **Color** — pair with motion, not instead of it. A success tint without motion reads as "nothing happened, but green"; with a fade or scale, it reads as confirmation.
- **Sound + haptic + visual** together is reserved for the *single most important moment in the flow* (payment success, sent message). Anything more frequent fatigues fast.

For `prefers-reduced-motion`: keep haptics and color, mute the motion. For `prefers-reduced-transparency`: mute glass / backdrop effects. See [`accessibility.md`](./accessibility.md).

---

## Examples

### Good — closing a card that was opened from a trigger button

```tsx
import { motion, AnimatePresence } from "motion/react";

<AnimatePresence>
  {open && (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{
        opacity: { duration: 0.24, ease: [0.2, 0.8, 0.2, 1] },
        scale: { duration: 0.24, ease: [0.2, 0.8, 0.2, 1] },
      }}
      style={{ transformOrigin: triggerPosition }}
    >
      …
    </motion.div>
  )}
</AnimatePresence>
```

Open and close use the **same shape** (scale + opacity) so the user reads them as paired. `transformOrigin` is anchored to the trigger so the card visibly comes from and returns to its source.

### Good — primary button press

```css
.button {
  transition: transform 100ms ease-out;
}
.button:active {
  transform: scale(0.97);
}
```

Three lines. Under 100 ms. `transform` only — composites on the GPU.

### Bad — over-animating a toggle

```tsx
<motion.div
  initial={{ rotate: -180, scale: 0 }}
  animate={{ rotate: 0, scale: 1 }}
  transition={{ type: "spring", stiffness: 100, damping: 8 }}
/>
```

A switch toggle is rung 2 — single-property morph at 160–200 ms. A spring with low damping introduces a bounce that fatigues at the dozens-per-session frequency of toggles.

### Bad — delete that vanishes instantly

```css
.row.deleting {
  display: none;
}
```

Deletion is rung 4 — slot collapse + item exit, two beats. Snap-to-`display: none` strips the user's spatial trail and re-flows the list under their cursor.

---

## Common mistakes

- **Picking the animation before answering the five brainstorm questions.** You end up with the wrong shape (fade where slide was needed, spring where curve was needed). **Fix:** answer verb / reversibility / initiator / source / affordance load first.
- **Asymmetric open/close that uses different *shapes*.** A modal that opens with scale and closes with slide reads as broken. **Fix:** same shape, faster exit. Symmetry is a feature.
- **Hero-grade animation on micro-interactions.** A 500 ms toggle, a 700 ms button press. **Fix:** intensity ladder — pick the rung that matches the stakes.
- **Layout shift without a beat for the layout.** Item slides out, list snaps to its new height in the same frame. **Fix:** two-beat — item leaves, *then* the slot collapses. Use Motion `layout` to get this for free.
- **Forgetting `transform-origin` on opens.** A modal triggered from a top-right button that scales up from screen center loses the spatial connection. **Fix:** anchor origin to the trigger position.
- **Loading spinner that flashes under 200 ms.** Looks broken on fast networks. **Fix:** enforce a 200 ms minimum visible duration with a setter timeout, or skip the spinner entirely for sub-200 ms operations.
- **Stacking haptic + sound + motion + color on every interaction.** Sensory fatigue. **Fix:** reserve full-stack multi-modal feedback for the single most important moment in the flow.
