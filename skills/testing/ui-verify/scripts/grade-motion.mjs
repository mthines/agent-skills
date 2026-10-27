#!/usr/bin/env node
// grade-motion.mjs — turn motion-probe results into findings with fixed thresholds.
//
// WHY THIS EXISTS
// The motion profile (rules/motion-profile.md) measures; this script judges, so
// two runs over the same numbers always produce the same findings and no agent
// re-derives a threshold mid-run. It never changes ui-verify's verdict.
//
// INPUT: results.jsonl — one motion-probe result per line, each with `id`,
// `spec`, `pass` ("no-preference" | "reduce"), and `cpu_throttle`.
//
// OUTPUT: a `motion:` YAML block on stdout. EXIT: 0 graded, 2 error.
//
// Usage:
//   node grade-motion.mjs <results.jsonl>
//   node grade-motion.mjs --self-test

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Thresholds. LONG_FRAME_MS is RAIL's 100 ms response budget (the probe only sees
// frames over the Long Animation Frames API's 50 ms floor);
// CLS_POOR is web.dev's "good" ceiling; P95_OVER_MEDIAN flags a p95 frame time over
// twice the median — at least 1 frame in 20 dropped, which one gap at the click
// cannot cause. PER_FRAME / MIN_EVENTS are this repo's floor for "driven every
// frame": a 600 ms animation at 60 Hz is 36 frames, so 20 events at ≥ 0.3 per
// frame over the settle window cannot be a one-off state change.
export const T = { LONG_FRAME_MS: 100, P95_OVER_MEDIAN: 2, CLS_POOR: 0.1, PER_FRAME: 0.3, MIN_EVENTS: 20, MOVING_MIN: 5 };
const LAYOUT_PROP = /^((max|min)-?)?(width|height|block-?size|inline-?size)$|^(top|left|right|bottom|inset|margin|padding|border-?((top|right|bottom|left|block|inline)(-?(start|end))?-?)?width|font-?size|line-?height)/i;

export function grade(rows) {
  const byId = new Map();
  for (const row of rows) {
    const t = byId.get(row.id) ?? { id: row.id, spec: row.spec };
    t[row.pass === "reduce" ? "reduce" : "normal"] = row;
    byId.set(row.id, t);
  }
  const targets = [];
  const findings = [];
  for (const t of byId.values()) {
    const allowedPass = t.normal;
    if (!allowedPass) { targets.push({ id: t.id, status: "error", reason: "no no-preference pass" }); continue; }
    const add = (severity, kind, detail) => findings.push({ id: t.id, spec: t.spec, severity, kind, detail });
    const perFrame = (count) => allowedPass.frames && count >= T.MIN_EVENTS && count / allowedPass.frames >= T.PER_FRAME;

    const moved = allowedPass.moving_animations.length > 0 || allowedPass.style_writes.moving >= T.MOVING_MIN || allowedPass.animations.length > 0;
    if (!moved && allowedPass.react.commits < T.MOVING_MIN) {
      targets.push({ id: t.id, status: "not-exercised", reason: "no animation observed after the trigger" });
      continue;
    }

    if (allowedPass.react.available && perFrame(allowedPass.react.commits))
      add("high", "render-per-frame", `${allowedPass.react.commits} React commits over ${allowedPass.frames} frames (${allowedPass.react.per_frame}/frame) — the animation is driven through React state; move the per-frame value to CSS, a Motion value, or a ref`);

    if (allowedPass.frame_ms.median && allowedPass.frame_ms.p95 > T.P95_OVER_MEDIAN * allowedPass.frame_ms.median)
      add("high", "jank", `p95 frame ${allowedPass.frame_ms.p95} ms vs median ${allowedPass.frame_ms.median} ms at ${allowedPass.cpu_throttle}x CPU — ${allowedPass.skipped_frames} of ${allowedPass.frames} frames skipped`);
    else if (allowedPass.long_animation_frames.some((f) => f.duration_ms > T.LONG_FRAME_MS)) {
      const long = allowedPass.long_animation_frames.filter((f) => f.duration_ms > T.LONG_FRAME_MS);
      const worst = long.reduce((a, b) => (b.duration_ms > a.duration_ms ? b : a));
      const s = worst.scripts?.[0];
      add("medium", "long-frame", `${long.length} animation frame(s) over ${T.LONG_FRAME_MS} ms, worst ${worst.duration_ms} ms${s ? ` in ${s.invoker || s.source}` : ""}`);
    }

    for (const a of allowedPass.non_composited) {
      const layout = a.properties.filter((p) => LAYOUT_PROP.test(p));
      const paint = a.properties.filter((p) => !LAYOUT_PROP.test(p));
      if (layout.length) add("medium", "layout-property", `${a.target} animates ${layout.join(", ")} — triggers layout every frame; animate transform instead`);
      else if (paint.length) add("low", "paint-property", `${a.target} animates ${paint.join(", ")} — repaints every frame; prefer opacity or a pseudo-element`);
    }

    if (allowedPass.cls > T.CLS_POOR) add("medium", "layout-shift", `CLS ${allowedPass.cls} during the animation (good ≤ ${T.CLS_POOR})`);

    const reducePass = t.reduce;
    let reduced = "not checked";
    if (reducePass) {
      const stillMoving = reducePass.moving_animations.filter((a) => a.duration_ms > 0);
      if (stillMoving.length || reducePass.style_writes.moving >= T.MIN_EVENTS) {
        reduced = "ignored";
        const what = stillMoving.length ? stillMoving.map((a) => `${a.target} (${a.properties.join(", ")}, ${a.duration_ms} ms)`).join("; ") : `${reducePass.style_writes.moving} per-frame style writes on ${reducePass.style_writes.top_targets.map((x) => x[0]).join(", ")}`;
        add("high", "reduced-motion-ignored", `still moves with prefers-reduced-motion: reduce — ${what}`);
      } else reduced = "honoured";
    }
    targets.push({ id: t.id, status: "profiled", frames: allowedPass.frames, cpu: allowedPass.cpu_throttle, reduced_motion: reduced });
  }
  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return { targets, findings };
}

