#!/usr/bin/env node
// L2 — Behavioral evals (data-driven). Each suite feeds a skill's LIVE rubric
// section + a labelled input to a model and exact-matches the model's choice
// against the human label. Classification tasks → exact-match, no LLM-as-judge.
//
//   ANTHROPIC_API_KEY=… node scripts/eval/l2.mjs                    # all suites
//   ANTHROPIC_API_KEY=… node scripts/eval/l2.mjs --suite bug-class
//   ANTHROPIC_API_KEY=… node scripts/eval/l2.mjs --suite a,b,c      # a selected subset
//   EVAL_MODEL=…  EVAL_GATE=70  …                                   # override actor / soft-gate
//
// Report-only unless EVAL_GATE is set (golden sets are < 50 — evals.md calls that
// statistically noisy). Skips cleanly (exit 0) without an API key.
//
// The suite table — which rubric each suite reads, which golden set labels it, and how
// to add one — lives in ./suites.mjs, because two other consumers need the same table:
// select-suites.mjs (which maps a changed-file list to the affected subset) and l1.mjs's
// G21 guards. Add a suite there.
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
// A suite this small cannot be gated meaningfully: below 10 cases one case moves
// accuracy by ≥ 10 points, so a 70% floor is decided by a single coin flip rather
// than by the rubric's health (5 cases ⇒ the floor allows exactly one miss). Such a
// suite is still RUN and still REPORTED — it just cannot breach the gate, and the
// runner says so on the line where its accuracy is printed. evals.md's "< 50 golden
// items is statistically noisy" is the same argument; 10 is the point where the
// blanket EVAL_GATE stops measuring anything at all.
const GATE_MIN_CASES = process.env.EVAL_GATE_MIN_CASES ? Number(process.env.EVAL_GATE_MIN_CASES) : 10;

// `--suite` takes one name or a comma-separated LIST, and it is always parsed to an
// array — never left as a string. The selection is tested with `.includes()`, and a
// String's `.includes` is a SUBSTRING test: `--suite tier` would have matched
// `tier-routing`, running a suite nobody named and reporting it as the one requested.
// An array makes that an exact-membership test, which is what the unknown-name guard
// below then has something to reject.
//
// The list form is also what would let one process run several suites; CI does not use
// it (one suite per matrix job, so a red suite names itself in the check list), but a
// hand-run `--suite a,b` works and the accounting below covers the whole run.
const onlyArg = process.argv.includes("--suite") ? process.argv[process.argv.indexOf("--suite") + 1] : null;
const only = onlyArg === null || onlyArg === undefined
  ? null
  : onlyArg.split(",").map((n) => n.trim()).filter(Boolean);

// An unknown --suite must be LOUD. CI drives this flag from a generated matrix, and
// the run-nothing-and-exit-0 alternative reports a typo (or a renamed suite whose
// selector entry was missed) as a passing eval — a green that graded nothing, which
// on a check page is indistinguishable from a green that graded everything. Same
// silent-green failure mode the missing API key had.
//
// This runs BEFORE the key check on purpose: a misspelled suite name is wrong whether
// or not a key is present, and diagnosing it should not depend on having one. There is
// exactly ONE such guard — a second copy further down was unreachable behind this one
// and exited a different code, so a caller branching on the exit read a value nothing
// could produce.
//
// The list form adds a SECOND way to grade nothing, and it is now the likelier one:
// `--suite ""`, or a bare `--suite` at the end of argv, parses to an EMPTY selection
// rather than to "all". CI passes a computed value here, so a selector that returned
// no suites or a shell that expanded an unset variable would otherwise report a
// passing eval run. It gets its own exit code because it has its own remedy — fix the
// caller, not the spelling.
if (only !== null && only.length === 0) {
  console.error("✗ L2: --suite was given an empty selection. Omit the flag to run every suite; an empty value grades nothing and is never a pass.");
  process.exit(5);
}
const unknownSuites = only === null ? [] : only.filter((n) => !SUITES.some((s) => s.name === n));
if (unknownSuites.length > 0) {
  console.error(`✗ L2: unknown suite ${unknownSuites.map((n) => JSON.stringify(n)).join(", ")}. Known: ${SUITES.map((s) => s.name).join(", ")}`);
  process.exit(2);
}

