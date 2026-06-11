#!/usr/bin/env node
// L1 — Deterministic contract checks. No LLM, no network, no cost.
// These assert the *mechanical contracts* the skills promise. Run in CI.
//   node scripts/eval/l1.mjs
// Exits non-zero if any check fails.
import { execSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, walk, headingSlugs, links, frontmatter, rel, Suite } from "./lib.mjs";

const AW = join(REPO_ROOT, "skills/workflow/autonomous-workflow");
const s = new Suite("L1 deterministic contract checks");

// ── Check A: link + anchor integrity (skips code fences + templates/) ──
// Catches the broken-anchor class (e.g. the #lesson-promotion bug we shipped + fixed).
// The repo has pre-existing link debt in example/scaffold prose, so this gates on
// NO NEW breakage: known pre-existing breaks live in the baseline below (a ratchet —
// burn the list down over time; never add to it for new work).
{
  // Known pre-existing breaks, kept so the gate catches NEW breakage without
  // failing on history. Currently EMPTY — all pre-existing breaks have been
  // resolved (from-to-morphs→state-choreography, the fix-bug verifier anchor, and
  // playwright-test-healer now points at the external Playwright Test Agents docs).
  // Keep it empty: fix new breaks, don't baseline them.
  const BASELINE = new Set([]);
  // linksOutsideFences: skip ``` fenced blocks (examples) and obvious placeholders.
  function realLinks(file) {
    const out = [];
    let fence = false;
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      if (/^\s*```/.test(line)) { fence = !fence; return; }
      if (fence) return;
      let m; const re = /\[[^\]]*\]\(([^)]+)\)/g;
      while ((m = re.exec(line))) out.push({ line: i + 1, target: m[1].trim() });
    });
    return out;
  }
  // Skills that live in sibling repos by design — links to them are not repo-internal.
  // (otel-* used to be here as broken relative links; they now point at the dash0
  // agent-skills repo via https, so the http skip handles them — and any NEW relative
  // otel link would correctly fail.)
  const SIBLING_REPO = /git-worktree-workflows/;
  const files = [
    ...walk(join(REPO_ROOT, "skills")).filter((f) => !f.includes("/templates/") && !f.endsWith("/_template.md")),
    ...walk(join(REPO_ROOT, "agents")).filter((f) => !f.includes("/templates/")),
    ...walk(join(REPO_ROOT, "memory")),
    join(REPO_ROOT, "CLAUDE.md"),
    join(REPO_ROOT, "README.md"),
  ];
  let newBroken = 0, baselined = 0;
  for (const f of files) {
    for (const { line, target } of realLinks(f)) {
      if (/^(https?:|mailto:)/.test(target) || target.includes("<") || target.includes("{") || target === "...") continue;
      if (target.startsWith("/")) continue; // absolute path = illustrative example, not a repo-relative link
      if (SIBLING_REPO.test(target)) continue; // lives in a sibling repo by design
      const [path, anchor] = target.split("#");
      const tf = path === "" ? f : join(f, "..", path);
      let bad = "";
      if (path && !existsSync(tf)) bad = `missing file: ${target}`;
      else if (anchor && tf.endsWith(".md") && !headingSlugs(tf).has(anchor)) bad = `no heading for #${anchor}`;
      if (!bad) continue;
      if (BASELINE.has(`${rel(f)}::${target}`)) { baselined++; continue; }
      newBroken++;
      s.check(`link ${rel(f)}:${line}`, false, bad);
    }
  }
  s.check("no NEW broken links/anchors (baseline-ratcheted)", newBroken === 0, newBroken ? `${newBroken} new` : `${baselined} pre-existing baselined`);
}

// ── Check B: the `aw` tier-detection table is identical in dispatcher + SKILL (R5 drift guard) ──
function tierQuestions(file) {
  // pull the 4 decision rows from the first markdown table whose rows mention Full/Lite/Micro
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => /^\|\s*\d\s*\|/.test(l) && /\*\*(Full|Lite|Micro)\*\*/.test(l))
    .map((l) => l.replace(/\s+/g, " ").trim());
}
{
  const a = tierQuestions(join(AW, "templates/dispatcher.template.md"));
  const b = tierQuestions(join(AW, "SKILL.md"));
  s.check("dispatcher tier table ≡ SKILL.md Step 1", a.length >= 4 && JSON.stringify(a) === JSON.stringify(b),
    a.length !== b.length ? `row count ${a.length} vs ${b.length}` : "rows differ");
}

