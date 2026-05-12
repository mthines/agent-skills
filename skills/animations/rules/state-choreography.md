---
title: State Choreography — Animating Between Structurally Different Layouts
impact: HIGH
tags:
  - layout-animation
  - shared-element
  - motion-layout
  - view-transitions
  - flip
  - planning
---

# State Choreography

Animations **between two structurally different visual states**: a
vertical **list** becomes a deck of **stacked cards**, a **text + icon
nav** collapses to **icon-only**, a **card in a grid** becomes a
**full detail view**, a pill **slides between tabs**.

The naive implementation breaks — the layout properties involved
(`width`, `height`, `grid-template-*`, `flex-direction`) all trigger
reflow. The platform answer is **FLIP**: measure both layouts, animate
only `transform` + `opacity` between them. The library answer is to
declare *which* element is the same across the swap and let the
framework do FLIP for you.

## Contents

- **Plan before you code** — mandatory checklist
- Decision flow — pick the right tool
- Recipe 1 — list → stacked cards (Motion `layout`)
- Recipe 2 — full nav → icon-only nav (Motion `layout` + width morph)
- Recipe 3 — card grid → detail view (shared element with `layoutId`)
- Recipe 4 — same-page DOM swap (View Transitions, no library)
- Performance pitfalls
- Accessibility — the rules for big morphs
- Common mistakes

---

## Plan before you code

State choreography is where animations break most often — the layout
*actually* changes between states. **Walk this checklist before
writing any code.** If any step has an unclear answer, **stop and
ask the user** rather than guessing.

1. **Name State A and State B** — one sentence each.
   *"Vertical list of cards"* → *"Deck of overlapping cards pinned
   to one spot."*
2. **Catalogue what changes** — per element: position, size,
   content (text / image / child count), container (parent flex
   direction or grid), decorations (radius, shadow, background).
   Decorations should match across states unless the change is
   deliberate.
3. **Decide element identity** — which elements are *the same*
   across A and B? Each gets one `layoutId` (Motion) or matching
   `view-transition-name` (View Transitions).
4. **Tag entries and exits** — what's new in B? what disappears
   from A? Those go in `AnimatePresence` with `initial` / `exit`.
5. **Pick a timing model** — exactly one:
   - **Simultaneous** — fastest; chaotic with many items.
   - **Layered** — content fades out → layout settles → content
     fades in. Calm; ~3× duration of simultaneous.
   - **Lead-and-follow** — one element starts, others stagger.
     Most narrative; reserve for hero morphs.
6. **Pick spring or curve** — springs for organic settles
   (lists, drag-release); fixed `cubic-bezier` for routes and
   known-distance moves. See [`timing-easing.md`](./timing-easing.md).
7. **Map accessibility risks** — for each, decide the mitigation:
   - Any element travels > ~30 % of viewport? → `prefers-reduced-motion`
     branch must cut the travel.
   - User focused / reading on something about to move? → focus
     plan + `aria-live` plan.
   - Any element loses its visible label? → `aria-label` plan.
