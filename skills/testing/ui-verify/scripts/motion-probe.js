// motion-probe.js — in-page motion profiler for ui-verify's motion profile
// (rules/motion-profile.md). Plain browser script, no imports, idempotent.
//
// Inject it BEFORE the page's own scripts (Playwright `addInitScript`) so the
// React commit counter can install; injected later (Chrome `javascript_tool`),
// every other measurement still works and `react.available` reads false unless
// the React DevTools extension's hook is present to wrap.
//
// Usage, in the page:
//   __motionProbe.start();   // just before triggering the animation
//   ...trigger, wait for it to finish...
//   __motionProbe.stop();    // returns the result object below
(() => {
  if (window.__motionProbe) return;

  // ── React commits: each commit is one render pass of the tree ──
  let commits = 0;
  let reactAvailable = false;
  const existing = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (existing && typeof existing.onCommitFiberRoot === 'function') {
    const orig = existing.onCommitFiberRoot.bind(existing);
    existing.onCommitFiberRoot = (...args) => { commits++; return orig(...args); };
    reactAvailable = true;
  } else if (!existing) {
    let id = 0;
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      renderers: new Map(),
      inject(renderer) { reactAvailable = true; this.renderers.set(++id, renderer); return id; },
      onCommitFiberRoot() { commits++; },
      onCommitFiberUnmount() {},
      onPostCommitFiberRoot() {},
      checkDCE() {},
      on() {}, off() {}, emit() {}, sub() { return () => {}; },
    };
  }

  // Properties the compositor animates without layout or paint.
  const COMPOSITED = new Set(['transform', 'opacity', 'filter', 'translate', 'rotate', 'scale', 'offset', 'offsetDistance', 'offsetPath', 'offsetRotate']);
  const TIMING_KEYS = new Set(['offset', 'computedOffset', 'easing', 'composite']);
  const MOVEMENT = /^(transform|translate|rotate|scale|top|left|right|bottom|inset|margin|((max|min)-?)?(width|height))/i;

  const describe = (el) => {
    if (!el || !el.tagName) return String(el);
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls;
  };

  let state = null;

  function sampleAnimations() {
    for (const a of document.getAnimations()) {
      if (state.animations.has(a)) continue;
      const props = new Set();
      if (a.transitionProperty) props.add(a.transitionProperty);
      try {
        for (const kf of a.effect.getKeyframes()) for (const k of Object.keys(kf)) if (!TIMING_KEYS.has(k)) props.add(k);
      } catch {}
      const timing = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : {};
      state.animations.set(a, {
        target: describe(a.effect && a.effect.target),
        kind: a.constructor.name,
        name: a.animationName || a.transitionProperty || a.id || '',
        properties: [...props],
        duration_ms: typeof timing.duration === 'number' ? Math.round(timing.duration) : null,
        iterations: timing.iterations === Infinity ? 'infinite' : timing.iterations,
      });
    }
  }

  function tick(ts) {
    if (!state) return;
    state.frames.push(ts);
    if (state.frames.length % 5 === 1) sampleAnimations();
    state.raf = requestAnimationFrame(tick);
  }

  function start() {
    state = { t0: performance.now(), frames: [], animations: new Map(), loaf: [], cls: 0, styleWrites: 0, movingStyleWrites: 0, styleTargets: new Map(), commits0: commits, observers: [] };
    const observe = (type, fn) => {
      try { const o = new PerformanceObserver((l) => l.getEntries().forEach(fn)); o.observe({ type, buffered: false }); state.observers.push(o); } catch {}
    };
    observe('long-animation-frame', (e) => state.loaf.push({
      duration_ms: Math.round(e.duration),
      blocking_ms: Math.round(e.blockingDuration || 0),
      scripts: (e.scripts || []).slice(0, 3).map((s) => ({ invoker: s.invoker, source: s.sourceURL, duration_ms: Math.round(s.duration) })),
    }));
    observe('layout-shift', (e) => { if (!e.hadRecentInput) state.cls += e.value; });
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        state.styleWrites++;
        const style = r.target.style;
        if (style && (style.transform || style.translate || style.rotate || style.scale || style.top || style.left || style.width || style.height)) state.movingStyleWrites++;
        const key = describe(r.target);
        state.styleTargets.set(key, (state.styleTargets.get(key) || 0) + 1);
      }
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['style'], subtree: true });
    state.mo = mo;
    sampleAnimations();
    state.raf = requestAnimationFrame(tick);
  }

  function stop() {
    if (!state) throw new Error('motion-probe: stop() before start()');
    sampleAnimations();
    cancelAnimationFrame(state.raf);
    state.mo.disconnect();
    state.observers.forEach((o) => o.disconnect());
    const intervals = [];
    for (let i = 1; i < state.frames.length; i++) intervals.push(state.frames[i] - state.frames[i - 1]);
    const sorted = [...intervals].sort((a, b) => a - b);
    const pct = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0);
    const median = pct(0.5);
    const frames = state.frames.length;
    const animations = [...state.animations.values()];
    const result = {
      window_ms: Math.round(performance.now() - state.t0),
      frames,
      frame_ms: { median: +median.toFixed(1), p95: +pct(0.95).toFixed(1), max: +(sorted[sorted.length - 1] || 0).toFixed(1) },
      skipped_frames: median ? intervals.reduce((n, d) => n + Math.max(0, Math.round(d / median) - 1), 0) : 0,
      long_animation_frames: state.loaf,
      cls: +state.cls.toFixed(4),
      animations,
      non_composited: animations.filter((a) => a.properties.some((p) => !COMPOSITED.has(p))),
      moving_animations: animations.filter((a) => a.properties.some((p) => MOVEMENT.test(p)) && (a.duration_ms || 0) > 0),
      style_writes: { total: state.styleWrites, moving: state.movingStyleWrites, per_frame: frames ? +(state.styleWrites / frames).toFixed(2) : 0, top_targets: [...state.styleTargets].sort((a, b) => b[1] - a[1]).slice(0, 3) },
      react: { available: reactAvailable, commits: commits - state.commits0, per_frame: frames ? +((commits - state.commits0) / frames).toFixed(2) : 0 },
      reduced_motion_media: matchMedia('(prefers-reduced-motion: reduce)').matches,
    };
    state = null;
    return result;
  }

  window.__motionProbe = { start, stop };
})();
