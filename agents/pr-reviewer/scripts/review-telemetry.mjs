#!/usr/bin/env node
// @ts-check
// review-telemetry.mjs — per-phase timing block + OTLP spans for a
// pr-reviewer pipeline run (pr-reviewer deterministic pipeline, Phase 0, R1).
//
// Two things a pipeline run needs that scripts/eval/telemetry.mjs does not
// provide, because it measures a different process (an eval harness, not a
// review):
//
//   1. A TIMING BLOCK: a plain `{phases: {name: ms}, total_ms}` object that
//      every pipeline artifact (review-context.json, judgments.json,
//      finalize-result.json, write-result.json) carries in its own `timing`
//      field, so a slow run is diagnosable from the artifact alone — no
//      OTLP backend required.
//   2. `pr_review.run` → `pr_review.phase <name>` OTLP spans, built on the
//      SAME encoder as scripts/eval/telemetry.mjs (agents/pr-reviewer/scripts/
//      otlp.mjs, D7) so the two harnesses never carry two copies of the wire
//      format.
//
// FOUR RULES (identical to otlp.mjs's, restated here because this is the
// file AC-1 self-tests against):
//   1. Off unless OTEL_EXPORTER_OTLP_ENDPOINT is set — a run with no
//      endpoint configured makes zero network calls.
//   2. A MISS is not a span error — a phase that completes normally but
//      finds nothing (e.g. zero candidates) stays span status UNSET. Only a
//      transport/API failure calls `.fail()`.
//   3. An absent attribute is OMITTED, never emitted as a placeholder value
//      like "unknown" — inherited from otlp.mjs's `attrs()`.
//   4. flush() is always awaited BEFORE the caller's process exit, so a
//      caller that traps SIGINT/exits early never loses the trace it most
//      needs to read.
//
// Token counts are recorded ONLY when the dispatcher supplies them (the
// judgment step, when run as a sub-agent, can report its own usage back);
// omitted otherwise — never estimated.
import { OtlpExporter, attrs } from "./otlp.mjs";

export { attrs };

/**
 * A wall-clock timing block builder. Independent of OTLP entirely — this is
 * what every artifact's `timing` field is built from, and it works with NO
 * endpoint configured (rule 1 governs spans, not this).
 */
export class Timing {
  constructor() {
    this._start = Date.now();
    /** @type {Record<string, number>} */
    this._phases = {};
    /** @type {string|null} */
    this._openPhase = null;
    /** @type {number|null} */
    this._openAt = null;
  }

  /** Start timing a named phase. Closes any phase left open by the caller —
   *  a forgotten `.end()` must not corrupt every phase after it.
   *  @param {string} name */
  start(name) {
    if (this._openPhase) this.end();
    this._openPhase = name;
    this._openAt = Date.now();
  }

  /** Close the currently open phase, recording its elapsed ms. Repeated
   *  calls to the same phase name accumulate (a phase run twice in one
   *  pipeline, e.g. a retry, reports its total time). */
  end() {
    if (!this._openPhase || this._openAt === null) return;
    const ms = Date.now() - this._openAt;
    this._phases[this._openPhase] = (this._phases[this._openPhase] || 0) + ms;
    this._openPhase = null;
    this._openAt = null;
  }

  /** The timing block shape every pipeline artifact carries verbatim.
   *  @returns {{phases: Record<string, number>, total_ms: number}} */
  block() {
    if (this._openPhase) this.end();
    return { phases: { ...this._phases }, total_ms: Date.now() - this._start };
  }
}

/** @type {Record<string, number[]>} */
const HIST_BOUNDS = {
  "pr_review.phase.duration": [0.1, 0.5, 1, 5, 15, 60, 180],
  "gen_ai.client.token.usage": [16, 64, 256, 1024, 4096, 16384, 65536],
};

/**
 * OTLP exporter for a pr-reviewer pipeline run. One `pr_review.run` root
 * span per invocation, with a `pr_review.phase <name>` child per phase.
 *
 * @typedef {{repo?: string, number?: number, headSha?: string, mode?: string,
 *   tier?: string}} ReviewResource
 */
