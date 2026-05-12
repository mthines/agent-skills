---
title: 3D and Canvas — React Three Fiber and Drei
impact: MEDIUM
tags:
  - three-js
  - react-three-fiber
  - r3f
  - drei
  - webgpu
---

# 3D and Canvas

When a hero scene, product viewer, particle field, or shader-driven
effect leaves the CSS / DOM rails, the modern default is **React Three
Fiber** (R3F) — a React reconciler for Three.js — paired with **Drei**,
the helper library that ships cameras, controls, environments, loaders,
and abstractions you would otherwise write yourself.

Vanilla Three.js still works; R3F is what production React apps
use because the imperative `scene.add` / `mesh.material.dispose`
lifecycle maps cleanly onto React's mount / unmount, and the ecosystem
(Leva, drei, postprocessing, rapier) all assumes the React shape.

## Contents

- When to reach for 3D at all
- Install
- Canonical render loop (`useFrame`, refs not state)
- Drei — the standard helpers
- WebGPU — the modern renderer
- Hooking Motion into R3F
- Performance — the short list
- Accessibility
- Common mistakes

## When to reach for 3D at all

| Signal                                                                                | Stay in CSS / Motion                  |
| ------------------------------------------------------------------------------------- | ------------------------------------- |
| A 2D card flip, parallax, or perspective tilt                                          | CSS `transform: perspective()` + rotate |
| Animated SVG icon                                                                      | CSS or Motion                         |
| Particle field, fog, lighting, GLB / GLTF models, shaders                              | **R3F**                               |
| Product configurator, scroll-driven 3D scene                                           | **R3F**                               |
| Generative art, simulations, > 10k particles                                            | **R3F + WebGPU**                       |

If 2D math gets the job done, do not load Three.js — it ships ~150 KB
gzipped before your scene. Reserve it for cases where the rendering
model itself needs to be three-dimensional.

## Install

```bash
npm install three @react-three/fiber @react-three/drei
```

## Canonical render loop

R3F sets up its own `requestAnimationFrame` loop. **Never** put
60 fps mutations into React state — reconciliation cost eats every
frame. Per-frame values live in refs read inside `useFrame`:

```tsx
import { Canvas, useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';

function SpinningBox() {
  const mesh = useRef<THREE.Mesh>(null!);

  useFrame((_, delta) => {
    mesh.current.rotation.y += delta * 0.6;
  });

  return (
    <mesh ref={mesh}>
      <boxGeometry />
      <meshStandardMaterial />
    </mesh>
  );
}

export function Scene() {
  return (
    <Canvas camera={{ position: [0, 0, 3] }}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[2, 2, 2]} />
      <SpinningBox />
    </Canvas>
  );
}
```

`useFrame` runs once per frame. The `delta` argument is the elapsed
seconds since the previous frame — multiply by it to make rotation /
translation **frame-rate-independent**.

## Drei — the standard helpers

Drei wraps the boilerplate. The handful you will use on every project:

| Helper                       | Purpose                                                  |
| ---------------------------- | -------------------------------------------------------- |
| `<OrbitControls />`          | Drag to rotate, scroll to zoom.                          |
| `<Environment preset="…" />` | HDR lighting — instant studio look.                      |
| `<Float />`                  | Slow ambient float on a mesh.                            |
| `<Html />`                   | Render DOM inside the 3D scene (overlays, labels).       |
| `<Text />` / `<Text3D />`    | High-quality typography in WebGL.                        |
| `useGLTF` / `useTexture`     | Cached, Suspense-friendly loaders.                       |
| `<ScrollControls />`         | Bind scroll progress to camera or scene state.           |

```tsx
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, Float } from '@react-three/drei';

<Canvas>
  <Environment preset="studio" />
  <Float speed={1.2} rotationIntensity={0.6} floatIntensity={0.4}>
    <Model />
  </Float>
  <OrbitControls />
</Canvas>
```

## WebGPU — the modern renderer

Three.js ships a WebGPU renderer (`three/webgpu`) with automatic
WebGL 2 fallback. Adopt it on new R3F projects where draw-call volume
or compute work would benefit:

