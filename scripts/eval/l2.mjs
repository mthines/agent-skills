#!/usr/bin/env node
// L2 — Behavioral evals (data-driven). Each suite feeds a skill's LIVE rubric
// section + a labelled input to a model and exact-matches the model's choice
// against the human label. Classification tasks → exact-match, no LLM-as-judge.
//
//   ANTHROPIC_API_KEY=… node scripts/eval/l2.mjs            # all suites
//   ANTHROPIC_API_KEY=… node scripts/eval/l2.mjs --suite bug-class
//   EVAL_MODEL=…  EVAL_GATE=70  …                            # override actor / soft-gate
//
// Report-only unless EVAL_GATE is set (golden sets are < 50 — evals.md calls that
// statistically noisy). Skips cleanly (exit 0) without an API key.
//
// The suite table lives in ./suites.mjs — shared with select-suites.mjs (which maps
// a changed-file list to the affected subset) and l1.mjs's G21 guards, so there is
// one definition of what each suite reads. Add a suite there.
//
// Telemetry (traces + metrics, OTLP) is emitted when OTEL_EXPORTER_OTLP_ENDPOINT is
// set and is otherwise entirely off — see ./telemetry.mjs. It is best-effort: an
// unreachable backend prints a warning and changes neither the accuracy nor the
// exit code.
import { readFileSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, extractSection } from "./lib.mjs";
import { SUITES } from "./suites.mjs";
import { EvalTelemetry } from "./telemetry.mjs";

const MODEL = process.env.EVAL_MODEL || "claude-sonnet-4-6";
const KEY = process.env.ANTHROPIC_API_KEY;
const GATE = process.env.EVAL_GATE ? Number(process.env.EVAL_GATE) : null;
const only = process.argv.includes("--suite") ? process.argv[process.argv.indexOf("--suite") + 1] : null;

// An unknown --suite must be LOUD. CI drives this flag from a generated matrix, and
// the run-nothing-and-exit-0 alternative reports a typo (or a renamed suite whose
// selector entry was missed) as a passing eval — the same silent-green failure mode
// the missing API key had.
if (only !== null && !SUITES.some((s) => s.name === only)) {
  console.error(`✗ L2: unknown suite "${only}". Known: ${SUITES.map((s) => s.name).join(", ")}`);
  process.exit(2);
}

if (!KEY) {
  console.log("⊘ L2: no ANTHROPIC_API_KEY — skipping (these are LLM evals; set the key to run).");
  process.exit(0);
}

// extractSection is heading-level-aware and shared from lib.mjs so l1.mjs's G21g
// "eval actually contains a rubric" guard exercises the exact extraction this runs.

// Returns the reply text AND the usage, because the token count is half of what
// makes a run worth recording: accuracy says whether the rubric works, tokens say
// what asking cost. `usage` is null when the response omits it, and a null is
// omitted from telemetry rather than reported as a zero.
async function ask(system, input) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 16, system, messages: [{ role: "user", content: input }] }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const body = await res.json();
  return { text: (body.content?.[0]?.text || "").trim(), usage: body.usage || null };
}

// Pick the choice that appears earliest in the model's reply (case-insensitive).
function parseChoice(text, choices) {
  const low = text.toLowerCase();
  let best = null, bestIdx = Infinity;
  for (const c of choices) {
    const idx = low.indexOf(c.toLowerCase());
    if (idx >= 0 && idx < bestIdx) { best = c; bestIdx = idx; }
  }
  return best || `?(${text.slice(0, 24)})`;
}

const summary = [];
let anyBelowGate = false;

const T = new EvalTelemetry();
const runSpan = T.span("eval.run", {
  attributes: {
    "eval.layer": "l2", "eval.model": MODEL,
    "eval.suite.filter": only, // omitted on a full run — absent means "all suites"
    "eval.gate.floor": GATE,
  },
});
let totalCases = 0, totalPass = 0, totalInTok = 0, totalOutTok = 0;

