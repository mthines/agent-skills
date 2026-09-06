// OTLP telemetry for the eval harness — zero-dependency, best-effort, off by default.
//
// WHY the evals are worth instrumenting: a run is already a tree with a price tag
// on every leaf (run → suite → case, each case one model call). stdout tells you
// what today's accuracy was; it cannot tell you whether the tier-routing rubric has
// been drifting down for three weeks, or which suite is eating the token budget.
// Both of those are trend questions, and a trend needs a backend.
//
// WHY it is hand-rolled: the rest of this harness is node-builtins-only and runs
// with no `npm install` in CI (the workflow deliberately sets
// `package-manager-cache: false` and never installs). Pulling the OTel SDK would
// make the evals the only thing here that needs a dependency tree. OTLP/HTTP+JSON
// over `fetch` is a small enough surface to own — the same call this repo's sibling
// projects make from their own self-contained exporters.
//
// SHAPE (one flush, at exit — a batch process has no reason to stream):
//
//   trace   eval.run                     (INTERNAL) whole invocation
//             └ eval.suite <name>        (INTERNAL) one per suite
//                 └ eval.case <id>       (CLIENT)   one per model call
//   metrics eval.case.result             Sum,       delta, {eval.case.match}
//           eval.suite.accuracy          Gauge,     unit %
//           eval.case.duration           Histogram, unit s
//           gen_ai.client.token.usage    Histogram, unit {token}, {gen_ai.token.type}
//
// A case that MISSES is not an error — a wrong answer is the measurement, so the
// span status stays UNSET and only a transport/API failure sets ERROR. Attributes
// follow upstream OpenTelemetry semantic conventions wherever one exists (`gen_ai.*`
// is incubating and still preferred over inventing a local key); the `eval.*`
// namespace covers what upstream has no convention for. An attribute with no value
// to report is OMITTED, never emitted as a placeholder.
//
// CONFIG — standard OTel env vars, so no bespoke names to remember:
//
//   OTEL_EXPORTER_OTLP_ENDPOINT   e.g. https://ingress.eu-west-1.aws.dash0.com
//                                 REQUIRED — unset means telemetry is off entirely.
//   OTEL_EXPORTER_OTLP_HEADERS    e.g. "Authorization=Bearer auth_…,Dash0-Dataset=default"
//   OTEL_SERVICE_NAME             default "evals"
//   OTEL_RESOURCE_ATTRIBUTES      extra resource attrs, k=v,k=v
//
// Behind an egress proxy, run node with NODE_USE_ENV_PROXY=1 — node's built-in
// fetch ignores HTTPS_PROXY without it and the export fails with a misleading
// "host not in allowlist" from the wrong gateway.
//
// FAILURE POLICY: every export error is swallowed and reported to stderr only. An
// eval must never go red because a telemetry backend was unreachable — the accuracy
// number is the product, the span is the receipt.
import { randomBytes } from "node:crypto";
import { hostname } from "node:os";

const HEX = (bytes) => randomBytes(bytes).toString("hex");
const nowNs = () => String(BigInt(Date.now()) * 1_000_000n);
const hrNs = (ms) => String(BigInt(Math.round(ms * 1e6)));

/** OTLP/JSON AnyValue. Numbers split on integer-ness: an intValue for a count, a
 *  doubleValue for a rate — collapsing both to double loses the distinction and
 *  makes token counts render as 1.0e4 downstream. */
function anyValue(v) {
  if (typeof v === "boolean") return { boolValue: v };
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null; // NaN/Infinity has no OTLP encoding — omit.
    return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === "string") return { stringValue: v };
  return { stringValue: String(v) };
}

/** Encode an attribute bag, DROPPING null/undefined keys rather than emitting a
 *  placeholder — an absent attribute is queryable as absent, "unknown" is not. */
export function attrs(bag) {
  const out = [];
  for (const [key, raw] of Object.entries(bag)) {
    if (raw === null || raw === undefined || raw === "") continue;
    const value = anyValue(raw);
    if (value) out.push({ key, value });
  }
  return out;
}