// A missing key is a legitimate skip for a fork or a fresh clone, and a silent
// FAILURE for a run that was explicitly asked for. 232 consecutive CI runs were
// green because the secret was unset — a green check that proves nothing is worse
// than a red one, so the caller that opted in sets EVAL_REQUIRE_KEY and gets a
// non-zero exit instead of a pass.
if (!KEY) {
  if (process.env.EVAL_REQUIRE_KEY === "1") {
    console.error("✗ L2: EVAL_REQUIRE_KEY is set but ANTHROPIC_API_KEY is empty — this run was asked for and cannot measure anything. Failing instead of exiting 0.");
    process.exit(3);
  }
  console.log("⊘ L2: no ANTHROPIC_API_KEY — skipping (these are LLM evals; set the key to run).");
  process.exit(0);
}

// extractSection is heading-level-aware and shared from lib.mjs so l1.mjs's G21g
// "eval actually contains a rubric" guard exercises the exact extraction this runs.

/**
 * Resolve a suite's rubric text. `section` (a heading literal, or `null` for the whole file)
 * is the single-slice form; `sections` is an ordered list joined by a blank line, for a
 * decision whose owning prose is split across sibling subsections. Fails CLOSED on the two
 * ways this can silently produce an empty or wrong rubric — an empty list, and both keys set
 * (where `sections` would win while `section: null` still reads as "whole file" to a reader).
 */
function rubricFor(suite) {
  const { file, section, sections } = suite.rubric;
  if (sections === undefined) return extractSection(file, section);
  if (section !== undefined) {
    throw new Error(`suite ${suite.name}: set rubric.section OR rubric.sections, not both`);
  }
  if (!Array.isArray(sections) || sections.length === 0) {
    throw new Error(`suite ${suite.name}: rubric.sections must be a non-empty array`);
  }
  return sections.map((s) => extractSection(file, s)).join("\n\n");
}