for (const suite of SUITES) {
  if (only && suite.name !== only) continue;
  const goldenPath = join(REPO_ROOT, "scripts/eval", suite.golden);
  if (!existsSync(goldenPath)) { console.log(`(skip ${suite.name}: no golden file)`); continue; }
  const rubric = extractSection(suite.rubric.file, suite.rubric.section);
  const system = `${suite.instruction}\nReply with exactly one of: ${suite.choices.join(", ")}. No explanation.\n\n${rubric}`;
  const cases = readFileSync(goldenPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

  console.log(`\n## ${suite.name} (${cases.length} cases)`);
  const suiteSpan = T.span(`eval.suite ${suite.name}`, {
    parent: runSpan.spanId,
    attributes: {
      "eval.suite.name": suite.name, "eval.case.count": cases.length,
      "eval.rubric.file": suite.rubric.file,
      "eval.rubric.section": suite.rubric.section, // omitted for a whole-file rubric
      // The rubric is the bulk of every prompt in the suite, so this is the one
      // number that explains a suite's share of the bill.
      "eval.rubric.chars": rubric.length,
    },
  });
  const results = [];
  for (const c of cases) {
    const caseSpan = T.span(`eval.case ${c.id}`, {
      parent: suiteSpan.spanId,
      kind: 3, // CLIENT — this span wraps the outbound model call
      attributes: {
        "eval.suite.name": suite.name, "eval.case.id": c.id, "eval.case.expected": c.expected,
        "gen_ai.operation.name": "chat", "gen_ai.request.model": MODEL, "gen_ai.provider.name": "anthropic",
      },
    });
    let got, usage = null, apiError = null;
    try {
      const r = await ask(system, `${suite.inputLabel}: ${c[suite.inputKey]}`);
      usage = r.usage;
      got = parseChoice(r.text, suite.choices);
    } catch (e) { apiError = e.message; got = `ERR(${e.message.slice(0, 30)})`; }
    const ok = got === c.expected;

    // A wrong answer is the measurement, not a fault — only a transport/API failure
    // is a span error. Conflating the two makes every rubric regression look like an
    // outage in the trace list.
    const caseAttrs = {
      "eval.case.actual": got, "eval.case.match": ok,
      "gen_ai.usage.input_tokens": usage?.input_tokens ?? null,
      "gen_ai.usage.output_tokens": usage?.output_tokens ?? null,
    };
    if (apiError) caseSpan.fail(apiError, caseAttrs); else caseSpan.end(caseAttrs);

    T.count("eval.case.result", 1, { "eval.suite.name": suite.name, "eval.case.match": ok, "eval.model": MODEL }, "{case}");
    T.histogram("eval.case.duration", caseSpan.durationS?.() ?? 0, { "eval.suite.name": suite.name }, "s");
    if (usage?.input_tokens) {
      T.histogram("gen_ai.client.token.usage", usage.input_tokens, { "gen_ai.token.type": "input", "gen_ai.request.model": MODEL, "eval.suite.name": suite.name }, "{token}");
      totalInTok += usage.input_tokens;
    }
    if (usage?.output_tokens) {
      T.histogram("gen_ai.client.token.usage", usage.output_tokens, { "gen_ai.token.type": "output", "gen_ai.request.model": MODEL, "eval.suite.name": suite.name }, "{token}");
      totalOutTok += usage.output_tokens;
    }

    results.push({ id: c.id, expected: c.expected, got, ok, input: c[suite.inputKey] });
    console.log(`  ${ok ? "✓" : "✗"} ${c.id}: expected ${c.expected}, got ${got}`);
  }
  const pass = results.filter((r) => r.ok).length;
  const acc = (pass / results.length) * 100;
  console.log(`  → ${suite.name}: ${pass}/${results.length} (${acc.toFixed(1)}%)`);
  const misses = results.filter((r) => !r.ok);
  for (const m of misses) console.log(`    miss ${m.id}: ${m.expected}→${m.got}  «${m.input}»`);
  summary.push({ name: suite.name, pass, total: results.length, acc, misses });
  if (GATE !== null && acc < GATE) anyBelowGate = true;

  totalCases += results.length; totalPass += pass;
  T.gauge("eval.suite.accuracy", acc, { "eval.suite.name": suite.name, "eval.model": MODEL }, "%");
  suiteSpan.end({
    "eval.suite.pass": pass, "eval.suite.accuracy": acc,
    "eval.suite.below_gate": GATE !== null ? acc < GATE : null,
  });
}

console.log(`\n=== L2 summary (model=${MODEL}) ===`);
for (const s of summary) console.log(`  ${s.name}: ${s.pass}/${s.total} (${s.acc.toFixed(1)}%)`);

const runAcc = totalCases ? (totalPass / totalCases) * 100 : null;
runSpan.end({
  "eval.suite.count": summary.length, "eval.case.count": totalCases, "eval.pass.count": totalPass,
  "eval.accuracy": runAcc, "eval.gate.breached": GATE !== null ? anyBelowGate : null,
  "gen_ai.usage.input_tokens": totalInTok || null, "gen_ai.usage.output_tokens": totalOutTok || null,
});
if (runAcc !== null) T.gauge("eval.run.accuracy", runAcc, { "eval.model": MODEL, "eval.layer": "l2" }, "%");
// Flushed BEFORE the gate exit below, so a red run still ships its own trace —
// the failing run is the one you most want to look at.
const exported = await T.flush();
console.log(`  telemetry: ${T.traceNote()}${exported.exported ? "" : " (not exported)"}`);

if (process.env.GITHUB_STEP_SUMMARY) {
  let md = `### L2 behavioral evals — model \`${MODEL}\`\n\n| suite | accuracy | misses |\n| --- | --- | --- |\n`;
  for (const s of summary) md += `| ${s.name} | ${s.pass}/${s.total} (${s.acc.toFixed(1)}%) | ${s.misses.map((m) => `${m.id}:${m.expected}→${m.got}`).join("; ") || "—"} |\n`;
  // What the run cost, next to what it measured — the two numbers are read together
  // when deciding whether a suite is worth its token bill.
  if (totalInTok || totalOutTok) md += `\n${totalCases} cases · ${totalInTok.toLocaleString()} input + ${totalOutTok.toLocaleString()} output tokens\n`;
  if (T.enabled) md += `\n<sup>trace \`${T.traceId}\`</sup>\n`;
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}

if (GATE !== null && anyBelowGate) {
  console.error(`\n✗ a suite is below the EVAL_GATE floor of ${GATE}%`);
  process.exit(1);
}
process.exit(0);
