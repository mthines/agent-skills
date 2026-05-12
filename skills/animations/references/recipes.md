---
title: Recipes — End-to-end Worked Examples
impact: MEDIUM
tags:
  - reference
  - recipes
  - examples
---

# Recipes

Full, end-to-end implementations of patterns the rules only sketch.
Load this when the user asks "what does X look like complete?" or
needs a starting point to copy.

## Contents

- Cursor-tracking spotlight button (vanilla)
- Cursor-tracking spotlight button (React + Motion)
- Staggered list reveal (CSS-only, any size)
- Modal entry with `@starting-style`
- Accordion with `interpolate-size`
- Shared-element navigation with `layoutId` (Motion)
- Scroll-driven progress bar (pure CSS)
- View Transition for SPA route change
- R3F scroll-tied 3D scene
- Tailwind v4 + `tw-animate-css` fade-in utility

For **from-to layout morphs** (list ↔ stacked cards, full ↔ icon-only
nav, grid ↔ detail view) with their full accessibility checklist,
see [`rules/from-to-morphs.md`](../rules/from-to-morphs.md) — the
recipes there are too long to inline here.

---

## Cursor-tracking spotlight button (vanilla)

```html
<button class="spotlight">Hover me</button>

<style>
  .spotlight {
    --x: 50%;
    --y: 50%;
    position: relative;
    overflow: hidden;
    padding: 1rem 1.5rem;
    border-radius: 0.75rem;
    border: 1px solid hsl(220 14% 28%);
    color: white;
    background:
      radial-gradient(
        circle 12rem at var(--x) var(--y),
        hsl(220 100% 70% / 0.35),
        transparent 50%
      ),
      hsl(220 14% 12%);
    transition: background-position 200ms ease-out;
  }
</style>

<script>
  const btn = document.querySelector('.spotlight');
  let frame = 0;
  btn.addEventListener('pointermove', (event) => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      const rect = btn.getBoundingClientRect();
      btn.style.setProperty('--x', `${event.clientX - rect.left}px`);
      btn.style.setProperty('--y', `${event.clientY - rect.top}px`);
      frame = 0;
    });
  });
</script>
```

The `requestAnimationFrame` gate is what keeps it 60 fps on
high-polling-rate mice.

---

## Cursor-tracking spotlight button (React + Motion)

```tsx
'use client';
import { motion, useMotionValue, useMotionTemplate } from 'motion/react';
import { useRef } from 'react';

export function SpotlightButton({ children }: { children: React.ReactNode }) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const ref = useRef<HTMLButtonElement>(null);

  function handlePointer(e: React.PointerEvent<HTMLButtonElement>) {
    const rect = ref.current!.getBoundingClientRect();
    x.set(e.clientX - rect.left);
    y.set(e.clientY - rect.top);
  }

  const background = useMotionTemplate`radial-gradient(circle 12rem at ${x}px ${y}px, rgb(96 165 250 / 0.35), transparent 50%), rgb(24 24 27)`;

  return (
    <motion.button
      ref={ref}
      onPointerMove={handlePointer}
      className="relative overflow-hidden rounded-xl border border-zinc-700 px-6 py-4 text-white"
      style={{ background }}
    >
      {children}
    </motion.button>
  );
}
```

`useMotionTemplate` returns a `MotionValue<string>` that Motion
subscribes to natively — zero React re-renders, correct at every
pointer position. Reading `x.get()` inline inside `style` would freeze
the gradient at the value present on first render.

---

## Staggered list reveal (CSS-only, any size)

```html
<ul class="reveal-list">
  <li style="--i: 0">First</li>
  <li style="--i: 1">Second</li>
  <li style="--i: 2">Third</li>
  <li style="--i: 3">Fourth</li>
</ul>

<style>
  .reveal-list {
    --stagger: 60ms;
    --ease: cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .reveal-list > li {
    opacity: 0;
    transform: translateY(8px);
    animation: rise 320ms var(--ease) forwards;
    animation-delay: calc(var(--i) * var(--stagger));
  }

  @keyframes rise {
    to { opacity: 1; transform: translateY(0); }
  }

  @media (prefers-reduced-motion: reduce) {
    .reveal-list > li {
      transform: none;
      animation: fade 160ms linear forwards;
      animation-delay: 0ms;
    }
    @keyframes fade { to { opacity: 1; } }
  }
</style>
```

---

## Modal entry with `@starting-style`