// The system prompt (instruction + rubric) is IDENTICAL for every case in a suite,
// and the rubric is the bulk of it — shape-depth-routing re-sent the same 2,641
// tokens 22 times. Marking it `cache_control: ephemeral` makes case 1 pay a 1.25×
// write and every later case a 0.1× read, which is ~80% off the suite's input bill.
// Two conditions: the cache needs a ≥ 1024-token prefix, and the 5-minute TTL
// comfortably covers a suite that finishes in under 90 seconds. It cannot change an
// answer — the same tokens reach the model either way — so it is a pure cost change,
// not an eval change.
//
// THREE suites fall under the prefix bound, not two, and they are not all cheap.
// Measured from the live rubrics: `reviewer-agreement-bump` ~317 tokens, `bug-class`
// ~405, and `tier-routing` ~935 — which misses the bound by under 90 tokens while
// being the LARGEST uncached bill in the run (30 cases × ~1k = 30,168 input tokens,
// more than any cached suite pays after its discount). So "nothing is lost when they
// miss" is false for that one; a real discount is unavailable to the most expensive
// suite here. Padding a rubric to reach the bound would be writing for the biller
// instead of the reader, so the loss is accepted and named rather than engineered
// away — but do not repeat the claim that it costs nothing.
//
// Whether the cache actually engaged is a MEASURED claim here, not a code comment: the
// per-case `usage` below is summed into the run's cache-read / cache-write totals and
// printed. Without that, a working cache and a `cache_control` key the API silently
// ignored differ only on the invoice, which arrives days later and off this surface.
async function ask(system, input) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16,
      // The system block is the suite's instruction + its LIVE rubric, and it is
      // BYTE-IDENTICAL across every case in a suite — only the user turn varies. Sent as a
      // bare string it was re-transmitted and re-billed once per case, which is the whole
      // cost of this eval: `code-review-retrieval-relevance` re-sent the same ~7.4k-token
      // rubric 14 times, 105k input tokens for 14 one-word answers, and a full nine-suite
      // run measured ~273k input against ~2.4k output. Marking it ephemeral makes case 1 a
      // cache WRITE and cases 2..n cache READS at a tenth of the price.
      //
      // Applied unconditionally on purpose: a block below the model's minimum cacheable
      // length is not an error, the API just declines to cache it, so the three small-rubric
      // suites (tier-routing, bug-class, reviewer-agreement-bump) are unaffected rather than
      // broken. Cases run sequentially ~0.2s apart, far inside the 5-minute TTL.
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: input }],
    }),
  });
  // 600 chars, not 120: an Anthropic error body opens with ~30 chars of JSON envelope
  // (`{"type":"error","error":{"type":…`) before it reaches the human-readable `message`,
  // and a model-not-found or context-length message can run past 120 on its own. This is
  // the only place the API's own explanation enters the process, so truncating it here
  // cannot be undone downstream.
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 600)}`);
  const body = await res.json();
  // Returns the reply text AND the usage, because the token count is half of what makes a
  // run worth recording: accuracy says whether the rubric works, tokens say what asking
  // cost. The caller sums them per case (so each case span carries its own numbers) rather
  // than a module-level accumulator doing it invisibly. `usage` is null when the response
  // omits it, and a null is omitted from telemetry rather than reported as a zero.
  return { text: (body.content?.[0]?.text || "").trim(), usage: body.usage || null };
}

/**
 * Read the model's choice, and refuse to guess when the reply names more than one.
 *
 * The prior rule was "whichever choice appears earliest wins", which silently
 * converted an ENUMERATION into a confident answer: a rubric that asks the agent to
 * emit a structured block (autonomous-workflow's `MODE SELECTION:` is the live case)
 * outranks the harness's "reply with exactly one of", and its template line lists
 * every choice — `- Tier: [Micro | Lite | Full]`. Earliest-substring scored that as
 * `Micro`, the first element, which is how all five tier-routing misses landed on one
 * label and read as a model that thinks a cross-cutting refactor is a one-file typo.
 *
 * An ambiguous reply is still a miss — it is just an HONEST one, printed with the raw
 * text so the next reader can tell a wrong answer from a wrong parse.
 */
function parseChoice(text, choices) {
  const t = text.trim();
  const eq = choices.find((c) => c.toLowerCase() === t.toLowerCase());
  if (eq) return eq;
  // A bracketed placeholder is scaffolding, not a claim: `Tier: Full [not Micro]`
  // names one choice, and `[Micro | Lite | Full]` names none.
  const low = t.replace(/\[[^\]]*\]/g, " ").toLowerCase();
  const named = choices.filter((c) => low.includes(c.toLowerCase()));
  // Prefer the LONGEST match. Two suites have nested choices — `optimal` is a
  // substring of `suboptimal`, `promoted` of `not-promoted` — so saying the longer
  // one necessarily "names" the shorter one too, and a bare `named.length === 1`
  // test made every reply but the byte-exact one ambiguous: `suboptimal.` scored
  // `?(…)`, a miss indistinguishable from a wrong answer. Dropping a choice that
  // another matched choice contains leaves exactly the one that was said.
  //
  // Known and accepted residue: for a nested pair this weakens the enumeration
  // guard, because containment is the ONLY evidence available. `optimal |
  // suboptimal` now reads as `suboptimal` rather than ambiguous. That is the right
  // trade — the guard's live case is a rubric's own bracketed template line, which
  // the bracket strip above already removes, so the loss is hypothetical while the
  // defect it fixes was systematic. Do NOT "restore" ambiguity here without
  // re-reading G21l's nested-choice checks, which pin both halves.
  const top = named.filter((c) =>
    !named.some((o) => o !== c && o.toLowerCase().includes(c.toLowerCase())));
  if (top.length === 1) return top[0];
  return `?(${t.slice(0, 40).replace(/\s+/g, " ")})`;
}