```tsx
import { Canvas } from '@react-three/fiber';
import { WebGPURenderer } from 'three/webgpu';

<Canvas
  gl={async (canvas) => {
    const renderer = new WebGPURenderer({ canvas });
    await renderer.init();
    return renderer;
  }}
/>
```

`renderer.init()` is `async`. Without `await`, the factory returns
before WebGPU finishes initialising and R3F silently falls through to
the WebGL fallback. The `gl` prop accepts a `Promise<Renderer>` since
R3F v8.

WebGPU shines for **draw-call-heavy** scenes (particles, instanced
meshes, custom compute) — 2–10× improvements are typical, and
compute shaders push particle counts into the millions where WebGL
caps out around 50 000. For a static GLB and an orbit control, the
gain is marginal — stay on the default WebGL renderer.

## Hooking Motion into R3F

Two integration shapes:

1. **Animate DOM overlays with Motion.** The `<Html />` from Drei
   renders DOM inside the scene; wrap with `motion.div` and you have
   a UI layer with declarative variants on top of WebGL.

2. **Animate scene state with Motion's value system.** `useMotionValue`
   + `useSpring` produce a value the `useFrame` loop reads directly:

```tsx
import { motion, useMotionValue, useSpring } from 'motion/react';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';

function Card() {
  const tilt = useMotionValue(0);
  const smooth = useSpring(tilt, { stiffness: 120, damping: 16 });
  const mesh = useRef(null!);

  useFrame(() => {
    mesh.current.rotation.y = smooth.get();
  });

  return (
    <mesh ref={mesh}
      onPointerMove={(e) => tilt.set(e.point.x * 0.5)}
      onPointerLeave={() => tilt.set(0)}>
      <boxGeometry />
      <meshStandardMaterial />
    </mesh>
  );
}
```

This combo gives spring physics from Motion and per-frame mutation
from R3F without sticking 60 fps values into React state.

## Performance — the short list

The full Three.js best-practice list runs into the hundreds. The
handful that matter on day one:

1. **Aim for under 100 draw calls per frame.** Use `<Instances>` /
   `<Merged>` from Drei to batch identical meshes.
2. **Compress textures with KTX2** (`@react-three/drei` ships a
   `useKTX2` loader). PNGs are not okay at scene scale.
3. **Dispose on unmount.** R3F auto-disposes geometries and materials,
   but textures created manually need a `texture.dispose()` call.
4. **Disable `frameloop="always"` when nothing is moving.** Set
   `frameloop="demand"` on the `<Canvas />` and call `invalidate()` to
   render. Cuts idle CPU/GPU to zero.
5. **Lazy-load the scene.** WebGL adds ~150 KB before your assets.
   `React.lazy(() => import('./scene'))` plus a `<Suspense fallback>`
   keeps the initial bundle lean.
6. **Cap pixel ratio.** `gl={{ powerPreference: 'high-performance' }}`
   plus `dpr={[1, 2]}` on `<Canvas />` prevents 4K retina screens from
   shading 4× the pixels.

## Accessibility

Decorative 3D scenes get `aria-hidden="true"` on the canvas. If the
scene conveys information, supply an equivalent in HTML (a description
list, an alt-text caption). Honour `prefers-reduced-motion`:

```tsx
const reduce = useReducedMotion(); // from 'motion/react'

useFrame((_, delta) => {
  if (reduce) return;
  mesh.current.rotation.y += delta * 0.4;
});
```

## Common mistakes

- **Putting per-frame state in `useState`.** Re-renders the tree at 60
  Hz. **Fix:** use refs and mutate inside `useFrame`.
- **Forgetting `delta`.** Animations run twice as fast on a 120 Hz
  display. **Fix:** multiply rotation / translation by `delta`.
- **Importing the whole of Three.js at the top level of a marketing
  page.** Bloats the initial bundle. **Fix:** `React.lazy` the scene.
- **`frameloop="always"` on a static product viewer.** Burns battery.
  **Fix:** `frameloop="demand"` + `invalidate()` on user input.
- **No reduced-motion gate.** Auto-rotating scenes cause nausea. **Fix:**
  early-return inside `useFrame` when `prefers-reduced-motion: reduce`.