// ── Check C: plan.md Core-section contract — runs the ACTUAL confidence rule-checks ──
// against fixtures. Encodes the #30 Core contract + the #31 Acceptance-Criteria-non-empty fix.
// We execute the exact idioms documented in skills/quality/confidence/SKILL.md rules #2 and #3,
// so a regression in that logic (like #31, where AC always counted 0) fails here.
function coreSectionCount(plan) {
  return Number(execSync(
    `grep -E '^## (TL;DR|Requirements|Decisions|Acceptance Criteria|Implementation Order|File Changes|Verification|Progress Log)' "${plan}" | wc -l`,
    { shell: "/bin/bash" }).toString().trim());
}
function acceptanceCriteriaCount(plan) {
  return Number(execSync(
    `awk '/^## Acceptance Criteria/{f=1;next} /^###? /{f=0} f' "${plan}" | grep -c '^- \\|^[0-9]' || true`,
    { shell: "/bin/bash" }).toString().trim());
}
{
  const fx = join(REPO_ROOT, "scripts/eval/fixtures/plans");
  const valid = join(fx, "valid-core.md");
  const missing = join(fx, "missing-core.md");
  const emptyAc = join(fx, "empty-ac.md");
  s.check("rule#2: valid plan has all 8 Core sections", coreSectionCount(valid) >= 8, `got ${coreSectionCount(valid)}`);
  s.check("rule#2: missing-core plan fails (< 8)", coreSectionCount(missing) < 8, `got ${coreSectionCount(missing)}`);
  s.check("rule#3: valid plan has ≥1 Acceptance Criterion", acceptanceCriteriaCount(valid) >= 1, `got ${acceptanceCriteriaCount(valid)}`);
  // The #31 regression: an AC heading present but empty must count 0 (the old awk bug counted wrong).
  s.check("rule#3 (#31 guard): empty-AC plan counts 0", acceptanceCriteriaCount(emptyAc) === 0, `got ${acceptanceCriteriaCount(emptyAc)}`);
}

// ── Check D: every skill with a diagnostic-surface is uniquely resolvable by `skills/*/<name>/` ──
// Locks the diagnose path-resolution fix (flat `skills/<name>/` would miss category-nested skills).
{
  const surfaces = walk(join(REPO_ROOT, "skills"))
    .filter((f) => f.endsWith("/rules/diagnostic-surface.md"))
    .map((f) => f.split("/skills/")[1].split("/")[1]); // skills/<category>/<name>/rules/...
  for (const name of surfaces) {
    const matches = readdirSync(join(REPO_ROOT, "skills"))
      .filter((c) => existsSync(join(REPO_ROOT, "skills", c, name)));
    s.check(`diagnose resolves '${name}' uniquely via skills/*/${name}/`, matches.length === 1, `${matches.length} matches`);
  }
}

// ── Check E: committed lesson scopes have the persistent-memory storage contract ──
{
  for (const scope of ["aw-lessons", "fix-bug-lessons", "batch-lessons"]) {
    const dir = join(REPO_ROOT, "memory", scope);
    s.check(`memory/${scope} has INDEX.md + entries/`,
      existsSync(join(dir, "INDEX.md")) && existsSync(join(dir, "entries")));
  }
}

// ── Check F: SKILL.md frontmatter sanity — semver version + name matches directory ──
{
  for (const f of walk(join(REPO_ROOT, "skills")).filter((p) => p.endsWith("/SKILL.md"))) {
    const fm = frontmatter(f);
    const dir = f.split("/").slice(-2)[0];
    if (fm.version !== undefined)
      s.check(`${rel(f)} version is semver`, /^\d+\.\d+\.\d+$/.test(fm.version), `got '${fm.version}'`);
    if (fm.name !== undefined)
      s.check(`${rel(f)} name matches dir`, fm.name === dir, `name='${fm.name}' dir='${dir}'`);
  }
}

