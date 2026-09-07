#!/usr/bin/env node
// L2-detection — the bug-detection eval for the pr-reviewer detection core.
//
//   ANTHROPIC_API_KEY=… node scripts/eval/l2-detection.mjs
//   ANTHROPIC_API_KEY=… node scripts/eval/l2-detection.mjs --class consumer-break
//   EVAL_MODEL=…  EVAL_DETECTION_GATE=1  …
//
// Skips cleanly (exit 0) without an API key, like l2.mjs.
//
// WHY THIS IS A SEPARATE RUNNER, and not a suite in l2.mjs: every l2.mjs suite is a
// single-choice classification scored by exact match, with `max_tokens: 16`. Detection is not a
// classification — the question is "did the reviewer FIND the seeded defect, and how much noise
// did it produce on clean code", which needs free-form output, per-record scoring against an
// anchor, and a rate computed across records. Bending that into l2.mjs's shape would have meant
// asking the model "is there a bug here — yes or no", which measures nothing: a reviewer that
// answers yes to everything scores 100% recall.
//
// WHAT IT MEASURES — three numbers, because recall alone is gameable in one direction and
// precision alone in the other:
//
//   recall@class   over the SEEDED records: a hit needs a candidate at the seeded path, within
//                  ±LINE_TOLERANCE lines, AND carrying the right defect class. Finding "something
//                  wrong nearby" is not finding the defect.
//   fp_rate        over the CONTROL records — diffs with no seeded defect. A control is a false
//                  positive if any finding survives. Controls are the half that keeps a
//                  flag-everything finder from scoring well.
//   verifier_lift  the same two numbers computed twice: once over raw finder candidates, once over
//                  the verifier-confirmed subset. This is the only direct measurement of whether
//                  Phase E earns its cost, and it is the number that would have caught a verifier
//                  that rejects everything (recall collapses) or nothing (fp_rate does not move).
//
// The rubrics are read LIVE from the shipped rule files, so the eval always tests the instructions
// that are in effect — same discipline as l2.mjs's `rubric.section`.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./lib.mjs";

const MODEL = process.env.EVAL_MODEL || "claude-sonnet-4-6";
const KEY = process.env.ANTHROPIC_API_KEY;
const GATED = process.env.EVAL_DETECTION_GATE === "1";
const onlyClass = process.argv.includes("--class")
  ? process.argv[process.argv.indexOf("--class") + 1] : null;
const CONCURRENCY = Number(process.env.EVAL_CONCURRENCY || 4);

// A candidate counts as a hit only this close to the seeded line. Wider and a finder that flags
// the whole hunk scores a hit on every seeded defect in it; narrower and a legitimate finding on
// the guard clause two lines up would miss.
const LINE_TOLERANCE = 3;

const GATES = { recall: 0.7, fp: 0.2 };

const SELF_TEST = process.argv.includes("--self-test");

// ── Live rubrics ────────────────────────────────────────────────────────────────────────────────

const read = (p) => readFileSync(join(REPO_ROOT, p), "utf8");
const FINDERS = read("agents/pr-reviewer/rules/finders.md");
const VERIFIER = read("agents/shared/rules/finding-verifier.md");

const CLASSES = ["logic", "consumer-break", "dep-breaking-change", "intent-mismatch", "standards"];

const FINDER_SYSTEM = `You are the pr-reviewer's finder stage (Phase D). The rules that govern you:

${FINDERS}

You are reviewing one diff at the \`deep\` tier, so every finder in the table is active.

Emit ONLY a JSON array of candidate records, no prose, no code fence. Each record:

{"path": "<file the defect is IN>", "line": <line number in that file>, "defect_class": "<one of ${CLASSES.join(" | ")}>", "claim": "<one sentence>", "bad_outcome": "<what breaks, concretely>", "verify_by": "<the cheapest check that would settle it>"}

Emit [] if the diff is sound. Remember the polarity rule: you flag, a separate verifier filters.
Do not withhold a candidate because you are unsure — that is the verifier's decision, not yours.
But a candidate still needs a concrete \`bad_outcome\`; "this could be cleaner" is not one.`;

