---
title: External Engines — Lottie and Rive
impact: MEDIUM
tags:
  - lottie
  - dotlottie
  - rive
  - designer-handoff
  - state-machine
---

# External Engines

Some animations are easier authored in a visual editor than written
in code: a complex illustrated loader, a character that reacts to
clicks, a multi-state interactive icon (hamburger → X → back arrow).
Two runtimes cover this domain on the modern web — **Lottie /
dotLottie** (After Effects export, linear playback) and **Rive**
(standalone editor, state-machine driven, interactive).

Both render outside the CSS / DOM pipeline (Canvas / WebGL / WASM),
which means: animations are not compositor-cheap by default, the
bundle adds runtime weight, and the same accessibility rules apply as
to any other motion.

## Contents

- When to pick external over CSS / Motion / R3F
- Lottie / dotLottie — install, usage, controls, sizing
- Rive — install, usage, state-machine inputs
- Decision: Motion vs Lottie vs Rive
- Performance and accessibility
- Common mistakes

---

## When to pick an external engine

| Need                                                                                | Pick                       |
| ----------------------------------------------------------------------------------- | -------------------------- |
| Code-defined transitions and layout animations                                       | Motion ([`when-to-use-js.md`](./when-to-use-js.md)) |
| Designer-authored **linear playback** asset (loader, illustration, micro-illustration) | **Lottie / dotLottie**     |
| Designer-authored **interactive** asset with multiple states reacting to clicks / hover / inputs | **Rive**                   |
| 3D, particles, shaders, scene graphs                                                 | R3F ([`three-d.md`](./three-d.md)) |
| The asset is purely vector, simple, and can be coded in 20 lines of SVG + CSS        | Just code it               |

Reach for an external engine when the **art** is the value and the
designer has working source. Reach for code when the **logic** is the
value.

## Lottie / dotLottie

Lottie is the original — JSON exported from After Effects via the
Bodymovin plugin. **dotLottie** (`.lottie`) is the modern format:
WebAssembly runtime, ZIP-packaged bundle, 80–90 % smaller than `.json`,
supports themes and embedded state machines.

### Install (React)

```bash
npm install @lottiefiles/dotlottie-react
```

### Basic usage

```tsx
'use client';
import { DotLottieReact } from '@lottiefiles/dotlottie-react';

export function Loader() {
  return (
    <DotLottieReact
      src="/animations/loader.lottie"
      loop
      autoplay
      aria-hidden="true"
    />
  );
}
```

`.lottie` files are preferred over `.json` for production — they ship
the WASM runtime once and decode the animation natively.

### Controls (play / pause / seek)

```tsx
'use client';
import { DotLottieReact } from '@lottiefiles/dotlottie-react';
import { useState } from 'react';
import type { DotLottie } from '@lottiefiles/dotlottie-react';

export function PlayPause() {
  const [player, setPlayer] = useState<DotLottie | null>(null);

  return (
    <>
      <DotLottieReact
        dotLottieRefCallback={setPlayer}
        src="/animation.lottie"
        autoplay={false}
      />
      <button onClick={() => player?.play()}>Play</button>
      <button onClick={() => player?.pause()}>Pause</button>
      <button onClick={() => player?.setFrame(60)}>Skip to frame 60</button>
    </>
  );
}
```

### Sizing and lazy-loading

```tsx
const Loader = React.lazy(() =>
  import('@lottiefiles/dotlottie-react').then(m => ({ default: m.DotLottieReact }))
);

<Suspense fallback={<div className="loader-fallback" />}>
  <Loader src="/animation.lottie" loop autoplay />
</Suspense>
```

The dotLottie runtime adds roughly 30–50 KB gzipped. Lazy-load it
unless the animation is above the fold on first paint.

### Frame interpolation

```tsx
<DotLottieReact src="/animation.lottie" useFrameInterpolation />
```

`useFrameInterpolation` enables sub-frame interpolation for smoother
playback on high-refresh displays. Recommended for any animation
visible long enough to notice.

## Rive

Rive is a separate editor + runtime. Animations are designed with a
state machine at the centre — every interactive state and transition
is declared in the editor, then driven from code via typed inputs
(boolean, number, trigger).

### Install (React)

```bash
npm install @rive-app/react-canvas
```

`@rive-app/react-canvas` is the recommended runtime; it wraps
`@rive-app/canvas` (the Canvas2D backend). Use `@rive-app/react-webgl`
only when WebGL is specifically required.

### Basic usage with a state machine