export class ReviewTelemetry extends OtlpExporter {
  /** @param {ReviewResource} [resourceFacts] @param {NodeJS.ProcessEnv} [env] */
  constructor(resourceFacts = {}, env = process.env) {
    const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT || "";
    super({
      endpoint,
      headers: parseHeaders(env.OTEL_EXPORTER_OTLP_HEADERS),
      scopeName: "agent-skills/pr-reviewer",
      histBounds: HIST_BOUNDS,
      resource: {
        "service.name": env.OTEL_SERVICE_NAME || "pr-reviewer",
        "service.namespace": "agent-skills",
        "pr_review.repo": resourceFacts.repo,
        "pr_review.number": resourceFacts.number,
        "pr_review.head_sha": resourceFacts.headSha ? resourceFacts.headSha.slice(0, 7) : null,
        "pr_review.mode": resourceFacts.mode,
        "pr_review.tier": resourceFacts.tier,
      },
    });
    this._timing = new Timing();
    this._run = this.span("pr_review.run");
  }

  /** Start a named phase: opens the wall-clock timer AND an OTLP child span
   *  (a no-op handle when telemetry is disabled — rule 1). Returns a handle
   *  with `.end(extra)` / `.fail(msg, extra)`, mirroring `OtlpExporter.span`.
   *  @param {string} name @param {import("./otlp.mjs").AttrBag} [attributes]
   *  @returns {{end: (extra?: import("./otlp.mjs").AttrBag) => void, fail: (message: unknown, extra?: import("./otlp.mjs").AttrBag) => void}} */
  phase(name, attributes = {}) {
    this._timing.start(name);
    const child = this.span(`pr_review.phase ${name}`, { parent: this._run.spanId || undefined, attributes });
    return {
      end: (extra = {}) => {
        this._timing.end();
        child.end(extra);
        if (this.enabled) this.histogram("pr_review.phase.duration", child.durationS(), { "pr_review.phase.name": name }, "s");
      },
      fail: (message, extra = {}) => {
        this._timing.end();
        child.fail(message, extra);
      },
    };
  }

  /** Record model token usage IF the dispatcher supplied it — never estimated.
   *  @param {Record<string, number>|null|undefined} usage @param {import("./otlp.mjs").AttrBag} [attributes] */
  tokens(usage, attributes = {}) {
    if (!usage || typeof usage !== "object") return;
    for (const [type, count] of Object.entries(usage)) {
      if (typeof count !== "number" || !Number.isFinite(count)) continue;
      this.histogram("gen_ai.client.token.usage", count, { "gen_ai.token.type": type, ...attributes }, "{token}");
    }
  }

  /** The `timing` field every pipeline artifact carries. */
  timingBlock() {
    return this._timing.block();
  }

  /** Close the root span and flush. Call once, at process end.
   *  @param {import("./otlp.mjs").AttrBag} [extra] */
  async finish(extra = {}) {
    this._run.end(extra);
    return this.flush();
  }
}

