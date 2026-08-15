#!/usr/bin/env node
// L1 — Deterministic contract checks. No LLM, no network, no cost.
// These assert the *mechanical contracts* the skills promise. Run in CI.
//   node scripts/eval/l1.mjs
// Exits non-zero if any check fails.
import { execSync } from "node:child_process";
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
  for (const scope of ["aw-lessons", "aw-tester-lessons", "fix-bug-lessons", "batch-lessons", "reviewer-lessons", "implement-suggestion-lessons", "ci-auto-fix-lessons", "e2e-pr-stabilizer-lessons", "test-auto-fix-lessons", "ideate-lessons", "optimize-approach-lessons"]) {
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
      const found = [...content.matchAll(stale)]
        .map((m) => Number(m[1] ?? m[2] ?? m[3] ?? m[4]))
        // 30 is `review-outcomes`' own TTL, a different bucket that legitimately
        // co-occurs in these files; G12a owns it.
        .filter((n) => n !== TTL_DAYS && n !== 30);
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
      prReviewer.includes("Standards (2.4d)") &&
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
    s.check("G19a pr-reviewer.md has the PASS concise headline with an affirming checkmark lead",
      prReviewer.includes("✅ Reviewed your changes — no issues found."));

    s.check("G19b pr-reviewer.md has the WARN concise headline led by WARN_GATE_COUNT and naming the warned gates",
      prReviewer.includes("Reviewed your changes — no blocking issues, **<WARN_GATE_COUNT> warning(s)**: <WARN_REASONS>."));

    s.check("G19c pr-reviewer.md has the FAIL concise headline led by SEVERITY_TALLY and naming the blocking gates",
      prReviewer.includes("Reviewed your changes — **<SEVERITY_TALLY>** need attention before human review.") &&
      prReviewer.includes("Blocking: <FAIL_REASONS>."));

    // G19d: in every Step-4 template block, every '| Gate | Status' line appears AFTER
    // a '<summary>Review details' anchor — proving the table is inside the accordion,
    // never at the top level between the <!-- PR_REVIEWER_REPORT --> marker and the accordion.
    // Slices only the Step-4 region (after '### Review body format', before
    // '### INLINE_COMMENTS_JSON format') to avoid false-matching the Step-3 terminal
    // tables at lines 818/844/870.
    {
      // sliceBetween guards both anchors: a moved/deleted anchor throws a clear
      // error instead of a raw indexOf(-1) silently widening the slice.
      const step4      = sliceBetween(prReviewer, "### Review body format", "### INLINE_COMMENTS_JSON format");
      // Split on the opening PR_REVIEWER_REPORT marker to isolate each template block,
      // then keep only real template blocks — those carrying the 'Reviewed your changes'
      // headline. This drops the trailing prose (the Rules-for-table-cells section mentions
      // the marker and the '| Gate | Status | Details |' header in backticks, which must not
      // be mistaken for a top-level gate table).
      const blocks     = step4.split("<!-- PR_REVIEWER_REPORT -->").slice(1)
        .filter((b) => b.includes("Reviewed your changes"));
      // For each block: if a gate table row is present it must appear AFTER the
      // '<summary>Review details' line (i.e. inside the accordion).
      let allTablesInsideAccordion = blocks.length >= 3;
      for (const b of blocks) {
        const gatePos = b.indexOf("| Gate | Status");
        const diagPos = b.indexOf("<summary>Review details");
        // Gate table present but accordion comes after (or is absent) → table is at top level.
        if (gatePos !== -1 && (diagPos === -1 || gatePos < diagPos)) {
          allTablesInsideAccordion = false;
        }
      }
      s.check("G19d pr-reviewer.md Step-4 gate tables all appear inside the Review details accordion (not at top level)",
        allTablesInsideAccordion);

      // G19e: the review-body footer no longer carries the redundant CI-status sentence.
      // The clause was dropped from every FOOTER_LINE variant; assert it is gone from the
      // whole shipped file, not just Step 4 (the FOOTER_LINE definitions live in Step 4).
      s.check("G19e pr-reviewer.md review-body footer dropped the 'CI status is shown' clause",
        !prReviewer.includes("CI status is shown"));

      // G19f: the gate table is now three columns with a per-gate Details column that shows a
      // static description on a passing (✅) gate. Assert the '| Gate | Status | Details |'
      // header and at least one verbatim static description string are present in Step 4.
      s.check("G19f pr-reviewer.md Step-4 gate table is 3-column with a static description on ✅",
        step4.includes("| Gate | Status | Details |") &&
        step4.includes("The multi-lens review found no blocking issues."));

      // G19g: the '<sup>FOOTER_LINE</sup>' commit line renders INSIDE the accordion in every
      // Step-4 template block — after the '<summary>Review details' line and before the gate
      // table — never at the top level. Guards the requested move of the commit line into the
      // Review details block. Per block: FOOTER_LINE must sit between the summary and the table.
      let allFootersInsideAccordion = blocks.length >= 3;
      for (const b of blocks) {
        const diagPos   = b.indexOf("<summary>Review details");
        const footerPos  = b.indexOf("<sup>FOOTER_LINE</sup>");
        const gatePos   = b.indexOf("| Gate | Status");
        // Footer must be present, after the accordion summary, and before the gate table.
        if (footerPos === -1 || diagPos === -1 ||
            footerPos < diagPos || (gatePos !== -1 && footerPos > gatePos)) {
          allFootersInsideAccordion = false;
        }
      }
      s.check("G19g pr-reviewer.md Step-4 commit footer (FOOTER_LINE) renders inside the Review details accordion",
        allFootersInsideAccordion);
    }
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

// ── Check G22: every CI-watch invocation is bounded at BOTH levels ──
// The `diagnostic-surface.md` invariant "every wait on an external system is
// bounded" has two clauses, and checking only the first is the documented trap:
// an in-command `timeout 540` issued at the Bash tool's DEFAULT (120000 ms) is
// still killed before its own exit 124 fires, so the expiry handling is dead
// code and the run hangs. This asserts both, PER SITE:
//   (a) the command carries an inner `timeout N` with N < 600, and
//   (b) `600000` appears within PROXIMITY lines ABOVE that command — per site,
//       not per file, so a second site cannot free-ride on the first's mention.
// `references/` is excluded: those files quote the unbounded forms as examples
// of the bug being fixed.
{
  const WATCH = /^\s*(?:timeout\s+(\d+)\s+)?(?:gh\s+(?:pr\s+checks|run\s+watch)|bash\s+-c|PR_URL)\b/;
  // Three shapes count, matching the invariant's enumerated set: a `gh … --watch`,
  // a `bash -c` poll wrapper, and a bare fenced poll loop that sleeps (the shape
  // `implement-suggestion/rules/watch-mode.md` uses — previously invisible here,
  // which is how the system's highest-traffic wait went unguarded).
  const isWatch = (l) =>
    /gh\s+(?:pr\s+checks[^\n]*--watch|run\s+watch)/.test(l) ||
    /\bbash\s+-c\b/.test(l) ||
    /^\s*PR_URL=/.test(l);
  const files = [
    ...walk(join(REPO_ROOT, "skills")),
    ...walk(join(REPO_ROOT, "agents")),
  ].filter((f) => !f.includes("/references/"));

  const PROXIMITY = 6;
  const EXPECTED_SITES = 8; // pinned, not a floor — deleting a site must trip this.
  let sites = 0;
  for (const f of files) {
    const lines = readFileSync(f, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!isWatch(line) || !WATCH.test(line)) continue;
      // A `bash -c` wrapper counts only when it is genuinely a poll loop — a loop
      // keyword plus a sleep nearby. Without this the matcher would fail G22 on any
      // unrelated `bash -c` one-liner a future skill documents.
      if (/\bbash\s+-c\b/.test(line) && !/gh\s+(?:pr\s+checks|run\s+watch)/.test(line)) {
        const block = lines.slice(i, i + 12).join("\n");
        if (!/\b(until|while)\b/.test(block) || !/\bsleep\b/.test(block)) continue;
      }
      // A bare fenced poll loop has no wrapping `timeout`; its only bound is the tool
      // timeout plus an interval kept under it. Assert those two instead of an inner one.
      if (/^\s*PR_URL=/.test(line)) {
        const block = lines.slice(i, i + 20).join("\n");
        if (!/\bsleep\b/.test(block)) continue;
        sites++;
        s.check(`G22 ${rel(f)}:${i + 1} bare poll loop clamps its interval below the tool cap`,
          /INTERVAL\s*<=\s*540|clamped to .?540/.test(block) || /INTERVAL=([0-9]|[1-9][0-9]|[1-4][0-9]{2}|5[0-3][0-9]|540)\b/.test(block),
          "an INTERVAL above 540 s is killed by the harness before the loop's own bound fires");
        s.check(`G22 ${rel(f)}:${i + 1} declares the per-call tool timeout (600000) within ${PROXIMITY} lines`,
          lines.slice(Math.max(0, i - PROXIMITY), i).join("\n").includes("600000"),
          "a poll loop bounded only internally still dies at the 120000 ms tool default");
        continue;
      }
      sites++;
      const inner = line.match(WATCH)[1];
      s.check(
        `G22 ${rel(f)}:${i + 1} watch is bounded in-command (timeout N, N < 600)`,
        inner !== undefined && Number(inner) < 600,
        inner === undefined ? `unbounded: ${line.trim()}` : `timeout ${inner} >= harness cap`,
      );
      s.check(
        `G22 ${rel(f)}:${i + 1} declares the per-call tool timeout (600000) within ${PROXIMITY} lines`,
        lines.slice(Math.max(0, i - PROXIMITY), i).join("\n").includes("600000"),
        "an inner timeout alone still dies at the 120000 ms tool default",
      );
    }
  }
  s.check(`G22 guards exactly ${EXPECTED_SITES} CI-watch sites`,
    sites === EXPECTED_SITES, `found ${sites}`);
}

process.exit(s.report() ? 0 : 1);