```tsx
'use client';
import { useRive, useStateMachineInput } from '@rive-app/react-canvas';

export function LikeButton() {
  const { rive, RiveComponent } = useRive({
    src: '/like.riv',
    stateMachines: 'State Machine 1',
    autoplay: true,
  });

  const liked = useStateMachineInput(rive, 'State Machine 1', 'Liked');

  return (
    <RiveComponent
      role="button"
      aria-pressed={Boolean(liked?.value)}
      aria-label="Like"
      onClick={() => { if (liked) liked.value = !liked.value; }}
    />
  );
}
```

The `liked` input is a typed `Boolean` input declared in the Rive
editor. Setting `.value` drives the state machine; the runtime plays
the transitions defined in the editor — no animation code on the
React side.

### Input types

| Type            | API                                  | Use for                                   |
| --------------- | ------------------------------------ | ----------------------------------------- |
| `Boolean`       | `input.value = true / false`         | On / off toggles, hover state              |
| `Number`        | `input.value = 0.6`                  | Progress bars, sliders, scroll-tied state |
| `Trigger`       | `input.fire()`                       | One-shot animations (button press, ack)   |

### Sizing and lazy-loading

The Rive WASM runtime is ~78 KB gzipped — comparable to dotLottie.
Same pattern: `React.lazy` + `Suspense` for non-critical scenes.

## Decision: Motion vs Lottie vs Rive

| Need                                                          | Pick    |
| ------------------------------------------------------------- | ------- |
| Code-defined transitions, layout morphs, gestures              | Motion  |
| Loader / illustration with linear playback, no interactivity   | Lottie / dotLottie |
| Animated icon that reacts to clicks / hover / inputs           | Rive    |
| Multi-state interactive component designed by a motion designer | Rive    |
| Skeleton with a subtle shimmer                                  | CSS     |
| Splash screen flourish, one-shot character animation            | Lottie / dotLottie |
| Designer wants to own the asset and iterate without dev help    | Whichever editor the designer uses (Lottie via After Effects, Rive via Rive editor) |

## Performance and accessibility

Both runtimes render to **Canvas** (Lottie / Rive default) or WebGL
(Rive optional). They are **not compositor-cheap** — the CPU and GPU
work happens per frame regardless of which CSS property changes.

### Rules

1. **One or two instances per viewport.** Many concurrent Lottie /
   Rive scenes drop frames on mobile.
2. **Pause off-screen.** Use `IntersectionObserver` to pause when the
   element scrolls out of view:
   ```tsx
   const ref = useRef(null);
   useEffect(() => {
     const io = new IntersectionObserver(([e]) => {
       if (e.isIntersecting) player?.play();
       else player?.pause();
     });
     io.observe(ref.current!);
     return () => io.disconnect();
   }, [player]);
   ```
3. **Lazy-load the runtime.** `React.lazy` + `Suspense`.
4. **Destroy on unmount.** dotLottie and Rive both expose a cleanup
   path — call `player.destroy()` / unmount the React component;
   leaked instances keep painting.

### Accessibility

- **Decorative animation:** `aria-hidden="true"` on the container.
- **Meaningful animation:** provide a text alternative
  (`aria-label`, adjacent visible text, or a description in
  surrounding content).
- **Interactive Rive components:** add the appropriate ARIA role
  (`role="button"`, `role="checkbox"`) and ARIA state
  (`aria-pressed`, `aria-checked`) to the `<RiveComponent>`.
- **`prefers-reduced-motion`:** gate both runtimes:

```tsx
import { useReducedMotion } from 'motion/react';

const reduce = useReducedMotion();

return reduce
  ? <StaticFallback />
  : <DotLottieReact src="..." autoplay />;
```

For Rive, swap to a single-frame poster or a static SVG when
`reduce` is set — never just let the animation play silently.

## Common mistakes

- **Shipping `.json` instead of `.lottie`.** 5–10× larger payload.
  **Fix:** export `.lottie` (dotLottie) format.
- **Many concurrent Lottie / Rive instances.** Frame drops on
  low-end mobile. **Fix:** one or two per viewport;
  `IntersectionObserver` pause off-screen.
- **No `prefers-reduced-motion` fallback.** Both runtimes ignore the
  OS preference by default. **Fix:** gate at the React level; serve a
  static poster under `reduce`.
- **Loading the runtime eagerly on every route.** Bloats initial
  bundle. **Fix:** `React.lazy` + `Suspense`.
- **Using Rive when Lottie would do.** Rive's state-machine power
  is wasted on a linear loop. **Fix:** Lottie / dotLottie is simpler
  and ubiquitous.
- **Reaching for Lottie / Rive for a CSS-doable effect.** A 30 KB
  WASM runtime to fade a spinner is wrong. **Fix:** keep simple
  effects in CSS.
- **No ARIA on interactive Rive components.** Screen readers see an
  empty canvas. **Fix:** `role` + `aria-label` + `aria-pressed` /
  `aria-checked` on `<RiveComponent>`.