export function render({ targets, findings }) {
  const c = (s) => findings.filter((f) => f.severity === s).length;
  const lines = [
    "motion:",
    `  summary: "${targets.length} targets, ${findings.length} findings (${c("critical")} critical, ${c("high")} high, ${c("medium")} medium, ${c("low")} low)"`,
    "  targets:",
    ...targets.map((t) => `    - { id: ${t.id}, status: ${t.status}${t.reason ? `, reason: "${t.reason}"` : `, frames: ${t.frames}, cpu: ${t.cpu}x, reduced_motion: ${t.reduced_motion}`} }`),
    "  findings:",
    ...(findings.length ? findings.map((f) => `    - { id: ${f.id}, spec: ${f.spec}, severity: ${f.severity}, kind: ${f.kind}, detail: ${JSON.stringify(f.detail)} }`) : ["    []"]),
  ];
  return lines.join("\n");
}

const parseJsonl = (text) => text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));

function selfTest() {
  const fixture = fileURLToPath(new URL("./fixtures/motion-results.jsonl", import.meta.url));
  const { targets, findings } = grade(parseJsonl(readFileSync(fixture, "utf8")));
  const kinds = (id) => findings.filter((f) => f.id === id).map((f) => f.kind).sort().join(",");
  const checks = [
    ["setState-per-frame flagged and ignores reduced motion", kinds("MP-bad"), "reduced-motion-ignored,render-per-frame"],
    ["CSS transform with reduced-motion query is clean", kinds("MP-good"), ""],
    ["width transition flagged and ignores reduced motion", kinds("MP-width"), "layout-property,reduced-motion-ignored"],
    ["every target profiled", targets.map((t) => t.status).join(","), "profiled,profiled,profiled"],
  ];
  let failed = 0;
  for (const [name, got, want] of checks) if (got !== want) { failed++; console.error(`FAIL ${name}: want "${want}", got "${got}"`); }
  const idle = grade([{ id: "MP-idle", spec: "S", pass: "no-preference", frames: 60, animations: [], moving_animations: [], non_composited: [], style_writes: { moving: 0 }, react: { commits: 1 } }]);
  if (idle.targets[0].status !== "not-exercised") { failed++; console.error("FAIL idle trigger must be not-exercised"); }
  const janky = grade([{ id: "MP-jank", spec: "S", pass: "no-preference", cpu_throttle: 4, frames: 40, skipped_frames: 12, frame_ms: { median: 8.3, p95: 33.2 }, long_animation_frames: [{ duration_ms: 140, scripts: [{ invoker: "FrameRequestCallback" }] }], cls: 0, animations: [{}], moving_animations: [], non_composited: [], style_writes: { moving: 0 }, react: { commits: 0 } }]);
  if (janky.findings.map((f) => f.kind).join() !== "jank") { failed++; console.error("FAIL p95 over 2x median must be jank"); }
  // getKeyframes() yields camelCase keys (maxHeight); a CSSTransition's transitionProperty is hyphenated (max-height).
  const anim = { target: "div.acc", kind: "CSSAnimation", name: "open", properties: ["maxHeight"], duration_ms: 300, iterations: 1 };
  const base = { id: "MP-max", spec: "S", cpu_throttle: 4, frames: 60, skipped_frames: 0, frame_ms: { median: 8.3, p95: 9.2 }, long_animation_frames: [], cls: 0, animations: [anim], non_composited: [anim], moving_animations: [anim], style_writes: { moving: 0, top_targets: [] }, react: { commits: 1 } };
  const maxH = grade([{ ...base, pass: "no-preference" }, { ...base, pass: "reduce" }]);
  const maxKinds = maxH.findings.map((f) => f.kind).sort().join(",");
  if (maxKinds !== "layout-property,reduced-motion-ignored") { failed++; console.error(`FAIL camelCase maxHeight: want "layout-property,reduced-motion-ignored", got "${maxKinds}"`); }
  console.log(failed ? `SELF-TEST ${failed} FAILED` : `SELF-TEST ${checks.length + 3}/${checks.length + 3} PASS`);
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) selfTest();
  else {
    try {
      if (!argv[0]) throw new Error("usage: grade-motion.mjs <results.jsonl> | --self-test");
      console.log(render(grade(parseJsonl(readFileSync(argv[0], "utf8")))));
    } catch (err) {
      console.error(`grade-motion: ${err.message}`);
      process.exit(2);
    }
  }
}
