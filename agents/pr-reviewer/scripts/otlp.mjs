// @ts-check
// otlp.mjs — zero-dependency OTLP/HTTP+JSON encoder + exporter core.
//
// Extracted from scripts/eval/telemetry.mjs (pr-reviewer deterministic
// pipeline, D7) so agents/pr-reviewer/scripts/review-telemetry.mjs can share
// ONE encoder rather than a second copy. Agent0 copies only the `agents/`
// tree when it builds its bundle (build-agent0-bundle.mjs), so an
// `agents/` → `scripts/eval/` import would silently break the hosted path;
// extracting the shared half down into `agents/` and having
// `scripts/eval/telemetry.mjs` import IT (the opposite direction) keeps one
// encoder with no broken import in either consumer.
//
// This file owns the wire format and the exporter mechanics. It does NOT
// build a resource — callers pass their own resource attributes (eval runs
// carry `vcs.*`/`cicd.*` GitHub Actions facts; pr-review runs carry PR/run
// facts) because "what identifies this process" is caller-specific and
// "how an OTLP payload is shaped" is not.
//
// FAILURE POLICY: every export error is swallowed and reported to stderr
// only — telemetry must never fail the thing it is measuring. A case/run
// that MISSES is not a span error: the span status stays UNSET and only a
// transport/API failure sets ERROR. An attribute with no value is OMITTED,
// never emitted as a placeholder. flush() always runs before its caller's
// process exit.
import { randomBytes } from "node:crypto";

/** @param {number} bytes */
export const HEX = (bytes) => randomBytes(bytes).toString("hex");
export const nowNs = () => String(BigInt(Date.now()) * 1_000_000n);

/** Per-request export budget. Two posts per flush (traces, then metrics), so
 *  the worst case a dead ingress can cost the caller is twice this. */
export const POST_TIMEOUT_MS = 10_000;

/**
 * @typedef {{boolValue: boolean}|{intValue: string}|{doubleValue: number}|{stringValue: string}} AnyValue
 * @typedef {{key: string, value: AnyValue}} Attribute
 * @typedef {string|number|boolean|null|undefined} AttrScalar
 * @typedef {Record<string, AttrScalar>} AttrBag
 * @typedef {{code: number, message?: string}} SpanStatus
 * @typedef {{traceId: string, spanId: string, parentSpanId?: string,
 *   name: string, kind: number, startTimeUnixNano: string,
 *   endTimeUnixNano: string|null, attributes: Attribute[], status: SpanStatus}} SpanRecord
 * @typedef {{spanId: string|null, durationS: () => number,
 *   end: (extra?: AttrBag) => void, fail: (message: unknown, extra?: AttrBag) => void}} SpanHandle
 */

/** OTLP/JSON AnyValue. Numbers split on integer-ness: an intValue for a
 *  count, a doubleValue for a rate — collapsing both to double loses the
 *  distinction and makes token counts render as 1.0e4 downstream.
 *  @param {AttrScalar} v @returns {AnyValue|null} */
export function anyValue(v) {
  if (typeof v === "boolean") return { boolValue: v };
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null; // NaN/Infinity has no OTLP encoding — omit.
    return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === "string") return { stringValue: v };
  return null;
}

/** Encode an attribute bag, DROPPING null/undefined/empty keys rather than
 *  emitting a placeholder — an absent attribute is queryable as absent,
 *  "unknown" is not.
 *  @param {AttrBag} bag @returns {Attribute[]} */
export function attrs(bag) {
  /** @type {Attribute[]} */
  const out = [];
  for (const [key, raw] of Object.entries(bag)) {
    if (raw === null || raw === undefined || raw === "") continue;
    const value = anyValue(raw);
    if (value) out.push({ key, value });
  }
  return out;
}