```html
<dialog id="m" class="dialog" open>
  <p>Hello</p>
</dialog>

<style>
  .dialog {
    opacity: 1;
    transform: translateY(0);
    transition: opacity 240ms ease-out,
                transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1),
                display 240ms allow-discrete,
                overlay 240ms allow-discrete;
  }

  .dialog[hidden],
  .dialog:not([open]) {
    opacity: 0;
    transform: translateY(8px);
  }

  @starting-style {
    .dialog[open] {
      opacity: 0;
      transform: translateY(8px);
    }
  }
</style>
```

Zero JavaScript for the fade-in. Toggle `open` and the transition runs.

---

## Accordion with `interpolate-size`

```html
<details class="accordion">
  <summary>Section</summary>
  <div class="content">Long content…</div>
</details>

<style>
  :root { interpolate-size: allow-keywords; }

  .accordion[open] .content { height: auto; }
  .accordion .content {
    height: 0;
    overflow: hidden;
    transition: height 280ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
</style>
```

For browsers without `interpolate-size`, wrap the same effect with
Motion's `layout` prop on a `motion.div` parent (see
[`when-to-use-js.md`](../rules/when-to-use-js.md)).

---

## Shared-element navigation with `layoutId` (Motion)

```tsx
'use client';
import { motion } from 'motion/react';

type Tab = { id: string; label: string };

interface TabsProps {
  tabs: Tab[];
  active: string;
  onSelect: (id: string) => void;
}

export function Tabs({ tabs, active, onSelect }: TabsProps) {
  return (
    <nav className="flex gap-2">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onSelect(tab.id)}
          className="relative px-3 py-2"
        >
          {tab.label}
          {active === tab.id && (
            <motion.span
              layoutId="active-tab"
              className="absolute inset-0 -z-10 rounded-md bg-zinc-200"
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            />
          )}
        </button>
      ))}
    </nav>
  );
}
```

The pill morphs from one tab to the next — no JS animation code,
Motion handles the FLIP under the hood via `layoutId`.

---

## Scroll-driven progress bar (pure CSS)

```html
<div class="progress" aria-hidden="true"></div>

<style>
  .progress {
    position: fixed;
    top: 0;
    left: 0;
    height: 4px;
    width: 100%;
    background: linear-gradient(to right, #60a5fa, #c084fc);
    transform-origin: left center;
    transform: scaleX(0);
  }

  @supports (animation-timeline: scroll()) {
    .progress {
      animation: fill linear;
      animation-timeline: scroll(root);
    }
    @keyframes fill {
      to { transform: scaleX(1); }
    }
  }
</style>
```

Static at the top in browsers that don't support scroll timelines, an
animated bar everywhere else. No JS.

---

## View Transition for SPA route change

```tsx
'use client';
import { useRouter } from 'next/navigation';

export function AnimatedLink({ href, children }) {
  const router = useRouter();
  function navigate(e: React.MouseEvent) {
    e.preventDefault();
    if (document.startViewTransition) {
      document.startViewTransition(() => router.push(href));
    } else {
      router.push(href);
    }
  }
  return <a href={href} onClick={navigate}>{children}</a>;
}
```

For multi-page apps, opt-in declaratively:

```css
@view-transition { navigation: auto; }
```

---

## R3F scroll-tied 3D scene

```tsx
'use client';
import { Canvas, useFrame } from '@react-three/fiber';
import { ScrollControls, useScroll } from '@react-three/drei';
import { useRef } from 'react';
import * as THREE from 'three';

function Model() {
  const mesh = useRef<THREE.Mesh>(null!);
  const scroll = useScroll();

  useFrame(() => {
    mesh.current.rotation.y = scroll.offset * Math.PI * 2;
  });

  return (
    <mesh ref={mesh}>
      <torusKnotGeometry args={[1, 0.3, 128, 32]} />
      <meshStandardMaterial color="#60a5fa" />
    </mesh>
  );
}

export function Scene() {
  return (
    <Canvas camera={{ position: [0, 0, 4] }}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[2, 2, 2]} />
      <ScrollControls pages={3}>
        <Model />
      </ScrollControls>
    </Canvas>
  );
}
```

Wrap with `React.lazy` so the WebGL bundle doesn't ship on routes
that don't render the scene.

---

## Tailwind v4 + `tw-animate-css` fade-in utility

```bash
npm install tw-animate-css
```

```css
@import "tailwindcss";
@import "tw-animate-css";

@theme {
  --animate-fade-in: fade-in 240ms cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
}

@keyframes fade-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

```tsx
<section className="animate-fade-in">…</section>
```

Drop `tailwindcss-animate` if you still have it — `tw-animate-css` is
the v4-compatible successor blessed by shadcn/ui.