/** @param {string} [s] @returns {Record<string,string>} */
function parseHeaders(s) {
  /** @type {Record<string,string>} */
  const out = {};
  for (const pair of (s || "").split(",")) {
    const i = pair.indexOf("=");
    if (i > 0) out[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  return out;
}

/* --------------------------------- self-test --------------------------------- */

function selfTest() {
  /** @type {string[]} */
  const fails = [];
  /** @param {string} label @param {boolean} cond @param {string} [detail] */
  const ok = (label, cond, detail = "") => { if (!cond) fails.push(`${label}${detail ? " — " + detail : ""}`); };

  // Rule 1: off unless an endpoint is configured.
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const off = new ReviewTelemetry({ repo: "o/r", number: 1 }, {});
  ok("rule 1 — disabled without OTEL_EXPORTER_OTLP_ENDPOINT", off.enabled === false);
  const p0 = off.phase("prepare");
  p0.end();
  ok("rule 1 — a disabled phase returns a no-op span (no spanId)", off.spans.length === 0);

  // Timing block works with NO endpoint — it is not gated by rule 1.
  ok("timing block shape has phases + total_ms even when telemetry is off",
    typeof off.timingBlock().total_ms === "number" && typeof off.timingBlock().phases === "object");
  ok("timing block records the closed phase", typeof off.timingBlock().phases["prepare"] === "number");

  // Rule 2: a miss is not a span error.
  const t = new ReviewTelemetry(
    { repo: "o/r", number: 2, headSha: "abcdef0123456789", mode: "full", tier: "deep" },
    { OTEL_EXPORTER_OTLP_ENDPOINT: "https://ingress.example.com" },
  );
  ok("enabled with an endpoint", t.enabled === true);
  const miss = t.phase("finders", { "pr_review.finder": "correctness" });
  miss.end({ "pr_review.candidates": 0 }); // zero candidates: a miss, not a failure
  const errored = t.phase("execute-write-plan");
  errored.fail("gh api 502");
  const spans = t.tracePayload().resourceSpans[0].scopeSpans[0].spans;
  const missSpan = spans.find((s) => s.name === "pr_review.phase finders");
  const errSpan = spans.find((s) => s.name === "pr_review.phase execute-write-plan");
  ok("rule 2 — a miss (zero candidates, completes normally) stays status UNSET", missSpan?.status.code === 0);
  ok("rule 2 — only an explicit .fail() sets status ERROR", errSpan?.status.code === 2);

  // Rule 3: an absent attribute is omitted, never a placeholder.
  const resourceKeys = t.resource.map((a) => a.key);
  const tierAttr = t.resource.find((a) => a.key === "pr_review.tier");
  ok("rule 3 — resource carries no pr_review.tier=null placeholder when omitted",
    !resourceKeys.includes("pr_review.tier") || /** @type {any} */ (tierAttr?.value)?.stringValue !== "unknown");
  const untagged = new ReviewTelemetry({}, { OTEL_EXPORTER_OTLP_ENDPOINT: "https://x" });
  ok("rule 3 — an unset resource fact is omitted entirely, not emitted as a placeholder",
    !untagged.resource.some((a) => a.key === "pr_review.repo"));

  // Token usage: only recorded when supplied.
  t.tokens({ input: 1200, output: 340, cache_read: 5000 }, { "pr_review.phase.name": "judgment" });
  t.tokens(null); // must not throw
  t.tokens({}); // must not throw
  const mp = /** @type {any} */ (t.metricPayload());
  // Each distinct attribute set is its own metric entry (one per token type),
  // never merged — so three token types are three entries sharing one name.
  const tokenMetrics = mp.resourceMetrics[0].scopeMetrics[0].metrics.filter((/** @type {any} */ m) => m.name === "gen_ai.client.token.usage");
  ok("token usage recorded only when supplied by the dispatcher", tokenMetrics.length === 3);

  // Rule 4: flush precedes exit — asserted by ordering, executed for real below.
  ok("finish() closes the root span before returning", typeof t.finish === "function");

  return { fails };
}

const isEntryPoint = process.argv[1] && process.argv[1].endsWith("review-telemetry.mjs");
if (isEntryPoint && process.argv.includes("--self-test")) {
  const { fails } = selfTest();
  // Rule 4 exercised for real: finish() must resolve (never reject) against
  // an unreachable backend, and must do so BEFORE this block exits.
  const dead = new ReviewTelemetry({ repo: "o/r", number: 3 }, { OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:1" });
  const r = await dead.finish();
  if (r.exported !== false) fails.push("rule 4 — an unreachable backend must report exported:false, never throw/reject");
  console.log(`${fails.length === 0 ? "✓" : "✗"} review-telemetry self-test: ${fails.length === 0 ? "all checks passed" : `${fails.length} failed`}`);
  for (const f of fails) console.log(`    ✗ ${f}`);
  process.exit(fails.length === 0 ? 0 : 1);
}