/** @param {string} [s] @returns {Record<string,string>} */
export function parseKv(s) {
  /** @type {Record<string,string>} */
  const out = {};
  for (const pair of (s || "").split(",")) {
    const i = pair.indexOf("=");
    if (i > 0) out[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  return out;
}

export class Histogram {
  /** @param {number[]} bounds */
  constructor(bounds) {
    this.bounds = bounds;
    this.count = 0;
    this.sum = 0;
    /** @type {number[]} */
    this.buckets = new Array(bounds.length + 1).fill(0);
    /** @type {number|null} */
    this.min = null;
    /** @type {number|null} */
    this.max = null;
  }
  /** @param {number} v */
  record(v) {
    this.count++;
    this.sum += v;
    this.min = this.min === null ? v : Math.min(this.min, v);
    this.max = this.max === null ? v : Math.max(this.max, v);
    let i = 0;
    while (i < this.bounds.length && v > this.bounds[i]) i++;
    this.buckets[i]++;
  }
}

/**
 * @typedef {{name: string, unit: string, points: Map<string, {attributes: Attribute[], value: number}>}} SumMetric
 * @typedef {{name: string, unit: string, attributes: Attribute[], value: number}} GaugePoint
 * @typedef {{name: string, unit: string, attributes: Attribute[], hist: Histogram}} HistMetric
 * @typedef {{endpoint?: string, headers?: Record<string,string>,
 *   resource?: AttrBag, scopeName?: string, scopeVersion?: string,
 *   histBounds?: Record<string, number[]>}} OtlpExporterOpts
 */

/**
 * A generic OTLP exporter: span tree + sum/gauge/histogram metrics, one
 * flush at exit. Off unless `endpoint` is non-empty. Caller supplies the
 * resource attribute bag (already attrs()-shaped is NOT required — pass raw
 * values, this constructor encodes them) and per-metric-name histogram
 * bucket bounds.
 */
export class OtlpExporter {
  /** @param {OtlpExporterOpts} [opts] */
  constructor({
    endpoint = "",
    headers = {},
    resource = {},
    scopeName = "agent-skills",
    scopeVersion = "1",
    histBounds = {},
  } = {}) {
    this.endpoint = (endpoint || "").replace(/\/+$/, "");
    this.enabled = this.endpoint !== "";
    /** @type {Record<string,string>} */
    this.headers = { "content-type": "application/json", ...headers };
    this.traceId = HEX(16);
    /** @type {SpanRecord[]} */
    this.spans = [];
    /** @type {Map<string, SumMetric>} */
    this.sums = new Map();
    /** @type {GaugePoint[]} */
    this.gauges = [];
    /** @type {Map<string, HistMetric>} */
    this.hists = new Map();
    this.startNs = nowNs();
    this.resource = attrs(resource);
    this.scopeName = scopeName;
    this.scopeVersion = scopeVersion;
    this.histBounds = histBounds;
  }

  /** Open a span. Returns a handle; call `.end({...attrs})` to close it.
   *  A no-op handle is returned when telemetry is off, so callers need no `if`.
   *  @param {string} name
   *  @param {{parent?: string|null, kind?: number, attributes?: AttrBag}} [opts]
   *  @returns {SpanHandle} */
  span(name, { parent = null, kind = 1, attributes = {} } = {}) {
    if (!this.enabled) return { spanId: null, durationS: () => 0, end: () => {}, fail: () => {} };
    const spanId = HEX(8);
    /** @type {SpanRecord} */
    const rec = {
      traceId: this.traceId,
      spanId,
      parentSpanId: parent || undefined,
      name,
      kind,
      startTimeUnixNano: nowNs(),
      endTimeUnixNano: null,
      attributes: attrs(attributes),
      status: { code: 0 },
    };
    this.spans.push(rec);
    const t0 = performance.now();
    return {
      spanId,
      durationS: () => (performance.now() - t0) / 1000,
      end: (extra = {}) => {
        rec.endTimeUnixNano = nowNs();
        rec.attributes = rec.attributes.concat(attrs(extra));
      },
      fail: (message, extra = {}) => {
        rec.endTimeUnixNano = nowNs();
        rec.attributes = rec.attributes.concat(attrs({ "error.type": "export_or_api_error", ...extra }));
        rec.status = { code: 2, message: String(message).slice(0, 300) };
      },
    };
  }

  /** @param {string} name @param {number} value @param {AttrBag} [attributes] @param {string} [unit] */
  count(name, value, attributes = {}, unit = "1") {
    if (!this.enabled) return;
    if (!this.sums.has(name)) this.sums.set(name, { name, unit, points: new Map() });
    const s = /** @type {SumMetric} */ (this.sums.get(name));
    const encoded = attrs(attributes);
    const k = JSON.stringify(encoded);
    if (!s.points.has(k)) s.points.set(k, { attributes: encoded, value: 0 });
    /** @type {{attributes: Attribute[], value: number}} */ (s.points.get(k)).value += value;
  }

  /** @param {string} name @param {number} value @param {AttrBag} [attributes] @param {string} [unit] */
  gauge(name, value, attributes = {}, unit = "1") {
    if (!this.enabled || !Number.isFinite(value)) return;
    this.gauges.push({ name, unit, attributes: attrs(attributes), value });
  }

  /** @param {string} name @param {number} value @param {AttrBag} [attributes] @param {string} [unit] */
  histogram(name, value, attributes = {}, unit = "1") {
    if (!this.enabled || !Number.isFinite(value)) return;
    const encoded = attrs(attributes);
    const k = `${name}|${JSON.stringify(encoded)}`;
    if (!this.hists.has(k)) {
      this.hists.set(k, { name, unit, attributes: encoded, hist: new Histogram(this.histBounds[name] || [1, 10, 100, 1000]) });
    }
    /** @type {HistMetric} */ (this.hists.get(k)).hist.record(value);
  }

  /** OTLP ExportTraceServiceRequest. Exposed for self-tests. */
  tracePayload() {
    return {
      resourceSpans: [
        {
          resource: { attributes: this.resource },
          scopeSpans: [
            {
              scope: { name: this.scopeName, version: this.scopeVersion },
              // A span left open by a crash gets closed at flush time rather than
              // dropped: a truncated trace still shows where the run died.
              spans: this.spans.map((s) => ({ ...s, endTimeUnixNano: s.endTimeUnixNano || nowNs() })),
            },
          ],
        },
      ],
    };
  }

  /** OTLP ExportMetricsServiceRequest. Exposed for self-tests. @returns {object|null} */
  metricPayload() {
    const time = nowNs();
    /** @type {object[]} */
    const metrics = [];
    for (const s of this.sums.values()) {
      metrics.push({
        name: s.name,
        unit: s.unit,
        sum: {
          // DELTA: this process reports its own run's counts, not a running total.
          aggregationTemporality: 1,
          isMonotonic: true,
          dataPoints: [...s.points.values()].map((p) => ({
            attributes: p.attributes, startTimeUnixNano: this.startNs, timeUnixNano: time, asInt: String(p.value),
          })),
        },
      });
    }
    for (const g of this.gauges) {
      metrics.push({ name: g.name, unit: g.unit, gauge: { dataPoints: [{ attributes: g.attributes, timeUnixNano: time, asDouble: g.value }] } });
    }
    for (const h of this.hists.values()) {
      metrics.push({
        name: h.name,
        unit: h.unit,
        histogram: {
          aggregationTemporality: 1,
          dataPoints: [
            {
              attributes: h.attributes, startTimeUnixNano: this.startNs, timeUnixNano: time,
              count: String(h.hist.count), sum: h.hist.sum,
              bucketCounts: h.hist.buckets.map(String), explicitBounds: h.hist.bounds,
              min: h.hist.min, max: h.hist.max,
            },
          ],
        },
      });
    }
    if (metrics.length === 0) return null;
    return { resourceMetrics: [{ resource: { attributes: this.resource }, scopeMetrics: [{ scope: { name: this.scopeName, version: this.scopeVersion }, metrics }] }] };
  }

  /** @param {string} path @param {object} body */
  async #post(path, body) {
    // Node's fetch has no default timeout, and flush() is normally awaited
    // BEFORE a caller's own exit — so an unresponsive ingress would hold the
    // whole process open until an external cap killed it, losing the very
    // result telemetry exists to report alongside. A timeout turns that into
    // what it already is everywhere else here: an export failure, caught by
    // flush(), never a caller failure.
    const res = await fetch(`${this.endpoint}${path}`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(POST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`${path} → ${res.status} ${(await res.text()).slice(0, 160)}`);
  }

  /** Ship everything. Never throws, never rejects — a dead backend is not a caller failure.
   *  @returns {Promise<{exported: boolean, reason?: string, traceId?: string, spans?: number}>} */
  async flush() {
    if (!this.enabled) return { exported: false, reason: "OTEL_EXPORTER_OTLP_ENDPOINT unset" };
    /** @type {[string, object][]} */
    const jobs = [["/v1/traces", this.tracePayload()]];
    const m = this.metricPayload();
    if (m) jobs.push(["/v1/metrics", m]);
    /** @type {string[]} */
    const errors = [];
    for (const [path, body] of jobs) {
      try {
        await this.#post(path, body);
      } catch (e) {
        errors.push(/** @type {Error} */ (e).message);
      }
    }
    if (errors.length) {
      console.error(`⚠ telemetry export failed (run still valid): ${errors.join(" | ")}`);
      return { exported: false, reason: errors.join(" | ") };
    }
    return { exported: true, traceId: this.traceId, spans: this.spans.length };
  }

  /** Backend-agnostic pointer for a log line, so a run links to its own trace. */
  traceNote() {
    return this.enabled ? `trace_id=${this.traceId} → ${this.endpoint}` : "telemetry off (no OTEL_EXPORTER_OTLP_ENDPOINT)";
  }
}

// --- self-test: run offline, executed by L1 so the encoding cannot silently rot ---
function selfTest() {
  /** @type {string[]} */
  const fails = [];
  /** @param {string} label @param {boolean} cond @param {string} [detail] */
  const ok = (label, cond, detail = "") => { if (!cond) fails.push(`${label}${detail ? " — " + detail : ""}`); };

  const off = new OtlpExporter({});
  ok("disabled without an endpoint", off.enabled === false);
  ok("disabled span handle is a no-op", off.span("x").spanId === null);

  const a = attrs({ s: "x", i: 3, f: 0.5, b: false, nul: null, undef: undefined, empty: "", nan: NaN });
  const byKey = Object.fromEntries(a.map((x) => [x.key, x.value]));
  ok("string encodes", /** @type {any} */ (byKey.s)?.stringValue === "x");
  ok("integer encodes as intValue", /** @type {any} */ (byKey.i)?.intValue === "3");
  ok("fraction encodes as doubleValue", /** @type {any} */ (byKey.f)?.doubleValue === 0.5);
  ok("false is kept, not dropped", /** @type {any} */ (byKey.b)?.boolValue === false);
  ok("null/undefined/empty/NaN are omitted", a.length === 4, `got keys ${a.map((x) => x.key).join(",")}`);

  const t = new OtlpExporter({
    endpoint: "https://ingress.example.com/",
    headers: parseKv("Authorization=Bearer tok,Dash0-Dataset=default"),
    resource: { "service.name": "x" },
    scopeName: "test-scope",
    histBounds: { "d": [1, 2, 3] },
  });
  ok("enabled with an endpoint", t.enabled === true);
  ok("trailing slash trimmed", t.endpoint === "https://ingress.example.com");
  ok("headers parsed", t.headers.Authorization === "Bearer tok");

  const run = t.span("run", { attributes: { a: 1 } });
  const child = t.span("child", { parent: run.spanId, kind: 3 });
  child.end({ "eval.case.match": false });
  const broke = t.span("broke", { parent: run.spanId, kind: 3 });
  broke.fail("API 429");
  run.end();
  ok("traceId is 32 hex chars", /^[0-9a-f]{32}$/.test(t.traceId));
  const spans = t.tracePayload().resourceSpans[0].scopeSpans[0].spans;
  ok("three spans recorded", spans.length === 3, `got ${spans.length}`);
  ok("child parents its run", spans[1].parentSpanId === run.spanId);
  ok("a wrong answer (no fail()) is status UNSET", spans[1].status.code === 0);
  ok("an explicit fail() is status ERROR", spans[2].status.code === 2);
  ok("every span is closed", spans.every((s) => s.endTimeUnixNano));

  t.count("c", 1, { k: "a" });
  t.count("c", 1, { k: "a" });
  t.count("c", 1, { k: "b" });
  t.gauge("g", 66.7, {});
  t.histogram("d", 1.5, {});
  t.histogram("d", 40, {});
  const mp = /** @type {any} */ (t.metricPayload());
  const byName = Object.fromEntries(mp.resourceMetrics[0].scopeMetrics[0].metrics.map((/** @type {any} */ m) => [m.name, m]));
  ok("sum splits on the attribute", byName.c.sum.dataPoints.length === 2);
  ok("sum is DELTA and monotonic", byName.c.sum.aggregationTemporality === 1 && byName.c.sum.isMonotonic === true);
  ok("gauge carries a double", byName.g.gauge.dataPoints[0].asDouble === 66.7);
  const h = byName.d.histogram.dataPoints[0];
  ok("histogram counted both observations", h.count === "2");
  ok("bucketCounts is bounds+1 long", h.bucketCounts.length === h.explicitBounds.length + 1);
  ok("empty metric set exports nothing", new OtlpExporter({ endpoint: "https://x" }).metricPayload() === null);

  return { fails };
}

// Guarded by BOTH `--self-test` and entry-point identity: `process.argv` is a
// process-global, so a sibling module (review-telemetry.mjs, telemetry.mjs)
// that merely IMPORTS this file while ITS OWN `--self-test` runs would
// otherwise trigger this block too, as a side effect of module evaluation —
// silently swallowing the importer's real self-test output.
const isEntryPoint = process.argv[1] && process.argv[1].endsWith("otlp.mjs");
if (isEntryPoint && process.argv.includes("--self-test")) {
  const { fails } = selfTest();
  const dead = new OtlpExporter({ endpoint: "http://127.0.0.1:1" });
  dead.span("run").end();
  const r = await dead.flush();
  if (r.exported !== false) fails.push("an unreachable backend must report exported:false");
  console.log(`${fails.length === 0 ? "✓" : "✗"} otlp self-test: ${fails.length === 0 ? "all checks passed" : `${fails.length} failed`}`);
  for (const f of fails) console.log(`    ✗ ${f}`);
  process.exit(fails.length === 0 ? 0 : 1);
}
