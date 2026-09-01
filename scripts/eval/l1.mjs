#!/usr/bin/env node
// L1 — Deterministic contract checks. No LLM, no network, no cost.
// These assert the *mechanical contracts* the skills promise. Run in CI.
//   node scripts/eval/l1.mjs
// Exits non-zero if any check fails.
import { execSync, spawnSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, walk, headingSlugs, links, frontmatter, rel, sliceBetween, extractSection, Suite } from "./lib.mjs";

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
  const a = tierQuestions(join(AW, "templates/aw.agent.md"));
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
// Rule #9 (v3.15): every [user-stated] requirement (positional R-number) is covered
// by a `(covers: R…)` annotation in the Acceptance Criteria. Exact idiom from
// skills/quality/confidence/SKILL.md rule #9. Returns true when the check passes.
function requirementCoveragePasses(plan) {
  try {
    execSync(
      `awk '/^## Requirements/ {rs=1; as=0; next} /^## Acceptance Criteria/ {as=1; rs=0; next} /^###? / {rs=0; as=0} rs && /^[-0-9]/ {n++; if (index($0,"[user-stated]")) us[n]=1} as {s=$0; while (match(s, /covers:[^)]*/)) {seg=substr(s,RSTART,RLENGTH); s=substr(s,RSTART+RLENGTH); while (match(seg,/R[0-9]+/)) {cov[substr(seg,RSTART+1,RLENGTH-1)]=1; seg=substr(seg,RSTART+RLENGTH)}}} END {for (i in us) if (!(i in cov)) exit 1; exit 0}' "${plan}"`,
      { shell: "/bin/bash" });
    return true;
  } catch { return false; }
}
// Rule #10 (v3.15): a File Changes `create` row requires an Existing Code Survey
// section with ≥1 verdict row; modification-only plans pass vacuously. Exact idiom
// from confidence rule #10 (pipe-free index() sums keep the table row verbatim).
function existingCodeSurveyPasses(plan) {
  try {
    execSync(
      `awk -F'[|]' '/^## File Changes/ {fc=1; es=0; next} /^## Existing Code Survey/ {es=1; fc=0; next} /^###? / {fc=0; es=0} fc && /^[|]/ && $2 ~ /create/ {creates++} es && /^[|]/ {if (index($0,"EXTEND") + index($0,"WRAP") + index($0,"BUILD NEW") > 0) rows++} END {if (creates == 0) exit 0; exit (rows < 1)}' "${plan}"`,
      { shell: "/bin/bash" });
    return true;
  } catch { return false; }
}
// Rule #11 (v3.15): checks.yaml IDs are in sync with the plan's AC-{n} IDs, both
// directions (no missing check, no orphan check).
function checksInSync(plan, checks) {
  const planIds = execSync(
    `awk '/^## Acceptance Criteria/{f=1;next} /^###? /{f=0} f' "${plan}" | grep -oE 'AC-[0-9]+' | sort -u`,
    { shell: "/bin/bash" }).toString().trim().split("\n").filter(Boolean);
  const checkIds = execSync(
    `grep -oE '^- id: AC-[0-9]+' "${checks}" | grep -oE 'AC-[0-9]+' | sort -u`,
    { shell: "/bin/bash" }).toString().trim().split("\n").filter(Boolean);
  return planIds.length > 0 &&
    JSON.stringify(planIds) === JSON.stringify(checkIds);
}
{
  const fx = join(REPO_ROOT, "scripts/eval/fixtures/plans");
  const valid = join(fx, "valid-core.md");
  const missing = join(fx, "missing-core.md");
  const emptyAc = join(fx, "empty-ac.md");
  const uncovered = join(fx, "uncovered-req.md");
  const createNoSurvey = join(fx, "create-no-survey.md");
  s.check("rule#2: valid plan has all 8 Core sections", coreSectionCount(valid) >= 8, `got ${coreSectionCount(valid)}`);
  s.check("rule#2: missing-core plan fails (< 8)", coreSectionCount(missing) < 8, `got ${coreSectionCount(missing)}`);
  s.check("rule#3: valid plan has ≥1 Acceptance Criterion", acceptanceCriteriaCount(valid) >= 1, `got ${acceptanceCriteriaCount(valid)}`);
  // The #31 regression: an AC heading present but empty must count 0 (the old awk bug counted wrong).
  s.check("rule#3 (#31 guard): empty-AC plan counts 0", acceptanceCriteriaCount(emptyAc) === 0, `got ${acceptanceCriteriaCount(emptyAc)}`);
  // Rule #9 — requirement→criterion traceability.
  s.check("rule#9: valid plan covers every [user-stated] requirement", requirementCoveragePasses(valid));
  s.check("rule#9: uncovered-req plan fails", !requirementCoveragePasses(uncovered));
  // Rule #10 — create-without-survey is the anti-reinvention gate; modify-only passes vacuously.
  s.check("rule#10: valid plan (create + survey) passes", existingCodeSurveyPasses(valid));
  s.check("rule#10: create-no-survey plan fails", !existingCodeSurveyPasses(createNoSurvey));
  s.check("rule#10: modification-only plan passes vacuously", existingCodeSurveyPasses(emptyAc));
  // Rule #11 — checks.yaml ID sync, both directions.
  s.check("rule#11: in-sync checks.yaml passes", checksInSync(valid, join(fx, "checks-valid.yaml")));
  s.check("rule#11: drifted checks.yaml fails", !checksInSync(valid, join(fx, "checks-drifted.yaml")));
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

// ── Check E: agent-skills.git commits no fast-tier lesson scopes ──
// The loops now run their fast tier on LoreKit (tag loop::<scope>, scopes
// global / repo::{owner}/{repo}), not on committed markdown — so no loop
// writes memory/<scope>/ anymore. This guard stays as a belt-and-suspenders
// check: a committed memory/<scope>/ directory here (e.g. left over from the
// pre-LoreKit markdown backend, or hand-created) would be skill-author noise
// masquerading as lessons. Keep these directories absent in agent-skills.git.
{
  // Keep this array in sync with the Lessons table in agents/shared/rules/memory-buckets.md.
  for (const scope of ["aw-lessons", "aw-tester-lessons", "preview-spec-lessons", "fix-bug-lessons", "batch-lessons", "reviewer-lessons", "implement-suggestion-lessons", "ci-auto-fix-lessons", "e2e-pr-stabilizer-lessons", "test-auto-fix-lessons", "ideate-lessons", "optimize-approach-lessons"]) {
    const dir = join(REPO_ROOT, "memory", scope);
    s.check(`memory/${scope} not committed in agent-skills.git (this is the skill source, not a consumer)`, !existsSync(dir));
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

// ── Check F2: frontmatter is PARSEABLE YAML, for skills and agents alike ──
// A plain (unquoted) YAML scalar may not contain ": " — it reads as a mapping indicator, and a
// strict parser rejects the WHOLE frontmatter block, so the file's name/description/tools never
// load. Two real instances: agents/rca-investigator.md shipped broken ("absorbing the
// reasoning: `/fix-bug`"), and a pr-reviewer description rewrite reintroduced it twice in one
// line ("multi-lens review: correctness", "the Task tool: `Task(`"). Both are invisible to every
// other check here, because every other check greps the BODY.
//
// This is a targeted rule rather than a YAML parse: the repo has no YAML dependency, and ": " in
// an unquoted scalar is the only shape either failure took. A quoted value may contain anything.
{
  const AGENT_AND_SKILL_FRONTMATTER = [
    ...walk(join(REPO_ROOT, "skills")).filter((p) => p.endsWith("/SKILL.md")),
    ...walk(join(REPO_ROOT, "agents")).filter((p) => /\/agents\/[^/]+\.md$/.test(p)),
  ];
  for (const f of AGENT_AND_SKILL_FRONTMATTER) {
    const src = readFileSync(f, "utf8");
    const parts = src.split("---\n");
    if (parts.length < 3 || parts[0] !== "") continue;   // no frontmatter block
    const offenders = parts[1].split("\n")
      .map((line) => /^([A-Za-z_][\w-]*): (.+)$/.exec(line))
      .filter((m) => m && !/^["'|>]/.test(m[2]) && m[2].includes(": "))
      .map((m) => m[1]);
    s.check(`F2 ${rel(f)} frontmatter has no bare ": " in a plain scalar`,
      offenders.length === 0,
      offenders.length ? `key(s): ${offenders.join(", ")} — quote the value or use an em dash` : "");
  }
}

// ── Check F3: "tool unavailable" is not one failure, and never terminal for a run ──
// An MCP server connects asynchronously: a tool unregistered at the start of a run can be
// callable minutes later in the same session (observed live — the harness reports servers as
// "still connecting" and ToolSearch waits for them). The rule used to say the opposite — "there
// is nothing to wait for, set false immediately, the remedy is environmental" — which is how a
// long multi-round run probes once, settles false, and then no-ops every read AND write in every
// later round: "LoreKit memory not connected ... nothing captured".
//
// Assert the two causes are still distinguished, and that no surface has gone back to declaring
// unavailability terminal for the run.
{
  const readSrc = (p) => readFileSync(join(REPO_ROOT, p), "utf8");
  const SURFACES = [
    "agents/pr-reviewer.md",
    "agents/shared/rules/comment-relevance-memory.md",
    "agents/shared/rules/prior-comment-awareness.md",
  ];
  for (const f of SURFACES) {
    const src = readSrc(f);
    s.check(`F3 ${f} distinguishes a missing grant from a server that has not connected yet`,
      /tools:` grant/.test(src) && /connected yet|has not connected/.test(src),
      "the two causes of 'tool unavailable' are conflated again");
    // The exact sentences that made the old rule wrong. Each asserted the run-level verdict.
    for (const phrase of ["There is nothing to wait for", "terminal immediately"]) {
      s.check(`F3 ${f} no longer declares unavailability terminal ("${phrase}")`,
        !src.includes(phrase),
        "a run-terminal verdict on an asynchronously-connecting server is back");
    }
  }
  // The write sites must not inherit the read-time verdict — that inheritance is what turned one
  // early probe into a whole run of no-ops.
  s.check("F3 pr-reviewer's write sites re-probe rather than inheriting the read verdict",
    /write sites[\s\S]{0,400}attempt their call regardless/.test(readSrc("agents/pr-reviewer.md")));
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

  // G6b: Materiality routing — non-blocking findings split material/cosmetic; cosmetic sorts after
  // material at placement, and on a docs-only incremental delta is dropped at the PRE-CLEARING
  // filtering stage (2.3) so it never enters <CL> and the <CL> − <DEF> == <F> identity holds. Both
  // assertions are scoped to the section slice so gutting the section fails the check.
  const matSec = (rcmd.match(/###\s+Materiality routing[\s\S]*?(?=\n##\s)/) || [""])[0];
  s.check("G6b rubric-composition § Materiality routing classifies material vs cosmetic + orders them",
    /cosmetic/i.test(matSec) && /material/i.test(matSec) && /sort before|material findings sort/i.test(matSec));
  s.check("G6b materiality cosmetic drop is pre-clearing (never enters <CL>, identity intact)",
    /filtering stage/i.test(matSec) && /never enters `<CL>`/i.test(matSec));
  // G6c: Consolidation collapses cross-surface parity findings into one enumerated finding, so a
  // consistency fix cannot leave a sibling to re-flag on the next push (cascade guard). Scoped to
  // the § Consolidation pass slice so gutting item 4 fails the check (matched G6b's scoping).
  const consSec = (rcmd.match(/##\s+Consolidation pass[\s\S]*?(?=\n##\s)/) || [""])[0];
  s.check("G6c rubric-composition consolidation collapses parity findings across siblings",
    /parity findings across sibling surfaces/i.test(consSec) && /enumerate/i.test(consSec));

  // G7: every refactor recipe (R\d+) in refactor-recipes.md's Contents list appears
  // in exactly one of the M or J rows of the Recipe Class table. The "simplify" mode
  // auto-applies Class M recipes; an unclassified recipe silently defaults to J, but
  // the contract is that the table is exhaustive — drift here erodes the classification
  // as a correctness boundary.
  const recipes = read("skills/quality/code-quality/rules/refactor-recipes.md");
  const contentsBlock = recipes.match(/## Contents\n([\s\S]+?)\n## /);
  const contentsIds = contentsBlock
    ? [...contentsBlock[1].matchAll(/^- (R\d+):/gm)].map((m) => m[1])
    : [];
  const classTable = recipes.match(/\| \*\*M \(Mechanical\)\*\* \| ([^|]+) \|[\s\S]+?\| \*\*J \(Judgment\)\*\* \| ([^|]+) \|/);
  const mIds = classTable ? [...classTable[1].matchAll(/R\d+/g)].map((m) => m[0]) : [];
  const jIds = classTable ? [...classTable[2].matchAll(/R\d+/g)].map((m) => m[0]) : [];
  const classified = new Set([...mIds, ...jIds]);
  const unclassified = contentsIds.filter((id) => !classified.has(id));
  s.check("G7 every recipe in Contents has a class (M or J)",
    contentsIds.length > 0 && unclassified.length === 0,
    unclassified.length ? `unclassified: ${unclassified.join(", ")}` : `${contentsIds.length} recipes classified`);
  const dupInM = mIds.filter((id, i) => mIds.indexOf(id) !== i);
  const dupInJ = jIds.filter((id, i) => jIds.indexOf(id) !== i);
  const inBoth = mIds.filter((id) => jIds.includes(id) && !/R17/.test(id));
  s.check("G7 no recipe appears in both M and J (R17 split is the only exception)",
    inBoth.length === 0 && dupInM.length === 0 && dupInJ.length === 0,
    [inBoth.length && `both: ${inBoth.join(", ")}`, dupInM.length && `dup M: ${dupInM.join(", ")}`, dupInJ.length && `dup J: ${dupInJ.join(", ")}`].filter(Boolean).join("; "));

  // G8: the targeted-escalation (Step 2.4b) contract is shared across four files —
  // the holistic skill's review-mode (owns the `focus` input + focused R1–R3),
  // the shared holistic-review rule (owns 2.4b selection/fan-out/cap), and both
  // review agents (wire 2.4b into their pipeline). Drift here means the escalation
  // calls into a `focus` input the skill never honours, or an agent advertises a
  // step that no longer exists. Lock the four corners of the contract.
  const reviewMode = read("skills/analysis/holistic-analysis/rules/review-mode.md");
  const holisticReview = read("agents/shared/rules/holistic-review.md");
  const prReviewer = read("agents/pr-reviewer.md");
  // Step 4's rendering reference (headlines, payload keys, section shapes) lives in its own rule
  // file. Checks that assert a rendered SHAPE read this; checks that assert PROCEDURE stay on the
  // agent body.
  const reportRendering = read("agents/pr-reviewer/rules/report-rendering.md");

  // G8a: review-mode declares the `focus` input with all four sub-keys.
  const focusKeys = ["file:", "line:", "symbol:", "finding:"];
  s.check("G8a review-mode declares the focus input with file/line/symbol/finding",
    /\bfocus\b/.test(reviewMode) && focusKeys.every((k) => reviewMode.includes(k)),
    focusKeys.filter((k) => !reviewMode.includes(k)).join(", ") || "ok");

  // G8b: the shared rule owns the 2.4b section and passes a `focus:` block in its call.
  s.check("G8b holistic-review has Targeted escalation (Step 2.4b) section",
    holisticReview.includes("Targeted escalation (Step 2.4b)") && /focus:/.test(holisticReview));

  // G8c: the 10-cap cost bound is stated (guards against silent regression to 3).
  s.check("G8c holistic-review escalation cap is 10, not 3",
    /up to \*\*10\*\*/.test(holisticReview));

  // G8d: pr-reviewer is the sole review agent; it wires 2.4b default-on with --no-escalate.
  // (reviewer agent retired — pr-reviewer self/cross relation handles both modes.)
  // Retiring reviewer.md dropped 8 checks that tracked that file (the G11 loop over
  // [reviewer, pr-reviewer] alone lost 7, plus G8d's former reviewer assertion), taking
  // the consolidation base from 156/156 down to 148/148. This branch restores the total to
  // 156/156: the 8 dropped checks are replaced by the 8 new G17a–G17h standards-conformance
  // guards below. All checks are executed and green.
  s.check("G8d pr-reviewer wires 2.4b + --no-escalate",
    prReviewer.includes("2.4b") && prReviewer.includes("--no-escalate"));

  // G9: verification-receipt (Step 2.6b) is wired into pr-reviewer's pipeline block
  // in the same position (after 2.6 grounding, before 2.7 confidence).
  // pr-reviewer is the sole review agent since the reviewer agent was retired.
  const verificationReceipt = read("agents/shared/rules/verification-receipt.md");
  s.check("G9a verification-receipt.md declares Step 2.6b",
    verificationReceipt.includes("2.6b") && verificationReceipt.includes("verification-receipt"));
  s.check("G9b verification-receipt.md declares null-result DROP rule",
    /null.*DROP|DROP.*null/i.test(verificationReceipt) || verificationReceipt.includes("null result = DROP") ||
    verificationReceipt.includes("null or empty proof result DROPS"));
  s.check("G9c pr-reviewer.md wires 2.6b between 2.6 and 2.7",
    prReviewer.includes("2.6b") && prReviewer.includes("verification-receipt"));

  // G9d: comment-relevance keys must be a pure `<category>:<claim-gist>` fingerprint —
  // NEVER a coordinate (pr#/comment-id/sha/file:line). Coordinate keys are unique per
  // occurrence, so seen_count never accumulates and the relevance loop goes inert; this
  // is the observed drift that left ~40 duplicate rows on dash0hq/dash0. The rule and the
  // pr-reviewer write path must both carry the broadened prohibition + the ❌ anti-pattern
  // exemplar, so the agent cannot read "MUST NOT encode file:line" narrowly and think a
  // pr{N}-{commentId} key is allowed. Lock the guidance in place (presence, not absence —
  // the ❌ example intentionally contains a coordinate key).
  const crm = read("agents/shared/rules/comment-relevance-memory.md");
  const threadRes = read("agents/shared/rules/thread-resolution.md");
  s.check("G9d comment-relevance-memory broadens the coordinate ban beyond file:line",
    /PR number,\s+comment id/.test(crm) && /never in the key/.test(crm));
  s.check("G9d comment-relevance-memory shows the pr{N}-{commentId} anti-pattern as ❌ WRONG",
    /❌ WRONG/.test(crm) && /reviewer-comment-relevance::pr\d+-\d+/.test(crm));
  s.check("G9d comment-relevance-memory carries the pre-write coordinate self-check",
    crm.includes("Self-check before every write") && /encoded a coordinate/.test(crm));
  // The self-check must key on coordinate SHAPES, not on any run of digits. `fingerprint()`
  // in scripts/record-comment-relevance.mjs preserves digits, so a bare `\d{3,}` test fires
  // on legitimate gists (`issue:500-responses-not-retried`) — the agent would strip the digits
  // while the script keeps them, re-creating the agent/script key split this rule exists to
  // close. Lock both halves: the over-broad test is gone, and the carve-out is stated.
  s.check("G9d comment-relevance self-check does not fire on digits inside a claim gist",
    !crm.includes("(pr)?\\d{3,}") && crm.includes("Digits inside a gist are legitimate"));
  s.check("G9d thread-resolution warns against coordinate keys in the pr-reviewer write path",
    /NO pr#\/comment-id\/sha/.test(threadRes) && threadRes.includes("<category>:<claim-gist>"));
  // The ban must cover EVERY write path, not just pr-reviewer's. A bare `::<fingerprint>`
  // placeholder left in any memory.write template is an open invitation to re-encode a
  // coordinate, which is how the drift reached dash0hq/dash0 in the first place. Assert the
  // expanded placeholder is present AND the bare one is gone, per writing agent.
  const implSuggestion = read("skills/workflow/implement-suggestion/SKILL.md");
  for (const [label, doc] of [
    ["implement-suggestion/SKILL.md", implSuggestion],
    ["comment-relevance-memory.md", crm],
    ["thread-resolution.md", threadRes],
  ]) {
    // Ban BOTH placeholder spellings: the markdown templates use `<fingerprint>` and the
    // GitHub Actions CLI snippet uses `{fingerprint}`. Guarding only the angle form leaves
    // the brace form free to regress the same defect.
    s.check(`G9d ${label} spells the relevance key as <category>:<claim-gist>, never a bare fingerprint placeholder`,
      doc.includes("reviewer-comment-relevance::<category>:<claim-gist>") &&
      !/reviewer-comment-relevance::[<{]fingerprint[>}]/.test(doc));
  }

  // G10: review-config.md declares that absent .review.yaml defaults to profile: balanced,
  // and that balanced = today's defaults (threshold 80, per-file caps 5/10).
  // Back-compat: any behavior change without a config file is a guard failure.
  const reviewConfig = read("agents/shared/rules/review-config.md");
  s.check("G10a review-config.md states 'defaults to profile: balanced' (back-compat phrase)",
    reviewConfig.includes("defaults to profile: balanced"));
  s.check("G10b review-config.md states balanced threshold is 80",
    /balanced.*80|80.*balanced/i.test(reviewConfig) || reviewConfig.includes("**80**"));
  s.check("G10c per-comment-confidence.md still documents threshold default of 80",
    read("agents/shared/rules/per-comment-confidence.md").includes("80"));

  // G11: pr-reviewer's diagnostic-surface Phase model table includes the new phases
  // 1.0, 1.7, 2.5b, 2.6b — failure taxonomy is append-only; verify new rows exist.
  // (reviewer agent retired — only pr-reviewer remains; it handles self + cross via REVIEW_RELATION.)
  const prReviewerDiag = read("agents/pr-reviewer/rules/diagnostic-surface.md");
  for (const [label, content] of [["pr-reviewer", prReviewerDiag]]) {
    s.check(`G11 ${label} diagnostic-surface has phase 1.7 (review config load)`,
      content.includes("1.7") && content.includes("review-config"));
    s.check(`G11 ${label} diagnostic-surface has phase 2.5b (prior-comment dedup)`,
      content.includes("2.5b") && content.includes("prior-comment"));
    s.check(`G11 ${label} diagnostic-surface has phase 2.6b (verification receipt)`,
      content.includes("2.6b") && content.includes("verification-receipt"));
    s.check(`G11 ${label} diagnostic-surface failure taxonomy has F-null-receipt-treated-as-confirmation`,
      content.includes("F-null-receipt-treated-as-confirmation"));
    s.check(`G11 ${label} diagnostic-surface failure taxonomy has F-flip-flop-not-suppressed`,
      content.includes("F-flip-flop-not-suppressed"));
    s.check(`G11 ${label} diagnostic-surface failure taxonomy has F-config-back-compat-broken`,
      content.includes("F-config-back-compat-broken"));
    s.check(`G11 ${label} diagnostic-surface hard invariants include null-receipt drop rule`,
      content.includes("null") && content.includes("verification") &&
      (content.includes("never read as confirmation") || content.includes("drop")));
  }

  // G12: review-outcomes.md exists as the shared candidate/outcome bus and documents
  // the four required contracts: volatile TTL, fingerprint reuse, promotion threshold,
  // and provenance rule. These are the stable literal strings the emit step and
  // agents wire against — check them verbatim.
  {
    const ro = read("agents/shared/rules/review-outcomes.md");
    s.check("G12a review-outcomes.md exists and declares volatile TTL (30 days)",
      ro.includes("review-outcomes") && ro.includes("volatile") && /30.day/i.test(ro));
    s.check("G12b review-outcomes.md mandates fingerprint reuse from prior-comment-awareness",
      ro.includes("prior-comment-awareness") && ro.includes("fingerprint"));
    s.check("G12c review-outcomes.md states promotion-agreement threshold (≥ 3 concordant verdicts)",
      /concordant.*verdict|verdict.*concordant/i.test(ro) || /3 concordant/i.test(ro));
    s.check("G12d review-outcomes.md states provenance honesty rule (mixed-source)",
      ro.includes("provenance") && /mixed.source/i.test(ro) &&
      (ro.includes("filter by") || ro.includes("filter by `source`")));
    s.check("G12e review-outcomes.md states candidate bus NOT loaded per-review",
      ro.includes("MUST NOT") && ro.includes("per-review") ||
      ro.includes("per-review") && ro.includes("never") && ro.includes("Step 0.7"));
    s.check("G12f review-outcomes.md names outcome-emit step token (anchors implement-suggestion's emit)",
      ro.includes("outcome-emit") || ro.includes("implement-suggestion"));
  }

  // G13: implement-suggestion SKILL.md references review-outcomes as a producer
  // and contains the outcome-emit step. Check for stable literal tokens written
  // into the file — these strings are controlled by this commit.
  {
    const isSkill = read("skills/workflow/implement-suggestion/SKILL.md");
    s.check("G13a implement-suggestion references review-outcomes scope",
      isSkill.includes("review-outcomes"));
    s.check("G13b implement-suggestion contains outcome-emit anchor/step",
      isSkill.includes("outcome-emit"));
    s.check("G13c implement-suggestion states emit is non-blocking (append-only)",
      /non-blocking/i.test(isSkill) && isSkill.includes("review-outcomes"));
    s.check("G13d implement-suggestion references outcome-learning.md as the consumer",
      isSkill.includes("outcome-learning.md") && isSkill.includes("review-outcomes"));
  }

  // G14: outcome-learning.md names review-outcomes as its primary input and explicitly
  // forbids loading the bus per-review (Step 0.7 discipline). Both contracts are
  // stable literal strings this commit writes into the file.
  {
    const ol = read("agents/shared/rules/outcome-learning.md");
    s.check("G14a outcome-learning.md names review-outcomes as primary input",
      ol.includes("review-outcomes") && /primary.*input|primary.*signal/i.test(ol));
    s.check("G14b outcome-learning.md states bus is NEVER loaded per-review",
      ol.includes("review-outcomes") && (ol.includes("NEVER") || ol.includes("never")) &&
      ol.includes("per-review"));
    s.check("G14c outcome-learning.md references review-outcomes.md for bus schema",
      ol.includes("review-outcomes.md") && (ol.includes("schema") || ol.includes("bus")));
  }

  // G15: implement-suggestion commit-per-comment + resolve-thread invariants (v2.3.0).
  // These lock the behavioral contract of the worker: one commit per addressed
  // comment, push ONCE, then resolve each addressed thread. The REST reply path
  // MUST carry the pull number (a prior review regression removed it) and the
  // forbidden legacy phrase "one commit per PR" must not reappear anywhere in
  // the skill. All are stable literal tokens this commit controls.
  {
    const handoff = read("skills/workflow/implement-suggestion/rules/handoff.md");
    const isSkill2 = read("skills/workflow/implement-suggestion/SKILL.md");
    const fetching = read("skills/workflow/implement-suggestion/rules/comment-fetching.md");
    const watch = read("skills/workflow/implement-suggestion/rules/watch-mode.md");
    const pack = read("skills/workflow/implement-suggestion/templates/suggestion-pack.md");
    const skillFiles = [
      ["SKILL.md", isSkill2], ["handoff.md", handoff], ["comment-fetching.md", fetching],
      ["watch-mode.md", watch], ["suggestion-pack.md", pack],
    ];

    s.check("G15a handoff worker prompt mandates one commit per comment",
      handoff.includes("ONE COMMIT PER COMMENT"));
    s.check("G15b handoff pushes ONCE after all per-comment commits",
      handoff.includes("Push ONCE") || handoff.includes("push ONCE"));
    s.check("G15c handoff resolves via resolveReviewThread",
      handoff.includes("resolveReviewThread"));
    s.check("G15d handoff REST reply path carries the pull number",
      handoff.includes("pulls/<n>/comments/<comment-id>/replies"));
    s.check("G15e handoff does NOT use the pull-number-less reply path (prior regression)",
      !handoff.includes("pulls/comments/<comment-id>/replies"));
    s.check("G15f handoff skips resolve for null threadId (issues/review-summary)",
      handoff.includes("threadId") && handoff.includes("no thread to resolve"));
    s.check("G15g handoff aborts push+resolve on partial-batch failure",
      handoff.includes("partial batch") && /push nothing/i.test(handoff) && /resolve nothing/i.test(handoff));
    s.check("G15h handoff continues (does not abort) on a resolve-side failure",
      handoff.includes("not-resolved") && handoff.includes("CONTINUE"));
    s.check("G15i comment-fetching captures threadId and guards GraphQL truncation",
      fetching.includes("threadId") && fetching.includes("hasNextPage"));
    s.check("G15j SKILL.md hard rule is 'One commit per applied comment'",
      isSkill2.includes("One commit per applied comment"));
    for (const [label, content] of skillFiles) {
      s.check(`G15k ${label} does not reintroduce the legacy 'one commit per PR' phrase`,
        !/one commit per pr\b/i.test(content));
    }
  }

  // G24: the relevance-bucket contracts this repo hand-mirrors across rule files.
  // Same class as G16 (cross-file drift, no single source of truth).
  //
  // Every check here must FAIL on the regression it names, not on a proxy. Five
  // earlier versions did not, each for its own reason: one asserted enum membership
  // under a name promising producer coverage; two matched only double-quoted phrase
  // restatements; one counted a symbol repo-wide so the function definition satisfied
  // it with both call sites deleted; one matched a key anywhere in a file that also
  // defines it. If you add a check here, mutate the contract and confirm it goes red.
  {
    const ol = read("agents/shared/rules/outcome-learning.md");
    const tr = read("agents/shared/rules/thread-resolution.md");
    const rec = read("scripts/record-comment-relevance.mjs");

    // (a) "Cite, don't restate": the two deferring rows in thread-resolution must link
    // out and must not carry the phrase lists they used to duplicate — quoted or not.
    const ackRow = (tr.match(/^\|\s*\*\*acknowledged\*\*.*$/m) || [""])[0];
    const decRow = (tr.match(/^\|\s*\*\*declined\*\*.*$/m) || [""])[0];
    const ackPhrases = (ackRow.match(/\b(fixed|done|addressed|resolved|updated)\b/gi) || []).length;
    const decPhrases = (decRow.match(/\b(won.?t fix|by design|intentional|out of scope|n\/a|nwf|as designed)\b/gi) || []).length;
    s.check("G24a acknowledged row links the judgement rule and does not restate a phrase list",
      /outcome-learning\.md/.test(ackRow) && ackPhrases <= 1);
    s.check("G24b declined row cites the judgement rule and does not restate the alternatives",
      /outcome-learning\.md/.test(decRow) && decPhrases === 0);

    // (c) The agent-facing rule is a JUDGEMENT rule, not a tokenizer. Positive shape
    // assertion: a denylist of tokenizer vocabulary is routed around by paraphrase.
    const ackSection = (ol.match(/#### What counts as an acknowledgement[\s\S]*?(?=\n#### |\n### |\n## )/) || [""])[0];
    const bullets = (ackSection.match(/^- \*\*/gm) || []).length;
    s.check("G24c the acknowledgement rule states decline-precedence",
      /decline wins/i.test(ackSection));
    s.check("G24d the acknowledgement rule keeps its judgement shape (bulleted criteria + default)",
      bullets >= 4 &&
      /cannot tell|when you can.t tell/i.test(ackSection) &&
      !/token window|word tokens|negator|complement clause|tokeniz|split the reply/i.test(ackSection));

    // (e) Decline-precedence is the one contract both paths must share. G24c asserts the
    // prose half in outcome-learning; this asserts it in thread-resolution, which makes
    // the claim, and (f) asserts the executable half, which fails silently.
    s.check("G24e thread-resolution states decline-precedence for the in-run path",
      /decline outranks an acknowledgement/i.test(tr));

    // Scope to each function's own body. `fnBody` must handle `async function`: an
    // earlier version terminated on "\nfunction " only, so modeThreadResolved's window
    // ran to EOF, swallowed modePrMerged, and stayed green when its own call was cut.
    const fnBody = (name) => {
      const i = rec.search(new RegExp(`^(?:async\\s+)?function ${name}\\(`, "m"));
      if (i < 0) return "";
      const rest = rec.slice(i + 1);
      const j = rest.search(/^(?:async\s+)?function \w+\(/m);
      return j < 0 ? rec.slice(i) : rec.slice(i, i + 1 + j);
    };
    s.check("G24f both script modes still apply decline detection",
      /hasWontFixReply\s*\(/.test(fnBody("modeThreadResolved")) &&
      /hasWontFixReply\s*\(/.test(fnBody("modePrMerged")));

    // (i) The acknowledged-no-fix carve-out must exist AND precede the ignored-at-merge
    // bullet whose condition it satisfies in full. Deleting it (which I did) sends an
    // author who replied "fixed" into `weak-not-relevant / ignored-at-merge` — a
    // dismissal feeding the suppression gate, the inversion the acknowledgement test
    // exists to prevent, arriving through the sibling bullet.
    const crm2 = read("agents/shared/rules/comment-relevance-memory.md");
    const iAck = crm2.indexOf("- Author **acknowledged** but no fix commit in range");
    const iIgn = crm2.indexOf("- PR merged with thread open");
    s.check("G24i the acknowledged-no-fix carve-out exists and precedes ignored-at-merge",
      iAck > -1 && iIgn > -1 && iAck < iIgn);
    s.check("G24i2 the ignored-at-merge bullet excludes acknowledgements in its own condition",
      /- PR merged with thread open[^\n]*no acknowledgement/.test(crm2));

    // (j) The open-thread set must mean "pending". Two contracts hold that invariant,
    // and both were absent when a real PR accumulated 20 unclosable threads across six
    // passes. These assert the RELATION, not the presence of two strings in a 450-line
    // file: an earlier version stayed green when the obsolete row's `and` was flipped to
    // `or` and when the whole alternate-write-path paragraph was deleted.
    const tr2 = read("agents/shared/rules/thread-resolution.md");
    const pca = read("agents/shared/rules/prior-comment-awareness.md");
    const prm = read("agents/pr-reviewer.md");

    const obsRow = (tr2.match(/^\|\s*\*\*obsolete\*\*.*$/m) || [""])[0];
    s.check("G24j thread-resolution defines an obsolete disposition that resolves",
      /\*\*Resolve\*\*/.test(obsRow));
    // Conjunction, in the row itself — `or` must fail.
    s.check("G24k obsolete conjoins isOutdated with non-reproduction, and requires the re-scan predicate",
      /isOutdated/.test(obsRow) && /\*\*and\*\*/.test(obsRow) && !/\*\*or\*\*/.test(obsRow) &&
      /re-scan predicate/i.test(obsRow));
    // The predicate must actually be stated for obsolete, not only for fixed.
    const obsSection = (tr2.match(/### `obsolete`[\s\S]*?(?=\n### |\n## )/) || [""])[0];
    s.check("G24k2 the obsolete section names both re-scan conjuncts and the pre-dedup read",
      /SCANNED_FILES/.test(obsSection) && /REVIEW_DIFF/.test(obsSection) &&
      /2\.5b|pre-dedup/i.test(obsSection));

    s.check("G24l the thread query captures isOutdated for both readers",
      /isResolved isOutdated/.test(pca) && /isResolved isOutdated/.test(tr2));

    // The carve-out must SET the flag (not "never set" it), defer the path decision to
    // github-access.md, and the agent must not report the removed threads as closed.
    s.check("G24m the no-resolve-path carve-out is stated affirmatively and defers the path to github-access",
      /\bset `RESOLUTION_UNAVAILABLE = true`/i.test(tr2) &&
      !/\b(never|do not|don't) set `RESOLUTION_UNAVAILABLE/i.test(tr2) &&
      /github-access\.md/.test(tr2));
    // The exclusion sentence is procedure (Step 2.9c, agent body); the Details-cell wording it
    // produces is a rendered shape (rendering reference). Assert each where it now lives.
    s.check("G24m2 carve-out removals are excluded from the resolved-since counter",
      /RESOLUTION_UNAVAILABLE` carve-out are excluded/.test(prm) &&
      /certified done but still open/.test(read("agents/pr-reviewer/rules/report-rendering.md")));

    // (g) Every WONT_FIX_RE alternative bounded, derived from the regex rather than a
    // named subset — an earlier version asserted three of four and missed the fourth.
    const reLine = (rec.match(/^const WONT_FIX_RE\s*=.*$/m) || [""])[0];
    const body = (reLine.match(/=\s*\/(.*)\/[a-z]*;/) || [])[1] || "";
    const alts = body ? body.split("|") : [];
    s.check("G24g every WONT_FIX_RE alternative is bounded on both sides",
      alts.length >= 8 && alts.every((a) => a.startsWith("\\b") && a.endsWith("\\b")));

    // (h) The model-readable decline list and WONT_FIX_RE are hand-mirrored. Compare as
    // sets so a deletion or addition on either side goes red — the drift that produced
    // the `as designed` inversion.
    const norm = (x) => x.replace(/\\b/g, "").replace(/\\s\+/g, " ").replace(/\\\//g, "/")
                         .replace(/\(.*?\)/g, "").replace(/[^a-z /]/gi, "").trim().toLowerCase();
    const fromRe = new Set(alts.map(norm).filter(Boolean));
    // The blockquote is indented inside a list item, so anchor on optional leading space.
    const quote = (ol.match(/^[ \t]*> [^\n]*·[\s\S]*?(?=\n[ \t]*\n)/m) || [""])[0];
    const fromProse = new Set(quote.split(/[·\n>]/).map(norm).filter(Boolean));
    // BOTH directions. A one-way subset test leaves the direction that matters green:
    // a phrase the model-readable list treats as a decline but WONT_FIX_RE misses is the
    // exact coupling this PR documents (a decline that misses the regex resolves the
    // thread and records relevant/fixed for a finding the author rejected).
    const covers = (x, set) => [...set].some((y) => y.includes(x) || x.includes(y));
    s.check("G24h the model-readable decline list and WONT_FIX_RE's alternatives agree both ways",
      fromRe.size >= 8 && fromProse.size >= 8 &&
      [...fromRe].every((a) => covers(a, fromProse)) &&
      [...fromProse].every((b) => covers(b, fromRe)));
  }

  // G16: the `reviewer-comment-relevance` TTL is hand-mirrored across five files
  // with no single source of truth (the executable writer needs a literal, and this
  // repo's CLAUDE.md requires rules to be self-contained). This is the cross-file
  // drift guard, the counterpart to G12a's lock on `review-outcomes`' 30-day TTL.
  //
  // CHANGING THE TTL? Update all SIX occurrences, then update `TTL_DAYS` below:
  //   1. CLAUDE.md                                        ("durable N-day per-repo relevance signal")
  //   2. agents/shared/rules/comment-relevance-memory.md   ("default: now + N days")
  //   3. plugins/pr-relevance-memory/README.md             ("N-day TTL, refreshed on each sighting")
  //   4. scripts/record-comment-relevance.mjs              (`N * 24 * 60 * 60 * 1000`)
  //   5. skills/workflow/implement-suggestion/SKILL.md     ("N-day default TTL", "durable N-day TTL")
  {
    const TTL_DAYS = 60;
    const claude = read("CLAUDE.md");
    const crm = read("agents/shared/rules/comment-relevance-memory.md");
    const pluginReadme = read("plugins/pr-relevance-memory/README.md");
    const recorder = read("scripts/record-comment-relevance.mjs");
    const isSkill3 = read("skills/workflow/implement-suggestion/SKILL.md");

    s.check(`G16a CLAUDE.md states the reviewer-comment-relevance TTL as ${TTL_DAYS} days`,
      new RegExp(`durable ${TTL_DAYS}-day per-repo relevance signal`).test(claude));
    s.check(`G16b comment-relevance-memory.md record schema expires at +${TTL_DAYS} days`,
      new RegExp(`default: now \\+ ${TTL_DAYS} days`).test(crm));
    s.check(`G16c pr-relevance-memory README states a ${TTL_DAYS}-day TTL`,
      new RegExp(`${TTL_DAYS}-day TTL`).test(pluginReadme));
    s.check(`G16d record-comment-relevance.mjs computes expiry from ${TTL_DAYS} days`,
      recorder.includes(`${TTL_DAYS} * 24 * 60 * 60 * 1000`));
    s.check(`G16e implement-suggestion SKILL.md states the ${TTL_DAYS}-day TTL in both places`,
      new RegExp(`${TTL_DAYS}-day default TTL`).test(isSkill3) &&
      new RegExp(`durable ${TTL_DAYS}-day TTL`).test(isSkill3));

    // Negative assertion: the feared drift is a PARTIAL revert, where one or two
    // files keep the old number. Any reviewer-comment-relevance TTL statement that
    // disagrees with TTL_DAYS must fail here.
    const mirrors = [
      ["CLAUDE.md", claude], ["comment-relevance-memory.md", crm],
      ["pr-relevance-memory/README.md", pluginReadme],
      ["record-comment-relevance.mjs", recorder],
      ["implement-suggestion/SKILL.md", isSkill3],
    ];
    const stale = /(\d+)-day (?:default )?TTL|(\d+)-day per-repo relevance signal|now \+ (\d+) days|(\d+) \* 24 \* 60 \* 60 \* 1000/g;
    for (const [label, content] of mirrors) {
      // TTLs of OTHER buckets legitimately co-occur in these files. Each is excused by name and
      // owned by its own check, so this one stays about `reviewer-comment-relevance` drift only.
      const OTHER_BUCKET_TTLS = new Set([
        30,  // `review-outcomes` — the volatile bus; G12a owns it.
        7,   // `pr-review-state` — pr-reviewer's per-PR state record; G24i owns it.
      ]);
      const found = [...content.matchAll(stale)]
        .map((m) => Number(m[1] ?? m[2] ?? m[3] ?? m[4]))
        .filter((n) => n !== TTL_DAYS && !OTHER_BUCKET_TTLS.has(n));
      s.check(`G16f ${label} carries no reviewer-comment-relevance TTL other than ${TTL_DAYS}`,
        found.length === 0, found.length ? `stale: ${[...new Set(found)].join(", ")}` : "");
    }
  }

  // G17: standards-conformance.md exists and is wired into pr-reviewer.
  // Each sub-check reads the REAL shipped file and asserts a literal anchor/string.
  // Mirrors the G8d/G9c guard shape — never re-encode expected content inside the eval.
  // Check-gaming is forbidden: these guards read the files under test, not a copy.
  {
    const sc = read("agents/shared/rules/standards-conformance.md");
    // G17a: the rule file exists and declares itself default-on with --no-standards opt-out.
    s.check("G17a standards-conformance.md exists and declares default-on + --no-standards opt-out",
      sc.includes("standards-conformance") &&
      /default.on/i.test(sc) &&
      sc.includes("--no-standards"));

    // G17b: the rule names review-config upward walk, states the 30,000-char cap,
    // states drops are logged (never silent), and references the reused holistic-review trivial-skip.
    s.check("G17b standards-conformance.md names review-config walk + 30000-char cap + log-drops + trivial-skip",
      sc.includes("review-config") &&
      (sc.includes("30,000") || sc.includes("30000")) &&
      /log/i.test(sc) &&
      sc.includes("trivial-skip"));

    // G17c: review-config.md documents the standards: schema, its concatenation merge rule,
    // and an explicit distinction between path_instructions (nudge) and standards (findings).
    const rcFull = read("agents/shared/rules/review-config.md");
    s.check("G17c review-config.md documents standards: schema + concatenation + path_instructions-vs-standards distinction",
      rcFull.includes("standards:") &&
      /concatenat/i.test(rcFull) &&
      rcFull.includes("path_instructions") &&
      // The distinction itself, not merely the two words: the section heading plus the
      // semantics that separate them (nudge-only vs. finding-producing).
      /`path_instructions`\s+vs\.\s+`standards`/.test(rcFull) &&
      /`path_instructions`\*\* is a \*\*confidence nudge\*\*/.test(rcFull) &&
      /`standards`\*\* produces \*\*real findings\*\*/.test(rcFull));

    // G17d: the rule states never/must→issue and prefer→suggestion mapping,
    // states narrative/aspirational prose is never flagged, and states doc path:line as grounding.
    s.check("G17d standards-conformance.md states never/must→issue + prefer→suggestion + prose-never + path:line grounding",
      /issue/i.test(sc) &&
      /suggestion/i.test(sc) &&
      /prefer/i.test(sc) &&
      /narrative|aspirational/i.test(sc) &&
      (/path:line/i.test(sc) || /grounding/i.test(sc)));

    // G17e: pr-reviewer.md has a standards diagnostics line in the Review details block
    // AND the standards-specific precedence statement.
    // A bare /precedence|conflict/ sweep is tautological here: the base file already matches it
    // three times (Step 0.7's lesson-collision sentence, Gate 4's merge-conflict markers, and the
    // carve-out's "conflict residue"), so it asserts nothing about the 2.4d statement. Same shape
    // as the G17c fix above — assert the new content, not a word that was already there.
    s.check("G17e pr-reviewer.md has standards diagnostics line + 2.4d precedence paragraph + Conflicts-surfaced counter",
      (prReviewer.includes("Standards (2.4d)")
        || read("agents/pr-reviewer/rules/report-rendering.md").includes("Standards (2.4d)")) &&
      /Precedence: when a standards finding conflicts with the PR author's stated intent or a review-config\s+explicit override, the author-intent and config \*\*win\*\*/.test(prReviewer) &&
      prReviewer.includes("Conflicts surfaced:"));

    // G17f: pr-reviewer.md has --no-standards in the arg table AND the frontmatter description,
    // standards-conformance.md in the Imports list, and 2.4d in the pipeline block.
    s.check("G17f pr-reviewer.md has --no-standards (arg + frontmatter) + standards-conformance in Imports + 2.4d in pipeline",
      prReviewer.includes("--no-standards") &&
      prReviewer.includes("standards-conformance.md") &&
      prReviewer.includes("2.4d"));

    // G17g: CLAUDE.md and README.md each mention standards-conformance and --no-standards
    // in the pr-reviewer context.
    const claude = read("CLAUDE.md");
    const readme = read("README.md");
    s.check("G17g CLAUDE.md mentions standards-conformance + --no-standards in pr-reviewer context",
      claude.includes("standards-conformance") && claude.includes("--no-standards"));
    s.check("G17h README.md mentions standards-conformance + --no-standards in pr-reviewer context",
      readme.includes("standards-conformance") && readme.includes("--no-standards"));
  }

  // G18: the pr-reviewer memory-read call sites name the real mcp__lorekit__memory_list
  // tool and state a mandatory-attempt policy; the shared read rules mirror the same.
  // Mirrors the G16/G17 guard shape — reads the REAL shipped files and asserts literal anchors.
  // Never re-encode expected prose inside the eval (aw-lessons::mock-that-reimplements-the-thing-under-test).
  {
    const crm = read("agents/shared/rules/comment-relevance-memory.md");
    const pca = read("agents/shared/rules/prior-comment-awareness.md");

    // G18a: pr-reviewer.md issues the Step 1.0 read as a real mcp__lorekit__memory_list call.
    // A bare includes("mcp__lorekit__memory_list") is tautological here: the base file already
    // matches it once, in the `tools:` frontmatter (line 4), so it asserts nothing about the new
    // Step 1.0 fan-out. Same shape as the G17c/G17e fixes above — assert a literal sentence from
    // the rewritten block plus an occurrence floor the base revision cannot reach.
    const memoryListMentions = prReviewer.split("mcp__lorekit__memory_list").length - 1;
    s.check("G18a pr-reviewer.md issues the Step 1.0 read as a real mcp__lorekit__memory_list call (literal sentence + >= 5 mentions)",
      prReviewer.includes("Issue each line below as a real `mcp__lorekit__memory_list` tool call — these are not documentation shorthand.") &&
      memoryListMentions >= 5);

    // G18b: comment-relevance-memory.md names the real mcp__lorekit__memory_list tool at the read.
    s.check("G18b comment-relevance-memory.md names mcp__lorekit__memory_list at the read call site",
      crm.includes("mcp__lorekit__memory_list"));

    // G18c: pr-reviewer.md states a mandatory-attempt policy (the word "mandatory" near the read).
    s.check("G18c pr-reviewer.md states mandatory-attempt policy at the Step 1.0 read",
      /mandatory attempt/i.test(prReviewer));

    // G18d: comment-relevance-memory.md states a mandatory-attempt policy.
    s.check("G18d comment-relevance-memory.md states mandatory-attempt policy at the read",
      /mandatory attempt/i.test(crm));

    // G18e: pr-reviewer.md carries the sub-agent + SessionStart priming statement.
    s.check("G18e pr-reviewer.md states sub-agent SessionStart priming caveat",
      prReviewer.includes("sub-agent") && prReviewer.includes("SessionStart"));

    // G18f: at least one shared rule carries the sub-agent + SessionStart statement
    //       (comment-relevance-memory.md or prior-comment-awareness.md).
    s.check("G18f at least one shared rule states sub-agent SessionStart priming caveat",
      (crm.includes("sub-agent") && crm.includes("SessionStart")) ||
      (pca.includes("sub-agent") && pca.includes("SessionStart")));

    // G18g: scope/tag regression lock — the existing read semantics are unchanged.
    //       Both repo:: and the loop::reviewer-comment-relevance tag still appear.
    s.check("G18g comment-relevance-memory.md still carries repo:: and loop::reviewer-comment-relevance",
      crm.includes("repo::") && crm.includes("loop::reviewer-comment-relevance"));
  }

  // G19: the pr-reviewer posted review body uses a concise headline at the top level and the
  // gate-status table lives only inside the Review details accordion.
  // Reads the REAL shipped agents/pr-reviewer.md — never re-encode expected strings as
  // a self-comparison (aw-lessons::mock-that-reimplements-the-thing-under-test).
  // Mirrors the G18 literal-sentence + positional-slice idiom.
  {
    // G19a: the three concise headline sentences are present (PASS / WARN / FAIL).
    // These are literal anchors grepped from the rewritten Step 4 section.
    s.check("G19a the PASS concise headline has an affirming checkmark lead",
      reportRendering.includes("✅ Reviewed your changes — no issues found."));

    s.check("G19b the WARN concise headline is led by WARN_GATE_COUNT and names the warned gates",
      reportRendering.includes("Reviewed your changes — no blocking issues, **<WARN_GATE_COUNT> warning(s)**: <WARN_REASONS>."));

    s.check("G19c the FAIL concise headline is led by SEVERITY_TALLY and names the blocking gates",
      reportRendering.includes("Reviewed your changes — **<SEVERITY_TALLY>** need attention before human review.") &&
      reportRendering.includes("Blocking: <FAIL_REASONS>."));

    // G19d / G19g retired: they scanned the three embedded Step-4 templates for
    // gate-table-inside-accordion and footer-inside-accordion. Those templates no longer exist —
    // layout moved to agents/pr-reviewer/templates/report-body.md — and G25 now asserts both
    // properties against the REAL rendered output instead of against prose, which is strictly
    // stronger: it catches a run that produces the wrong markup, not just a spec that describes it.
    {
      // G19e: the review-body footer no longer carries the redundant CI-status sentence.
      // The clause was dropped from every FOOTER_LINE variant; assert it is gone from the
      // whole shipped file, not just Step 4 (the FOOTER_LINE definitions live in Step 4).
      s.check("G19e pr-reviewer.md review-body footer dropped the 'CI status is shown' clause",
        !prReviewer.includes("CI status is shown"));

      // G19f: the gate table is three columns with a static description on a passing gate.
      // The table lives in the template; the static descriptions the model chooses from live in
      // the rendering reference. Assert one on each side of that split.
      s.check("G19f the report template carries the 3-column gate table",
        readFileSync(join(REPO_ROOT, "agents/pr-reviewer/templates/report-body.md"), "utf8")
          .includes("| Gate | Status | Details |"));
      s.check("G19f the rendering reference still defines the ✅ static descriptions",
        reportRendering.includes("The multi-lens review found no blocking issues."));
    }
  }

  // G33: the Step 3 TERMINAL report's WARN verdict line and the POSTED body's WARN headline
  // (report-rendering.md) must never re-diverge. Regression guard for
  // `reviewer-lessons::gate-table-says-pass-while-contract-says-fail` (seen_count 7): a Step 3
  // WARN row that prints "PASS — no blocking issues, N warning(s)" beside a harness
  // `VERDICT: FAIL` (forced by ACTIONABLE >= 1, independent of gate severity) reads as an
  // unexplained contradiction to a human, and — per the lesson's sighting 7 — a harness that
  // judges "was this lesson honoured" from the Step 3 report rather than the posted body can be
  // fooled if the two are allowed to drift apart. Assert three things: neither surface prints the
  // literal `PASS —` WARN token, both surfaces state "no blocking issues" plus the warning count
  // for WARN, and pr-reviewer.md's WARN line names the report-rendering.md contract explicitly so
  // a future edit to one side is not made in ignorance of the other.
  {
    const step3WarnRow = sliceBetween(prReviewer, "| Presentation | `**Verdict**` line |", "`VERDICT` (PASS/WARN/FAIL");
    s.check("G33a pr-reviewer.md Step 3 WARN verdict line carries no bare PASS token",
      !/\|\s*WARN\s*\|\s*`PASS\s*—/.test(step3WarnRow),
      "Step 3's WARN row still prints a `PASS —` verdict, which contradicts a harness VERDICT: FAIL");
    s.check("G33b pr-reviewer.md Step 3 WARN verdict line matches the posted-body wording",
      /No blocking issues — <WARN_GATE_COUNT> warning\(s\): <WARN_REASONS>\./.test(step3WarnRow),
      "Step 3's WARN row no longer reads 'No blocking issues — <N> warning(s): <reasons>.' — re-sync it with report-rendering.md § Headlines");
    s.check("G33c report-rendering.md's posted-body WARN headline carries no bare PASS token",
      !/no blocking issues.*\*\*PASS\*\*|PASS\s*—\s*no blocking issues/i.test(reportRendering),
      "report-rendering.md's WARN headline regained a PASS token");
    s.check("G33d pr-reviewer.md's WARN row cites report-rendering.md so the two cannot drift silently",
      /report-rendering\.md[\s\S]{0,40}byte-identical|byte-identical[\s\S]{0,40}report-rendering\.md/.test(prReviewer),
      "pr-reviewer.md's Step 3 WARN explanation no longer cross-references report-rendering.md as the source of truth");
  }

  // G34: prior-comment-awareness.md requires verifying a "resolved" thread against HEAD before
  // trusting it, and verifying an "open" thread before assuming it is still live. Regression guard
  // for `reviewer-lessons::resolved-bot-thread-is-not-evidence-of-a-fix` (seen_count 7): a resolved
  // cursor[bot] thread was once trusted at face value and a real defect it covered was suppressed
  // with no code change behind the resolution.
  {
    const pca = read("agents/shared/rules/prior-comment-awareness.md");
    s.check("G34a the resolved-state table no longer treats GitHub thread resolution as sufficient on its own",
      !/\|\s*Thread explicitly marked resolved on GitHub\s*\|\s*Yes\s*\|/.test(pca),
      "the 'accepted / resolved' table reverted to trusting a resolved GitHub thread unconditionally");
    s.check("G34b prior-comment-awareness.md states the anchor-file-existence check as the first, cheapest verification",
      /anchor-file existence/i.test(pca) && /[Cc]heck it before anything else/.test(pca));
    s.check("G34c prior-comment-awareness.md requires bidirectional verification (resolved≠fixed, open≠unaddressed)",
      /resolved ≠ fixed|resolved≠fixed/.test(pca) && /open ≠ unaddressed|open≠unaddressed/.test(pca));
    s.check("G34d prior-comment-awareness.md requires verifying compound claims per-mechanism, not as a whole sentence",
      /each\s+mechanism\s+verified\s+separately/i.test(pca));
    s.check("G34e prior-comment-awareness.md defines three dedupe outcomes, not a binary post-or-suppress",
      /gate-without-posting/.test(pca) && /post-as-new-code/.test(pca) &&
      /not\s+collapse\s+this\s+to\s+a\s+binary\s+post-or-suppress/i.test(pca));
    s.check("G34f the verification requirement applies to this agent's own prior comments too, not only a third party's",
      /this agent's own prior comments\*\*, not only a third party's/.test(pca));
  }

  // G20: the pr-reviewer Step 1.2c diff-keyed lesson search enriches its query with the changed
  // symbol names and the synthesized intent + integrations, and raises the search limit past 10.
  // Reads the REAL shipped agents/pr-reviewer.md and asserts literal anchors grepped from it —
  // never re-encode expected strings as a self-comparison
  // (aw-lessons::mock-that-reimplements-the-thing-under-test). Mirrors the G18/G19 idiom.
  {
    // sliceBetween guards both anchors: an unresolved anchor throws a clear error
    // instead of a raw indexOf(-1) silently widening the haystack to (nearly) the
    // whole file and keeping the checks green.
    const step12c      = sliceBetween(prReviewer, "### 1.2c Diff-keyed lesson search", "### 1.3 Synthesize intent");

    // G20a: the query-construction prose enumerates the changed-symbol-names field.
    s.check("G20a pr-reviewer.md Step 1.2c query includes a changed-symbol-names field",
      step12c.includes("Changed symbol names") &&
      step12c.includes("added or modified"));

    // G20b: the query-construction prose enumerates the synthesized-intent + integrations field,
    //       and ties it to the Step 1.3 synthesis.
    s.check("G20b pr-reviewer.md Step 1.2c query includes a synthesized-intent + integrations field",
      step12c.includes("Synthesized intent + integrations") &&
      step12c.includes("Step 1.3"));

    // G20c: the runnable q= example carries both new field groups (not just the prose above it).
    //       Scope the assertion to the fenced `q=` line itself — asserting over the whole
    //       step12c slice lets the prose above satisfy it (e.g. after a casing change), which
    //       is the tautology class this repo's guards must not fall into.
    const qLine = (step12c.match(/^mcp__lorekit__memory_search: q=.*$/m) || [""])[0];
    s.check("G20c pr-reviewer.md Step 1.2c q= example lists the symbol + intent + integrations groups",
      qLine.length > 0 &&
      qLine.includes("changed symbol names") &&
      qLine.includes("synthesized intent") &&
      qLine.includes("integrations"));

    // G20d: the search limit was raised past 10 — no `limit=10` survives in the block, and a
    //       higher limit in the 15–20 band is present on the memory_search call.
    s.check("G20d pr-reviewer.md Step 1.2c memory_search limit raised past 10 into the 15–20 band",
      !step12c.includes("limit=10") &&
      /memory_search:.*limit=(1[5-9]|20)\b/.test(step12c));

    // G20e: Step 1.0's list cap of 50 is explicitly left unchanged — regression lock so a future
    //       edit does not conflate the two caps. Scoped to the Step 1.0 block for the same reason
    //       G20c is scoped to its fence: a `limit=50` anywhere else in the file must not satisfy a
    //       claim about Step 1.0. An unresolvable slice fails rather than passing vacuously.
    const step10      = sliceBetween(prReviewer, "### 1.0 Prior-comment awareness", "### 1.1 Fetch PR data in parallel");
    s.check("G20e pr-reviewer.md Step 1.0 list cap of 50 is unchanged",
      /memory_list:.*limit=50/.test(step10));

    // G20f: the docs-drift sweep — the diagnostic-surface phase-model row for 1.2c names the two
    //       new query fields, not just "changed paths". G20a–G20e lock agents/pr-reviewer.md only,
    //       so without this the mirrored row can silently revert. Non-tautological: the base row
    //       carries neither literal.
    const diag12cRow = prReviewerDiag
      .split("\n")
      .find((l) => l.startsWith("| 1.2c | Diff-keyed lesson search")) || "";
    s.check("G20f diagnostic-surface 1.2c row names the changed-symbol and intent+integrations fields",
      diag12cRow.includes("changed symbol names") &&
      diag12cRow.includes("synthesized intent + integrations"));

    // G20g: the INTENT_PHRASE hoist itself — Step 1.2c is the single derivation point and Step 1.3
    //       expands the bound value instead of re-deriving it. Without this the two prose halves
    //       can drift back apart, which is the exact defect the hoist was introduced to remove.
    //       Both halves are asserted from their OWN slice, never from the whole file.
    const step13      = sliceBetween(prReviewer, "### 1.3 Synthesize intent", "### 1.4 Triage for large PRs");
    const diag13Row = prReviewerDiag
      .split("\n")
      .find((l) => l.startsWith("| 1.3 | Intent synthesis")) || "";
    s.check("G20g Step 1.2c binds INTENT_PHRASE as the single derivation point and Step 1.3 expands it",
      step12c.includes("INTENT_PHRASE") &&
      step12c.includes("single derivation point") &&
      /Expand `INTENT_PHRASE`/.test(step13) &&
      step13.includes("do not re-derive it") &&
      diag12cRow.includes("INTENT_PHRASE") &&
      diag13Row.includes("INTENT_PHRASE"));

    // G20h: the second mirrored surface for the hoist — holistic-analysis review-mode's
    //       `intent_summary` input bullet. It is the only downstream consumer that restates
    //       Step 1.3's DERIVATION rather than its output, so it is the one the hoist can
    //       invalidate; without a guard it silently reverts. Scoped to that one bullet.
    const intentSummaryBullet = reviewMode
      .split("\n")
      .find((l) => l.startsWith("- `intent_summary`")) || "";
    s.check("G20h review-mode intent_summary bullet describes Step 1.3 as expanding INTENT_PHRASE",
      intentSummaryBullet.includes("INTENT_PHRASE") &&
      intentSummaryBullet.includes("Step 1.2c"));
  }
}

// ── G21: code-review-retrieval-relevance L2 suite wiring ──
// Reads the REAL shipped files and asserts literal anchors grepped OUT of them —
// never re-encode expected strings inside the eval (aw-lessons::mock-that-reimplements).
// Pairs positive + negative halves. Guard bites on revert (aw-lessons::prove-the-guard-bites).
{
  const read = (p) => readFileSync(join(REPO_ROOT, p), "utf8");

  const l2 = read("scripts/eval/l2.mjs");
  const golden = read("scripts/eval/golden/code-review-retrieval-relevance.jsonl");
  const notes  = read("scripts/eval/golden/code-review-retrieval-relevance.NOTES.md");
  const l2yml  = read(".github/workflows/evals-l2.yml");
  const readme = read("scripts/eval/README.md");

  // G21a: l2.mjs SUITES contains the new suite entry with the D1 rubric file + section.
  // Scoped to the code-review-retrieval-relevance suite object so the file/section
  // anchors are asserted INSIDE that entry — a bare whole-file includes would stay
  // green if agents/pr-reviewer.md ever appeared in another suite's rubric.
  const d1Suite = (l2.match(
    /name:\s*"code-review-retrieval-relevance"[\s\S]*?rubric:\s*\{[^}]*\}/,
  ) || [""])[0];
  s.check("G21a l2.mjs SUITES contains code-review-retrieval-relevance with D1 rubric (file + section)",
    d1Suite.includes("agents/pr-reviewer.md") &&
    d1Suite.includes("## Step 1: Fetch all inputs + load memories"));

  // G21b: golden JSONL exists and every non-empty line is valid JSON (locks the
  // test-plan claim that all lines parse). A bare non-empty count would pass on a
  // truncated/corrupt line; JSON.parse per line actually validates parseability.
  const goldenLines = golden.split("\n").filter(Boolean);
  let goldenAllParse = goldenLines.length >= 1;
  for (const ln of goldenLines) {
    try { JSON.parse(ln); } catch { goldenAllParse = false; break; }
  }
  s.check("G21b golden JSONL exists and every line is valid JSON", goldenAllParse);

  // G21c: the loud BOOTSTRAP marker literal is present in the NOTES file.
  s.check("G21c loud BOOTSTRAP marker literal is present in the NOTES file",
    notes.includes("BOOTSTRAP SEED — NOT A REAL BASELINE"));

  // G21d: evals-l2.yml paths lists agents/pr-reviewer.md (the live rubric source for the new suite).
  s.check("G21d evals-l2.yml paths lists agents/pr-reviewer.md",
    l2yml.includes("agents/pr-reviewer.md"));

  // G21e: README carries the methodology NOTE for this suite (promotion → golden case),
  // not merely the suite table row. Assert on the note's own heading literal so a table
  // row alone can't satisfy it.
  s.check("G21e README carries the per-suite methodology note (promotion → golden case) for code-review-retrieval-relevance",
    readme.includes("### `code-review-retrieval-relevance` — methodology note"));

  // G21f (regression lock): the six pre-existing suite names are still present in l2.mjs
  // (negative half: the edit added, did not replace).
  for (const name of ["tier-routing", "bug-class", "complexity-triage", "aw-should-trigger",
    "optimize-approach-optimality", "reviewer-agreement-bump"]) {
    s.check(`G21f l2.mjs still contains pre-existing suite '${name}' (add-not-replace)`,
      l2.includes(`name: "${name}"`));
  }

  // G21g: EVERY L2 suite with a non-null rubric.section must extract a NON-EMPTY body
  // (more than just its heading line). This is the "the eval actually contains a rubric"
  // guard — it would have caught the empty-rubric defect where a `## ` section immediately
  // followed by a `### ` subheading extracted only the 43-char title (zero body), feeding
  // the model an empty rubric. It runs the SAME shared extractSection l2.mjs feeds the model
  // (imported from lib.mjs), so a regression in that function — e.g. reverting the
  // heading-level-aware cut back to a cut-at-any-heading — fails this guard. The suite list
  // is parsed live out of l2.mjs so the guard can never drift from the shipped suites.
  const BODY_MIN = 80; // a real rubric body dwarfs this; a bare title never reaches it.
  const rubricEntries = [...l2.matchAll(
    /rubric:\s*\{\s*file:\s*"([^"]+)",\s*section:\s*(null|"([^"]+)")\s*\}/g,
  )].map((m) => ({ file: m[1], section: m[2] === "null" ? null : m[3] }));
  s.check("G21g parsed at least the 7 shipped rubric entries from l2.mjs",
    rubricEntries.length >= 7);
  for (const { file, section } of rubricEntries) {
    if (section === null) continue; // whole-file rubrics have no heading to strip.
    // Guard the extraction: a renamed/moved rubric heading makes extractSection throw.
    // Catch it so this surfaces as a red G21g check with a report, rather than an
    // uncaught throw that aborts the entire L1 run before s.report() runs.
    let body = "";
    let extractErr = null;
    try {
      body = extractSection(file, section).slice(section.length).trim();
    } catch (e) {
      extractErr = e instanceof Error ? e.message : String(e);
    }
    s.check(`G21g L2 rubric '${section}' in ${file} extracts a non-empty body (> heading line)`,
      extractErr === null && body.length > BODY_MIN,
      extractErr ?? `body length ${body.length} <= ${BODY_MIN}`);
  }

}

// ── G24: Gate 3 (Prior review feedback) tri-state + open-thread rendering contract ──
// The summary counter and the list heading are an EXACT-STRING contract between the renderer
// (pr-reviewer.md § The Gate 3 open threads) and its documented consumer
// (reviewer-report-ingest.md § the open-threads checklist is not a body section). That rule
// skips these blocks by literal heading match, so a reworded heading on either side silently
// promotes a presentational block to an ingestable one — re-ingesting OTHER bots' comments as
// pr-reviewer's own findings. Nothing else locks that pair.
// The headings are EXTRACTED from the renderer and compared against the consumer, never
// re-encoded here (aw-lessons::mock-that-reimplements-the-thing-under-test).
{
  const read = (p) => readFileSync(join(REPO_ROOT, p), "utf8");
  const prReviewer = read("agents/pr-reviewer.md");
  // Step 4's rendering reference moved to its own rule file (verbatim, so every literal anchor
  // below still matches). Checks that assert a SHAPE read it; checks that assert PROCEDURE stay
  // on the agent body.
  const reportRendering = read("agents/pr-reviewer/rules/report-rendering.md");
  const prReviewerDiag = read("agents/pr-reviewer/rules/diagnostic-surface.md");
  const ingest = read("agents/shared/rules/reviewer-report-ingest.md");

  // G24a: Step 1.8 grades on BOTH discriminants and enumerates all three states. A revert to
  // the old binary gate drops the `blocking`/`answered` conjunct and reds here.
  const gate3 = sliceBetween(prReviewer,
    "**Gate 3 — Unresolved prior review feedback**", "**Gate 4 — Self-review signals**");
  s.check("G24a pr-reviewer.md Step 1.8 grades Gate 3 on blocking AND answered, across ✅/⚠️/❌",
    gate3.includes("`blocking == true` **and** `answered == false`") &&
    ["- ✅ —", "- ⚠️ —", "- ❌ —"].every((marker) => gate3.includes(marker)));

  // ── G25: the report renderer. Behavioural, not textual: these EXECUTE the script that now
  // owns the report layout and compare against committed snapshots. Five production runs posted
  // marker-less, accordion-less reports from a correct prose spec, so text-matching the spec was
  // never going to catch this class. Snapshots live in scripts/eval/fixtures/report-body/ and are
  // readable markdown — they are the reference for what a report looks like.
  {
    const RENDER = join(REPO_ROOT, "agents/pr-reviewer/scripts/render-report.mjs");
    const FIX = join(REPO_ROOT, "scripts/eval/fixtures/report-body");
    const run = (args, input) => {
      const r = spawnSync("node", [RENDER, ...args], { input, encoding: "utf8" });
      return { ok: r.status === 0, out: r.stdout || "", err: (r.stderr || "").trim() };
    };

    s.check("G25 the renderer and its template both exist",
      existsSync(RENDER) && existsSync(join(REPO_ROOT, "agents/pr-reviewer/templates/report-body.md")));

    // (a) Snapshot parity. A template or renderer change that alters the output must be
    // accompanied by a regenerated snapshot, so the diff shows the reader exactly what moved.
    for (const name of ["pass", "warn", "fail"]) {
      const payload = join(FIX, `${name}.json`);
      const expectedPath = join(FIX, `${name}.expected.md`);
      if (!existsSync(payload) || !existsSync(expectedPath)) {
        s.check(`G25 ${name} fixture + snapshot present`, false, "missing fixture or snapshot");
        continue;
      }
      const r = run([payload]);
      s.check(`G25 ${name}.json renders without error`, r.ok, r.err);
      const expected = readFileSync(expectedPath, "utf8");
      s.check(`G25 ${name} output matches its committed snapshot`, r.out === expected,
        r.out === expected ? "" : "output drifted — regenerate the snapshot and review the diff");
    }

    // (b) Structural invariants on every snapshot. These are what the five failed runs broke.
    for (const name of ["pass", "warn", "fail"]) {
      const p = join(FIX, `${name}.expected.md`);
      if (!existsSync(p)) continue;
      const body = readFileSync(p, "utf8");
      s.check(`G25 ${name} carries the report marker`, body.includes("<!-- PR_REVIEWER_REPORT -->"));
      s.check(`G25 ${name} has a Review details accordion`,
        /<details>\n<summary>Review details/.test(body));
      s.check(`G25 ${name} pre-expands nothing`, !body.includes("<details open>"));
      s.check(`G25 ${name} carries no **Verdict** line`, !body.includes("**Verdict**"));
      // Nothing the accordion owns may render above the first <details>.
      const head = body.split("<details>")[0];
      for (const owned of ["| Gate | Status | Details |", "**Run mode**", "**Memories**",
        "**Quality**", "**Skipped files**"]) {
        s.check(`G25 ${name} keeps ${owned} inside the accordion`, !head.includes(owned));
      }
    }

    // (c) Fail-closed. Each of these once shipped as a real posted report; the renderer must
    // refuse them, and must print NOTHING on stdout so a piping caller cannot post a fragment.
    const base = JSON.parse(readFileSync(join(FIX, "pass.json"), "utf8"));
    const mutate = (fn) => { const c = structuredClone(base); fn(c); return JSON.stringify(c); };
    const rejects = [
      ["a missing required slot", mutate((c) => { delete c.HEADLINE; })],
      ["an unknown key (typo'd slot)", mutate((c) => { c.HEADLIN = "x"; })],
      ["an invalid gate glyph", mutate((c) => { c.GATE_PRIOR_STATUS = "FAIL"; })],
      // `RUN_MODE` is a v1 slot, so mutating it only proved the unknown-key check. Smuggle the
      // verdict through slots a v2 payload really has — one scalar, one nested in an array item.
      ["a smuggled **Verdict** line", mutate((c) => { c.RUN_NOTE = "**Verdict**: PASS"; })],
      ["a **Verdict** line nested in OPEN_THREADS", mutate((c) => {
        c.OPEN_THREADS = [{ path: "a.ts", line: 1, ask: "see **Verdict**: PASS" }];
      })],
      ["a **Verdict** line nested in ADDITIONAL_FINDINGS", mutate((c) => {
        c.ADDITIONAL_FINDINGS = [{ path: "a.ts", line: 1, prefix: "issue", body: "**Verdict**: PASS", confidence: 90 }];
      })],
      ["an empty required slot", mutate((c) => { c.SKIPPED_FILES = "   "; })],
      ["a non-object payload", "[1,2]"],
      ["malformed JSON", "{nope"],
      // ── v2 shape validation. Each of these was a live defect in a posted report, or the
      // silent-acceptance path that let one through.
      ["a 40-char sha in RUN", mutate((c) => { c.RUN.sha = "c3ceb870255d96307be5b0499ca372345d237af7"; })],
      ["an uppercase sha in RUN", mutate((c) => { c.RUN.sha = "C3CEB87"; })],
      ["a bad RUN.mode", mutate((c) => { c.RUN.mode = "quick"; })],
      ["a missing prior_sha on an incremental run", mutate((c) => { c.RUN.mode = "incremental"; delete c.RUN.prior_sha; })],
      ["a non-integer delta_lines", mutate((c) => { c.RUN.delta_lines = "256"; })],
      ["a stray nested field in RUN", mutate((c) => { c.RUN.delta_note = "x"; })],
      ["a gate cell over the 120-char cap", mutate((c) => { c.GATE_DOCS_DETAILS = "x".repeat(121); })],
      ["a newline in a gate cell", mutate((c) => { c.GATE_DOCS_DETAILS = "one\ntwo"; })],
      ["a pipe in a gate cell", mutate((c) => { c.GATE_DOCS_DETAILS = "a | b"; })],
      ["a markdown link in a structured field", mutate((c) => {
        c.OPEN_THREADS = [{ path: "a.ts", line: 1, ask: "see [the docs](https://x.invalid)" }];
      })],
      ["a backtick in an identifier field", mutate((c) => {
        c.OPEN_THREADS = [{ path: "a`b.ts", line: 1, ask: "bind the store" }];
      })],
      ["a non-http url", mutate((c) => {
        c.OPEN_THREADS = [{ path: "a.ts", line: 1, url: "javascript:alert(1)", ask: "x" }];
      })],
      ["a non-numeric line", mutate((c) => {
        c.OPEN_THREADS = [{ path: "a.ts", line: "top", url: "https://x.invalid/1", ask: "x" }];
      })],
      ["a bad Conventional-Comments prefix", mutate((c) => {
        c.ADDITIONAL_FINDINGS = [{ path: "a.ts", line: 1, prefix: "warning", body: "x", confidence: 90 }];
      })],
      ["an out-of-range confidence", mutate((c) => {
        c.ADDITIONAL_FINDINGS = [{ path: "a.ts", line: 1, prefix: "issue", body: "x", confidence: 150 }];
      })],
      ["RESOLVED_SINCE with no open threads", mutate((c) => { c.RESOLVED_SINCE = { count: 4, sha: "70cf147" }; })],
      ["an optimality card with no anchored heading", mutate((c) => { c.OPTIMALITY_CARDS = ["> just prose"]; })],
      ["a log slot that does not start ran/skipped", mutate((c) => { c.STANDARDS_LOG = "2 docs · 0 findings"; })],
      ["a QUALITY line in the wrong shape", mutate((c) => { c.QUALITY = "4 findings posted"; })],
      // A v1 payload must fail loudly, and the error must name the replacement.
      ["a v1 payload (FOOTER_LINE / MEMORIES / counts)", mutate((c) => {
        c.FOOTER_LINE = "Reviewed for commit `abc1234`."; c.MEMORIES = "53 indexed";
        c.OPEN_THREADS_COUNT = "2";
      })],
      // The v1 companion-slot cases (`PARTIAL_BANNER`, `OPEN_THREADS_SUFFIX`) are gone: those slots
      // are derived now, so supplying one is just another unknown key and the case above covers it.
      // What is left to guard is the structured replacement being handed a v1-shaped value.
      ["OPEN_THREADS supplied as a markdown string", mutate((c) => { c.OPEN_THREADS = "- x"; })],
      ["a non-zero delta_lines on a zero-delta run", mutate((c) => {
        c.RUN = { mode: "zero-delta", sha: "bde3c2f", prior_sha: "70cf147", delta_lines: 12 };
      })],
      ["a MEMORIES_USED entry with no key", mutate((c) => {
        c.MEMORIES_USED = [{ url: "https://lorekit.io/lore?x=1", note: "promoted" }];
      })],
      // The `used` half is derived from MEMORIES_USED, so supplying it is the one remaining way
      // to make a count disagree with its list.
      ["a hand-written used count in MEMORIES_SUMMARY",
        mutate((c) => { c.MEMORIES_SUMMARY = "53 indexed · 3 used"; })],
      ["MEMORIES_USED beside a not-connected summary", mutate((c) => {
        c.MEMORIES_SUMMARY = "not connected";
        c.MEMORIES_USED = [{ key: "a-lesson-key" }];
      })],
      ["more memories used than indexed", mutate((c) => {
        c.MEMORIES_SUMMARY = "1 indexed";
        c.MEMORIES_USED = [{ key: "a" }, { key: "b" }];
      })],
      ["PARTIAL_REVIEW scanned over total", mutate((c) => {
        c.PARTIAL_REVIEW = { calls: 40, scanned: 90, total: 12 };
      })],
      ["RESOLVED_SINCE supplied as a pre-rendered string",
        mutate((c) => { c.RESOLVED_SINCE = " <sup>7 resolved since `abc1234`</sup>"; })],
      // Shipped for real on PR #121's sticky: the run wanted [`key`](url) inside a JSON string,
      // mangled the nesting, and emitted ``['key'](url)`` — a code span, so the link rendered as
      // dead monospace text. The report looked fine and the URL did not work.
      // Routing it through the retired `MEMORIES` slot only exercised the unknown-key check, so
      // aim it at the two surfaces a v2 payload can still cage a link on: a prose field, and
      // OPTIMALITY_CARDS, the one slot where model-authored markdown remains.
      ["a markdown link caged in a code span in a prose field", mutate((c) => {
        c.MEMORIES_USED = [{
          key: "a-lesson-key",
          note: "``[a-lesson-key](https://lorekit.io/lore?x=1)`` — promoted",
        }];
      })],
      ["a markdown link caged in a code span in an optimality card", mutate((c) => {
        c.OPTIMALITY_CARDS = ["### Optimality proposal — a.ts:1\n\n"
          + "``[the docs](https://lorekit.io/lore?x=1)``"];
      })],
    ];
    // Only the v1 case is allowed to fail on the unknown-key check. Everything else must fail on
    // the guard it names. Without this, a v2 rename silently turns a real guard's case into an
    // `unknown payload key` rejection: the check still passes, and the guard it was written for
    // is left with no coverage at all. That is exactly what happened to the **Verdict** and
    // caged-link cases when the payload went structured.
    const UNKNOWN_KEY_CASES = new Set([
      "an unknown key (typo'd slot)",
      "a v1 payload (FOOTER_LINE / MEMORIES / counts)",
    ]);
    for (const [why, input] of rejects) {
      const r = run([], input);
      s.check(`G25 the renderer rejects ${why}`, !r.ok, r.ok ? "ACCEPTED" : "");
      s.check(`G25 rejecting ${why} emits nothing on stdout`, r.out === "", r.out.slice(0, 60));
      if (!UNKNOWN_KEY_CASES.has(why)) {
        s.check(`G25 rejecting ${why} is not an unknown-key rejection`,
          !/unknown payload key/.test(r.err), r.err.slice(0, 90));
      }
    }

    // A correctly written link in the same slot must still render — the footer link
    // [`pr-reviewer`](url) in every snapshot already proves the guard is not blanket-rejecting,
    // but assert the MEMORIES shape explicitly since that is where the mangling happened.
    {
      // The renderer BUILDS the link from {key, url}; the model never writes markdown here, which
      // is what makes the caged-link failure unrepresentable rather than merely rejected.
      const r = run([], mutate((c) => {
        c.MEMORIES_USED = [{ key: "a-lesson-key", url: "https://lorekit.io/lore?x=1", note: "promoted" }];
      }));
      s.check("G25 MEMORIES_USED renders as a real link", r.ok, r.err);
      s.check("G25 the renderer built the link, not the model",
        r.out.includes("[`a-lesson-key`](https://lorekit.io/lore?x=1) — promoted"));
      s.check("G25 the used count is derived from the list",
        r.out.includes("**Memories** — 53 indexed · 1 used"));
    }

    // A zero-delta run parses under the same {mode, delta_lines} grammar as every other mode,
    // and the footer — not the Run mode line — is what still names the zero-delta shape.
    {
      const r = run([], mutate((c) => {
        c.RUN = { mode: "zero-delta", sha: "bde3c2f", prior_sha: "70cf147", at: "2026-08-15T09:12:00Z" };
      }));
      s.check("G25 a zero-delta run renders", r.ok, r.err);
      s.check("G25 zero-delta parses as {incremental, 0}",
        r.out.includes("**Run mode** — incremental · 0 lines in delta"));
      s.check("G25 zero-delta keeps its footer form",
        r.out.includes("No code changes since `70cf147` — gate checks only for commit `bde3c2f`."));
    }

    // A prose field carries the source comment's own wording, backticks and all. Step 1.0 requires
    // `ask` be another bot's lead line truncated-not-paraphrased, and those name symbols in code
    // spans; rejecting them aborted the render on mandated input.
    {
      const r = run([], mutate((c) => {
        c.OPEN_THREADS = [{
          path: "a.ts", line: 1, url: "https://x.invalid/1", ask: "bind `LocalStore.search`",
        }];
      }));
      s.check("G25 a backticked ask renders", r.ok, r.err);
      s.check("G25 the ask survives verbatim", r.out.includes("— bind `LocalStore.search`"));
    }

    // A complete group is still accepted — the check must discriminate, not blanket-reject.
    {
      // Count and suffix are DERIVED from the array, so they cannot be supplied, omitted, or
      // disagree — the companion-group and orphaned-slot failures are gone by construction.
      const r = run([], mutate((c) => {
        c.OPEN_THREADS = [{ path: "a.ts", line: 1, url: "https://x.invalid/1", ask: "bind the store" }];
      }));
      s.check("G25 a structured OPEN_THREADS array renders", r.ok, r.err);
      s.check("G25 the derived count and suffix agree, list inside the accordion",
        r.out.includes("**Open review threads (1)**") &&
        r.out.includes("<summary>Review details — 1 open review thread</summary>") &&
        r.out.split("<details>")[0].includes("**Open review threads (") === false);
    }

    // (h) PRODUCER -> CONSUMER ROUND TRIP. reviewer-report-ingest.md documents extractable
    // grammars for the report's sections; nothing checked that the report the producer emits
    // actually parses under them. It did not: the first report the new pipeline posted carried
    // `Run mode — full (forced by --full) · 15 files, 750 additions / 486 deletions`, while the
    // grammar parses that slot for {mode, delta_lines}. An unenforced grammar is aspirational,
    // which is the exact failure this whole line of work was diagnosing.
    //
    // These extractors are the grammar's documented shapes, applied to real rendered output.
    {
      const EXTRACT = {
        // The grammar is explicit: match on "commit `<sha>`" ALONE, never on a leading phrase —
        // anchoring on "review for commit" catches only the incremental form. Take the last such
        // match, since the zero-delta form names the prior sha first.
        "Footer SHA": (b) => {
          const line = (b.match(/^<sup>(?:Reviewed|Incremental review|No code changes)[^\n]*<\/sup>$/m) || [""])[0];
          const all = [...line.matchAll(/commit `([0-9a-f]{7})`/g)];
          return all.length ? { sha: all[all.length - 1][1] } : null;
        },
        "Run mode": (b) => {
          // One shape for every mode, zero-delta included — it renders `incremental · 0 lines in
          // delta`, so there is no second alternative to carry.
          const m = b.match(/^\*\*Run mode\*\* — (full|incremental|incremental-quick) · (\d+) lines in delta/m);
          return m ? { mode: m[1], delta_lines: Number(m[2]) } : null;
        },
        "Standards log": (b) => {
          const m = b.match(/^\*\*Standards \(2\.4d\)\*\* — (ran|skipped)/m);
          return m ? { ran: m[1] === "ran" } : null;
        },
        "Optimality log": (b) => {
          const m = b.match(/^\*\*Optimality \(2\.4c\)\*\* — (ran|skipped)/m);
          return m ? { ran: m[1] === "ran" } : null;
        },
        "Skipped files": (b) => {
          const m = b.match(/^\*\*Skipped files\*\* — (.+)$/m);
          return m ? { files: m[1] === "none" ? [] : [m[1]] } : null;
        },
        "Headline": (b) => {
          const lines = b.split("\n").filter((l) => l.trim() !== "");
          const i = lines.findIndex((l) => !l.startsWith("<!--") && !l.startsWith("⚠️ **Partial review"));
          return i !== -1 && lines[i].length > 0 ? { headline: lines[i] } : null;
        },
      };
      // Sections that only appear on some fixtures: assert they parse WHERE PRESENT.
      const CONDITIONAL = {
        "Additional findings": [/<summary>Additional findings \((\d+)\) — cleared review, not inlined<\/summary>/,
          /^- (?:\[)?`[^`]+`(?:\]\([^)]+\))? — \w+: .+ \(confidence \d+\)$/m],
        "Low-confidence findings": [/<summary>Low-confidence findings \((\d+)\) — advisory, below the confidence bar<\/summary>/,
          /^- (?:\[)?`[^`]+`(?:\]\([^)]+\))? — \w+: .+ \(confidence \d+\)$/m],
        "Optimality cards": [/<summary>Optimality review \((\d+)\) — is this the best approach\?<\/summary>/,
          /^### Optimality proposal — \S+:\d+$/m],
        "Partial-review banner": [/⚠️ \*\*Partial review — tool budget exhausted after \d+ calls; \d+ of \d+ files scanned\.\*\*/, null],
      };
      for (const name of ["pass", "warn", "fail"]) {
        const p = join(REPO_ROOT, `scripts/eval/fixtures/report-body/${name}.expected.md`);
        if (!existsSync(p)) continue;
        const body = readFileSync(p, "utf8");
        for (const [section, fn] of Object.entries(EXTRACT)) {
          const got = fn(body);
          s.check(`G25 round-trip: ${name} — the ingest grammar parses "${section}"`, got !== null,
            "section absent or does not match the documented shape");
        }
        // The gate table must parse to five rows with a valid glyph each.
        const rows = [...body.matchAll(/^\| (Description vs\. code|Prior review feedback|Documentation|Self-review signals|Code review) \| (✅|⚠️|❌|⏭️) \| ([^|]*) \|$/gm)];
        s.check(`G25 round-trip: ${name} — the gate table parses to 5 typed rows`, rows.length === 5,
          `parsed ${rows.length}`);
        // Counts in a summary must equal the bullets rendered under it.
        for (const [section, [summaryRe, bulletRe]] of Object.entries(CONDITIONAL)) {
          const m = body.match(summaryRe);
          if (!m) continue;
          s.check(`G25 round-trip: ${name} — "${section}" summary matches the documented literal`, true);
          if (bulletRe) {
            s.check(`G25 round-trip: ${name} — "${section}" bullets match the documented shape`,
              bulletRe.test(body), "no bullet matched");
          }
        }
      }
    }

    // (i) Derived counts cannot disagree with the lists they count — the whole point of moving
    // counts out of the payload. Assert it on the rendered output, per fixture.
    for (const name of ["warn", "fail"]) {
      const p = join(REPO_ROOT, `scripts/eval/fixtures/report-body/${name}.expected.md`);
      if (!existsSync(p)) continue;
      const body = readFileSync(p, "utf8");
      const declared = body.match(/\*\*Open review threads \((\d+)\)\*\*/);
      if (declared) {
        const region = body.split("**Open review threads (")[1].split("\n\n")[1] || "";
        const bullets = region.split("\n").filter((l) => l.startsWith("- ")).length;
        s.check(`G25 ${name}: the open-threads count equals the bullets rendered`,
          Number(declared[1]) === bullets, `declared ${declared[1]}, rendered ${bullets}`);
        const suffix = body.match(/<summary>Review details — (\d+) open review thread/);
        s.check(`G25 ${name}: the summary counter equals the list count`,
          suffix && Number(suffix[1]) === Number(declared[1]),
          suffix ? `summary ${suffix[1]} vs list ${declared[1]}` : "no summary counter");
      }
    }

    // (d) The agent must delegate, not hand-render. The old three-template shape is gone and
    // must not come back; the payload contract and the renderer call must be present.
    s.check("G25 pr-reviewer.md no longer embeds report templates",
      (prReviewer.match(/```markdown\n<!-- PR_REVIEWER_REPORT -->/g) || []).length === 0,
      "an embedded REPORT_BODY template is back — layout belongs to the template file");
    s.check("G25 pr-reviewer.md calls the renderer at Step 4a",
      /render-report\.mjs/.test(prReviewer) && /REPORT_BODY payload/.test(prReviewer));
    s.check("G25 pr-reviewer.md forbids hand-rendering as a fallback",
      /do not fall back to composing the body by hand/.test(prReviewer));
    // (e) A provenance-independent pre-write net — EXECUTED, not text-matched. The previous
    // version of this guard used preWrite.includes(needle) and was green over an assertion that
    // could never fire: `grep -qz '<details>\n<summary>…'` treats \n as the letter n inside a
    // plain-quoted BRE, so it matched only the literal "<details>n<summary>…" and would have
    // aborted every run. A guard that checks a command's TEXT cannot see that. Run the block.
    {
      const preWrite = sliceBetween(prReviewer,
        "**Assert these four things on `REPORT_BODY` immediately before the write",
        "On any `abort`: post no report object");
      const fence = preWrite.match(/```bash\n([\s\S]*?)```/);
      s.check("G25 the pre-write assertion block is extractable", !!fence);
      if (fence) {
        const script = `abort() { printf 'ABORT: %s\\n' "$*"; exit 3; }\n${fence[1]}\nexit 0\n`;
        const good = spawnSync("node", [join(REPO_ROOT, "agents/pr-reviewer/scripts/render-report.mjs"),
          join(REPO_ROOT, "scripts/eval/fixtures/report-body/warn.json")], { encoding: "utf8" }).stdout;
        const runAssert = (body) =>
          spawnSync("bash", ["-c", script], { env: { ...process.env, REPORT_BODY: body }, encoding: "utf8" });

        // A valid rendered body must PASS. This is the check that was missing.
        const ok = runAssert(good);
        s.check("G25 the pre-write assertions accept a valid rendered body",
          ok.status === 0, `exit ${ok.status}: ${(ok.stdout || "").trim()}`);

        // Each defect the net exists to catch must ABORT.
        const cases = [
          ["a body with no marker", good.replace("<!-- PR_REVIEWER_REPORT -->\n", "")],
          ["a flattened body (no accordion)", good.replace(/<details>\n<summary>Review details[^\n]*\n/, "")],
          ["a pre-expanded accordion", good.replace("<details>\n<summary>Review details", "<details open>\n<summary>Review details")],
          ["a smuggled **Verdict** line", `${good}\n**Verdict**: PASS\n`],
        ];
        for (const [why, body] of cases) {
          const r = runAssert(body);
          s.check(`G25 the pre-write assertions reject ${why}`, r.status === 3,
            `exit ${r.status} (expected 3 = abort)`);
        }
      }
    }

    // (g) Slot-name parity. In v2 the payload keys are the three declared arrays; the template's
    // placeholders are the renderer's DERIVED names, which are a superset (counts, bullets, the
    // footer line). So: prose must name only real payload keys, and no unresolved placeholder may
    // survive a render — the latter is asserted behaviourally by the fixtures rendering at all.
    {
      const rendererSrc = readFileSync(join(REPO_ROOT, "agents/pr-reviewer/scripts/render-report.mjs"), "utf8");
      const keysIn = (arrName) => {
        const blk = sliceBetween(rendererSrc, `const ${arrName} = [`, "];");
        return new Set([...blk.matchAll(/"([A-Z0-9_]+)"/g)].map((m) => m[1]));
      };
      const payloadKeys = new Set([...keysIn("REQUIRED_SCALARS"), ...keysIn("OPTIONAL_SCALARS"),
        ...keysIn("STRUCTURED")]);
      s.check("G25 the renderer declares a non-trivial payload key set", payloadKeys.size >= 24,
        `${payloadKeys.size}`);

      // Every slot the agent's payload contract names must be a real payload key. A name that
      // disagrees is a hard exit 1 and the run posts nothing — this caught PARTIAL_REVIEW_BANNER.
      const contract = sliceBetween(reportRendering, "#### REPORT_BODY payload", "#### Headlines");
      const named = [...contract.matchAll(/^\|\s*((?:`[A-Z][A-Z0-9_]{3,}`(?:\s*[·+]\s*)?)+)\s*\|/gm)]
        .flatMap((m) => [...m[1].matchAll(/`([A-Z][A-Z0-9_]{3,})`/g)].map((x) => x[1]));
      const wrong = [...new Set(named)].filter((n) => !payloadKeys.has(n));
      s.check("G25 every slot named in the payload contract is a real payload key", wrong.length === 0,
        wrong.join(", "));
      for (const g of ["DESCRIPTION", "PRIOR", "DOCS", "SELFREVIEW", "CODEREVIEW"]) {
        for (const kind of ["STATUS", "DETAILS"]) {
          s.check(`G25 the payload contract spells GATE_${g}_${kind}`,
            contract.includes(`GATE_${g}_${kind}`));
        }
      }
      // v1 slot names must be gone from the contract: a payload built from them exits 1.
      for (const dead of ["FOOTER_LINE", "RUN_MODE", "OPEN_THREADS_COUNT", "OPEN_THREADS_SUFFIX",
        "ADDITIONAL_COUNT", "LOW_CONFIDENCE_COUNT", "OPTIMALITY_COUNT", "BUDGET_CALLS"]) {
        s.check(`G25 the payload contract does not still name the derived slot ${dead}`,
          !named.includes(dead), "listed as a payload key but is derived by the renderer");
      }
    }

    // (e) A provenance-independent pre-write net — EXECUTED, not text-matched. The previous
    // version of this guard used preWrite.includes(needle) and was green over an assertion that
    // could never fire: `grep -qz '<details>\n<summary>…'` treats \n as the letter n inside a
    // plain-quoted BRE, so it matched only the literal "<details>n<summary>…" and would have
    // aborted every run. A guard that checks a command's TEXT cannot see that. Run the block.
    {
      const preWrite = sliceBetween(prReviewer,
        "**Assert these four things on `REPORT_BODY` immediately before the write",
        "On any `abort`: post no report object");
      const fence = preWrite.match(/```bash\n([\s\S]*?)```/);
      s.check("G25 the pre-write assertion block is extractable", !!fence);
      if (fence) {
        const script = `abort() { printf 'ABORT: %s\\n' "$*"; exit 3; }\n${fence[1]}\nexit 0\n`;
        const good = spawnSync("node", [join(REPO_ROOT, "agents/pr-reviewer/scripts/render-report.mjs"),
          join(REPO_ROOT, "scripts/eval/fixtures/report-body/warn.json")], { encoding: "utf8" }).stdout;
        const runAssert = (body) =>
          spawnSync("bash", ["-c", script], { env: { ...process.env, REPORT_BODY: body }, encoding: "utf8" });

        // A valid rendered body must PASS. This is the check that was missing.
        const ok = runAssert(good);
        s.check("G25 the pre-write assertions accept a valid rendered body",
          ok.status === 0, `exit ${ok.status}: ${(ok.stdout || "").trim()}`);

        // Each defect the net exists to catch must ABORT.
        const cases = [
          ["a body with no marker", good.replace("<!-- PR_REVIEWER_REPORT -->\n", "")],
          ["a flattened body (no accordion)", good.replace(/<details>\n<summary>Review details[^\n]*\n/, "")],
          ["a pre-expanded accordion", good.replace("<details>\n<summary>Review details", "<details open>\n<summary>Review details")],
          ["a smuggled **Verdict** line", `${good}\n**Verdict**: PASS\n`],
        ];
        for (const [why, body] of cases) {
          const r = runAssert(body);
          s.check(`G25 the pre-write assertions reject ${why}`, r.status === 3,
            `exit ${r.status} (expected 3 = abort)`);
        }
      }
    }

    // (f) The taxonomy is append-only: a superseded row is marked Retired, never deleted. This
    // caught a real regression — the layout excision took three rows out with it.
    for (const fm of ["F-report-accordion-flattened", "F-report-accordion-expanded",
      "F-open-threads-slot-orphaned", "F-report-body-composed-from-memory"]) {
      s.check(`G25 diagnostic-surface keeps the retired ${fm} row`,
        prReviewerDiag.includes(fm) &&
        new RegExp(`\\\`${fm}\\\`[^\n]*Retired`).test(prReviewerDiag),
        "row deleted or not marked Retired");
    }
    s.check("G25 diagnostic-surface forbids deleting a taxonomy row",
      /a row is \*\*never deleted\*\*/.test(prReviewerDiag));
  }

  // G24f: the report has exactly one host. A review body carrying the report marker is the
  // regression that leaves one full report per run on the PR; the pre-flight must reject it.
  s.check("G24f pr-reviewer.md rejects a review body carrying the report marker",
    /"<!-- PR_REVIEWER_REPORT -->" in payload\["body"\]/.test(prReviewer));
  s.check("G24f pr-reviewer.md documents the un-writable-sticky path without a second report",
    /When the sticky cannot be written/.test(prReviewer) &&
    /DEGRADED_POINTER_BODY/.test(prReviewer));
  // G24h: prior-run detection reads the PR-state record, and its ONE GitHub fallback rung must
  // not be login-keyed — an unresolvable `/user` would otherwise read as "no prior report" and
  // duplicate the sticky on every run. Assert on the WHOLE fetch region rather than on one clause
  // shape: a predicate is order-free (`select((.body | contains(…)) and .user.login == env.ME)`
  // is the same bug rearranged), so any mention of the login inside these fetches is the regression.
  const step07 = sliceBetween(prReviewer,
    "## Step 0.7: Prior run detection", "### Bind the run-mode inputs");
  const step07Fetches = [...step07.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]).join("\n");
  // Reading `.user.login` OUT of a found object is fine (PRIOR_REPORT_AUTHOR does exactly that);
  // FILTERING on it is the bug. A regex cannot express "inside a select() at any nesting depth" —
  // an earlier bounded-depth version let `select(((.body | contains(…))) and .user.login == …)`
  // through — so scan to the matching close paren instead.
  const selectBodies = (src) => {
    const out = [];
    for (let i = src.indexOf("select("); i >= 0; i = src.indexOf("select(", i + 1)) {
      let depth = 0;
      for (let j = i + "select".length; j < src.length; j++) {
        if (src[j] === "(") depth++;
        else if (src[j] === ")" && --depth === 0) { out.push(src.slice(i, j + 1)); break; }
      }
    }
    return out;
  };
  const loginFilter = selectBodies(step07Fetches).some((b) => /user\.login/.test(b));
  s.check("G24h pr-reviewer.md finds the sticky by marker, not by author login",
    step07Fetches.includes("PR_REVIEWER_REPORT") && !loginFilter && !/env\.ME/.test(step07Fetches),
    step07Fetches.includes("PR_REVIEWER_REPORT") ? "login key present in a Step 0.7 fetch" : "no marker-keyed fetch found");

  // ── G24i: prior-run state lives in the PR-state record, not in the report body. These are the
  // guards on the change that moved it: the read, the write, their agreement, and the absence of
  // every mechanism that used to serialise state into a comment.
  {
    const step4c = sliceBetween(prReviewer, "### 4c. Record the run state",
      "### The shapes: report body, headlines, sections, inline comments");
    const step4b = sliceBetween(prReviewer, "### 4b. Post the review (conditionally)",
      "### 4c. Record the run state");

    // The read and the write must address the SAME record. Two independently-written scope/key
    // strings is the drift that silently gives every run a fresh first-run path.
    for (const [where, src] of [["Step 0.7", step07], ["Step 4c", step4c]]) {
      s.check(`G24i ${where} addresses the record by branch scope + per-PR key`,
        /branch::\$?\{?RESOLVED_REPO\}?|branch::\{owner\}\/\{repo\}/.test(src) &&
        /ci-state::pr-review-/.test(src),
        "scope or key missing — the two sites must name the same record");
    }
    s.check("G24i Step 0.7 reads the record with memory_read",
      /mcp__lorekit__memory_read/.test(step07));
    s.check("G24i Step 4c writes the record with memory_write",
      /mcp__lorekit__memory_write/.test(step4c));

    // A state record's guards are cardinality, TTL, and never-blocking (ci-state-records.md),
    // not the lessons entrenchment guards. Each of these has cost a real loop when omitted.
    // The TTL is 7 days and lives in exactly one place per surface. G16f excuses the number as
    // "another bucket's TTL"; this is the check that makes that excuse true.
    s.check("G24i Step 4c passes ttl_days on every write", /ttl_days/.test(step4c));
    s.check("G24i the state-record TTL is 7 days in the agent and the taxonomy",
      /ttl_days\s*=\s*7\b/.test(step4c) &&
      /7d, refreshed on every write/.test(read("agents/shared/rules/memory-buckets.md")));
    // The TTL must be documented as self-sufficient. A repo with no LoreKit GitHub integration —
    // which is most of them — has no merge-purge event, so any wording that makes that event the
    // real collector tells those users their records are never cleaned up. It shipped that way
    // once ("the floor, not the plan", "the only collector") and was corrected.
    for (const [label, src] of [["pr-reviewer.md", step4c],
      ["memory-buckets.md", read("agents/shared/rules/memory-buckets.md")]]) {
      s.check(`G24i ${label} presents the TTL as the cleanup mechanism, not a stopgap`,
        /requires? nothing to be wired up|needs nothing wired up/.test(src) &&
        /accelerant/.test(src) &&
        !/only collector|floor, not the plan/.test(src),
        "the merge-purge event is being presented as the real mechanism");
    }
    // An expired record can still be RETURNED by a read; acting on one is the stale-state failure
    // the house rule warns about, and it is the normal end state of every dormant PR where nothing
    // purges. It must route to the fallback rung, with its own log line.
    s.check("G24i an expired state record is treated as absent",
      /An expired record is a miss, not a baseline/.test(step07) &&
      /record expired at/.test(step07),
      "expired records are not routed to the fallback rung");
    s.check("G24i Step 4c tags the record outside the loop:: lessons grammar",
      /ci::pr-review-state/.test(step4c) && !/loop::/.test(step4c));
    s.check("G24i Step 4c applies the three caps", /50\]/.test(step4c.replace(/\s/g, ""))
      || /\.\[-50:\]/.test(step4c));
    s.check("G24i Step 4c is unconditional and never blocking",
      /unconditional/i.test(step4c) && /never on the critical path|never block/i.test(step4c));

    // The retired mechanisms. Each is asserted absent from the step that used to own it, not from
    // the whole file — the file still EXPLAINS them, and forbidding the explanation would delete
    // the record of why they are gone.
    s.check("G24i Step 4a appends no ledger to the report body",
      !/PR_REVIEWER_LEDGER/.test(sliceBetween(prReviewer, "#### Build the payload, then run the renderer",
        "#### The report has exactly one host")));
    s.check("G24i Step 4b rejects a review body carrying a ledger",
      /PR_REVIEWER_LEDGER" in payload\["body"\]/.test(step4b));
    s.check("G24i Step 0.7 does not fetch pulls/reviews for prior state",
      !/pulls\/\$PR_NUMBER\/reviews|pulls\/\{n\}\/reviews`/.test(step07Fetches));

    // Step 4b has exactly ONE posting condition. The three notification-only conditions are what
    // filled a PR timeline with one review object per state change.
    // The retired conditions are still NAMED in this step (deliberately — the prose explains what
    // was removed and why), so the predicate keys on the live contract instead: exactly one
    // condition, and no surviving "post when any of these holds" enumeration.
    s.check("G24i Step 4b posts a review only for new inline findings",
      /\*\*When to post\.\*\* Exactly one condition/.test(step4b) &&
      /INLINE_COMMENTS_JSON` is non-empty/.test(step4b) &&
      !/Post a review when \*\*any\*\* of these holds/.test(step4b),
      "a notification-only posting condition is back");
    s.check("G24i the notification-only cost is stated, not silent",
      /updates the report silently|silently/.test(step4b));

    // Both prior-run paths must bind what Step 1.2b reads; an unset value is not a bound empty one.
    for (const v of ["RUN_MODE", "PRIOR_SHA", "LAST_FULL_SHA", "INCR_RUNS_SINCE_FULL"]) {
      s.check(`G24i Step 0.7 binds ${v} on the first-run path`,
        sliceBetween(prReviewer, "### First run", "### What no longer happens here").includes(v));
    }
    // STATE_STATUS is the flag the announcements and Step 5 branch on. A flag with no reader is
    // a comment — this is the check PRIOR_RUN_STATE_UNKNOWN used to carry.
    s.check("G24i STATE_STATUS has readers, not just a binding",
      (prReviewer.match(/STATE_STATUS/g) || []).length >= 3);
    s.check("G24i Step 5 reports how prior-run state was resolved",
      /state: (record|sticky fallback)/.test(sliceBetween(prReviewer, "## Step 5: Report",
        "## What this agent does not do")));
    s.check("G24i Step 5 reports the state write outcome separately",
      /state record/.test(sliceBetween(prReviewer, "## Step 5: Report",
        "## What this agent does not do")));

    // The identity ladder's second rung. Both sources are needed: the record on the happy path,
    // the sticky on the fallback rung — which is the one path where `/user` also fails.
    s.check("G24i PRIOR_REPORT_AUTHOR is bound from both the record and the sticky",
      /PRIOR_REPORT_AUTHOR[\s\S]{0,400}bot_login/.test(prReviewer) &&
      /PRIOR_REPORT_AUTHOR=\$\(jq -r '\.user\.login/.test(prReviewer));

    // The write is in-run, which the "never writes lessons during a review" rule must not be read
    // to forbid. Without this carve-out spelled out, a reader deletes Step 4c and takes the delta
    // logic with it.
    s.check("G24i the state write is distinguished from a lesson write",
      /not a lesson/i.test(prReviewer) && /never writes lessons during a review/.test(prReviewer));

    // The bucket is in the taxonomy, with the branch-scope reasoning that keeps per-PR state out
    // of the repo:: scope an agent's SessionStart injection reads.
    const buckets = read("agents/shared/rules/memory-buckets.md");
    s.check("G24i memory-buckets documents the pr-review-state record",
      /pr-review-state/.test(buckets) && /ci::pr-review-state/.test(buckets) &&
      /branch::\{owner\}\/\{repo\}/.test(buckets));
    s.check("G24i memory-buckets says why the scope is branch:: and not repo::",
      /SessionStart/.test(buckets) && /displace/.test(buckets));
  }

  // ── G26: the out-of-band shape validator. Behavioural — these EXECUTE the validator, against
  // both our own fixtures and REAL bodies as published. Everything else guarding the report shape
  // runs inside the agent's control flow; a run that hand-writes the body is invisible to all of
  // it, so this is the only check that observes what actually reached a PR.
  {
    const VALIDATOR = join(REPO_ROOT, "scripts/validate-report-shape.mjs");
    const POSTED = join(REPO_ROOT, "scripts/eval/fixtures/posted-bodies");
    const run = (input) => {
      const r = spawnSync("node", [VALIDATOR], { input, encoding: "utf8" });
      let verdict = null;
      try { verdict = JSON.parse(r.stdout); } catch { /* reported below */ }
      return { status: r.status, verdict, err: (r.stderr || "").trim() };
    };
    s.check("G26 the validator exists", existsSync(VALIDATOR));

    // (a) Real production bodies must be rejected, with the specific codes that name the defect.
    const REAL = [
      ["lorekit-503-flat.md", ["missing-report-marker", "no-review-details-accordion",
        "accordion-owned-line-at-top-level"]],
      ["lorekit-503-report-as-pointer.md", ["report-marked-as-pointer"]],
    ];
    for (const [file, expectedCodes] of REAL) {
      const p = join(POSTED, file);
      if (!existsSync(p)) { s.check(`G26 posted fixture ${file} present`, false); continue; }
      const r = run(readFileSync(p, "utf8"));
      s.check(`G26 ${file} is rejected`, r.status === 1, `exit ${r.status}: ${r.err.slice(0, 80)}`);
      const got = new Set((r.verdict?.violations || []).map((v) => v.code));
      for (const code of expectedCodes) {
        s.check(`G26 ${file} reports ${code}`, got.has(code), `got: ${[...got].join(", ")}`);
      }
    }

    // (b) Every rendered snapshot must PASS. If the renderer's own output fails the external
    // validator, the two disagree about the contract and one of them is wrong.
    // A missing snapshot must FAIL, exactly as an absent posted fixture does in case (a). A bare
    // `continue` here ran zero checks, so deleting all three snapshots would have passed by vacuity.
    for (const name of ["pass", "warn", "fail"]) {
      const p = join(REPO_ROOT, `scripts/eval/fixtures/report-body/${name}.expected.md`);
      if (!existsSync(p)) { s.check(`G26 report-body snapshot ${name}.expected.md present`, false); continue; }
      const r = run(readFileSync(p, "utf8"));
      s.check(`G26 the rendered ${name} snapshot passes the external validator`, r.status === 0,
        `exit ${r.status}: ${r.err.slice(0, 120)}`);
    }

    // (b2) The gate table alone must classify a body as a report. The real flat body omitted
    // `**Run mode**`, which broke a classifier that required two diagnostic labels; the abridged
    // fixture still carries two others, so this synthesises the minimal case that makes the
    // gate-table signal load-bearing. Column spacing varies between runs, so test both.
    for (const [why, sep] of [["tight pipes", "|---|---|---|"], ["padded pipes", "| --- | --- | --- |"]]) {
      const minimal = "Reviewed your changes — no blocking issues.\n\n"
        + `| Gate | Status | Details |\n${sep}\n| Code review | ✅ | fine |\n`;
      const r = run(minimal);
      s.check(`G26 the gate table alone classifies a body as a report (${why})`,
        r.status === 1 && r.verdict?.kind === "report-unmarked",
        `kind ${r.verdict?.kind}, exit ${r.status}`);
    }

    // (b4) The gate table above the accordion must be caught with the SAME spacing tolerance the
    // classifier uses. A literal `| Gate | Status | Details |` let a padded header classify as a
    // report and then escape the flattening check.
    for (const [why, hdr] of [["tight", "| Gate | Status | Details |"], ["padded", "|  Gate  |  Status  |  Details  |"]]) {
      const flat = `Reviewed your changes.\n\n${hdr}\n|---|---|---|\n| Code review | OK | fine |\n\n`
        + "<details>\n<summary>Review details</summary>\n\n**Run mode** \u2014 full\n\n</details>\n";
      const r = run(flat);
      s.check(`G26 a ${why}-spaced gate table above the accordion is flagged`,
        r.status === 1 &&
        (r.verdict?.violations || []).some((v) => v.code === "accordion-owned-line-at-top-level"),
        `exit ${r.status}, codes: ${(r.verdict?.violations || []).map((v) => v.code).join(", ")}`);
    }

    // (b5) The pointer budget must match the agent's own pre-flight, which strips the ledger and
    // nothing else. Stripping the marker too made the external guard looser than the internal one.
    {
      const marker = "<!-- PR_REVIEWER_POINTER -->";
      const prose = "x".repeat(600 - marker.length + 5);
      const r = run(`${marker}\n${prose}\n`);
      s.check("G26 the pointer budget counts the marker, as the agent's pre-flight does",
        r.status === 1 && (r.verdict?.violations || []).some((v) => v.code === "pointer-too-long"),
        `exit ${r.status}, codes: ${(r.verdict?.violations || []).map((v) => v.code).join(", ")}`);
    }

    // (b6) The guard's own notice must not trip the guard. The workflow renders every violation
    // `detail` into its sticky notice, so a detail quoting a marker verbatim made that notice
    // classify as a malformed report when re-validated — the guard failing itself.
    {
      const flat = "Reviewed your changes.\n\n| Gate | Status | Details |\n|---|---|---|\n| Code review | OK | x |\n";
      const r = run(flat);
      const details = (r.verdict?.violations || []).map((v) => v.detail).join("\n");
      const notice = ["<!-- PR_REVIEWER_SHAPE_GUARD -->",
        "\u26a0\ufe0f **The last `pr-reviewer` body does not match the report shape contract.**", "",
        ...(r.verdict?.violations || []).map((v) => `- \`${v.code}\` \u2014 ${v.detail}`), ""].join("\n");
      const back = run(notice);
      s.check("G26 no violation detail emits a marker verbatim",
        !/<!--\s*PR_REVIEWER_(REPORT|POINTER)\s*-->/.test(details), details.slice(0, 120));
      s.check("G26 the guard's own notice is not itself a reviewer body",
        back.status === 0 && back.verdict?.kind === "not-a-reviewer-body",
        `kind ${back.verdict?.kind}, exit ${back.status}`);
    }

    // (c) Non-reviewer bodies are ignored, so the guard never fires on ordinary PR chatter.
    for (const [why, body] of [
      ["a plain human comment", "LGTM, nice work on the caching layer."],
      ["a body with one incidental bold label", "**Note** — rebased onto main."],
    ]) {
      const r = run(body);
      s.check(`G26 the validator ignores ${why}`, r.status === 0 && r.verdict?.kind === "not-a-reviewer-body",
        `kind ${r.verdict?.kind}, exit ${r.status}`);
    }

    // (d) A genuine one-line pointer conforms — the guard must discriminate report from pointer.
    {
      const r = run('<!-- PR_REVIEWER_POINTER -->\nReviewed `abc1234` — 3 finding(s) inline.\n\n'
        + '<!-- PR_REVIEWER_LEDGER {"v":1,"runs":[]} -->\n');
      s.check("G26 a genuine one-line pointer conforms", r.status === 0 && r.verdict?.kind === "pointer",
        `kind ${r.verdict?.kind}, exit ${r.status}`);
    }

    // (d2) The ordinary review body is now marker-only (render-pointer.mjs `pointer` form). It has
    // no visible prose, no gate table, and no report signals, so the CI shape guard must classify
    // it as a conforming pointer — never as a report or a non-reviewer body — or a converging
    // review-loop would post a false-positive shape notice on every run.
    {
      const r = run('<!-- PR_REVIEWER_POINTER -->\n');
      s.check("G26 a marker-only pointer conforms", r.status === 0 && r.verdict?.kind === "pointer",
        `kind ${r.verdict?.kind}, exit ${r.status}`);
    }

    // (e) Each remaining defect class, synthesised.
    // Guarded like case (b): an unguarded readFileSync throws and aborts ALL of L1, turning one
    // missing fixture into a total run failure with no per-check attribution.
    const goodPath = join(REPO_ROOT, "scripts/eval/fixtures/report-body/warn.expected.md");
    const goodPresent = existsSync(goodPath);
    s.check("G26 report-body snapshot warn.expected.md present (the synthesis base)", goodPresent);
    const good = goodPresent ? readFileSync(goodPath, "utf8") : "";
    const CASES = goodPresent ? [
      ["a pre-expanded accordion", good.replace("<details>\n<summary>Review details", "<details open>\n<summary>Review details"), "accordion-pre-expanded"],
      ["a **Verdict** line", `${good}\n**Verdict**: PASS\n`, "verdict-in-posted-body"],
      // Cage the WHOLE link, both delimiters — the production defect was
      // ``['key'](url)``, and a leading pair alone cages nothing.
      ["a caged markdown link",
        good.replace(/^- (\[[^\]]*\]\([^)]*\))/m, "- ``$1``"), "link-caged-in-code-span"],
      ["a count disagreeing with its list", good.replace("**Open review threads (2)**", "**Open review threads (5)**"), "count-disagrees-with-list"],
      // The captured drift body wrote `**Open threads (6)**`; requiring the canonical `review`
      // wording let a hand-written heading's wrong count through the very check meant to catch it.
      ["a drift-worded count disagreeing with its list",
        good.replace("**Open review threads (2)**", "**Open threads (5)**"), "count-disagrees-with-list"],
      // The head slice must anchor on the `Review details` accordion, not on the first <details>.
      // A flat body preceded by an unrelated fold sliced the head to nothing and reported clean.
      ["a flat body preceded by an unrelated <details> fold",
        "Reviewed your changes.\n\n<details>\n<summary>Additional findings</summary>\n\n- a\n\n</details>\n\n"
        + "| Gate | Status | Details |\n|---|---|---|\n| Code review | \u2705 | fine |\n\n**Run mode** \u2014 full\n",
        "accordion-owned-line-at-top-level"],
    ] : [];
    for (const [why, body, code] of CASES) {
      const r = run(body);
      s.check(`G26 the validator flags ${why}`, r.status === 1, `exit ${r.status}`);
      s.check(`G26 ${why} reports ${code}`,
        (r.verdict?.violations || []).some((v) => v.code === code),
        (r.verdict?.violations || []).map((v) => v.code).join(", "));
    }

    // (f) The workflow and its caller template must reference the validator and each other, or the
    // guard is unreachable from a consuming repo.
    // Every read here is guarded: an unguarded readFileSync throws and takes down all of L1, so a
    // deleted workflow would be reported as a total run failure instead of one named missing file.
    const readGuarded = (rel) => {
      const p = join(REPO_ROOT, rel);
      const present = existsSync(p);
      s.check(`G26 ${rel} present`, present);
      return present ? readFileSync(p, "utf8") : "";
    };
    const wf = readGuarded(".github/workflows/reviewer-report-shape.yml");
    if (wf) {
      s.check("G26 the reusable workflow runs the validator",
        wf.includes("scripts/validate-report-shape.mjs") && wf.includes("workflow_call"));
      // BOTH body inputs, not just the review one: `github.event.comment.body` is equally
      // attacker-controlled, and asserting only the review body left half the claim unguarded.
      for (const [label, expr] of [
        ["REVIEW_BODY", "github.event.review.body"],
        ["COMMENT_BODY", "github.event.comment.body"],
      ]) {
        const bound = new RegExp(`${label}: \\$\\{\\{ ${expr.replace(/\./g, "\\.")} \\}\\}`);
        const spliced = new RegExp(`run:[\\s\\S]{0,400}\\$\\{\\{ ${expr.replace(/\./g, "\\.")} \\}\\}`);
        s.check(`G26 the workflow binds ${label} via env, never interpolated into shell`,
          bound.test(wf) && !spliced.test(wf));
      }
      s.check("G26 the workflow posts one sticky notice, keyed by a marker",
        wf.includes("PR_REVIEWER_SHAPE_GUARD") && wf.includes("-X PATCH"));
    }
    const caller = readGuarded("plugins/pr-reviewer-shape-guard/templates/report-shape-caller.yml");
    if (caller) {
      s.check("G26 the caller template targets the reusable workflow",
        caller.includes("mthines/agent-skills/.github/workflows/reviewer-report-shape.yml@main"));
      // The caller must grant at least what the reusable workflow requests, or the run fails on a
      // repo whose default token is read-only.
      s.check("G26 the caller template declares the permissions the reusable workflow needs",
        /permissions:\s*\n\s*contents: read\s*\n\s*pull-requests: write/.test(caller));
    }
  }

  // ── G27: Gate 2 (CI) warns, it never fails. Red CI is a fact about the branch, not a finding
  // about the diff — this agent did not diagnose it and cannot tell a regression from a flaky job,
  // a quota, a check that does not run on this base branch, or a draft with no workflow. GitHub
  // already blocks the merge on a required check. Observed on mthines/lorekit#490, whose headline
  // read "CI failing, 1 error, 2 warnings … Blocking: CI checks failing" — i.e. it reported the
  // reviewer as having found something blocking when it had not.
  {
    const gateStates = sliceBetween(prReviewer, "### Gate states", "`--skip-gates` bypasses");
    s.check("G27 Gate 2 is declared a soft/warning gate, not a hard one",
      /Gates 1 and 2 are two-state/.test(gateStates) &&
      /\*\*Gate 2 \(CI\) warns, it does not fail\.\*\*/.test(gateStates));
    s.check("G27 the hard-gate set no longer contains Gate 2",
      /Gates 4 and 5 are \*\*hard\*\* gates/.test(gateStates) &&
      !/plus Gate 2 \(CI\), are \*\*hard\*\*/.test(gateStates));

    // No verdict rule may still route a CI failure to FAIL. `Gates 2/4/5` was the shared idiom for
    // the hard-gate set at four sites, so its absence is the load-bearing assertion.
    s.check("G27 no verdict rule still names Gates 2/4/5 as the hard set",
      !/Gates 2\/4\/5/.test(prReviewer));
    s.check("G27 the FAIL verdict rule names only Gates 4 and 5",
      /verdict is \*\*FAIL\*\* when Gate 4 or Gate 5 fails/.test(prReviewer));

    // The tally and reasons must carry no CI token. These are the two strings that produced the
    // misleading headline, so assert on the rendered vocabulary rather than on prose about it.
    const tally = sliceBetween(reportRendering, "`SEVERITY_TALLY` (the **FAIL** headline",
      "`FAIL_REASONS` / `WARN_REASONS`");
    s.check("G27 SEVERITY_TALLY is ordered errors-then-warnings, with no CI term",
      /ordered errors-then-warnings/.test(tally) &&
      !/prefix `CI failing`/.test(tally));
    s.check("G27 SEVERITY_TALLY states CI never appears in it",
      /\*\*CI never appears in the tally\.\*\*/.test(tally));
    const reasons = sliceBetween(reportRendering, "`FAIL_REASONS` / `WARN_REASONS`", "| Gate | ❌ reason");
    s.check("G27 FAIL_REASONS no longer leads with a CI phrase",
      !/leading\s*\n?`CI checks failing`/.test(reasons) && /CI is\s*\n?never among them/.test(reasons));

    // The reason table's CI row must offer a ⚠️ phrase and no ❌ phrase.
    const ciRow = (reportRendering.match(/^\| CI \(Gate 2\) \|[^\n]*$/m) || [""])[0];
    s.check("G27 the reason table's CI row has no ❌ phrase", /warns, never fails/.test(ciRow), ciRow.slice(0, 90));
    s.check("G27 the reason table's CI row supplies a ⚠️ phrase", /CI red:/.test(ciRow), ciRow.slice(0, 90));

    // Gate 2's own result line must be two-state.
    const gate2 = sliceBetween(prReviewer, "**Gate 2 — CI status**", "**Gate 3 —");
    s.check("G27 Gate 2's result is PASS/WARN and explicitly never ❌",
      /Never ❌/.test(gate2) && /WARN \(⚠️\)/.test(gate2));

    // Registered in the diagnostic surface, as an invariant and a failure mode.
    s.check("G27 diagnostic-surface registers F-ci-failed-the-verdict",
      prReviewerDiag.includes("F-ci-failed-the-verdict"));
    // Absence is not sufficiency. Dropping Gate 2 from the hard set only lands if CI is ADDED
    // wherever the WARNING gates are enumerated — the WARN presentation selectors and the
    // WARN_GATE_COUNT definition. All three omitted it while L1 was green at 549/549, so a
    // CI-only ⚠️ selected neither PASS ("every gate is ✅") nor WARN, and would have rendered
    // `**0 warning(s)**`. Assert the presence side too.
    // The two selectors now live in different files: Step 3's terminal one in the agent body,
    // Step 4's body-template one in the rendering reference. Pair each anchor with its source
    // rather than assuming one haystack.
    for (const [what, src, anchor] of [
      ["the Step 3 WARN selector", prReviewer, "Pick the presentation by verdict"],
      ["the Step 4 WARN selector", reportRendering, "Pick the body by verdict"],
    ]) {
      const sel = sliceBetween(src, anchor, "\n\n");
      s.check(`G27 ${what} lists CI among the graded gates`,
        /at least one graded gate — Description vs\. code, CI, Prior review feedback/.test(sel),
        sel.slice(0, 120));
    }
    {
      const wgc = sliceBetween(reportRendering, "- `WARN_GATE_COUNT` = the number of gates showing",
        "The top-level WARN headline leads with");
      s.check("G27 WARN_GATE_COUNT counts CI among the warning gates",
        /\*\*CI\*\*/.test(wgc) && /so 0 to 4/.test(wgc), wgc.slice(0, 140));
    }
    // The criteria list is read as normative, so it must not still call CI verdict-bearing.
    {
      const crit = sliceBetween(prReviewer, "2. **CI status**", "3. **Prior review feedback**");
      s.check("G27 criterion 2 declares CI a soft-warning gate, not verdict-bearing",
        /soft-warning gate/.test(crit) && !/Contributes to verdict/.test(crit), crit.slice(0, 120));
    }
    // The reference fixtures must not demonstrate the shape G27 forbids — G25 diffs them, so a
    // stale fixture locks the forbidden headline in as the expected rendering.
    for (const name of ["pass", "warn", "fail"]) {
      for (const ext of ["json", "expected.md"]) {
        const f = join(REPO_ROOT, `scripts/eval/fixtures/report-body/${name}.${ext}`);
        if (!existsSync(f)) continue;
        const t = readFileSync(f, "utf8");
        s.check(`G27 fixture ${name}.${ext} carries no CI-blocking headline`,
          !/CI failing/.test(t) && !/Blocking: CI checks failing/.test(t));
      }
    }
    // Every prior guard here checks whether a STRING is present or absent. That cannot see a
    // fixture whose headline COUNT disagrees with its own gate statuses — and because G25 diffs
    // the snapshots byte-for-byte, such a fixture locks the wrong semantics in as the reference
    // rendering. warn.json read `**2 warning(s)**` while three gates warned (Prior review feedback,
    // Code review, and CI via CI_NOTE), which is exactly the miscount this change introduces the
    // risk of. Derive the counts from the payload and compare them to the rendered headline.
    for (const name of ["pass", "warn", "fail"]) {
      const pj = join(REPO_ROOT, `scripts/eval/fixtures/report-body/${name}.json`);
      if (!existsSync(pj)) { s.check(`G27 fixture ${name}.json present`, false); continue; }
      const d = JSON.parse(readFileSync(pj, "utf8"));
      const statuses = Object.entries(d).filter(([k]) => k.endsWith("_STATUS")).map(([, v]) => v);
      const errors = statuses.filter((v) => v === "❌").length;
      // CI is a warning gate now, and CI_NOTE is its only surface — a populated CI_NOTE means ⚠️.
      const warnings = statuses.filter((v) => v === "⚠️").length + (d.CI_NOTE ? 1 : 0);
      const h = String(d.HEADLINE);
      const claimedErr = Number((h.match(/\*\*(\d+) errors?/) || [0, 0])[1]);
      const claimedWarn = Number((h.match(/(\d+) warnings?/) || [0, 0])[1]);
      s.check(`G27 ${name} headline's error count matches its gate statuses`,
        claimedErr === errors, `headline ${claimedErr}, gates ${errors}`);
      s.check(`G27 ${name} headline's warning count matches its gate statuses (CI included)`,
        claimedWarn === warnings, `headline ${claimedWarn}, gates ${warnings}`);
      // A warning gate must be NAMED where WARN_REASONS renders — which is the WARN headline only.
      // On a FAIL run the spec counts warning gates in the tally but names them in the accordion,
      // never in the headline, so requiring the phrase there would contradict the file. Scope this
      // to the no-errors case rather than "wherever CI_NOTE is set".
      if (d.CI_NOTE && errors === 0) {
        s.check(`G27 ${name} names CI in WARN_REASONS when CI_NOTE reports a red check`,
          /CI red:|CI still pending/.test(h), h.slice(0, 90));
      }
    }
    s.check("G27 diagnostic-surface carries the CI-never-fails invariant",
      /\*\*CI never fails the verdict\.\*\*/.test(prReviewerDiag));
  }

  // G24c: the three Gate-3 failure modes are registered in the diagnostic surface, so a
  // regression has a named bucket instead of silently becoming "expected behaviour".
  for (const fm of ["F-nonblocking-thread-fails-gate-3", "F-gate-3-severity-reinvented",
    "F-warn-hides-open-threads"]) {
    s.check(`G24c diagnostic-surface.md registers ${fm}`, prReviewerDiag.includes(fm));
  }
}

// Shared by G22 and G23. Deliberately ONE definition: this predicate was
// copy-pasted across the two checks, and widening one without the other would
// let a block be counted by G22 while G23 silently stopped guarding it — the
// same restated-value defect these checks exist to catch.
const isPollBlock = (block) =>
  /\b(while|until)\b/.test(block) && /\bsleep\b/.test(block) &&
  /\b(gh|curl|wget|aws|kubectl|az|gcloud)\b/.test(block);

// ── Check G22: every external-wait site is bounded at BOTH levels ──
// The `diagnostic-surface.md` invariant has two clauses and checking only the
// first is the documented trap: an in-command `timeout 540` issued at the Bash
// tool's DEFAULT (120000 ms) is still killed before its own exit 124 fires.
//
// Sites are identified by SHAPE inside fenced code blocks, not by variable name:
//   - a `gh … --watch` / `gh run watch` command line, or
//   - a poll block: a fence containing a loop keyword AND a sleep AND a network call.
// Keying on a shape rather than an identifier means a poll loop written with any
// variable name is still seen, and an unrelated snippet is not miscounted.
// `references/` is excluded — it quotes the unbounded forms as examples of the bug.
{
  const PROXIMITY = 6;
  const EXPECTED_SITES = 9; // pinned, not a floor — adding or deleting a site must trip this.
  const files = [
    ...walk(join(REPO_ROOT, "skills")),
    ...walk(join(REPO_ROOT, "agents")),
  ].filter((f) => !f.includes("/references/"));

  const isWatchCmd = (l) => /gh\s+(?:pr\s+checks[^\n]*--watch|run\s+watch)/.test(l);
  let sites = 0;

  for (const f of files) {
    const lines = readFileSync(f, "utf8").split("\n");
    const text = lines.join("\n");
    // Collect fenced blocks as [startIdx, endIdx) line ranges.
    const blocks = [];
    let open = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*```/.test(lines[i])) {
        if (open === -1) open = i;
        else { blocks.push([open + 1, i]); open = -1; }
      }
    }

    for (const [b0, b1] of blocks) {
      const block = lines.slice(b0, b1).join("\n");

      // (1) Watch commands — one site per matching line.
      for (let i = b0; i < b1; i++) {
        if (!isWatchCmd(lines[i])) continue;
        sites++;
        const m = lines[i].match(/^\s*(?:timeout\s+(\d+)\s+)?gh\b/);
        const inner = m && m[1] ? Number(m[1]) : null;
        s.check(`G22 ${rel(f)}:${i + 1} watch is bounded in-command (timeout N, N < 600)`,
          inner !== null && inner < 600,
          inner === null ? `unbounded: ${lines[i].trim()}` : `timeout ${inner} >= harness cap`);
        s.check(`G22 ${rel(f)}:${i + 1} declares the per-call tool timeout (600000) within ${PROXIMITY} lines`,
          lines.slice(Math.max(0, i - PROXIMITY), i).join("\n").includes("600000"),
          "an inner timeout alone still dies at the 120000 ms tool default");
      }

      // (2) Poll blocks — a loop that sleeps around a network call.
      if (!isPollBlock(block)) continue;
      // A fence may hold BOTH a watch command and a separate poll loop; each is
      // counted. (isPoll needs a loop keyword AND a sleep, which a watch command
      // line never has, so this cannot double-count a single watch.)
      sites++;
      const wrapper = block.match(/^\s*timeout\s+(\d+)\s+bash\s+-c/m);
      const wrapped = wrapper !== null && Number(wrapper[1]) < 600;
      if (wrapped) {
        s.check(`G22 ${rel(f)}:${b0 + 1} poll block is wrapped in a timeout below the harness cap`, true);
      } else {
        // A bare poll's only bounds are the tool timeout plus an interval kept
        // under it — so assert the CLAMP INSTRUCTION, not merely the example
        // literal, which a comment on the snippet line would satisfy on its own.
        s.check(`G22 ${rel(f)}:${b0 + 1} bare poll documents an --interval clamp instruction`,
          lines.some((l) => /--interval/.test(l) && /\b540\b/.test(l)),
          "needs a line instructing the clamp (--interval and 540 together); an example " +
          "literal, or the word 'clamp' about some other flag, does not constrain a " +
          "user-supplied interval");
      }
      s.check(`G22 ${rel(f)}:${b0 + 1} poll block declares the per-call tool timeout (600000) within ${PROXIMITY} lines`,
        lines.slice(Math.max(0, b0 - PROXIMITY), b0 + 2).join("\n").includes("600000"),
        "a poll bounded only internally still dies at the 120000 ms tool default");
    }
  }
  s.check(`G22 guards exactly ${EXPECTED_SITES} external-wait sites`,
    sites === EXPECTED_SITES, `found ${sites}`);
}

// ── Check G23: every polling block classifies tool failure as failure ──
// G22 guards BOUNDING. Nothing guarded CLASSIFICATION, and L1 was green in every
// round of PR #111 in which a classification defect shipped — three of them, each
// the same shape: a remote call whose empty output was read as a benign "nothing
// yet" regardless of whether the tool had actually failed. A broken `gh` prints
// to stderr and nothing to stdout, so `$(gh …)` yields "" exactly as a legitimate
// empty result does; a loop that cannot tell them apart burns its budget and then
// escalates the wrong cause, or reports "quiet" when it is simply blind.
//
// The rule, stated in registration-poll.md: an unrecognised tool error is never
// benign. This asserts it mechanically — every fenced poll block must contain a
// non-benign default: a `case` whose `*)` arm exits non-zero, or an explicit
// stderr/failure arm.
{
  const files = [
    ...walk(join(REPO_ROOT, "skills")),
    ...walk(join(REPO_ROOT, "agents")),
  ].filter((f) => !f.includes("/references/"));

  let guarded = 0;
  for (const f of files) {
    const lines = readFileSync(f, "utf8").split("\n");
    const blocks = [];
    let open = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*```/.test(lines[i])) {
        if (open === -1) open = i;
        else { blocks.push([open + 1, i]); open = -1; }
      }
    }
    for (const [b0, b1] of blocks) {
      const block = lines.slice(b0, b1).join("\n");
      if (!isPollBlock(block)) continue;
      guarded++;
      // Accept either shape: a case default that exits non-zero, or an explicit
      // "the tool wrote to stderr / the call failed" arm.
      // MUST be anchored: a specific arm such as `*authentication*)` also ends
      // in `*)`, so an unanchored match is satisfied by a non-default arm while
      // the real default stays benign — the exact bug this check exists to find.
      const caseDefault = /^\s*\*\)[^\n]*exit\s+[1-9]/m.test(block);
      const stderrArm = /\[\s*-[sn]\s+"?\$\{?(err|ERR)/i.test(block) ||
        /\|\|\s*\{[^}]*(exit\s+[1-9]|POLL_ERROR)/.test(block);
      s.check(
        `G23 ${rel(f)}:${b0 + 1} poll block treats a tool failure as failure, not as "nothing yet"`,
        caseDefault || stderrArm,
        "empty output alone cannot distinguish a broken tool from a legitimately " +
        "empty result — add a non-benign default (case *) exit N, or a stderr arm)",
      );
    }
  }
  s.check("G23 guards exactly 3 polling blocks", guarded === 3, `found ${guarded}`);
}

// ── Check G24: any agent that does GitHub work can actually reach GitHub ──
// A sub-agent inherits NEITHER the parent's `gh` binary NOR the parent's MCP
// tools — its access is exactly its own `tools:` frontmatter. Observed in the
// field: an agent dispatched to open a PR reported the task BLOCKED, in a session
// where the parent's MCP tools worked fine; the parent then did it in one call.
// Same cause: `pr-reviewer` made 26 `gh` calls with zero GitHub tools granted,
// so on a cloud session it could not post a single one of its reviews.
//
// If an agent's body invokes GitHub, its frontmatter must grant a way to get there.
{
  const agentFiles = [
    // Real agent definitions only: agents/*.md. `agents/rules/` and
    // `agents/templates/` are prose and boilerplate, not dispatchable agents.
    ...walk(join(REPO_ROOT, "agents"))
      .filter((f) => !f.includes("/rules/") && !f.includes("/templates/")),
    ...walk(join(REPO_ROOT, "skills/workflow/autonomous-workflow/templates"))
      .filter((f) => f.endsWith(".agent.md")),
  ];
  let checked = 0;
  for (const f of agentFiles) {
    const text = readFileSync(f, "utf8");
    const fmEnd = text.indexOf("\n---", 4);
    if (fmEnd === -1) continue;
    const fm = text.slice(0, fmEnd);
    const body = text.slice(fmEnd);
    // Two ways an agent needs GitHub access, and the second is the one that bit:
    //   (1) its own body runs `gh ...`
    //   (2) it invokes a skill that does — that skill executes IN THIS AGENT'S
    //       context, with this agent's tools, so delegating does not delegate access.
    const ghCalls = (body.match(/\bgh\s+(pr|api|run|repo|search|auth)\b/g) || []).length;
    // Matches both `Skill("create-pr")` and the backticked name used in the
    // agents' companion tables — either way the skill runs in this agent's context.
    const GH_SKILLS = /(?:Skill\(\s*["']|`)(create-pr|ci-auto-fix|review-loop|implement-suggestion)(?:["']|`)/;
    const viaSkill = GH_SKILLS.test(body);
    if (ghCalls === 0 && !viaSkill) continue;
    checked++;
    const why = ghCalls > 0
      ? `makes ${ghCalls} gh calls`
      : "invokes a GitHub-using skill, which runs in its context";
    s.check(
      `G24 ${rel(f)} ${why}, so its frontmatter must grant GitHub tools`,
      /mcp__github__/.test(fm),
      "grant mcp__github__* in tools: — a sub-agent inherits neither gh nor the " +
      "parent's MCP tools, so without this it reports the task blocked",
    );
  }
  s.check("G24 found the GitHub-using agents to guard", checked >= 3, `found ${checked}`);
}

// ── G28: the verify-behavior skill exists and its wiring into verification-receipt.md +
// pr-reviewer's diagnostic-surface.md is real. Each sub-check reads the REAL shipped file and
// asserts a literal anchor — never a copy re-encoded inside this eval. Mirrors the G17 guard
// shape. Check-gaming is forbidden: these guards read the files under test, not a mock of them.
{
  const read = (p) => readFileSync(join(REPO_ROOT, p), "utf8");
  const skillDir = join(REPO_ROOT, "skills/quality/verify-behavior");

  // G28a: the skill exists and documents the ladder + receipt contract + execute-not-score
  // boundary (the same anchors AC-1/AC-6 gate on, read here as a shipping-file guard rather
  // than a plan-time acceptance check).
  s.check("G28a skills/quality/verify-behavior/SKILL.md exists and documents the ladder",
    existsSync(join(skillDir, "SKILL.md")) &&
    /Tier 1/i.test(read("skills/quality/verify-behavior/SKILL.md")) &&
    /Tier 3/i.test(read("skills/quality/verify-behavior/SKILL.md")) &&
    /does not score/i.test(read("skills/quality/verify-behavior/SKILL.md")));

  // G28b: verification-receipt.md actually delegates Tier 2/3 to the skill, keeps the 2.6b
  // pipeline position, and preserves the null-drop invariant — the exact adapter contract
  // AC-7 gates on, read here as a regression lock against a future edit re-flattening it.
  const vr = read("agents/shared/rules/verification-receipt.md");
  s.check('G28b verification-receipt.md delegates to Skill("verify-behavior") and keeps 2.6b + null-drop',
    /Skill\(\s*["']verify-behavior["']/.test(vr) &&
    vr.includes("2.6b") &&
    /null/i.test(vr) &&
    /unavailable|not installed|not available/i.test(vr));

  // G28c: verification-receipt.md's Order-in-the-pipeline block still reads 2.6 -> 2.6b -> 2.7 —
  // a regression lock distinct from G28b's substring check, so a rewrite that keeps the words
  // "2.6b" somewhere else in the file but reorders the actual pipeline diagram still fails.
  s.check("G28c verification-receipt.md pipeline diagram still orders 2.6 -> 2.6b -> 2.7",
    /\[2\.6\][^\n]*\n\s*→ verification-receipt\.md[^\n]*\[2\.6b\][^\n]*\n\s*→ per-comment-confidence[^\n]*\[2\.7\]/.test(vr));

  // G28d: pr-reviewer's diagnostic-surface.md carries the new runtime-tier failure classes
  // (append-only) without dropping the pre-existing static-tier row
  // (F-null-receipt-treated-as-confirmation) — the exact append-only contract R17/AC-14
  // requires. Retired rows are asserted per-fingerprint by G25, not here; a bare
  // diag.includes("Retired") only matched the append-only policy sentence, so it is dropped.
  const diag = read("agents/pr-reviewer/rules/diagnostic-surface.md");
  s.check("G28d diagnostic-surface.md appends the runtime-tier F-classes without dropping prior rows",
    diag.includes("F-tier3-ran-untrusted-code-in-cross") &&
    diag.includes("F-null-execution-treated-as-confirmation") &&
    diag.includes("F-tier3-modified-tracked-files") &&
    diag.includes("F-null-receipt-treated-as-confirmation"));

  // G28e: bug-fix-verifier.md and feature-pr-verifier.md both delegate their run mechanic and
  // both still exist as real agent files — the WRAP verdict from the Existing Code Survey
  // (D7 / plan.md), never a DELETE.
  s.check("G28e bug-fix-verifier.md and feature-pr-verifier.md delegate to verify-behavior and still exist",
    existsSync(join(REPO_ROOT, "agents/bug-fix-verifier.md")) &&
    existsSync(join(REPO_ROOT, "agents/feature-pr-verifier.md")) &&
    read("agents/bug-fix-verifier.md").includes("verify-behavior") &&
    read("agents/feature-pr-verifier.md").includes("verify-behavior"));

  // G28f: the aw-executor Phase 4 checks loop cites the change-verification shape while
  // keeping its own mode-aware cap and check-integrity rules intact.
  const p4 = read("skills/workflow/autonomous-workflow/rules/phase-4-testing.md");
  s.check("G28f phase-4-testing.md checks loop cites verify-behavior change-verification and keeps its own gate rules",
    p4.includes("verify-behavior") &&
    p4.includes("Check definitions are executor-immutable") &&
    p4.includes("unsatisfiable"));
}

// ── G29: the review-body pointer renderer. Behavioural, same rationale as G25 — a hand-authored
// pointer drifted into four different ad-hoc headline shapes across mthines/lorekit#514-#518 when
// a run had no deterministic fallback for "the sticky write is forbidden, not just technically
// unavailable". render-pointer.mjs is the fix; these checks execute it against committed fixtures.
{
  const RENDER = join(REPO_ROOT, "agents/pr-reviewer/scripts/render-pointer.mjs");
  const FIX = join(REPO_ROOT, "scripts/eval/fixtures/report-pointer");
  const run = (args, input) => {
    const r = spawnSync("node", [RENDER, ...args], { input, encoding: "utf8" });
    return { ok: r.status === 0, out: r.stdout || "", err: (r.stderr || "").trim() };
  };
  const prReviewer = readFileSync(join(REPO_ROOT, "agents/pr-reviewer.md"), "utf8");

  s.check("G29a the pointer renderer exists and pr-reviewer.md invokes it, not a hand-authored body",
    existsSync(RENDER) &&
    /render-pointer\.mjs/.test(prReviewer) &&
    prReviewer.includes("`POINTER_BODY` is not written by hand either"));

  s.check("G29b pr-reviewer.md defines the caller-policy-refusal branch, distinct from access-path incapability",
    /STICKY_WRITE_FORBIDDEN/.test(prReviewer) &&
    /Two different reasons the sticky can go unwritten/.test(prReviewer) &&
    /caller policy refusal/.test(prReviewer));

  // (a) Snapshot parity — one fixture per FORM.
  for (const name of ["pointer", "degraded"]) {
    const payload = join(FIX, `${name}.json`);
    const expectedPath = join(FIX, `${name}.expected.md`);
    if (!existsSync(payload) || !existsSync(expectedPath)) {
      s.check(`G29 ${name} fixture + snapshot present`, false, "missing fixture or snapshot");
      continue;
    }
    const r = run([payload]);
    s.check(`G29 ${name}.json renders without error`, r.ok, r.err);
    const expected = readFileSync(expectedPath, "utf8");
    s.check(`G29 ${name} output matches its committed snapshot`, r.out === expected,
      r.out === expected ? "" : "output drifted — regenerate the snapshot and review the diff");
  }

  // (b) Structural invariants every form must hold.
  for (const name of ["pointer", "degraded"]) {
    const p = join(FIX, `${name}.expected.md`);
    if (!existsSync(p)) continue;
    const body = readFileSync(p, "utf8");
    s.check(`G29 ${name} carries the pointer marker`, body.startsWith("<!-- PR_REVIEWER_POINTER -->"));
    s.check(`G29 ${name} never carries the report marker`, !body.includes("<!-- PR_REVIEWER_REPORT -->"));
  }

  // (c) Fail-closed — each once shipped as an ad-hoc posted body (or is the exact shape that
  // would let one back in); the renderer must refuse it and print nothing on stdout.
  const rejects = [
    ["a missing FORM", '{"HEAD_SHA":"bde3c2f"}'],
    ["an invalid FORM", '{"FORM":"summary","HEAD_SHA":"bde3c2f"}'],
    ["a non-7-char sha", '{"FORM":"pointer","HEAD_SHA":"abc","FINDINGS_COUNT":1}'],
    ["an uppercase sha", '{"FORM":"pointer","HEAD_SHA":"BDE3C2F","FINDINGS_COUNT":1}'],
    // The two retired notification-only forms. A run that remembers them must get an error, not
    // a shape nothing documents — and not a silently-accepted unknown FORM either.
    ["the retired escalation form", '{"FORM":"escalation","HEAD_SHA":"bde3c2f","VERDICT":"FAIL","PRIOR_VERDICT":"PASS","REASONS":"x","STICKY_URL":"https://x/1"}'],
    ["the retired no_prior form", '{"FORM":"no_prior","HEAD_SHA":"bde3c2f","VERDICT":"PASS","STICKY_URL":"https://x/1"}'],
    ["degraded missing DEGRADED_REASON", '{"FORM":"degraded","HEAD_SHA":"bde3c2f","FINDINGS_COUNT":1,"HEADLINE_LINE":"x"}'],
    ["degraded HEADLINE_LINE carrying the report marker", '{"FORM":"degraded","HEAD_SHA":"bde3c2f","FINDINGS_COUNT":1,"HEADLINE_LINE":"<!-- PR_REVIEWER_REPORT -->","DEGRADED_REASON":"x"}'],
    // Run state may not ride on a review body at all any more: LEDGER is not a known key, and a
    // ledger block smuggled in through a prose field is rejected by the post-condition.
    ["a LEDGER key", '{"FORM":"degraded","HEAD_SHA":"bde3c2f","FINDINGS_COUNT":1,"HEADLINE_LINE":"x","DEGRADED_REASON":"y","LEDGER":{"v":1,"runs":[]}}'],
    ["a ledger block smuggled into DEGRADED_REASON", '{"FORM":"degraded","HEAD_SHA":"bde3c2f","FINDINGS_COUNT":1,"HEADLINE_LINE":"x","DEGRADED_REASON":"see <!-- PR_REVIEWER_LEDGER {\"v\":1} -->"}'],
    ["an unknown payload key", '{"FORM":"pointer","HEAD_SHA":"bde3c2f","FINDINGS_COUNT":1,"EXTRA":"nope"}'],
    ["a non-object payload", "[1,2]"],
    ["malformed JSON", "{nope"],
  ];
  for (const [label, input] of rejects) {
    const r = run([], input);
    s.check(`G29 rejects ${label}`, !r.ok && r.out === "", r.out ? `stdout was non-empty: ${r.out.slice(0, 80)}` : r.err);
  }
}

// G30: the tier-tolerant Conventional-Comments prefix / severity-label regex is hand-mirrored
// across three sites — the rule (conventional-comments.md PREFIX_RE), the agent's Step 4b
// payload pre-flight (pr-reviewer.md), and the relevance script (record-comment-relevance.mjs).
// A drift (a tier renamed/reordered/removed in one) would let a tiered comment pass one gate and
// abort another — exactly the hand-mirror the #136 review flagged. Assert the four-tier alternation
// is spelled identically wherever that regex lives. (render-report.mjs uses the array form, so it
// is not a mirror of this string and is excluded.)
{
  const TIER = "critical|high|medium|low";
  for (const m of [
    "agents/shared/rules/conventional-comments.md",
    "agents/pr-reviewer.md",
    "scripts/record-comment-relevance.mjs",
  ]) {
    const body = readFileSync(join(REPO_ROOT, m), "utf8");
    s.check(`G30 ${m} spells the severity tier enum as \`${TIER}\``, body.includes(TIER),
      `missing the canonical tier alternation "${TIER}" — a rename/reorder/removal drifted a mirror`);
  }
}

// G31: build-agent0-link.mjs is the documented single source of truth for the Agent0 deep-link
// encoding (its own header comment says so, and render-report.mjs's FIX_ALL_URL guard cites it by
// name) but, unlike every other renderer script here (G25 render-report.mjs, G29 render-pointer.mjs),
// no fixture or unit check exercised it directly — a regression in `encodePrompt` or the MAX_URL
// guard could ship silently. Exercise the exported functions directly (not a snapshot: the encoding
// contract is a small pure function, not a rendered template) plus the CLI's two fail-closed guards.
{
  const LINK_MOD = join(REPO_ROOT, "agents/pr-reviewer/scripts/build-agent0-link.mjs");
  const { encodePrompt, buildLink } = await import(`file://${LINK_MOD}`);

  s.check("G31a encodePrompt escapes '(', ')', and \"'\" beyond encodeURIComponent's own output",
    encodePrompt("fix(this)'now") === "fix%28this%29%27now",
    `got ${JSON.stringify(encodePrompt("fix(this)'now"))}`);

  s.check("G31b buildLink never leaves a literal ')' in the URL — the markdown-link-termination guard",
    !buildLink("close (this) paren", "production", "fix-all").includes(")"),
    `buildLink output still contained ')': ${buildLink("close (this) paren", "production", "fix-all")}`);

  s.check("G31c buildLink prefixes the documented Agent0 base and auto_submit flag",
    buildLink("hi", "production", "fix-all").startsWith("https://app.dash0.com/goto/agent0?auto_submit=true&initial_prompt="));

  s.check("G31g buildLink throws on a missing or unknown source — click attribution must never silently default",
    (() => { try { buildLink("hi", "production", undefined); return false; } catch { return true; } })()
    && (() => { try { buildLink("hi", "production", "bogus"); return false; } catch { return true; } })());

  s.check("G31h buildLink appends the utm_source click-attribution tag matching the given source",
    buildLink("hi", "production", "fix-all").includes("&utm_source=pr-reviewer-fix-all")
    && buildLink("hi", "production", "fix-this").includes("&utm_source=pr-reviewer-fix-this"));

  const runCli = (args) => spawnSync("node", [LINK_MOD, ...args], { encoding: "utf8" });

  const empty = runCli(["--source", "fix-all", ""]);
  s.check("G31d CLI rejects an empty prompt: non-zero exit, nothing on stdout",
    empty.status !== 0 && empty.stdout === "",
    `status=${empty.status} stdout=${JSON.stringify(empty.stdout)}`);

  const oversized = runCli(["--source", "fix-all", "a".repeat(4500)]);
  s.check("G31e CLI rejects a prompt whose encoded URL exceeds MAX_URL: non-zero exit, nothing on stdout",
    oversized.status !== 0 && oversized.stdout === "" && /over 4000/.test(oversized.stderr),
    `status=${oversized.status} stdout=${JSON.stringify(oversized.stdout)} stderr=${oversized.stderr}`);

  const ok = runCli(["--source", "fix-all", "fix this thing"]);
  s.check("G31f CLI accepts a normal prompt: zero exit, one URL line on stdout",
    ok.status === 0 && ok.stdout.trim() === buildLink("fix this thing", "production", "fix-all"),
    `status=${ok.status} stdout=${JSON.stringify(ok.stdout)}`);

  const noSource = runCli(["fix this thing"]);
  s.check("G31i CLI rejects a missing --source: non-zero exit, nothing on stdout",
    noSource.status !== 0 && noSource.stdout === "" && /source must be one of/.test(noSource.stderr),
    `status=${noSource.status} stdout=${JSON.stringify(noSource.stdout)} stderr=${noSource.stderr}`);

  // G32: the Agent0 prompt templates are addresses, not identities. Both hand Agent0 the finding
  // locations it would otherwise spend round trips discovering — the regression this guards is a
  // revert to the marker hop ("open the pr-reviewer report comment (marker PR_REVIEWER_REPORT)"),
  // which cost four discovery calls on mthines/lorekit#594 and is structurally stale: Gate 3 counts
  // PRIOR threads, while the run's own findings post at 4b after the 4a render. The templates carry
  // no code, so a fixture cannot cover them; assert the placeholders plus the length bound that
  // embedding a variable-length worklist trades away.
  const rule = readFileSync(join(REPO_ROOT, "agents/shared/rules/agent0-fix-links.md"), "utf8");
  const templates = [...rule.matchAll(/```text\n([^`]*?)\n```/g)].map((m) => m[1]);
  const fixAll = templates.find((t) => t.includes("{locations}"));
  const fixThis = templates.find((t) => t.includes("{path}:{line}") && !t.includes("{locations}"));
  const ciOnly = templates.find((t) => t.includes("{failing_checks}"));

  s.check("G32a the Fix-all template hands over the worklist by location ({locations} + {count})",
    !!fixAll && fixAll.includes("{count}"),
    "no ```text template carries both {locations} and {count} — the worklist fill was dropped");

  s.check("G32b no template sends Agent0 to the report comment by marker first",
    !templates.some((t) => t.includes("PR_REVIEWER_REPORT")),
    "a prompt template names the PR_REVIEWER_REPORT marker again — that is the list-and-scan hop, and the report is stale for this run's own findings");

  s.check("G32c the Fix-this template carries the finding's lead line, not just its location",
    !!fixThis && fixThis.includes("{lead}"),
    "the fix-this template lost {lead} — Agent0 is back to fetching before it knows the subject");

  // Worst case the cap allows: 15 locations at 94-char paths. The design target is 2500 — the point
  // of the target is that MAX_URL (4000) stays a fail-closed guard rather than a routine ceiling,
  // since the real cliff behind it is the 8k request-line buffer of a default nginx/Apache.
  // Filled from the LIVE template, never hand-copied: a transcribed copy silently stops measuring
  // the real prompt the moment the template gains a clause, which is exactly when the measurement
  // matters. Substitute the placeholders a real fill would.
  const TARGET = 2500;
  const worstLocations = Array.from({ length: 15 },
    (_, i) => `${"packages/service/src/features/nested/module".padEnd(86, "x")}-${i}.ts:${1200 + i}`).join(", ");
  const worst = (fixAll ?? "")
    .replaceAll("{owner}", "mthines").replaceAll("{repo}", "lorekit")
    .replaceAll("{n}", "594").replaceAll("{count}", "15")
    .replaceAll("{locations}", worstLocations);
  s.check("G32d0 the worst-case fill leaves no unsubstituted placeholder",
    worst !== "" && !/\{[a-z_]+\}/.test(worst),
    `template gained a placeholder this fill does not substitute: ${/\{[a-z_]+\}/.exec(worst)?.[0] ?? "(no template)"}`);
  const worstLen = buildLink(worst, "production", "fix-all").length;
  s.check(`G32d a worst-case 15-location Fix-all URL stays under the ${TARGET}-char design target`,
    worstLen < TARGET, `worst-case URL is ${worstLen} chars — lower the location cap in agent0-fix-links.md, do not raise MAX_URL`);

  s.check("G32e the rule caps the Fix-all location list at 15",
    /capped at 15/.test(rule), "agent0-fix-links.md no longer states the 15-location cap G32d assumes");

  // The embedded worklist can be incomplete — findings past the 15 cap, a thread opened between the
  // render and the click, a payload bug. The sweep is the completeness net, and it must come AFTER
  // the locations: in front of them it is the four-call discovery hunt G32b exists to prevent.
  s.check("G32h the Fix-all template sweeps for the same reviewer's other unresolved threads",
    !!fixAll && /sweep for any other unresolved thread by that same reviewer/.test(fixAll),
    "Fix-all lost the sweep clause — findings past the location cap, or opened after the render, go unfixed");

  s.check("G32i the sweep follows the location list rather than preceding it",
    !!fixAll && fixAll.indexOf("sweep") > fixAll.indexOf("{locations}"),
    "the sweep moved ahead of {locations} — that is the discovery hunt again, with extra steps");

  // The Agent0 runner lacks the headroom for a raw tsc/eslint invocation — even one scoped to a
  // single changed package still walks that package's whole project graph and crashes the run, so
  // scoping by file count alone (the earlier wording) was not sufficient; observed live when a run
  // honored "only the files you changed" but still reached for `npx tsc --noEmit --project
  // tsconfig.json` on the changed package. All three templates must instead route to the repo's own
  // lint/typecheck/test scripts and allow skipping verification outright rather than inventing a raw
  // invocation.
  for (const [name, tpl] of [["Fix-all", fixAll], ["Fix-this", fixThis], ["Fix-all — CI-only", ciOnly]]) {
    s.check(`G32g the ${name} template verifies via the repo's own scripts, never a raw call or a whole-repo pass`,
      !!tpl
        && /repo's own lint\/typecheck/.test(tpl)
        && /never a raw [\w/-]+ call or a whole-repo pass/.test(tpl)
        && /skip verification if none exist/.test(tpl),
      `${name} lost the scoped-verification clause — a raw tsc/eslint call, even scoped to the changed package, still crashes the Agent0 runner on a large repo`);
  }

  const maxUrl = Number(/^const MAX_URL = (\d+)/m.exec(readFileSync(LINK_MOD, "utf8"))?.[1]);
  s.check("G32f MAX_URL stays under the 8k request-line cliff it was moved off",
    Number.isFinite(maxUrl) && maxUrl <= 4000,
    `MAX_URL is ${maxUrl} — 8000 is nginx's default one-buffer request-line limit (414), not a safe ceiling`);
}

// ── G33: the shape classifier — depth routing's deterministic core, EXECUTED ──
// classify-shape.mjs owns the high-stakes path list and the change-shape taxonomy that
// Step 1.2/1.2b route review depth on. The regression this guards: the hand-copied
// high-stakes jq regex in pr-reviewer.md shipped with an unmatched parenthesis, so every
// incremental delta triage threw at runtime — a prose-presence check cannot see that;
// only executing the code can.
{
  const readRepo = (p) => readFileSync(join(REPO_ROOT, p), "utf8");
  const CLS = join(REPO_ROOT, "agents/pr-reviewer/scripts/classify-shape.mjs");
  const FIX = join(REPO_ROOT, "scripts/eval/fixtures/delta-triage");
  s.check("G33a classify-shape.mjs exists", existsSync(CLS));

  const st = spawnSync("node", [CLS, "--self-test"], { encoding: "utf8" });
  s.check("G33b classifier self-test passes", st.status === 0,
    (st.stderr || "").split("\n").filter((l) => l.includes("FAIL")).join("; ").slice(0, 200));

  const run = spawnSync("node", [CLS, join(FIX, "pr-files.ndjson")], { encoding: "utf8" });
  s.check("G33c classifier accepts the NDJSON /tmp/pr-files.json shape", run.status === 0,
    (run.stderr || "").slice(0, 120));
  let cls = {};
  try { cls = JSON.parse(run.stdout || "{}"); } catch { /* asserted below */ }
  s.check("G33d fixture classifies auth as a risky high-stakes shape",
    Array.isArray(cls.shapes) && cls.shapes.includes("auth") && cls.risky === true
      && (cls.high_stakes_files || []).includes("src/auth/login.ts"),
    JSON.stringify(cls).slice(0, 160));

  const badRe = spawnSync("node", [CLS, join(FIX, "pr-files.ndjson"), "--extra-high-stakes", "("], { encoding: "utf8" });
  s.check("G33e an invalid --extra-high-stakes regex fails closed (non-zero, empty stdout)",
    badRe.status !== 0 && badRe.stdout === "");
  const badFlag = spawnSync("node", [CLS, join(FIX, "pr-files.ndjson"), "--nope"], { encoding: "utf8" });
  s.check("G33f an unknown flag fails closed (non-zero, empty stdout)",
    badFlag.status !== 0 && badFlag.stdout === "");

  // Single source: the agent body must not re-state the high-stakes alternation by hand —
  // that copy is what drifted into the broken regex. Any two high-stakes tokens joined by a
  // literal `|` is a regex being restated, whatever the order. (holistic-review.md keeps one
  // grep as the documented reference fallback for non-pr-reviewer callers; that is the one
  // allowed site.)
  s.check("G33g pr-reviewer.md carries no hand-copied high-stakes regex",
    !/\b(auth|billing|payments|migrations|infra|secrets)\|(auth|billing|payments|migrations|infra|secrets)\b/
      .test(readRepo("agents/pr-reviewer.md")));

  // A one-file PR's /tmp/pr-files.json is a SINGLE JSON object (valid JSON, not just valid
  // NDJSON) — the parse must treat it as one file entry, not a malformed wrapper. This is
  // the classifier's blocking regression from PR #146's own review.
  const one = spawnSync("node", [CLS, join(FIX, "one-file.ndjson")], { encoding: "utf8" });
  let oneCls = {};
  try { oneCls = JSON.parse(one.stdout || "{}"); } catch { /* asserted below */ }
  s.check("G33h a single-file PR classifies instead of failing the parse",
    one.status === 0 && Array.isArray(oneCls.shapes) && oneCls.shapes.includes("auth"),
    `status=${one.status} ${(one.stderr || "").slice(0, 80)}`);

  // Shell state does not persist between the agent's tool calls, so resolve() is defined at
  // BOTH call sites (Step 1.2 and Step 4a) with an edit-them-together note. This asserts the
  // two bodies have not drifted — the regression that shipped was defining it at only one.
  const resolves = [...readRepo("agents/pr-reviewer.md")
    .matchAll(/resolve\(\)\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1].replace(/\s+/g, " ").trim());
  s.check("G33i resolve() is defined at both call sites and the bodies are identical",
    resolves.length === 2 && resolves[0] === resolves[1],
    `found ${resolves.length} definition(s)${resolves.length === 2 && resolves[0] !== resolves[1] ? " that differ" : ""}`);
}

// ── G34: the defer-floor formula has one owner ──
// per-comment-confidence.md § Drop vs. defer floors the near-miss band at 50 (so sub-65
// severity tiers keep a non-empty band). Three restatements shipped a stale 65 floor;
// this pins the authority and bans the stale form everywhere it appeared.
{
  const readRepo = (p) => readFileSync(join(REPO_ROOT, p), "utf8");
  s.check("G34a per-comment-confidence floors the defer band at 50",
    /max\(threshold - 15, 50\)/.test(readRepo("agents/shared/rules/per-comment-confidence.md")));
  for (const f of ["agents/pr-reviewer.md", "agents/pr-reviewer/rules/diagnostic-surface.md", "CLAUDE.md"]) {
    s.check(`G34b ${f} carries no stale 65-floor restatement`,
      !/threshold\s*[−-]\s*15,\s*65/.test(readRepo(f)));
  }
}

// ── G35: Step 1.2b's executable delta-triage snippets actually run ──
// Same pattern as Check C: extract the EXACT idioms from the agent body and execute them
// against fixtures, so a syntax error or semantic regression in the shipped snippet fails
// here instead of at review time.
{
  const prm = readFileSync(join(REPO_ROOT, "agents/pr-reviewer.md"), "utf8");
  const FIX = join(REPO_ROOT, "scripts/eval/fixtures/delta-triage");

  // The intact-history compare extraction.
  const compareJq = /--jq '(\{\n\s*delta_lines:[\s\S]*?\n {2}\})'\)/.exec(prm)?.[1];
  s.check("G35a the compare-extraction jq program is extractable", !!compareJq);
  if (compareJq) {
    const r = spawnSync("jq", [compareJq], { input: readFileSync(join(FIX, "compare-intact.json"), "utf8"), encoding: "utf8" });
    s.check("G35b the compare jq runs clean (the shipped predecessor threw 'unmatched parenthesis')",
      r.status === 0, (r.stderr || "").slice(0, 160));
    let out = {};
    try { out = JSON.parse(r.stdout || "{}"); } catch { /* asserted below */ }
    s.check("G35c compare jq extracts delta_lines=8, new_files=1, files=2",
      out.delta_lines === 8 && out.new_files === 1 && Array.isArray(out.files) && out.files.length === 2,
      JSON.stringify({ delta_lines: out.delta_lines, new_files: out.new_files, files: out.files?.length }));
  }

  // The EXTRA_HS awk — review-config.md's own worked example annotates high_stakes_paths
  // entries with inline `#` comments, and the shipped extraction once passed the comment
  // text through as CLI arguments, killing the whole classification (PR #146 review round 3).
  const hsAwk = /awk '([^']*)' "\$HS_CFG"/.exec(prm)?.[1];
  s.check("G35g the high_stakes_paths awk program is extractable", !!hsAwk);
  if (hsAwk) {
    const r = spawnSync("awk", [hsAwk, join(FIX, "review.yaml")], { encoding: "utf8" });
    s.check("G35h the awk strips inline comments, quotes, and empty entries",
      r.status === 0 && r.stdout === " --extra-high-stakes (^|/)ledger(/|$) --extra-high-stakes packages/tenant-isolation/",
      `status=${r.status} out=${JSON.stringify(r.stdout)}`);
  }

  // The diverged-history blob-SHA authored delta.
  const blobJq = /jq -s --slurpfile prior \S+ '\n([\s\S]*?)' \\/.exec(prm)?.[1];
  s.check("G35d the blob-diff jq program is extractable", !!blobJq);
  if (blobJq) {
    const r = spawnSync("jq", ["-s", "--slurpfile", "prior", join(FIX, "tree-prior.json"), blobJq],
      { input: readFileSync(join(FIX, "pr-files.ndjson"), "utf8"), encoding: "utf8" });
    s.check("G35e the blob-diff jq runs clean", r.status === 0, (r.stderr || "").slice(0, 160));
    let files = [];
    try { files = JSON.parse(r.stdout || "[]"); } catch { /* asserted below */ }
    const names = files.map((f) => f.filename).sort();
    s.check("G35f blob diff keeps changed + added + REMOVED files and drops the identical blob",
      JSON.stringify(names) === JSON.stringify(["assets/logo.png", "src/legacy/cleanup.ts", "src/util.ts"]),
      JSON.stringify(names));
  }
}

// ── G36: the Fix-with-Agent0 scripts are never invoked by a bare relative path ──
// build-agent0-link.mjs must be resolved from $AGENT_MD the same way RENDER/CLASSIFY/POINTER
// already are — a bare `agents/pr-reviewer/scripts/build-agent0-link.mjs` only happens to
// resolve when the shell's cwd is this repo's own checkout, which silently breaks on a
// cross-repo dispatch (observed live: mthines/lorekit#318 still linked to app.dash0.com hours
// after both the base-config resolution and the --env-threading fixes had merged).
{
  const readRepo = (p) => readFileSync(join(REPO_ROOT, p), "utf8");
  // Matches only an actual invocation ("node <bare path>"), not the cautionary prose in these
  // same files that quotes the bad bare path as an example of what NOT to do.
  const BARE_INVOCATION = /node agents\/pr-reviewer\/scripts\/build-agent0-link\.mjs/;
  for (const f of ["agents/pr-reviewer.md", "agents/shared/rules/comment-shape.md"]) {
    s.check(`G36a ${f} never invokes build-agent0-link.mjs by a bare relative path`,
      !BARE_INVOCATION.test(readRepo(f)));
  }
  s.check("G36b pr-reviewer.md derives BUILD_LINK from the same $AGENT_MD as RENDER",
    /BUILD_LINK="\$\{AGENT_MD%\/pr-reviewer\.md\}\/pr-reviewer\/scripts\/build-agent0-link\.mjs"/.test(
      readRepo("agents/pr-reviewer.md")));
}

process.exit(s.report() ? 0 : 1);