const VERIFIER_SYSTEM = `You are the pr-reviewer's finding verifier (Phase E). The rules that govern you:

${VERIFIER}

You receive one candidate and the code it was raised against. You do NOT know which finder produced
it, how confident that finder was, or how many other candidates exist.

Re-derive the claim from the code and reply with ONLY a JSON object, no prose, no code fence:

{"verdict": "confirmed" | "contradicted" | "ambiguous" | "unobtainable", "reason": "<one sentence>"}`;

// ── API ─────────────────────────────────────────────────────────────────────────────────────────

// The run's token bill, accumulated inside `ask()` itself.
//
// This DIVERGES from l2.mjs, which threads `usage` back to its caller and sums it there — with a
// comment arguing against "a module-level accumulator doing it invisibly". That reasoning is
// specific to l2.mjs: it stamps per-case telemetry spans, so each case's numbers must reach the
// case. This runner emits no telemetry, and it has a failure mode l2.mjs does not: a record makes
// 1 + N calls (one finder, one verifier per candidate) and can throw partway through, so a caller
// that sums only what `runRecord` RETURNS drops the tokens of every call that already billed
// before the throw. Counting at the one place a request is actually paid for cannot undercount.
let totalInTok = 0, totalOutTok = 0, totalCacheRead = 0, totalCacheWrite = 0;

