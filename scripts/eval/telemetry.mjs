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
// The wire-format encoder and the exporter mechanics (span tree, sum/gauge/
// histogram metrics, the flush) live in `agents/pr-reviewer/scripts/otlp.mjs`
// (pr-reviewer deterministic pipeline, D7) — `review-telemetry.mjs` shares the
// same encoder rather than a second copy. This file keeps its own API and its
// own `--self-test` unchanged; it now BUILDS on the shared exporter instead of
// implementing it, so it owns only what is eval-specific: the GitHub Actions /
// VCS resource attributes and the eval-specific histogram bucket bounds.
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
import { hostname } from "node:os";
import { attrs, parseKv, OtlpExporter } from "../../agents/pr-reviewer/scripts/otlp.mjs";

export { attrs };

const HIST_BOUNDS = {
  // seconds — a classification call is ~0.5–5s; the tail is what a timeout looks like
  "eval.case.duration": [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60],
  // tokens — the rubric prompts here run from ~500 to ~17,000
  "gen_ai.client.token.usage": [16, 64, 256, 1024, 4096, 16384, 65536],
};

export class EvalTelemetry extends OtlpExporter {
  constructor(env = process.env) {
    const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT || "";
    const headers = parseKv(env.OTEL_EXPORTER_OTLP_HEADERS);
    const svc = env.OTEL_SERVICE_NAME || "evals";
    const resource = {
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
    };
    super({ endpoint, headers, resource, scopeName: "agent-skills/evals", histBounds: HIST_BOUNDS });
  }

  /** Backend-agnostic pointer for the log, so a run links to its own trace. */
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

// Entry-point-gated for the same reason otlp.mjs's own block is: `process.argv`
// is process-global, so importing otlp.mjs must not let ITS `--self-test` block
// fire as a side effect of this file's `--self-test` run.
const isEntryPoint = process.argv[1] && process.argv[1].endsWith("telemetry.mjs");
if (isEntryPoint && process.argv.includes("--self-test")) {
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
