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
import { REPO_ROOT, extractSection } from "./lib.mjs";

const SUITES = [
  {
    name: "tier-routing",
    golden: "golden/tier-routing.jsonl",
    rubric: { file: "skills/workflow/autonomous-workflow/templates/aw.agent.md", section: "## Tier detection" },
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
    rubric: { file: "skills/workflow/autonomous-workflow/templates/routing.rule.md", section: null }, // whole file
    instruction: "You apply the autonomous-workflow routing rule below. Decide whether it should auto-trigger on the user's message. Reply 'trigger' or 'skip'.",
    inputKey: "input", inputLabel: "User message",
    choices: ["trigger", "skip"],
  },
  {
    name: "optimize-approach-optimality",
    golden: "golden/optimize-approach-optimality.jsonl",
    rubric: { file: "skills/quality/optimize-approach/rules/optimality-rubric.md", section: null }, // whole rubric
    instruction: "You are the optimize-approach skill at Phase O2. Using ONLY the optimality rubric below, classify the described approach unit: 'suboptimal' only when a materially better approach exists AND no anti-overlap guard fires AND the materiality bar clears; otherwise 'optimal'.",
    inputKey: "input", inputLabel: "Approach unit",
    choices: ["optimal", "suboptimal"],
  },
  {
    name: "reviewer-agreement-bump",
    golden: "golden/reviewer-agreement-bump.jsonl",
    rubric: { file: "agents/shared/rules/rubric-composition.md", section: "## Cross-rubric agreement" },
    instruction: "You apply the Cross-rubric agreement rule from the reviewer pipeline. Given a scenario describing dedupe pass results, classify whether the surviving finding would be marked agreement-promoted.",
    inputKey: "input", inputLabel: "Scenario",
    choices: ["promoted", "not-promoted"],
  },
  {
    name: "severity-tiering",
    golden: "golden/severity-tiering.jsonl",
    rubric: { file: "skills/quality/severity/SKILL.md", section: "## Severity rubric" },
    instruction: "You are the severity skill. Using ONLY the rubric below, classify the finding into exactly one severity tier. Run the exclusion gate and the reachability cap before applying any path floor or escalator.",
    inputKey: "input", inputLabel: "Finding",
    choices: ["critical", "high", "medium", "low"],
  },
  {
    name: "shape-depth-routing",
    golden: "golden/shape-depth-routing.jsonl",
    rubric: { file: "agents/pr-reviewer.md", section: "### 1.2b Delta triage and depth routing (Phase C)" },
    instruction: "You are pr-reviewer at Step 1.2b, after the delta and its shape classification are computed. Using ONLY the rules below, pick the routing outcome: 'full' when any upgrade rule forces RUN_MODE=full, 'escalate' when the run stays incremental but ESCALATE_IN_INCREMENTAL is set (a risky content shape with no upgrade trigger), and 'cheap' when the run stays incremental with no escalation.",
    inputKey: "input", inputLabel: "Delta",
    choices: ["full", "escalate", "cheap"],
  },
  {
    name: "code-review-retrieval-relevance",
    golden: "golden/code-review-retrieval-relevance.jsonl",
    rubric: { file: "agents/pr-reviewer.md", section: "## Step 1: Fetch all inputs + load memories" },
    instruction: "You are pr-reviewer at Step 1. Using ONLY the Step 1 memory-read procedure below (Step 1.0 mcp__lorekit__memory_list + Step 1.2c mcp__lorekit__memory_search), decide whether the described candidate memory would be surfaced by the documented read for the given PR diff. Reply 'surface' if the documented read would return it, or 'skip' if it would not.",
    inputKey: "input", inputLabel: "Candidate + diff",
    choices: ["surface", "skip"],
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

// extractSection is heading-level-aware and shared from lib.mjs so l1.mjs's G21g
// "eval actually contains a rubric" guard exercises the exact extraction this runs.

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