async function ask(system, input, maxTokens) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        // Both system blocks are a live rule file plus a fixed harness preamble, and each is
        // BYTE-IDENTICAL on every call in the run: `FINDERS` (~2.5k tokens) is re-sent once per
        // record and `VERIFIER` (~2.4k) once per candidate — the candidate-side one being the
        // larger bill, since a 30-record run raises well over 30 candidates. Marking them
        // ephemeral makes the first call of each kind a 1.25× write and every later one a 0.1×
        // read. Same change l2.mjs already made, for the same reason, and it CANNOT move a
        // number here either: the model receives identical tokens either way, so this is a cost
        // change, not an eval change, and needs no re-baseline.
        //
        // Two runner-specific notes. `CONCURRENCY` is 4, so the first batch races and may pay up
        // to four writes instead of one before any cache exists to read — a fixed, bounded
        // overhead, not a defect. And the 5-minute TTL is refreshed on every read, so a run of
        // any length keeps both prefixes warm.
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: input }],
      }),
    });
    if (res.ok) {
      const body = await res.json();
      const u = body.usage;
      if (u) {
        totalInTok += u.input_tokens || 0;
        totalOutTok += u.output_tokens || 0;
        totalCacheRead += u.cache_read_input_tokens || 0;
        totalCacheWrite += u.cache_creation_input_tokens || 0;
      }
      return (body.content?.[0]?.text || "").trim();
    }
    // 429/5xx are transport, not signal: a retried record is still a real measurement, whereas a
    // record dropped on a rate limit silently shrinks the denominator and flatters the score.
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 160)}`);
  }
  throw new Error("API failed after 3 attempts");
}

// Whether the cache ENGAGED is a measured claim, not a code comment: a `cache_control` key the API
// silently declined and a working cache differ only on the invoice, which arrives days later and
// off this surface. The three-way notice is l2.mjs's, and the distinction it draws is the point —
// a prefix under the minimum cacheable length was never eligible ("nothing to discount"), which is
// a different fact from an eligible prefix that cached nothing ("MISSED", worth investigating).
const MIN_CACHEABLE_TOKENS = 1024;
const CHARS_PER_TOKEN = 4;

function cacheNote() {
  // Measure the PREFIX, not the prompt: only the system block carries `cache_control`, while
  // `input_tokens` also covers each call's user turn — which here is a whole diff plus, on the
  // verifier call, a candidate record. Dividing total input by call count would badly overstate
  // the cached part. Both system blocks are module constants, so the largest is known exactly.
  const prefixTok = Math.round(Math.max(FINDER_SYSTEM.length, VERIFIER_SYSTEM.length) / CHARS_PER_TOKEN);
  if (totalCacheRead || totalCacheWrite) {
    // Cost-equivalent, not a token count: a write is 1.25× a fresh input token and a read 0.1×,
    // so comparing raw totals understates the win. The counterfactual is that every read would
    // instead have been a full re-send — which is exactly what this runner did before.
    const equiv = totalInTok + totalCacheWrite + totalCacheRead;
    const costNow = totalInTok + totalCacheWrite * 1.25 + totalCacheRead * 0.1;
    const saved = equiv > 0 ? (1 - costNow / equiv) * 100 : 0;
    return ` · cache ${totalCacheRead.toLocaleString()} read / ${totalCacheWrite.toLocaleString()} written`
      + ` (~${saved.toFixed(0)}% lower input cost than re-sending each rubric)`;
  }
  if (prefixTok < MIN_CACHEABLE_TOKENS) {
    return ` · cache not applicable (largest cached prefix ~${prefixTok.toLocaleString()} tokens,`
      + ` below the ${MIN_CACHEABLE_TOKENS}-token minimum — nothing to discount, not a defect)`;
  }
  return ` · cache MISSED (no read, no write, and the prefix is ~${prefixTok.toLocaleString()} tokens —`
    + ` long enough to cache, so the rubrics are being re-billed per call)`;
}

// Models wrap JSON in fences despite instructions. Strip one fence, then parse. A parse failure is
// reported as a malformed record rather than silently treated as "no findings" — the two have
// opposite meanings for recall.
function parseJson(text, expect) {
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    const v = JSON.parse(stripped);
    if (expect === "array" && !Array.isArray(v)) return { error: "not an array" };
    if (expect === "object" && (Array.isArray(v) || typeof v !== "object" || v === null)) {
      return { error: "not an object" };
    }
    return { value: v };
  } catch (e) {
    return { error: `unparseable: ${String(e.message).slice(0, 60)}` };
  }
}

// ── Prompt bodies ───────────────────────────────────────────────────────────────────────────────

// Each optional field is a context surface a specific finder needs. Omitting the section entirely
// when the field is absent matters: an empty "Consumers:" heading tells the model there are none,
// which is a claim the golden record did not make.
function renderRecord(r) {
  const parts = [`Diff under review:\n\n\`\`\`diff\n${r.diff}\n\`\`\``];
  if (r.description) parts.push(`PR description (as written by the author):\n\n${r.description}`);
  if (r.consumers?.length) {
    parts.push("Consumers of the changed symbols, from the impact graph (these files are NOT in the diff):\n\n"
      + r.consumers.map((c) => `${c.path}:\n\`\`\`\n${c.excerpt}\n\`\`\``).join("\n\n"));
  }
  if (r.dependency) {
    const d = r.dependency;
    parts.push(`Dependency delta from the impact graph: \`${d.name}\` ${d.from} → ${d.to} (${d.delta}).\n`
      + `Upstream release notes for the range:\n\n${d.changelog}\n\n`
      + `Usage sites in this repository:\n\n`
      + d.usage_sites.map((u) => `${u.path}:${u.line}\n\`\`\`\n${u.excerpt}\n\`\`\``).join("\n\n"));
  }
  if (r.governing_doc) {
    parts.push(`Governing document for this repository (${r.governing_doc.path}):\n\n${r.governing_doc.excerpt}`);
  }
  return parts.join("\n\n---\n\n");
}

// ── Scoring ─────────────────────────────────────────────────────────────────────────────────────

function isHit(candidates, defect) {
  return candidates.some((c) =>
    String(c.path) === defect.path
    && Number.isFinite(Number(c.line))
    && Math.abs(Number(c.line) - defect.line) <= LINE_TOLERANCE
    && String(c.defect_class) === defect.defect_class);
}

async function runRecord(r) {
  const body = renderRecord(r);
  const raw = await ask(FINDER_SYSTEM, body, 2000);
  const parsed = parseJson(raw, "array");
  if (parsed.error) {
    return { id: r.id, class: r.class, malformed: parsed.error, candidates: [], confirmed: [] };
  }
  // Drop entries that are not usable candidate records at all. A record missing `path`/`line`
  // cannot be scored against an anchor and must not be counted as a finding in either direction.
  const candidates = parsed.value.filter((c) => c && typeof c === "object" && c.path && c.line);

  const confirmed = [];
  for (const c of candidates) {
    const v = await ask(VERIFIER_SYSTEM,
      `Candidate:\n\n${JSON.stringify(c, null, 2)}\n\n---\n\n${body}`, 300);
    const pv = parseJson(v, "object");
    // An unparseable verdict is not a confirmation. Failing closed here keeps a malformed verifier
    // reply from inflating the post-verifier numbers, which is the direction that would hide a
    // broken verifier behind a good-looking lift.
    if (!pv.error && pv.value.verdict === "confirmed") confirmed.push({ ...c, _reason: pv.value.reason });
  }
  return { id: r.id, class: r.class, candidates, confirmed, malformed: null };
}