function parseKv(s) {
  const out = {};
  for (const pair of (s || "").split(",")) {
    const i = pair.indexOf("=");
    if (i > 0) out[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  return out;
}

const HIST_BOUNDS = {
  // seconds — a classification call is ~0.5–5s; the tail is what a timeout looks like
  "eval.case.duration": [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60],
  // tokens — the rubric prompts here run from ~500 to ~17,000
  "gen_ai.client.token.usage": [16, 64, 256, 1024, 4096, 16384, 65536],
};

class Histogram {
  constructor(bounds) { this.bounds = bounds; this.count = 0; this.sum = 0; this.buckets = new Array(bounds.length + 1).fill(0); this.min = null; this.max = null; }
  record(v) {
    this.count++; this.sum += v;
    this.min = this.min === null ? v : Math.min(this.min, v);
    this.max = this.max === null ? v : Math.max(this.max, v);
    let i = 0;
    while (i < this.bounds.length && v > this.bounds[i]) i++;
    this.buckets[i]++;
  }
}

export class EvalTelemetry {
  constructor(env = process.env) {
    this.endpoint = (env.OTEL_EXPORTER_OTLP_ENDPOINT || "").replace(/\/+$/, "");
    this.enabled = this.endpoint !== "";
    this.headers = { "content-type": "application/json", ...parseKv(env.OTEL_EXPORTER_OTLP_HEADERS) };
    this.traceId = HEX(16);
    this.spans = [];
    this.sums = new Map();      // key -> { name, unit, points: Map<attrKey, {attributes, value}> }
    this.gauges = [];
    this.hists = new Map();     // "name|attrKey" -> { name, unit, attributes, hist }
    this.startNs = nowNs();

    const svc = env.OTEL_SERVICE_NAME || "evals";
    this.resource = attrs({
      "service.name": svc,
      "service.namespace": "agent-skills",
      "service.version": env.GITHUB_SHA ? env.GITHUB_SHA.slice(0, 7) : null,
      "deployment.environment.name": env.GITHUB_ACTIONS ? "ci" : "local",
      "host.name": hostname(),
      // upstream CI/CD + VCS conventions — these are what make a regression
      // attributable to a commit instead of to "some run last Tuesday"
      "cicd.pipeline.name": env.GITHUB_WORKFLOW,
      "cicd.pipeline.run.id": env.GITHUB_RUN_ID,
      "vcs.repository.url.full": env.GITHUB_REPOSITORY ? `https://github.com/${env.GITHUB_REPOSITORY}` : null,
      "vcs.ref.head.name": env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME,
      "vcs.ref.head.revision": env.GITHUB_SHA,
      ...parseKv(env.OTEL_RESOURCE_ATTRIBUTES),
    });
  }

  /** Open a span. Returns a handle; call `.end({...attrs})` to close it.
   *  A no-op handle is returned when telemetry is off, so callers need no `if`. */
  span(name, { parent = null, kind = 1, attributes = {} } = {}) {
    if (!this.enabled) return { spanId: null, end: () => {}, fail: () => {} };
    const spanId = HEX(8);
    const rec = {
      traceId: this.traceId, spanId, parentSpanId: parent || undefined,
      name, kind, startTimeUnixNano: nowNs(), endTimeUnixNano: null,
      attributes: attrs(attributes), status: { code: 0 },
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

  count(name, value, attributes = {}, unit = "1") {
    if (!this.enabled) return;
    if (!this.sums.has(name)) this.sums.set(name, { name, unit, points: new Map() });
    const s = this.sums.get(name);
    const encoded = attrs(attributes);
    const k = JSON.stringify(encoded);
    if (!s.points.has(k)) s.points.set(k, { attributes: encoded, value: 0 });
    s.points.get(k).value += value;
  }

  gauge(name, value, attributes = {}, unit = "1") {
    if (!this.enabled || !Number.isFinite(value)) return;
    this.gauges.push({ name, unit, attributes: attrs(attributes), value });
  }

  histogram(name, value, attributes = {}, unit = "1") {
    if (!this.enabled || !Number.isFinite(value)) return;
    const encoded = attrs(attributes);
    const k = `${name}|${JSON.stringify(encoded)}`;
    if (!this.hists.has(k)) this.hists.set(k, { name, unit, attributes: encoded, hist: new Histogram(HIST_BOUNDS[name] || [1, 10, 100, 1000]) });
    this.hists.get(k).hist.record(value);
  }

  /** OTLP ExportTraceServiceRequest. Exposed for the self-test. */
  tracePayload() {
    return {
      resourceSpans: [{
        resource: { attributes: this.resource },
        scopeSpans: [{
          scope: { name: "agent-skills/evals", version: "1" },
          // A span left open by a crash gets closed at flush time rather than
          // dropped: a truncated trace still shows where the run died.
          spans: this.spans.map((s) => ({ ...s, endTimeUnixNano: s.endTimeUnixNano || nowNs() })),
        }],
      }],
    };
  }

  /** OTLP ExportMetricsServiceRequest. Exposed for the self-test. */
  metricPayload() {
    const time = nowNs();
    const metrics = [];
    for (const s of this.sums.values()) {
      metrics.push({
        name: s.name, unit: s.unit,
        sum: {
          // DELTA: this process reports its own run's counts, not a running total.
          aggregationTemporality: 1, isMonotonic: true,
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
        name: h.name, unit: h.unit,
        histogram: {
          aggregationTemporality: 1,
          dataPoints: [{
            attributes: h.attributes, startTimeUnixNano: this.startNs, timeUnixNano: time,
            count: String(h.hist.count), sum: h.hist.sum,
            bucketCounts: h.hist.buckets.map(String), explicitBounds: h.hist.bounds,
            min: h.hist.min, max: h.hist.max,
          }],
        },
      });
    }
    if (metrics.length === 0) return null;
    return { resourceMetrics: [{ resource: { attributes: this.resource }, scopeMetrics: [{ scope: { name: "agent-skills/evals", version: "1" }, metrics }] }] };
  }

  async #post(path, body) {
    const res = await fetch(`${this.endpoint}${path}`, { method: "POST", headers: this.headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`${path} → ${res.status} ${(await res.text()).slice(0, 160)}`);
  }

  /** Ship everything. Never throws, never rejects — a dead backend is not an eval failure. */
  async flush() {
    if (!this.enabled) return { exported: false, reason: "OTEL_EXPORTER_OTLP_ENDPOINT unset" };
    const jobs = [["/v1/traces", this.tracePayload()]];
    const m = this.metricPayload();
    if (m) jobs.push(["/v1/metrics", m]);
    const errors = [];
    for (const [path, body] of jobs) {
      try { await this.#post(path, body); }
      catch (e) { errors.push(e.message); }
    }
    if (errors.length) {
      console.error(`⚠ telemetry export failed (evals still valid): ${errors.join(" | ")}`);
      return { exported: false, reason: errors.join(" | ") };
    }
    return { exported: true, traceId: this.traceId, spans: this.spans.length };
  }

  /** Dash0/Grafana-agnostic pointer for the log, so a run links to its own trace. */
  traceNote() {
    return this.enabled ? `trace_id=${this.traceId} → ${this.endpoint}` : "telemetry off (no OTEL_EXPORTER_OTLP_ENDPOINT)";
  }
}

// --- self-test: run offline, executed by l1.mjs so the encoding cannot silently rot ---
function selfTest() {
  const fails = [];
  const ok = (label, cond, detail = "") => { if (!cond) fails.push(`${label}${detail ? " — " + detail : ""}`); };

  // 1. Off by default: no endpoint ⇒ disabled, and flush neither throws nor fetches.
  const off = new EvalTelemetry({});
  ok("disabled without an endpoint", off.enabled === false);
  ok("disabled span handle is a no-op", off.span("x").spanId === null);
  ok("disabled flush reports why", off.flush() instanceof Promise);

  const t = new EvalTelemetry({
    OTEL_EXPORTER_OTLP_ENDPOINT: "https://ingress.example.com/",
    OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer tok,Dash0-Dataset=default",
    GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "mthines/agent-skills",
    GITHUB_SHA: "abcdef1234567890", GITHUB_RUN_ID: "42", GITHUB_WORKFLOW: "evals",
  });
  ok("enabled with an endpoint", t.enabled === true);
  ok("trailing slash trimmed", t.endpoint === "https://ingress.example.com");
  ok("headers parsed", t.headers.Authorization === "Bearer tok" && t.headers["Dash0-Dataset"] === "default");
  ok("content-type kept", t.headers["content-type"] === "application/json");

  // 2. Attribute encoding, including the omission rule.
  const a = attrs({ s: "x", i: 3, f: 0.5, b: false, nul: null, undef: undefined, empty: "", nan: NaN });
  const byKey = Object.fromEntries(a.map((x) => [x.key, x.value]));
  ok("string encodes", byKey.s?.stringValue === "x");
  ok("integer encodes as intValue", byKey.i?.intValue === "3");
  ok("fraction encodes as doubleValue", byKey.f?.doubleValue === 0.5);
  ok("false is kept, not dropped", byKey.b?.boolValue === false);
  ok("null/undefined/empty/NaN are omitted", a.length === 4, `got keys ${a.map((x) => x.key).join(",")}`);

  // 3. Resource carries the CI/VCS conventions.
  const rk = Object.fromEntries(t.resource.map((x) => [x.key, x.value.stringValue ?? x.value.intValue]));
  ok("service.name defaults to evals", rk["service.name"] === "evals");
  ok("environment is ci under GITHUB_ACTIONS", rk["deployment.environment.name"] === "ci");
  ok("repo url built from GITHUB_REPOSITORY", rk["vcs.repository.url.full"] === "https://github.com/mthines/agent-skills");
  ok("revision recorded", rk["vcs.ref.head.revision"] === "abcdef1234567890");

  // 4. Span tree: ids are the right width, parent links hold, a miss is NOT an error.
  const run = t.span("eval.run", { attributes: { "eval.layer": "l2" } });
  const suite = t.span("eval.suite bug-class", { parent: run.spanId });
  const miss = t.span("eval.case b1", { parent: suite.spanId, kind: 3 });
  miss.end({ "eval.case.match": false });
  const broke = t.span("eval.case b2", { parent: suite.spanId, kind: 3 });
  broke.fail("API 429");
  suite.end(); run.end();
  ok("traceId is 32 hex chars", /^[0-9a-f]{32}$/.test(t.traceId));
  ok("spanId is 16 hex chars", /^[0-9a-f]{16}$/.test(run.spanId));
  const spans = t.tracePayload().resourceSpans[0].scopeSpans[0].spans;
  ok("four spans recorded", spans.length === 4, `got ${spans.length}`);
  ok("case parents its suite", spans[2].parentSpanId === suite.spanId);
  ok("root has no parent", spans[0].parentSpanId === undefined);
  ok("a wrong answer is status UNSET", spans[2].status.code === 0);
  ok("an API failure is status ERROR", spans[3].status.code === 2);
  ok("every span is closed", spans.every((s) => s.endTimeUnixNano));
  ok("case span kind is CLIENT", spans[2].kind === 3);

  // 5. An unclosed span is still exported (a crashed run shows where it died).
  const t2 = new EvalTelemetry({ OTEL_EXPORTER_OTLP_ENDPOINT: "https://x" });
  t2.span("eval.run");
  ok("unclosed span gets an end time at flush", !!t2.tracePayload().resourceSpans[0].scopeSpans[0].spans[0].endTimeUnixNano);

  // 6. Metrics: sum aggregates by attribute set, histogram buckets by bound.
  t.count("eval.case.result", 1, { "eval.suite.name": "bug-class", "eval.case.match": true }, "{case}");
  t.count("eval.case.result", 1, { "eval.suite.name": "bug-class", "eval.case.match": true }, "{case}");
  t.count("eval.case.result", 1, { "eval.suite.name": "bug-class", "eval.case.match": false }, "{case}");
  t.gauge("eval.suite.accuracy", 66.7, { "eval.suite.name": "bug-class" }, "%");
  t.histogram("eval.case.duration", 0.3, { "eval.suite.name": "bug-class" }, "s");
  t.histogram("eval.case.duration", 40, { "eval.suite.name": "bug-class" }, "s");
  t.histogram("gen_ai.client.token.usage", 5000, { "gen_ai.token.type": "input" }, "{token}");
  const mp = t.metricPayload();
  const byName = Object.fromEntries(mp.resourceMetrics[0].scopeMetrics[0].metrics.map((m) => [m.name, m]));
  ok("sum splits on the match attribute", byName["eval.case.result"].sum.dataPoints.length === 2);
  ok("matching cases summed to 2", byName["eval.case.result"].sum.dataPoints.some((p) => p.asInt === "2"));
  ok("sum is DELTA and monotonic", byName["eval.case.result"].sum.aggregationTemporality === 1 && byName["eval.case.result"].sum.isMonotonic === true);
  ok("gauge carries a double", byName["eval.suite.accuracy"].gauge.dataPoints[0].asDouble === 66.7);
  const h = byName["eval.case.duration"].histogram.dataPoints[0];
  ok("histogram counted both observations", h.count === "2");
  ok("bucketCounts is bounds+1 long", h.bucketCounts.length === h.explicitBounds.length + 1);
  ok("0.3s lands in the (0.25,0.5] bucket", h.bucketCounts[2] === "1", `buckets ${h.bucketCounts.join(",")}`);
  ok("40s lands in the (30,60] bucket", h.bucketCounts[8] === "1", `buckets ${h.bucketCounts.join(",")}`);
  ok("nothing overflowed past 60s", h.bucketCounts[h.bucketCounts.length - 1] === "0");
  ok("histogram sum is the real total", Math.abs(h.sum - 40.3) < 1e-9);
  ok("semconv token metric present", !!byName["gen_ai.client.token.usage"]);
  ok("empty metric set exports nothing", new EvalTelemetry({ OTEL_EXPORTER_OTLP_ENDPOINT: "https://x" }).metricPayload() === null);

  // 7. An unreachable backend must not throw.
  return { fails };
}

if (process.argv.includes("--self-test")) {
  const { fails } = selfTest();
  // The transport half of the failure policy, exercised for real against a port
  // nothing is listening on — the whole point is that this resolves, not rejects.
  const dead = new EvalTelemetry({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:1" });
  dead.span("eval.run").end();
  const r = await dead.flush();
  if (r.exported !== false) fails.push("an unreachable backend must report exported:false");
  console.log(`${fails.length === 0 ? "✓" : "✗"} telemetry self-test: ${fails.length === 0 ? "all checks passed" : `${fails.length} failed`}`);
  for (const f of fails) console.log(`    ✗ ${f}`);
  process.exit(fails.length === 0 ? 0 : 1);
}