// ── Check G: cross-file contract drift guards (2026-06 holistic audit) ──
// Every defect below was a contradiction between files that must agree —
// the class Check A's link integrity cannot see. Lock the repaired contracts.
{
  const read = (p) => readFileSync(join(REPO_ROOT, p), "utf8");
  const norm = (t) => t.replace(/\s+/g, " ");

  // G1: the seen_count UPDATE contract sentence is shared verbatim by all three owners
  // (persistent-memory write pipeline + both autonomous-workflow loop surfaces).
  // Without it, applied lessons never reach the seen_count >= 3 promotion gate.
  const CONTRACT =
    "An UPDATE to an entry that carries a `seen_count` field MUST increment `seen_count` by 1 and refresh `expires`.";
  for (const p of [
    "skills/authoring/persistent-memory/rules/write-pipeline.md",
    "skills/workflow/autonomous-workflow/rules/self-improvement-loop.md",
    "skills/workflow/autonomous-workflow/rules/phase-7-ci-gate.md",
  ])
    s.check(`G1 seen_count UPDATE contract in ${p.split("/").pop()}`, norm(read(p)).includes(norm(CONTRACT)));

  // G2: the fix-bug fast-lane plan is a superset of the aw-create-plan Core sections —
  // otherwise aw-executor's bail check and confidence(plan) rule #2 reject every fast-lane plan.
  const CORE = ["TL;DR", "Requirements", "Decisions", "Acceptance Criteria",
    "Implementation Order", "File Changes", "Verification", "Progress Log"];
  const fastLane = read("skills/workflow/fix-bug/rules/fast-lane-plan-contract.md");
  // Match heading-shaped occurrences (`## <name>`), not prose mentions — the executor
  // bail check and confidence rule #2 key on `^## ` headings, so the guard must too.
  const missingCore = CORE.filter(
    (c) => !new RegExp("^## " + c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$", "m").test(fastLane));
  s.check("G2 fast-lane plan contract ⊇ Core-8 sections (as ## headings)", missingCore.length === 0, missingCore.join(", "));

  // G3: implement-suggestion's non-removable override keys on /critical's REAL output
  // buckets (Must-fix), never the phantom Critical/High/Major severity taxonomy.
  const isFiles = walk(join(REPO_ROOT, "skills/workflow/implement-suggestion"));
  const phantomSeverity = isFiles.filter((f) => /Critical( or |\/)(High|Major)/.test(readFileSync(f, "utf8"))).map(rel);
  const usesMustFix = isFiles.some((f) => readFileSync(f, "utf8").includes("Must-fix"));
  s.check("G3 implement-suggestion keys on /critical's Must-fix bucket",
    phantomSeverity.length === 0 && usesMustFix, phantomSeverity.join(", ") || "Must-fix missing");

  // G4: review agents consume confidence(code)'s real contract (weighted Final over
  // Correctness/Completeness/No-regressions), not a fictional returned score trio.
  const pcc = read("agents/shared/rules/per-comment-confidence.md");
  s.check("G4 per-comment gate consumes the real confidence(code) contract",
    !/returns three scores/.test(pcc) && /Correctness/.test(pcc));

  // G5: forbidden phrases that re-introduce audited contradictions or phantom references.
  const FORBIDDEN = [
    [/Never auto-continue past iteration 3/, "flat 3-cap — caps are mode-aware with one-shot auto-replan"],
    [/iterate until passing/i, "uncapped iteration — the stuck-loop cap governs"],
    [/\bvisual-test\b/, "phantom visual-test agent"],
    [/worker-dispatch-prompt\.md/, "phantom dispatch prompt file"],
    [/\bmcp list\b/, "fabricated mcp CLI — detect MCP tools from the tool list"],
  ];
  const scan = [...walk(join(REPO_ROOT, "skills")), ...walk(join(REPO_ROOT, "agents"))];
  for (const [re, why] of FORBIDDEN) {
    const hits = scan.filter((f) => re.test(readFileSync(f, "utf8"))).map(rel);
    s.check(`G5 no /${re.source}/ (${why})`, hits.length === 0, hits.slice(0, 3).join(", "));
  }

  // G6: Phase 1 — Cross-rubric agreement rule is present and carries the promotion language.
  // Locks the contract that ≥ 2 rubric overlap lowers the per-comment-confidence threshold.
  const rcmd = read("agents/shared/rules/rubric-composition.md");
  s.check("G6 rubric-composition has Cross-rubric agreement section",
    rcmd.includes("Cross-rubric agreement"));
  s.check("G6 rubric-composition 80 → 70 promotion language present",
    rcmd.includes("80") && rcmd.includes("70") && /agreement.promoted/i.test(rcmd));
}

process.exit(s.report() ? 0 : 1);