const summary = [];
let anyBelowGate = false;
// Distinct API error messages → how many cases hit each. A blanket transport failure is one
// entry with a count equal to the whole run; a genuine per-case problem is a small count.
const apiErrors = new Map();

const T = new EvalTelemetry();
const runSpan = T.span("eval.run", {
  attributes: {
    "eval.layer": "l2", "eval.model": MODEL,
    // Joined explicitly rather than letting an array fall through to String(): the
    // encoder's fallback would produce the same text, but relying on it makes the
    // attribute's type an accident of the parse form. Omitted on a full run, where
    // `only` is null — absent means "all suites", which is not the same as empty.
    "eval.suite.filter": only === null ? null : only.join(","),
    "eval.gate.floor": GATE,
  },
});
let totalCases = 0, totalPass = 0, totalInTok = 0, totalOutTok = 0, totalCacheRead = 0, totalCacheWrite = 0;
// Largest system block (instruction + rubric) built this run — the only part `ask()`
// marks cacheable. Read by the cache note at the end; see the comment there.
let maxSystemChars = 0;

for (const suite of SUITES) {
  if (only !== null && !only.includes(suite.name)) continue;
  const goldenPath = join(REPO_ROOT, "scripts/eval", suite.golden);
  // A suite in the table with no cases to run is a BROKEN TABLE, not a skip. Deleting
  // its golden file used to print `(skip …)` and an emptied one ran zero cases, scored
  // NaN%, and could not breach the floor because `results.length >= GATE_MIN_CASES`
  // fails — so the run exited 0 either way. That is the third door of the same
  // silent-green class this file already closes for an unknown `--suite` and an absent
  // API key, and it is the worst of the three: the suite still appears in the summary.
  if (!existsSync(goldenPath)) {
    console.error(`✗ L2: ${suite.name} is in the suite table but its golden file is missing (${suite.golden}). Delete the SUITES entry too, or restore the file.`);
    process.exit(4);
  }
  const rubric = rubricFor(suite);
  const system = `${suite.instruction}\nReply with exactly one of: ${suite.choices.join(", ")}. No explanation.\n\n${rubric}`;
  maxSystemChars = Math.max(maxSystemChars, system.length);
  const cases = readFileSync(goldenPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  if (cases.length === 0) {
    console.error(`✗ L2: ${suite.name} has an EMPTY golden file (${suite.golden}) — zero cases scores NaN% and cannot breach the gate.`);
    process.exit(4);
  }

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
    let got, usage = null, apiError = null, raw = null;
    try {
      const r = await ask(system, `${suite.inputLabel}: ${c[suite.inputKey]}`);
      usage = r.usage;
      raw = r.text;
      got = parseChoice(r.text, suite.choices);
    } catch (e) {
      apiError = e.message;
      // The per-case line stays short — 189 wrapped stack-widths is unreadable — but the
      // message is RECORDED IN FULL (on the case span, and in `apiErrors` for the
      // end-of-run reprint). A 30-char slice rendered every failure as
      // `ERR(API 400: {"type":"error","erro`, which is the JSON envelope and nothing else:
      // a run where all nine suites scored 0.0% because every request was rejected was
      // indistinguishable, in its OUTPUT, from a run where the model answered wrongly 189
      // times. A transport failure must not be able to masquerade as an eval result.
      //
      // Key on the message with the per-request identifiers STRIPPED. An Anthropic error
      // body ends in a unique `"request_id":"req_…"`, so keying on the raw message made the
      // Map a no-op: run 34048339749 printed one `1×` line per case, 149 of them, for a
      // single account-wide cause. Dedup that does not dedup is worse than none — it is the
      // same wall of noise, now claiming to be a summary.
      const key = e.message.replace(/,?"request_id":\s*(?:"[^"]*"|null)/g, "");
      apiErrors.set(key, (apiErrors.get(key) ?? 0) + 1);
      got = `ERR(${e.message.slice(0, 60)}…)`;
    }
    const ok = got === c.expected;

    // A wrong answer is the measurement, not a fault — only a transport/API failure
    // is a span error. Conflating the two makes every rubric regression look like an
    // outage in the trace list.
    const caseAttrs = {
      "eval.case.actual": got, "eval.case.match": ok,
      "gen_ai.usage.input_tokens": usage?.input_tokens ?? null,
      "gen_ai.usage.output_tokens": usage?.output_tokens ?? null,
      // Cache accounting is the receipt for the prompt-cache win: a suite whose
      // reads stay near zero is silently paying full price for the same rubric.
      "gen_ai.usage.cache_read_input_tokens": usage?.cache_read_input_tokens ?? null,
      "gen_ai.usage.cache_creation_input_tokens": usage?.cache_creation_input_tokens ?? null,
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
    // Split out so the bill is reconstructable: a cache read is billed at 0.1× and a
    // write at 1.25×, so summing them into `input` would misreport the cost either way.
    if (usage?.cache_read_input_tokens) {
      T.histogram("gen_ai.client.token.usage", usage.cache_read_input_tokens, { "gen_ai.token.type": "cache_read", "gen_ai.request.model": MODEL, "eval.suite.name": suite.name }, "{token}");
      totalCacheRead += usage.cache_read_input_tokens;
    }
    if (usage?.cache_creation_input_tokens) {
      T.histogram("gen_ai.client.token.usage", usage.cache_creation_input_tokens, { "gen_ai.token.type": "cache_write", "gen_ai.request.model": MODEL, "eval.suite.name": suite.name }, "{token}");
      totalCacheWrite += usage.cache_creation_input_tokens;
    }

    results.push({ id: c.id, expected: c.expected, got, ok, raw, input: c[suite.inputKey] });
    console.log(`  ${ok ? "✓" : "✗"} ${c.id}: expected ${c.expected}, got ${got}`);
  }
  const pass = results.filter((r) => r.ok).length;
  const acc = (pass / results.length) * 100;
  // A suite below the case floor is reported with its accuracy and labelled, never
  // hidden — the number is still the measurement, it just does not decide the exit.
  const gating = GATE !== null && results.length >= GATE_MIN_CASES;
  const gateNote = GATE === null ? "" : gating ? "" : `  (advisory — ${results.length} cases < ${GATE_MIN_CASES}-case gate floor)`;
  console.log(`  → ${suite.name}: ${pass}/${results.length} (${acc.toFixed(1)}%)${gateNote}`);
  const misses = results.filter((r) => !r.ok);
  // The RAW reply, not just the parsed label. A miss line showing only the parsed
  // choice cannot distinguish a wrong answer from a wrong parse, which is exactly
  // the ambiguity that made five tier-routing misses look like a rubric problem.
  for (const m of misses) console.log(`    miss ${m.id}: ${m.expected}→${m.got}${m.raw !== null && m.raw !== m.got ? `  reply: «${m.raw.replace(/\s+/g, " ").slice(0, 80)}»` : ""}\n      case: «${m.input}»`);
  summary.push({ name: suite.name, pass, total: results.length, acc, misses, gating });
  if (gating && acc < GATE) anyBelowGate = true;

  totalCases += results.length; totalPass += pass;
  T.gauge("eval.suite.accuracy", acc, { "eval.suite.name": suite.name, "eval.model": MODEL }, "%");
  suiteSpan.end({
    "eval.suite.pass": pass, "eval.suite.accuracy": acc,
    "eval.suite.below_gate": GATE !== null ? acc < GATE : null,
    // Distinct from below_gate: a suite can be under the floor AND unable to breach it.
    "eval.suite.gating": GATE !== null ? gating : null,
  });
}

console.log(`\n=== L2 summary (model=${MODEL}) ===`);
for (const s of summary) console.log(`  ${s.name}: ${s.pass}/${s.total} (${s.acc.toFixed(1)}%)${s.gating === false && GATE !== null ? " [advisory]" : ""}`);

const runAcc = totalCases ? (totalPass / totalCases) * 100 : null;
runSpan.end({
  "eval.suite.count": summary.length, "eval.case.count": totalCases, "eval.pass.count": totalPass,
  "eval.accuracy": runAcc, "eval.gate.breached": GATE !== null ? anyBelowGate : null,
  "gen_ai.usage.input_tokens": totalInTok || null, "gen_ai.usage.output_tokens": totalOutTok || null,
  "gen_ai.usage.cache_read_input_tokens": totalCacheRead || null,
  "gen_ai.usage.cache_creation_input_tokens": totalCacheWrite || null,
});
if (runAcc !== null) T.gauge("eval.run.accuracy", runAcc, { "eval.model": MODEL, "eval.layer": "l2" }, "%");
// Flushed BEFORE the gate exit below, so a red run still ships its own trace —
// the failing run is the one you most want to look at.
const exported = await T.flush();
console.log(`  telemetry: ${T.traceNote()}${exported.exported ? "" : " (not exported)"}`);

// A score is only an eval result if the requests behind it actually ran. Report the API
// errors BEFORE the gate verdict, in full, with the share of the run they consumed — and
// call the run INVALID rather than "below the floor" when they dominate it.
const casesRun = summary.reduce((n, s) => n + s.total, 0);
const casesErrored = [...apiErrors.values()].reduce((n, c) => n + c, 0);
if (casesErrored > 0) {
  console.error(`\n=== API errors: ${casesErrored}/${casesRun} cases, ${apiErrors.size} distinct ===`);
  for (const [msg, count] of [...apiErrors].sort((a, b) => b[1] - a[1])) {
    console.error(`  ${count}× ${msg}`);
  }
}
// Half the run failing to transport is not a measurement. Naming it INVALID is the whole
// point: a 0.0%-across-nine-suites run previously exited with "a suite is below the
// EVAL_GATE floor", which reads as a rubric regression and sends the reader to the rubric.
const RUN_INVALID = casesRun > 0 && casesErrored / casesRun > 0.5;

if (process.env.GITHUB_STEP_SUMMARY) {
  let md = `### L2 behavioral evals — model \`${MODEL}\`\n\n`;
  // The error preamble comes FIRST, above the accuracy table, because a table of low
  // scores read without it is a rubric regression and read with it is an outage. Same
  // reason the console output leads with the error tally.
  if (casesErrored > 0) {
    md += RUN_INVALID
      ? `> **INVALID RUN — not a measurement.** ${casesErrored} of ${casesRun} cases never reached the model.\n\n`
      : `> **${casesErrored} of ${casesRun} cases errored** and are counted as misses below.\n\n`;
    for (const [msg, count] of [...apiErrors].sort((a, b) => b[1] - a[1])) {
      md += `> - \`${count}×\` ${msg.replace(/`/g, "'")}\n`;
    }
    md += "\n";
  }
  md += `| suite | accuracy | gate | misses |\n| --- | --- | --- | --- |\n`;
  for (const s of summary) md += `| ${s.name} | ${s.pass}/${s.total} (${s.acc.toFixed(1)}%) | ${GATE === null ? "—" : s.gating ? `${GATE}%` : "advisory"} | ${s.misses.map((m) => `${m.id}:${m.expected}→${m.got}`).join("; ") || "—"} |\n`;
  // What the run cost, next to what it measured — the two numbers are read together
  // when deciding whether a suite is worth its token bill. Cache reads are called out
  // because a suite whose reads collapse to zero has silently lost the ~80% discount.
  if (totalInTok || totalOutTok) md += `\n${totalCases} cases · ${totalInTok.toLocaleString()} input + ${totalOutTok.toLocaleString()} output tokens`;
  if (totalCacheRead || totalCacheWrite) md += ` · cache ${totalCacheRead.toLocaleString()} read / ${totalCacheWrite.toLocaleString()} written`;
  if (totalInTok || totalOutTok) md += `\n`;
  if (T.enabled) md += `\n<sup>trace \`${T.traceId}\`</sup>\n`;
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}

// A prefix shorter than the model's minimum cacheable length cannot be cached at all,
// so the write is refused silently and every case is billed in full. That is NOT the
// same failure as losing a discount that was available, and the first CI run proved the
// distinction matters: three of nine suites reported MISSED purely because their rubric
// slice is small, which sent a reader looking for a bug that does not exist.
//
// Measure the PREFIX, not the prompt. Only the system block carries `cache_control`
// (see `ask()`), while `input_tokens` also covers each case's user message — so
// dividing total input by case count overstates the cached part and can cry MISSED at
// a suite that was never cacheable. `maxSystemChars` is the largest system block the
// run built: if even that is under the bound, no suite in the run could cache.
//
// The comparison is deliberately STRICT (`<`), with no tolerance band, and the
// direction of the estimate's error is why. Chars/token runs ~10% LOW against the
// observed writes, so an estimate that already clears 1024 implies a real prefix
// comfortably above it: such a suite genuinely could have cached, and MISSED is the
// true report. The uncertainty is entirely on the OTHER side — an estimate of ~950 may
// be a real ~1050, so "not applicable" is already the lenient verdict and is the one
// that can be wrong. Widening it upward would suppress true MISSED reports, which is
// the opposite of what this note exists to protect.
//
// So the residue runs one way: a prefix measured just BELOW the bound may in fact have
// been cacheable, and we will have said "nothing to discount". That costs a missed
// discount. A MISSED report, by contrast, is trustworthy — act on it.
const MIN_CACHEABLE_TOKENS = 1024;
const CHARS_PER_TOKEN = 4;

if (totalInTok || totalOutTok) {
  const prefixTok = Math.round(maxSystemChars / CHARS_PER_TOKEN);
  let cacheNote;
  if (totalCacheRead || totalCacheWrite) {
    // Cost-equivalent, not a token count: the three input classes are priced
    // differently (a cache write is 1.25× a fresh input token, a cache read 0.1×), so
    // comparing raw token totals would understate the win. Both sides of the ratio are
    // in units of "fresh input tokens", and the counterfactual is that every cache READ
    // would instead have been a full re-send — which is what the pre-cache code did.
    const equiv = totalInTok + totalCacheWrite + totalCacheRead;
    const costNow = totalInTok + totalCacheWrite * 1.25 + totalCacheRead * 0.1;
    const saved = equiv > 0 ? (1 - costNow / equiv) * 100 : 0;
    cacheNote = ` · cache ${totalCacheRead.toLocaleString()} read / ${totalCacheWrite.toLocaleString()} written`
      + ` (~${saved.toFixed(0)}% lower input cost than re-sending each rubric)`;
  } else if (maxSystemChars && prefixTok < MIN_CACHEABLE_TOKENS) {
    cacheNote = ` · cache not applicable (largest cached prefix ~${prefixTok.toLocaleString()} tokens, below the ${MIN_CACHEABLE_TOKENS}-token minimum — nothing to discount, not a defect)`;
  } else {
    cacheNote = ` · cache MISSED (no read, no write, and the prefix is ~${prefixTok.toLocaleString()} tokens — long enough to cache, so the rubric is being re-billed per case)`;
  }
  console.log(`  tokens: ${totalInTok.toLocaleString()} input + ${totalOutTok.toLocaleString()} output${cacheNote}`);
}

// An INVALID RUN exits before the gate check, deliberately. A run whose requests never
// reached the model produces scores that measure nothing, and reporting that as a gate
// breach names the wrong cause: the next reader goes looking at the rubric and the golden
// set for a fault that is in the transport or the account. The gate below is only
// meaningful over answers the model actually gave.
if (RUN_INVALID) {
  console.error(`\n✗ INVALID RUN — ${casesErrored}/${casesRun} cases never reached the model.`
    + ` The scores above measure nothing; fix the API errors listed above and re-run.`
    + ` Do NOT read this as a rubric or golden-set regression.`);
  process.exit(1);
}
if (GATE !== null && anyBelowGate) {
  const breached = summary.filter((s) => s.gating && s.acc < GATE).map((s) => `${s.name} ${s.acc.toFixed(1)}%`);
  console.error(`\n✗ below the EVAL_GATE floor of ${GATE}%: ${breached.join(", ")}`);
  process.exit(1);
}
process.exit(0);