8. **Pick the tool** — use the decision flow below.
9. **Open questions for the user** — anything ambiguous (*"rotate
   or just translate?"*, *"who keeps focus?"*, *"click-triggered or
   route-triggered?"*) goes back to the user **before** code.

A two-minute plan saves an hour of refactoring.

> **React state for the morph.** Once the visual plan is locked,
> decide where state lives, how transitions are triggered, and how
> to keep React re-renders out of the way — see
> [`react-state.md`](./react-state.md).

---

## Decision flow

Walk in order. First match wins.

| #  | Signal                                                                                          | Tool                                                                            |
| -- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1  | Same elements, container layout changes (list → cards, row → column, grid reflow)               | **Motion `layout`** on each child                                                |
| 2  | Element moves *between* containers or the rendered tree (active tab pill, drag-and-drop reorder) | **Motion `layoutId`**                                                            |
| 3  | Element is preserved across a route / page swap (thumbnail → hero on the next page)             | **View Transitions** with `view-transition-name` (or `layoutId` if SPA-only)    |
| 4  | One element resizes between widths or heights (sidebar collapse, drawer)                        | `interpolate-size` (Chromium) or Motion `layout`                                  |
| 5  | No React in the project                                                                          | **FLIP via WAAPI** (the manual version, see [`when-to-use-js.md`](./when-to-use-js.md)) |
| 6  | The morph is a same-page DOM swap with a default crossfade                                       | **View Transitions** (`document.startViewTransition`)                            |

Motion's `layout` prop is FLIP under the hood — runs on the compositor,
no manual `getBoundingClientRect` arithmetic.

---

## Recipe 1 — List → stacked cards

```tsx
'use client';
import { motion, LayoutGroup } from 'motion/react';
import { useState } from 'react';

type Item = { id: string; title: string; body: string };

export function ListToCards({ items }: { items: Item[] }) {
  const [view, setView] = useState<'list' | 'stack'>('list');

  return (
    <LayoutGroup>
      <button onClick={() => setView(view === 'list' ? 'stack' : 'list')}>
        {view === 'list' ? 'Stack' : 'Unstack'}
      </button>

      <div className={view === 'list' ? 'list' : 'stack'}>
        {items.map((item, i) => (
          <motion.article
            key={item.id}
            layout
            layoutId={item.id}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            className="card"
            style={
              view === 'stack'
                ? {
                    position: 'absolute',
                    top: i * 12,
                    left: i * 4,
                    rotate: `${(i - items.length / 2) * 1.5}deg`,
                    zIndex: items.length - i,
                  }
                : {}
            }
          >
            <h3>{item.title}</h3>
            <p>{item.body}</p>
          </motion.article>
        ))}
      </div>
    </LayoutGroup>
  );
}
```

`.list` is a vertical grid, `.stack` is `position: relative` with
absolute children — switching the container class re-flows everything,
and `layout` on each card animates the position / size change via
FLIP. `LayoutGroup` synchronises children so they choreograph as one.
The stable `key` keeps the React node identity → Motion can measure
before and after. For layout morphs prefer springs over fixed-duration
curves; elements *settle* into the new layout rather than arriving on
a clock.

## Recipe 2 — Full nav → icon-only nav

A horizontal nav with icons + text labels that collapses to just
icons. The hard parts are (a) animating each item's width from
"icon + 12 px + label" to "icon only", and (b) keeping the icons
locked in place while the label fades out.

```tsx
'use client';
import { motion, AnimatePresence } from 'motion/react';

type NavItem = { id: string; icon: React.ReactNode; label: string; href: string };

interface NavProps {
  items: NavItem[];
  collapsed: boolean;
}

export function CollapsibleNav({ items, collapsed }: NavProps) {
  return (
    <motion.nav
      layout
      className="nav"
      data-collapsed={collapsed}
      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
    >
      {items.map((item) => (
        <motion.a
          key={item.id}
          href={item.href}
          layout
          className="nav-item"
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        >
          <span className="nav-icon" aria-hidden="true">{item.icon}</span>

          <AnimatePresence initial={false}>
            {!collapsed && (
              <motion.span
                key="label"
                className="nav-label"
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
              >
                {item.label}
              </motion.span>
            )}
          </AnimatePresence>

          <span className="sr-only">{collapsed ? item.label : ''}</span>
        </motion.a>
      ))}
    </motion.nav>
  );
}
```

CSS shape: `.nav` is a column flex container, each `.nav-item` is a
row flex with `gap` between icon and label, `overflow: hidden` on the
item so the collapsing label clips cleanly, and a standard `.sr-only`
utility (`position: absolute; width: 1px; height: 1px; overflow:
hidden; clip: rect(0 0 0 0)`) for the accessible-name fallback.

**Why this works:** `layout` on `<nav>` and each `<a>` lets Motion
animate the width change via `transform: scaleX` internally — `width`
never hits the main thread. `AnimatePresence` enters / exits the
label cleanly. The screen-reader-only span keeps the accessible name
on the link when the visible label is gone — set an `aria-label` for
the screen reader and a `title` for the sighted-user tooltip:

```tsx
<a aria-label={item.label} title={collapsed ? item.label : undefined}>…</a>
```

## Recipe 3 — Card grid → detail view

A card in a grid expands to a detail view on click. The image, title,
and primary action are the **same elements** in both layouts — declare
them with matching `layoutId` values so Motion morphs the position
and size of each:

```tsx
<motion.button layoutId={`card-${id}`}>
  <motion.img   layoutId={`image-${id}`} src={thumb} alt="" />
  <motion.h3    layoutId={`title-${id}`}>{title}</motion.h3>
</motion.button>

{active && (
  <motion.div layoutId={`card-${active}`}>
    <motion.img layoutId={`image-${active}`} src={hero} alt="" />
    <motion.h3  layoutId={`title-${active}`}>{title}</motion.h3>
  </motion.div>
)}
```

The full working component (with `AnimatePresence`, the close handler,
and CSS) is in
[`references/recipes.md` § "Shared-element navigation"](../references/recipes.md#shared-element-navigation-with-layoutid-motion)
and the full gallery pattern in the same file. Motion crossfades the
image when `src` changes — swap thumb for hero and the transition
reads as a true zoom-and-load.

## Recipe 4 — Same-page DOM swap (no library)

For two distinct render passes with a default crossfade, **View
Transitions** ship the effect with zero dependencies:

```tsx
function navigate(swap: () => void) {
  if (document.startViewTransition) document.startViewTransition(swap);
  else swap();
}
```

Per-element morphs use matching `view-transition-name` on both
states. Full syntax in [`modern-css.md`](./modern-css.md).

Use View Transitions when the morph is a clean "render A → render B"
swap. For continuous live state that crosses the transition (a drag
in progress, a controlled animation that should pause / resume), use
Motion `layout` instead — it preserves DOM identity.

---

## Performance pitfalls

Motion `layout` and View Transitions animate **only `transform` /
`opacity`** internally. Still watch for: `box-shadow` /
`border-radius` differing between states (repaints per frame — match
them or swap a pseudo-element's opacity); new `background-image`
decode on the first frame (preload); heavy child counts (virtualise
with `react-virtual`); **the parent's clip mask during the FLIP transit**
— see the next bullet.

**FLIP transit window.** Motion's `layout` animates the child via
`transform`, which means the child renders at its PRE-state-change
layout position throughout the spring (only at the end does it arrive
at its new layout position). If the parent applies `overflow: hidden`
(or `clip-path`, or `contain: paint`) while the spring is in flight
AND the parent's bounds shrink across the morph, the child's mid-flight
position falls outside the parent's clip rect and the child visibly
disappears for the duration of the spring. Keep `overflow: visible`
on the parent until `onLayoutAnimationComplete` fires, then restore
the clip if you need scrolling.

## Accessibility — the rules for big morphs

Layout morphs travel further across the screen than a fade. That makes
them disproportionately risky for users with vestibular disorders.
Apply **every** rule below; layout morphs are where this skill earns
its WCAG 2.3.3 compliance.

### 1. `prefers-reduced-motion` → fall back to crossfade

Wrap the app in `<MotionConfig reducedMotion="user">`. Motion then
automatically disables `transform`-based movement (slides, scales)
under the OS preference while keeping `opacity` (fades survive).

```tsx
import { MotionConfig } from 'motion/react';
<MotionConfig reducedMotion="user">{children}</MotionConfig>
```

For per-morph overrides, swap the `transition` based on
`useReducedMotion()` — short `duration` for reduced, spring for
default.

### 2. Cap motion amplitude

A morph that travels > ~30 % of the viewport is a vestibular hazard
even without the OS preference set. Mitigations: stage the morph
(fade out → layout settles → fade in — three short motions over one
long one), and **anchor the camera** (keep one element fixed so the
user has something stable to track).

### 3. Preserve focus

The focused element must stay focused across the morph — unless the
morph deliberately moves focus (opening a detail dialog should move
focus into the dialog, after layout settles inside a `requestAnimationFrame`).
Motion's `layout` preserves DOM identity automatically; verify with
keyboard testing.

### 4. Announce state changes to screen readers

```tsx
<div role="status" aria-live="polite" className="sr-only">
  {view === 'stack' ? 'Switched to stacked view' : 'Switched to list view'}
</div>
```

`aria-live="polite"` for non-urgent changes; `assertive` only for
blockers.

### 5. Keep the accessible name when text disappears

In the collapsing nav, the visible label is gone but the link's
purpose is unchanged. Set `aria-label` so a screen reader still
says "Settings", not just "icon":

```tsx
<a href="/settings" aria-label="Settings">
  <SettingsIcon aria-hidden="true" />
  {!collapsed && <span aria-hidden="true">Settings</span>}
</a>
```

### 6. Gate pointer input, never keyboard

Click handlers fired mid-morph create surprising layouts. Disable
pointer events on the morphing container while it animates;
keyboard focus must keep working:

```tsx
<motion.div
  layout
  onLayoutAnimationStart={() => setBusy(true)}
  onLayoutAnimationComplete={() => setBusy(false)}
  style={{ pointerEvents: busy ? 'none' : 'auto' }}
/>
```

### 7. Test with the OS preference set

Toggle `Reduce motion` in macOS System Settings → Accessibility (or
Windows Settings → Accessibility → Visual effects → Animation
effects) and re-run the flow. If the morph still travels or rotates,
the `prefers-reduced-motion` path is wrong. Fix before merging.

## Common mistakes

- **Animating `flex-direction`, `grid-template-*`, or `width: auto`
  directly.** Discrete or layout-bound — they snap or thrash. **Fix:**
  wrap children with `layout` and let Motion FLIP, or use
  `interpolate-size` for single-element width.
- **Forgetting `LayoutGroup`.** Siblings morphing independently
  desync. **Fix:** wrap them.
- **`layoutId` reused across unrelated elements.** Motion morphs them
  together and the result looks broken. **Fix:** one logical shared
  element per ID.
- **`overflow: hidden` (or `clip-path`, or `contain: paint`) on the
  morph parent while the spring is in flight.** Children FLIP through
  their pre-state-change positions; if the parent shrinks across the
  morph, those positions sit outside the clip rect and the children
  vanish for the duration of the spring. Symptom: cards "pop in" at
  the end of the animation instead of sliding in. **Fix:** keep
  `overflow: visible` until `onLayoutAnimationComplete` fires; re-enable
  `overflow-auto` / `overflow-hidden` only at rest.
- **No `aria-live` for view swaps and no `prefers-reduced-motion`
  fallback.** The two top a11y violations on layout morphs. **Fix:**
  polite live region + `<MotionConfig reducedMotion="user">` at the
  app root.
- **Heavy children inside the morph.** A 500-card morph drops frames
  even with FLIP. **Fix:** virtualise the list.