// ── Golden set ──────────────────────────────────────────────────────────────────────────────────

const GOLDEN = join(REPO_ROOT, "scripts/eval/golden/bug-detection.jsonl");

// Validate before spending any tokens: a seeded record whose defect class is not in CLASSES can
// never be hit, and a control that carries a defect is counted in both denominators. Either way
// the run produces a number that looks like a model result and is actually a golden-set typo.
// Returns the list of problems rather than throwing, so `--self-test` can report all of them.
function validate(records) {
  const problems = [];
  const seen = new Set();
  for (const r of records) {
    if (!r.id) { problems.push("a record has no id"); continue; }
    if (seen.has(r.id)) problems.push(`${r.id}: duplicate id — the results map is keyed by id, so one would shadow the other`);
    seen.add(r.id);
    if (!r.diff) problems.push(`${r.id}: no diff`);
    if (r.class === "control") {
      if (r.defect) problems.push(`${r.id}: a control record must not carry a defect`);
      continue;
    }
    if (!CLASSES.includes(r.class)) {
      problems.push(`${r.id}: class ${r.class} is neither "control" nor one of ${CLASSES.join(", ")}`);
      continue;
    }
    if (!r.defect) { problems.push(`${r.id}: a seeded record must carry a defect anchor`); continue; }
    if (!r.defect.path || !Number.isFinite(Number(r.defect.line))) {
      problems.push(`${r.id}: the defect anchor needs a path and a numeric line`);
    }
    if (r.defect.defect_class !== r.class) {
      problems.push(`${r.id}: record class ${r.class} disagrees with defect_class ${r.defect.defect_class}`);
    }
    // The finder only sees the diff plus the optional context surfaces, so a defect anchored in a
    // file that appears in none of them is unfindable by construction and scores a guaranteed miss.
    const surfaces = [r.diff,
      ...(r.consumers || []).map((c) => c.path),
      ...(r.dependency?.usage_sites || []).map((u) => u.path),
      r.governing_doc?.path || ""].join("\n");
    if (!surfaces.includes(r.defect.path)) {
      problems.push(`${r.id}: defect path ${r.defect.path} appears in no surface the finder is shown`);
    }
  }
  return problems;
}

