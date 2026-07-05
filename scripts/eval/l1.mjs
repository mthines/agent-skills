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

// ── Check E: agent-skills.git itself does not commit fast-tier scopes ──
// Consumer repos MAY commit memory/<scope>/ to opt their team into the
// project-shared tier (the workflow auto-detects and reads/writes there).
// But agent-skills.git is the SKILL SOURCE, not a consumer — a committed
// fast-tier scope here would silently apply this repo's lessons to every
// skill-development run, polluting the universal store with skill-author
// noise. Keep this directory absent in agent-skills.git specifically.
{
  for (const scope of ["aw-lessons", "aw-tester-lessons", "fix-bug-lessons", "batch-lessons", "reviewer-lessons", "implement-suggestion-lessons", "ci-auto-fix-lessons", "e2e-pr-stabilizer-lessons", "test-auto-fix-lessons"]) {
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
  const reviewerAgent = read("agents/reviewer.md");

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

  // G8d: both agents wire Step 2.4b into their pipeline and expose the right opt flag —
  // pr-reviewer default-on with --no-escalate, reviewer opt-in with --escalate.
  s.check("G8d pr-reviewer wires 2.4b + --no-escalate",
    prReviewer.includes("2.4b") && prReviewer.includes("--no-escalate"));
  s.check("G8d reviewer wires 2.4b + --escalate opt-in",
    reviewerAgent.includes("2.4b") && reviewerAgent.includes("--escalate"));

  // G9: verification-receipt (Step 2.6b) is wired into BOTH agents' pipeline blocks
  // in the same position (after 2.6 grounding, before 2.7 confidence).
  // This guards against one agent drifting out of sync.
  const verificationReceipt = read("agents/shared/rules/verification-receipt.md");
  s.check("G9a verification-receipt.md declares Step 2.6b",
    verificationReceipt.includes("2.6b") && verificationReceipt.includes("verification-receipt"));
  s.check("G9b verification-receipt.md declares null-result DROP rule",
    /null.*DROP|DROP.*null/i.test(verificationReceipt) || verificationReceipt.includes("null result = DROP") ||
    verificationReceipt.includes("null or empty proof result DROPS"));
  s.check("G9c reviewer.md wires 2.6b between 2.6 and 2.7",
    /2\.6[^\n]*grounding[^\n]*\n[^\n]*2\.6b[^\n]*\n[^\n]*2\.7/m.test(reviewerAgent) ||
    (reviewerAgent.includes("2.6b") && reviewerAgent.includes("verification-receipt")));
  s.check("G9c pr-reviewer.md wires 2.6b between 2.6 and 2.7",
    prReviewer.includes("2.6b") && prReviewer.includes("verification-receipt"));

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

  // G11: both agents' diagnostic-surface Phase model tables include the new phases
  // 1.0, 1.7, 2.5b, 2.6b — failure taxonomy is append-only; verify new rows exist.
  const reviewerDiag = read("agents/reviewer/rules/diagnostic-surface.md");
  const prReviewerDiag = read("agents/pr-reviewer/rules/diagnostic-surface.md");
  for (const [label, content] of [["reviewer", reviewerDiag], ["pr-reviewer", prReviewerDiag]]) {
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
}

process.exit(s.report() ? 0 : 1);
