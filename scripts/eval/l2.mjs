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
// Add a suite: drop a golden JSONL in golden/ and append a config object below.
// `rubric.section` is read LIVE from the skill source, so the eval always tests
// the shipped instructions — not a copy.
import { readFileSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./lib.mjs";

const SUITES = [
  {
    name: "tier-routing",
    golden: "golden/tier-routing.jsonl",
    rubric: { file: "skills/workflow/autonomous-workflow/templates/aw.template.md", section: "## Tier detection" },
    instruction: "You are the autonomous-workflow dispatcher. Using ONLY the tier-detection rules below, classify the task into exactly one tier.",
    inputKey: "task", inputLabel: "Task",
    choices: ["Micro", "Lite", "Full"],
  },
  {
    name: "bug-class",
    golden: "golden/bug-class.jsonl",
    rubric: { file: "skills/workflow/fix-bug/SKILL.md", section: "### Step 0c — Infer bug class" },
    instruction: "You are /fix-bug at Phase 0c. Using ONLY the bug-class table below, infer the single best bugClass for the evidence.",
    inputKey: "input", inputLabel: "Evidence",
    choices: ["contract-mismatch", "null-deref", "off-by-one", "regression", "race", "perf", "config", "logic", "unknown"],
  },
  {
    name: "complexity-triage",
    golden: "golden/complexity-triage.jsonl",
    rubric: { file: "skills/workflow/fix-bug/SKILL.md", section: "## Phase 0.5 — Complexity Triage" },
    instruction: "You are /fix-bug at Phase 0.5. Using ONLY the triage rules below (conservative: pick complex when in doubt), classify the bug.",
    inputKey: "input", inputLabel: "Bug",
    choices: ["simple", "complex"],
  },
  {
    name: "aw-should-trigger",
    golden: "golden/aw-should-trigger.jsonl",
    rubric: { file: "skills/workflow/autonomous-workflow/templates/routing-rule.template.md", section: null }, // whole file
    instruction: "You apply the autonomous-workflow routing rule below. Decide whether it should auto-trigger on the user's message. Reply 'trigger' or 'skip'.",
    inputKey: "input", inputLabel: "User message",
    choices: ["trigger", "skip"],
  },
  {
    name: "reviewer-agreement-bump",
    golden: "golden/reviewer-agreement-bump.jsonl",
    rubric: { file: "agents/shared/rules/rubric-composition.md", section: "## Cross-rubric agreement" },
    instruction: "You apply the Cross-rubric agreement rule from the reviewer pipeline. Given a scenario describing dedupe pass results, classify whether the surviving finding would be marked agreement-promoted.",
    inputKey: "input", inputLabel: "Scenario",
    choices: ["promoted", "not-promoted"],
  },
];

const MODEL = process.env.EVAL_MODEL || "claude-sonnet-4-6";
const KEY = process.env.ANTHROPIC_API_KEY;
const GATE = process.env.EVAL_GATE ? Number(process.env.EVAL_GATE) : null;
const only = process.argv.includes("--suite") ? process.argv[process.argv.indexOf("--suite") + 1] : null;

if (!KEY) {
  console.log("⊘ L2: no ANTHROPIC_API_KEY — skipping (these are LLM evals; set the key to run).");
  process.exit(0);
}

function extractSection(file, section) {
  const txt = readFileSync(join(REPO_ROOT, file), "utf8");
  if (!section) return txt.trim();
  const i = txt.indexOf(section);
  if (i < 0) throw new Error(`section "${section}" not found in ${file}`);
  const after = txt.slice(i + section.length);
  const next = /\n#{1,6}\s/.exec(after); // cut at the next heading of any level
  return (section + (next ? after.slice(0, next.index) : after)).trim();
}

async function ask(system, input) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 16, system, messages: [{ role: "user", content: input }] }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 120)}`);
  return ((await res.json()).content?.[0]?.text || "").trim();
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

for (const suite of SUITES) {
  if (only && suite.name !== only) continue;
  const goldenPath = join(REPO_ROOT, "scripts/eval", suite.golden);
  if (!existsSync(goldenPath)) { console.log(`(skip ${suite.name}: no golden file)`); continue; }
  const rubric = extractSection(suite.rubric.file, suite.rubric.section);
  const system = `${suite.instruction}\nReply with exactly one of: ${suite.choices.join(", ")}. No explanation.\n\n${rubric}`;
  const cases = readFileSync(goldenPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

  console.log(`\n## ${suite.name} (${cases.length} cases)`);
  const results = [];
  for (const c of cases) {
    let got;
    try { got = parseChoice(await ask(system, `${suite.inputLabel}: ${c[suite.inputKey]}`), suite.choices); }
    catch (e) { got = `ERR(${e.message.slice(0, 30)})`; }
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

if (process.env.GITHUB_STEP_SUMMARY) {
  let md = `### L2 behavioral evals — model \`${MODEL}\`\n\n| suite | accuracy | misses |\n| --- | --- | --- |\n`;
  for (const s of summary) md += `| ${s.name} | ${s.pass}/${s.total} (${s.acc.toFixed(1)}%) | ${s.misses.map((m) => `${m.id}:${m.expected}→${m.got}`).join("; ") || "—"} |\n`;
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}

if (GATE !== null && anyBelowGate) {
  console.error(`\n✗ a suite is below the EVAL_GATE floor of ${GATE}%`);
  process.exit(1);
}
process.exit(0);