if (SELF_TEST) {
  let failed = 0;
  const t = (name, ok, detail = "") => {
    if (ok) console.log(`  ✓ ${name}`);
    else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
  };
  console.log("l2-detection self-test\n");

  if (!existsSync(GOLDEN)) {
    console.log(`  ✗ golden set present at ${GOLDEN}`);
    process.exit(1);
  }
  const recs = readFileSync(GOLDEN, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  const problems = validate(recs);
  t("the golden set is well-formed", problems.length === 0, problems.join("; "));

  // Both halves must be populated. Recall with no seeded records is vacuously perfect, and a
  // false-positive rate with no controls is `n/a` — which is how a detection eval reports a great
  // score while measuring nothing.
  const seededN = recs.filter((r) => r.class !== "control").length;
  const controlN = recs.filter((r) => r.class === "control").length;
  t("the golden set has seeded records", seededN >= 10, `${seededN}`);
  t("the golden set has controls", controlN >= 5, `${controlN}`);

  // A rate cannot be measured finer than one record, so the control count is what decides whether
  // `fp_rate` can express a verdict against its gate at all. At 10 controls the metric moved in
  // 10-point steps against a 20-point gate: the only readings available were 0, 10, 20, 30 — one
  // control was the whole distance between passing and failing by half again, and no amount of
  // rubric work could produce a value between them. That is a measurement fault, not a core fault,
  // and it is why the first five runs read 30 · 40 · 30 · ≤20 · 40 and looked like a flaky gate.
  //
  // The bar is FOUR tolerated dirty controls, which is the smallest count where the gate survives
  // one bad decoy and the rate has interior values to land on. The fix for a breach is more
  // controls; lowering GATES.fp to buy resolution would be the fix-to-pass this eval exists to
  // prevent, and lowering it would not buy resolution anyway — it shrinks the tolerated count.
  const tolerated = Math.floor(controlN * GATES.fp);
  t("fp_rate resolves finely enough to grade against its gate",
    tolerated >= 4, `${controlN} controls × ${GATES.fp} gate tolerates ${tolerated} dirty`);
  for (const c of CLASSES) {
    const n = recs.filter((r) => r.class === c).length;
    t(`class ${c} is represented`, n >= 2, `${n}`);
  }

  // isHit is the scoring predicate; all three of its conjuncts must be load-bearing, or the
  // measured recall is not measuring what the metric claims.
  const anchor = { path: "a.ts", line: 20, defect_class: "logic" };
  t("isHit matches on path + class within tolerance",
    isHit([{ path: "a.ts", line: 22, defect_class: "logic" }], anchor));
  t("isHit rejects a candidate outside the line tolerance",
    !isHit([{ path: "a.ts", line: 20 + LINE_TOLERANCE + 1, defect_class: "logic" }], anchor));
  t("isHit rejects the right line in the wrong file",
    !isHit([{ path: "b.ts", line: 20, defect_class: "logic" }], anchor));
  t("isHit rejects the right place with the wrong defect class",
    !isHit([{ path: "a.ts", line: 20, defect_class: "standards" }], anchor));
  t("isHit rejects a candidate with a non-numeric line",
    !isHit([{ path: "a.ts", line: "somewhere", defect_class: "logic" }], anchor));
  t("isHit is false on an empty candidate list", !isHit([], anchor));

  // A fenced reply is the common real case; a malformed one must be an error, never an empty
  // result — "no findings" and "the reply did not parse" have opposite meanings for both metrics.
  t("parseJson strips a json fence", parseJson('```json\n[{"a":1}]\n```', "array").value?.[0]?.a === 1);
  t("parseJson strips a bare fence", parseJson('```\n[]\n```', "array").value?.length === 0);
  t("parseJson reports an object where an array is expected",
    parseJson('{"verdict":"confirmed"}', "array").error !== undefined);
  t("parseJson reports unparseable text as an error, not as empty",
    parseJson("I could not find any issues.", "array").error !== undefined);
  t("parseJson accepts a verdict object", parseJson('{"verdict":"confirmed"}', "object").value.verdict === "confirmed");
  t("parseJson rejects an array where an object is expected",
    parseJson("[]", "object").error !== undefined);
  t("parseJson rejects a JSON null where an object is expected",
    parseJson("null", "object").error !== undefined);

  // The cache readout, offline. What makes it worth a self-test is that its three branches are
  // indistinguishable from a passing run: a silently-declined `cache_control` and a working cache
  // both produce correct accuracy numbers, and only this line tells them apart.
  //
  // The first assertion is the one that bites. Unlike l2.mjs — where three suites genuinely sit
  // under the bound and "not applicable" is the honest report — BOTH prefixes here are whole rule
  // files, so caching is expected to work and a MISSED is a real defect. If a rule file were
  // shrunk below the bound, this reds rather than the runner quietly starting to report
  // "nothing to discount" on a suite that used to be discounted.
  const prefixTok = Math.round(Math.max(FINDER_SYSTEM.length, VERIFIER_SYSTEM.length) / CHARS_PER_TOKEN);
  t("both system prefixes are long enough to cache", prefixTok >= MIN_CACHEABLE_TOKENS, `~${prefixTok} tokens`);

  const savedTotals = [totalInTok, totalOutTok, totalCacheRead, totalCacheWrite];
  totalInTok = 1000; totalCacheRead = 0; totalCacheWrite = 0;
  t("a long prefix with no cache activity reports MISSED, not 'not applicable'",
    cacheNote().includes("MISSED"));
  totalCacheRead = 10_000; totalCacheWrite = 2_500;
  const note = cacheNote();
  // Sign, not magnitude: a saving computed with the weights inverted (read 1.25×, write 0.1×)
  // would come out negative, which is the arithmetic slip this catches.
  t("cache activity reports a positive saving", /~[1-9][0-9]?% lower input cost/.test(note), note);
  [totalInTok, totalOutTok, totalCacheRead, totalCacheWrite] = savedTotals;

  console.log(failed ? `\n✗ ${failed} self-test failure(s)` : "\n✓ self-test passed");
  process.exit(failed ? 1 : 0);
}

// ── Main ────────────────────────────────────────────────────────────────────────────────────────

// Same rule as l2.mjs: a fork or a fresh clone skips, a run someone asked for fails.
// Exiting 0 with no key is what let 232 L2 runs report green having measured nothing.
if (!KEY) {
  if (process.env.EVAL_REQUIRE_KEY === "1") {
    console.error("✗ L2-detection: EVAL_REQUIRE_KEY is set but ANTHROPIC_API_KEY is empty — this run was asked for and cannot measure anything. Failing instead of exiting 0.");
    process.exit(3);
  }
  console.log("⊘ L2-detection: no ANTHROPIC_API_KEY — skipping (this is an LLM eval; set the key to run).");
  process.exit(0);
}

if (!existsSync(GOLDEN)) {
  console.error(`✗ L2-detection: golden set missing at ${GOLDEN}`);
  process.exit(1);
}
let records = readFileSync(GOLDEN, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
const problems = validate(records);
if (problems.length) {
  console.error(`✗ L2-detection: the golden set is malformed:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
// Controls are kept under --class: a per-class recall figure with no false-positive rate beside it
// is the half of the measurement that can be gamed by flagging everything.
if (onlyClass) records = records.filter((r) => r.class === onlyClass || r.class === "control");

console.log(`▶ L2-detection: ${records.length} records (${MODEL}), ${CONCURRENCY}-way\n`);

const results = [];
for (let i = 0; i < records.length; i += CONCURRENCY) {
  const batch = records.slice(i, i + CONCURRENCY);
  const settled = await Promise.allSettled(batch.map(runRecord));
  settled.forEach((s, j) => {
    if (s.status === "fulfilled") results.push(s.value);
    else results.push({ id: batch[j].id, class: batch[j].class, error: String(s.reason).slice(0, 120),
      candidates: [], confirmed: [], malformed: null });
  });
  process.stdout.write(`  ${Math.min(i + CONCURRENCY, records.length)}/${records.length}\r`);
}
console.log("");

const byId = new Map(records.map((r) => [r.id, r]));
const seeded = results.filter((r) => r.class !== "control");
const controls = results.filter((r) => r.class === "control");

const rate = (n, d) => (d === 0 ? null : n / d);
const pct = (v) => (v === null ? "n/a" : `${(v * 100).toFixed(0)}%`);

function measure(pick) {
  const hits = seeded.filter((r) => isHit(pick(r), byId.get(r.id).defect));
  const dirty = controls.filter((r) => pick(r).length > 0);
  return { recall: rate(hits.length, seeded.length), fp: rate(dirty.length, controls.length),
    hits: hits.length, dirty: dirty.length };
}

const rawM = measure((r) => r.candidates);
const verM = measure((r) => r.confirmed);

console.log("  stage           recall@class      fp_rate");
console.log(`  finder only     ${pct(rawM.recall).padEnd(17)} ${pct(rawM.fp)}   (${rawM.hits}/${seeded.length} seeded, ${rawM.dirty}/${controls.length} controls dirty)`);
console.log(`  + verifier      ${pct(verM.recall).padEnd(17)} ${pct(verM.fp)}   (${verM.hits}/${seeded.length} seeded, ${verM.dirty}/${controls.length} controls dirty)`);

// Lift is a joint claim, not two independent ones: the verifier is only earning its cost if it
// removes more noise than signal. Recall that drops as far as fp_rate is a filter with no opinion.
const fpDrop = (rawM.fp ?? 0) - (verM.fp ?? 0);
const recallDrop = (rawM.recall ?? 0) - (verM.recall ?? 0);
const lift = fpDrop - recallDrop;
console.log(`\n  verifier lift   ${lift >= 0 ? "+" : ""}${(lift * 100).toFixed(0)} pts  (fp −${(fpDrop * 100).toFixed(0)}, recall −${(recallDrop * 100).toFixed(0)})`);

console.log("\n  per class:");
for (const c of CLASSES) {
  const inClass = seeded.filter((r) => r.class === c);
  if (!inClass.length) continue;
  const h = inClass.filter((r) => isHit(r.confirmed, byId.get(r.id).defect)).length;
  console.log(`    ${c.padEnd(22)} ${h}/${inClass.length}`);
}

const broken = results.filter((r) => r.malformed || r.error);
if (broken.length) {
  console.log("\n  malformed / errored records (counted as misses, never as clean):");
  for (const b of broken) console.log(`    ${b.id}: ${b.malformed || b.error}`);
}

// Which controls survived, and on what claim. The seeded half has always printed its misses; the
// control half printed only a COUNT, so a red `fp_rate` said "six decoys got through" and nothing
// about which six or why — and the only work that moves that number is editing the two rubrics
// against the specific claims that survived. Guessing which decoy fooled the verifier is exactly
// the blind tuning the golden-set growth exists to prevent, so the diagnosis has to be printed.
//
// Both stages are shown, because they are different faults with different fixes: a control the
// finder never flagged is already clean, one the verifier dropped is the pipeline working, and one
// that survived BOTH is the only kind that costs a point. The surviving claim is quoted because
// the fix is usually visible in it — a claim naming a guard the code has is a Step 1 re-derivation
// miss, one naming a rule the file is exempt from is a scope miss.
const dirty = controls.filter((r) => r.confirmed.length > 0);
if (dirty.length) {
  console.log("\n  controls that survived the verifier (each one is a false positive):");
  for (const c of dirty) {
    console.log(`    ${c.id} — ${c.confirmed.length} of ${c.candidates.length} candidate(s) confirmed`);
    for (const f of c.confirmed) {
      console.log(`      ${f.path}:${f.line} [${f.defect_class}] ${String(f.claim ?? "").slice(0, 110)}`);
    }
  }
}
const filteredOut = controls.filter((r) => r.candidates.length > 0 && r.confirmed.length === 0);
if (filteredOut.length) {
  console.log(`\n  controls the verifier rescued (flagged then dropped): ${filteredOut.map((c) => c.id).join(", ")}`);
}

const misses = seeded.filter((r) => !isHit(r.confirmed, byId.get(r.id).defect));
if (misses.length) {
  console.log("\n  missed:");
  for (const m of misses) {
    const found = isHit(m.candidates, byId.get(m.id).defect) ? "found by the finder, dropped by the verifier" : "never flagged";
    console.log(`    ${m.id} (${m.class}) — ${found}`);
  }
}

// Printed BEFORE either exit below, so the run someone most wants the cost of — the one that just
// tripped the gate — still reports it. Accuracy is the product; this line is what makes the next
// person's decision about re-running, or about growing the golden set, an informed one.
if (totalInTok || totalOutTok) {
  console.log(`\n  tokens: ${totalInTok.toLocaleString()} input + ${totalOutTok.toLocaleString()} output${cacheNote()}`);
}

// Report-only by default; CI opts in with EVAL_DETECTION_GATE=1. The golden set is 50 records,
// which reaches the bar evals.md sets for a set worth gating on — but the two halves reach it
// unevenly and the local default stays report-only because of the weaker half: 30 controls put
// `fp_rate` on 3.3-point steps, while 20 seeded records still put recall on 5-point steps against
// a 70% gate, so a single case is a seventh of the distance to a breach. Grow the seeded half
// before reading a local recall delta as a trend.
if (!GATED) {
  console.log("\n⊘ report-only (set EVAL_DETECTION_GATE=1 to gate)");
  process.exit(0);
}

const failures = [];
if ((verM.recall ?? 0) < GATES.recall) failures.push(`recall@class ${pct(verM.recall)} < ${pct(GATES.recall)}`);
if ((verM.fp ?? 0) > GATES.fp) failures.push(`fp_rate ${pct(verM.fp)} > ${pct(GATES.fp)}`);
if (lift < 0) failures.push(`verifier lift is negative (${(lift * 100).toFixed(0)} pts) — it removes more signal than noise`);

if (failures.length) {
  console.log(`\n✗ L2-detection gate: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("\n✓ L2-detection gate passed");
