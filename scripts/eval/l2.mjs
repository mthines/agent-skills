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
// to add one — lives in `suites.mjs`, because `select-suites.mjs` needs the same table
// to map a PR's changed files onto the suites they can affect.
import { readFileSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, extractSection } from "./lib.mjs";

import { SUITES } from "./suites.mjs";

const MODEL = process.env.EVAL_MODEL || "claude-sonnet-4-6";
const KEY = process.env.ANTHROPIC_API_KEY;
const GATE = process.env.EVAL_GATE ? Number(process.env.EVAL_GATE) : null;
// `--suite` takes one name or a comma-separated list. The list form is what lets CI run only
// the suites a PR's changed files can affect (see select-suites.mjs) in ONE process, so the
// nine rubrics are not all re-read and the accounting below covers the whole run.
const onlyArg = process.argv.includes("--suite") ? process.argv[process.argv.indexOf("--suite") + 1] : null;
const only = onlyArg === null || onlyArg === undefined
  ? null
  : onlyArg.split(",").map((n) => n.trim()).filter(Boolean);

if (!KEY) {
  console.log("⊘ L2: no ANTHROPIC_API_KEY — skipping (these are LLM evals; set the key to run).");
  process.exit(0);
}

// A misspelled `--suite` would otherwise match nothing, run zero cases, and exit 0 — a green
// that graded nothing, which is indistinguishable from a green that graded everything. Fail
// closed on the name instead, and name the suites so the next attempt is right.
//
// The list form adds a second way to grade nothing: `--suite ""` (or a bare `--suite` at the
// end of argv) parses to an EMPTY selection, not to "all". That is now the likeliest spelling
// of the bug, because CI passes a computed value — a selector that returned no suites, or a
// shell that expanded an unset variable, would otherwise report a passing eval run. Both
// spellings exit 1.
if (only !== null && only.length === 0) {
  console.error("✗ --suite was given an empty selection."
    + " Omit the flag to run every suite; an empty value grades nothing and is never a pass.");
  process.exit(1);
}
const unknown = only === null ? [] : only.filter((n) => !SUITES.some((sx) => sx.name === n));
if (unknown.length > 0) {
  console.error(`✗ unknown --suite ${unknown.map((n) => JSON.stringify(n)).join(", ")}.`
    + ` Suites: ${SUITES.map((sx) => sx.name).join(", ")}`);
  process.exit(1);
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

// Per-run token accounting, so "caching is on" is a measured claim and not a code comment.
// Without this the only observable difference between a working cache and a `cache_control`
// key the API silently ignored is the invoice, which arrives days later and off this surface.
const tokens = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };

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
  const u = body.usage ?? {};
  tokens.input += u.input_tokens ?? 0;
  tokens.cacheWrite += u.cache_creation_input_tokens ?? 0;
  tokens.cacheRead += u.cache_read_input_tokens ?? 0;
  tokens.output += u.output_tokens ?? 0;
  return (body.content?.[0]?.text || "").trim();
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
// Distinct API error messages → how many cases hit each. A blanket transport failure is one
// entry with a count equal to the whole run; a genuine per-case problem is a small count.
const apiErrors = new Map();

for (const suite of SUITES) {
  if (only !== null && !only.includes(suite.name)) continue;
  const goldenPath = join(REPO_ROOT, "scripts/eval", suite.golden);
  if (!existsSync(goldenPath)) { console.log(`(skip ${suite.name}: no golden file)`); continue; }
  const rubric = rubricFor(suite);
  const system = `${suite.instruction}\nReply with exactly one of: ${suite.choices.join(", ")}. No explanation.\n\n${rubric}`;
  const cases = readFileSync(goldenPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

  console.log(`\n## ${suite.name} (${cases.length} cases)`);
  const results = [];
  for (const c of cases) {
    let got;
    try { got = parseChoice(await ask(system, `${suite.inputLabel}: ${c[suite.inputKey]}`), suite.choices); }
    catch (e) {
      // The per-case line stays short — 189 wrapped stack-widths is unreadable — but the
      // message is RECORDED IN FULL and reprinted once per distinct value at the end.
      // The prior 30-char slice rendered every failure as `ERR(API 400: {"type":"error","erro`,
      // which is the JSON envelope and nothing else: a run where all nine suites scored 0.0%
      // because every request was rejected was indistinguishable, in its output, from a run
      // where the model simply answered wrongly 189 times. A transport failure must not be
      // able to masquerade as an eval result.
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
}

console.log(`\n=== L2 summary (model=${MODEL}) ===`);
for (const s of summary) console.log(`  ${s.name}: ${s.pass}/${s.total} (${s.acc.toFixed(1)}%)`);

// Token accounting. `cache read` near zero across a multi-case suite means the rubric is NOT
// being cached — the block fell under the model's minimum, or a `cache_control` change stopped
// taking effect — and the run costs what it did before. Printed unconditionally so a
// regression is visible in the log of the very next run rather than in a later invoice.
{
  // Cost-equivalent, not a token count: the three input classes are priced differently
  // (a cache write is 1.25x a fresh input token, a cache read 0.1x), so comparing raw
  // token totals would understate the win. Both sides of the ratio are in units of
  // "fresh input tokens", and the counterfactual is that every cache READ would instead
  // have been a full re-send — which is exactly what the pre-cache code did.
  const total = tokens.input + tokens.cacheWrite + tokens.cacheRead;
  const costNow = tokens.input + tokens.cacheWrite * 1.25 + tokens.cacheRead * 0.1;
  const costUncached = total;
  const pct = costUncached > 0 ? (1 - costNow / costUncached) * 100 : 0;
  console.log(`\n=== tokens: ${total.toLocaleString()} in (${tokens.input.toLocaleString()} fresh,`
    + ` ${tokens.cacheWrite.toLocaleString()} cache write, ${tokens.cacheRead.toLocaleString()} cache read),`
    + ` ${tokens.output.toLocaleString()} out ===`);
  console.log(tokens.cacheRead > 0
    ? `  prompt cache active — ~${pct.toFixed(0)}% lower input cost than re-sending each rubric`
    : "  prompt cache INACTIVE (0 cache reads) — rubrics are being re-sent per case;"
      + " expected only for a 1-case suite or a rubric under the model's minimum cacheable length");
}

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
  if (casesErrored > 0) {
    md += RUN_INVALID
      ? `> **INVALID RUN — not a measurement.** ${casesErrored} of ${casesRun} cases never reached the model.\n\n`
      : `> **${casesErrored} of ${casesRun} cases errored** and are counted as misses below.\n\n`;
    for (const [msg, count] of [...apiErrors].sort((a, b) => b[1] - a[1])) {
      md += `> - \`${count}×\` ${msg.replace(/`/g, "'")}\n`;
    }
    md += "\n";
  }
  md += `| suite | accuracy | misses |\n| --- | --- | --- |\n`;
  for (const s of summary) md += `| ${s.name} | ${s.pass}/${s.total} (${s.acc.toFixed(1)}%) | ${s.misses.map((m) => `${m.id}:${m.expected}→${m.got}`).join("; ") || "—"} |\n`;
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}

if (RUN_INVALID) {
  console.error(`\n✗ INVALID RUN — ${casesErrored}/${casesRun} cases never reached the model.`
    + ` The scores above measure nothing; fix the API errors listed above and re-run.`
    + ` Do NOT read this as a rubric or golden-set regression.`);
  process.exit(1);
}
if (GATE !== null && anyBelowGate) {
  console.error(`\n✗ a suite is below the EVAL_GATE floor of ${GATE}%`);
  process.exit(1);
}
process.exit(0);
