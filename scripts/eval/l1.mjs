#!/usr/bin/env node
// L1 — Deterministic contract checks. No LLM, no network, no cost.
// These assert the *mechanical contracts* the skills promise. Run in CI.
//   node scripts/eval/l1.mjs
// Exits non-zero if any check fails.
import { execSync, spawnSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { REPO_ROOT, walk, headingSlugs, links, frontmatter, rel, sliceBetween, extractSection, Suite } from "./lib.mjs";

const AW = join(REPO_ROOT, "skills/workflow/autonomous-workflow");
const s = new Suite("L1 deterministic contract checks");

// Every report-body fixture, discovered from disk rather than listed. G25/G26/G27 each iterate
// the fixtures, and an explicit list meant a new fixture was silently exempt from all three —
// the guards would have kept passing while the reference rendering it locks in went unchecked.
// A fixture is `<name>.json` + `<name>.expected.md`; the presence checks below catch a half-pair.
const REPORT_FIXTURES = (() => {
  const dir = join(REPO_ROOT, "scripts/eval/fixtures/report-body");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, "")).sort();
})();

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

// ── Check B / G2b: the tier-detection table has exactly ONE home ──
// Until v3.23 the dispatcher was an agent, which boots cold and so carried its
// own inline copy of the table; this check compared the two copies byte-for-byte.
// The dispatcher is now the `aw` SKILL, which runs in the caller's context with
// SKILL.md already loaded — so the second copy buys nothing and can only rot.
// The guard inverts accordingly: assert the canonical table still exists, and
// that the dispatcher did not silently re-fork it.
function tierQuestions(file) {
  // pull the decision rows from the first markdown table whose rows mention Full/Lite/Micro
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => /^\|\s*\d\s*\|/.test(l) && /\*\*(Full|Lite|Micro)\*\*/.test(l))
    .map((l) => l.replace(/\s+/g, " ").trim());
}
{
  const canonical = tierQuestions(join(AW, "SKILL.md"));
  s.check("G2b tier table present in SKILL.md Step 1 (canonical)", canonical.length >= 4,
    `${canonical.length} decision rows`);

  const dispatcher = tierQuestions(join(AW, "aw/SKILL.md"));
  s.check("G2b aw dispatcher does not duplicate the tier table", dispatcher.length === 0,
    dispatcher.length ? `${dispatcher.length} tier rows re-forked into aw/SKILL.md` : "single source of truth");

  // The dispatcher must still POINT at the canonical table, or "no copy" would
  // pass trivially on a dispatcher that forgot tier detection altogether.
  const body = readFileSync(join(AW, "aw/SKILL.md"), "utf8");
  s.check("G2b aw dispatcher links the canonical tier table",
    /\.\.\/SKILL\.md#step-1-detect-workflow-mode-mandatory/.test(body),
    "expected a link to ../SKILL.md#step-1-detect-workflow-mode-mandatory");
}

// ── Check B2 / G2c: prose agent counts ≡ what install.sh actually links ──
// The v3.23 dispatcher conversion moved `aw` out of the agent set, and the
// resulting "how many aw- agents are there" claim went wrong three times across
// two review rounds — each fix corrected the flagged line and left a twin, in a
// different file, saying the other number. The count is mechanically derivable
// from the installer, so derive it and make every prose claim answer to it.
//
// `aw` is deliberately NOT in the population: it is a skill, has no `aw-`
// prefix, and is linked into skills/ rather than agents/. That distinction is
// exactly what the prose kept losing.
{
  const installer = readFileSync(join(AW, "install.sh"), "utf8");
  const linked = [...installer.matchAll(/ln -sf[n]?\s+\S+\s+"\$CLAUDE_DIR\/agents\/(aw-[a-z]+)\.md"/g)]
    .map((m) => m[1]);
  const truth = new Set(linked);

  s.check("G2c install.sh links a discoverable set of aw- agents", truth.size >= 2,
    truth.size ? [...truth].join(", ") : "no `ln -sf` into agents/aw-*.md found");

  // Every agent the installer links must be inventoried in the root CLAUDE.md
  // generated-from-templates list, or `agents/` stays the wrong place to look.
  const rootClaude = readFileSync(join(REPO_ROOT, "CLAUDE.md"), "utf8");
  const uninventoried = [...truth].filter((a) => !new RegExp("^- `" + a + "`", "m").test(rootClaude));
  s.check("G2c every installed aw- agent is inventoried in CLAUDE.md",
    uninventoried.length === 0,
    uninventoried.length ? `missing: ${uninventoried.join(", ")}` : `${truth.size} inventoried`);

  // Now the counts. Three phrasings carry the claim across the docs; each is
  // anchored on something that pins it to the aw- set specifically, so an
  // unrelated "agents" sentence elsewhere in these files is not swept in.
  const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  const toNum = (w) => (/^\d+$/.test(w) ? Number(w) : WORDS[w.toLowerCase()]);
  const CLAIMS = [
    // "the three `aw-` agents", "links three `aw-` agents"
    /(\w+)\s+`aw-`\s+agents/g,
    // "Plus three agents linked into", "three agents installed"
    /(\w+)\s+agents\s+(?:linked|installed)/g,
    // "a dispatcher, three agents, eight phases"
    /dispatcher(?:\s+skill)?,\s+(\w+)\s+agents/g,
  ];
  const SURFACES = [
    ["README.md", readFileSync(join(REPO_ROOT, "README.md"), "utf8")],
    ["autonomous-workflow/README.md", readFileSync(join(AW, "README.md"), "utf8")],
    ["autonomous-workflow/install.sh", installer],
  ];
  const wrong = [];
  let claimsSeen = 0;
  for (const [label, text] of SURFACES) {
    for (const re of CLAIMS) {
      for (const m of text.matchAll(re)) {
        const n = toNum(m[1]);
        if (n === undefined) continue;   // "the `aw-` agents" etc. — not a count
        claimsSeen++;
        if (n !== truth.size) wrong.push(`${label}: "${m[0].trim()}" (linked: ${truth.size})`);
      }
    }
  }
  s.check("G2c prose aw- agent counts match the installer", wrong.length === 0,
    wrong.length ? wrong.join(" | ") : `${claimsSeen} count claims agree on ${truth.size}`);

  // Sentinel: if the phrasings drift, the check above passes vacuously.
  s.check("G2c found the aw- agent count claims to guard", claimsSeen >= 5, `found ${claimsSeen}`);
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
    // `export ` must be tolerated too: the decline logic now lives in exported pure
    // deciders, and a pattern anchored on a bare `function` silently returned "" for
    // each of them — which reads as "the call is missing" rather than "the guard cannot
    // see the function", the same false-green shape the async fix above closed.
    const FN_START = "^(?:export\\s+)?(?:async\\s+)?function";
    const fnBody = (name) => {
      const i = rec.search(new RegExp(`${FN_START} ${name}\\(`, "m"));
      if (i < 0) return "";
      const rest = rec.slice(i + 1);
      const j = rest.search(new RegExp(`${FN_START} \\w+\\(`, "m"));
      return j < 0 ? rec.slice(i) : rec.slice(i, i + 1 + j);
    };
    // Decline detection moved out of the two mode functions and into the pure deciders
    // they call, so asserting the call site inside each mode body no longer proves
    // anything. Assert the whole path instead — each mode delegates, and each decider
    // it delegates to applies the matcher. Four assertions where there were two: a
    // decider that drops the matcher fails, and so does a mode that stops delegating.
    s.check("G24f both deciders apply decline detection",
      /hasWontFixReply\s*\(/.test(fnBody("decideResolvedThread")) &&
      /hasWontFixReply\s*\(/.test(fnBody("decideMergeSweep")));
    s.check("G24f both script modes delegate to the decider that applies it",
      /decideResolvedThread\s*\(/.test(fnBody("modeThreadResolved")) &&
      /decideMergeSweep\s*\(/.test(fnBody("modePrMerged")));

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
        90,  // `codebase-knowledge` — symbol + hotspot records; G16g below owns it.
      ]);
      const found = [...content.matchAll(stale)]
        .map((m) => Number(m[1] ?? m[2] ?? m[3] ?? m[4]))
        .filter((n) => n !== TTL_DAYS && !OTHER_BUCKET_TTLS.has(n));
      s.check(`G16f ${label} carries no reviewer-comment-relevance TTL other than ${TTL_DAYS}`,
        found.length === 0, found.length ? `stale: ${[...new Set(found)].join(", ")}` : "");
    }

    // G16g owns the OTHER durable TTL in the same file. Excusing 90 in G16f without an
    // owning check would let the knowledge TTL drift freely under cover of the excuse.
    const KNOWLEDGE_TTL_DAYS = 90;
    const buckets = read("agents/shared/rules/memory-buckets.md");
    s.check(`G16g record-comment-relevance.mjs computes the knowledge/hotspot expiry from ${KNOWLEDGE_TTL_DAYS} days`,
      recorder.includes(`KNOWLEDGE_TTL_MS = ${KNOWLEDGE_TTL_DAYS} * 24 * 60 * 60 * 1000`));
    s.check(`G16g memory-buckets.md states the knowledge/hotspot lifetime as ${KNOWLEDGE_TTL_DAYS}d`,
      new RegExp(`codebase-knowledge\`? \\(symbol\\)[^\n]*durable ${KNOWLEDGE_TTL_DAYS}d`).test(buckets) &&
      new RegExp(`codebase-knowledge\`? \\(hotspot\\)[^\n]*durable ${KNOWLEDGE_TTL_DAYS}d`).test(buckets));
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
      // The posted-body label dropped its step number when the accordion was grouped
      // (`**Standards (2.4d)** —` → `Standards — ` under the `Found` heading), so match the
      // current label there and the step reference in the agent body. Either surface satisfies it;
      // the assertion is that a standards run-state line EXISTS, not what it is called.
      (prReviewer.includes("Standards conformance (2.4d)")
        || read("agents/pr-reviewer/rules/report-rendering.md").includes("`Standards — `")) &&
      /Precedence: when a standards finding conflicts with the PR author's stated intent or a review-config\s+explicit override, the author-intent and config \*\*win\*\*/.test(prReviewer) &&
      // The diagnostics counter lives in whichever surface renders the log block: the terminal
      // template (now terminal-report.md) or the posted-body reference. Accept either — the
      // assertion is that the counter EXISTS, not which file it moved to.
      (prReviewer.includes("Conflicts surfaced:")
        || read("agents/pr-reviewer/rules/terminal-report.md").includes("Conflicts surfaced:")));

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
    // G19a-c: the three headline forms. They used to be three prose sentences the run composed
    // and the renderer accepted unchecked, which is how a headline matching none of them shipped;
    // they are now derived shapes, so the checks assert the RENDERED forms against the real
    // renderer and the doc that specifies them, not a prose literal.
    s.check("G19a the PASS form is a heading with an affirming checkmark lead",
      reportRendering.includes("`### ✅ No issues found`"));

    s.check("G19b the zero-finding non-PASS form names the gate count",
      reportRendering.includes("`### <verdict glyph> No findings — <M> gates need attention`"));

    s.check("G19c the with-findings form leads with the count and the blocking subset",
      reportRendering.includes("`### <worst-tier glyph> <N> findings — <K> blocking`")
      && /never rendered as `0 blocking`/.test(reportRendering));

    // Every form the doc specifies must be reachable from the renderer, and every form the
    // renderer emits must be specified. Executed against the real script, because a spec/impl
    // agreement asserted by reading only the spec is the exact gap this replaces.
    {
      const RENDER = join(REPO_ROOT, "agents/pr-reviewer/scripts/render-report.mjs");
      const FIX = join(REPO_ROOT, "scripts/eval/fixtures/report-body");
      const base = JSON.parse(readFileSync(join(FIX, "pass.json"), "utf8"));
      const render = (fn) => {
        const c = structuredClone(base); fn(c);
        const r = spawnSync("node", [RENDER], { input: JSON.stringify(c), encoding: "utf8" });
        return { ok: r.status === 0, out: r.stdout || "", err: (r.stderr || "").trim() };
      };
      const passForm = render(() => {});
      s.check("G19a the renderer emits the PASS form", passForm.ok
        && /^### ✅ No issues found$/m.test(passForm.out), passForm.err);
      const warnForm = render((c) => {
        c.VERDICT = "WARN"; c.GATE_DOCS_STATUS = "⚠️"; c.GATE_DOCS_DETAILS = "x";
        c.WARN_REASONS = ["1 doc gap"];
      });
      s.check("G19b the renderer emits the zero-finding non-PASS form", warnForm.ok
        && /^### ⚠️ No findings — 1 gate needs? attention$/m.test(warnForm.out), warnForm.err);
      const withFindings = render((c) => {
        c.QUALITY = "produced 3 → posted inline 2 · cleared 2 · carried forward 0 · deferred 0 · below-bar 0";
        c.FINDINGS = [
          { title: "A blocking finding", path: "a.ts", line: 1, tier: "high", blocking: true },
          { title: "A quieter one", path: "b.ts", line: 2, tier: "low" },
        ];
      });
      s.check("G19c the renderer emits the with-findings form", withFindings.ok
        && /^### 🟠 2 findings — 1 blocking$/m.test(withFindings.out), withFindings.err);
      // `0 blocking` is never rendered — the clause is dropped, not zero-filled.
      const noBlocking = render((c) => {
        c.QUALITY = "produced 3 → posted inline 1 · cleared 1 · carried forward 0 · deferred 0 · below-bar 0";
        c.FINDINGS = [{ title: "A quieter one", path: "b.ts", line: 2, tier: "low" }];
      });
      s.check("G19c the renderer drops the blocking clause at zero", noBlocking.ok
        && /^### ⚪ 1 finding$/m.test(noBlocking.out) && !/0 blocking/.test(noBlocking.out),
        noBlocking.err);
    }

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
    // The template moved out of the agent body into terminal-report.md; the agent body keeps the
    // routing line. Read the surface that actually owns the verdict rows, and assert the agent
    // still routes to it — otherwise a future move could orphan these three checks silently.
    const terminalReport = readFileSync(join(REPO_ROOT, "agents/pr-reviewer/rules/terminal-report.md"), "utf8");
    s.check("G33 pr-reviewer.md routes Step 3 to terminal-report.md",
      prReviewer.includes("pr-reviewer/rules/terminal-report.md"),
      "Step 3 no longer names the file that owns the terminal template");
    const step3WarnRow = sliceBetween(terminalReport, "| Presentation | `**Verdict**` line |", "`VERDICT` (PASS/WARN/FAIL");
    s.check("G33a terminal-report.md Step 3 WARN verdict line carries no bare PASS token",
      !/\|\s*WARN\s*\|\s*`PASS\s*—/.test(step3WarnRow),
      "Step 3's WARN row still prints a `PASS —` verdict, which contradicts a harness VERDICT: FAIL");
    s.check("G33b terminal-report.md Step 3 WARN verdict line matches the posted-body wording",
      /No blocking issues — <WARN_GATE_COUNT> warning\(s\): <WARN_REASONS>\./.test(step3WarnRow),
      "Step 3's WARN row no longer reads 'No blocking issues — <N> warning(s): <reasons>.' — re-sync it with report-rendering.md § Headlines");
    s.check("G33c report-rendering.md's posted-body WARN headline carries no bare PASS token",
      !/no blocking issues.*\*\*PASS\*\*|PASS\s*—\s*no blocking issues/i.test(reportRendering),
      "report-rendering.md's WARN headline regained a PASS token");
    // The two surfaces now count different things on purpose — the posted headline counts
    // FINDINGS, this line counts gates — so the old assertion (a `byte-identical` claim next to a
    // `report-rendering.md` reference) would now enforce a coupling that is itself the bug: it is
    // what made the posted headline count gates. What must still agree is the FACT, so assert the
    // cross-reference plus the named shared values, and assert the retired claim is gone.
    s.check("G33d terminal-report.md's WARN row cites report-rendering.md so the two cannot drift silently",
      /report-rendering\.md/.test(terminalReport)
      && /verdict token[\s\S]{0,200}reason phrases/.test(terminalReport),
      "terminal-report.md's Step 3 WARN explanation no longer cross-references report-rendering.md,"
      + " or no longer names the verdict token and reason phrases as the values that must agree");
    s.check("G33d the retired byte-identity coupling is not re-asserted",
      /byte-identity rule this paragraph used to state/.test(terminalReport)
      && !/must stay \*\*byte-identical\*\*/.test(terminalReport),
      "a byte-identity claim between the terminal line and the posted headline is back");
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
    for (const name of REPORT_FIXTURES) {
      const payload = join(FIX, `${name}.json`);
      const expectedPath = join(FIX, `${name}.expected.md`);
      if (!existsSync(payload) || !existsSync(expectedPath)) {
        s.check(`G25 ${name} fixture + snapshot present`, false, "missing fixture or snapshot");
        continue;
      }
      const r = run([payload]);
      s.check(`G25 ${name}.json renders without error`, r.ok, r.err);
      const expected = readFileSync(expectedPath, "utf8");
      let diffDetail = "";
      if (r.out !== expected) {
        let i = 0;
        const min = Math.min(r.out.length, expected.length);
        while (i < min && r.out[i] === expected[i]) i++;
        const ctx = (s2, at) => JSON.stringify(s2.slice(Math.max(0, at - 20), at + 20));
        diffDetail = `output drifted — regenerate the snapshot and review the diff (lengths`
          + ` ${r.out.length} vs ${expected.length}, first diff at index ${i}: got`
          + ` ${ctx(r.out, i)} want ${ctx(expected, i)})`;
      }
      s.check(`G25 ${name} output matches its committed snapshot`, r.out === expected, diffDetail);
    }

    // (b) Structural invariants on every snapshot. These are what the five failed runs broke.
    for (const name of REPORT_FIXTURES) {
      const p = join(FIX, `${name}.expected.md`);
      if (!existsSync(p)) continue;
      const body = readFileSync(p, "utf8");
      s.check(`G25 ${name} carries the report marker`, body.includes("<!-- PR_REVIEWER_REPORT -->"));
      s.check(`G25 ${name} has a Review details accordion`,
        /<details>\n<summary>Review details/.test(body));
      s.check(`G25 ${name} pre-expands nothing`, !body.includes("<details open>"));
      s.check(`G25 ${name} carries no **Verdict** line`, !body.includes("**Verdict**"));
      // The report is the ONE surface that carries the methodology link; G46e asserts its
      // absence inline. Named here rather than left to the snapshot byte-diff, because a
      // regenerated snapshot updates silently and both halves of an asymmetry need a guard
      // that says which direction it points (`comment-shape.md § The footer`).
      s.check(`G25 ${name} carries the methodology link (report-only)`,
        body.includes("[how these findings are produced]"),
        "the report owns this link once per review; inline findings carry the identity half only");
      // Nothing the accordion owns may render above the first <details>.
      const head = body.split("<details>")[0];
      for (const owned of ["| Gate | Status | Details |", "**Needs attention**", "**Found**",
        "**Run**", "<sup>Nothing to report \u2014"]) {
        s.check(`G25 ${name} keeps ${owned} inside the accordion`, !head.includes(owned));
      }
    }

    // (c) Fail-closed. Each of these once shipped as a real posted report; the renderer must
    // refuse them, and must print NOTHING on stdout so a piping caller cannot post a fragment.
    const base = JSON.parse(readFileSync(join(FIX, "pass.json"), "utf8"));
    const mutate = (fn) => { const c = structuredClone(base); fn(c); return JSON.stringify(c); };
    const rejects = [
      ["a missing required slot", mutate((c) => { delete c.SUMMARY; })],
      // The verdict is cross-checked against the gate table it sits above. A `reviewer-lessons`
      // entry records a posted report whose gate table read PASS while the run's own contract said
      // FAIL; the gates decide, so a disagreement is a rejection rather than a rendered
      // contradiction.
      ["a VERDICT that contradicts the gate table",
        mutate((c) => { c.GATE_DOCS_STATUS = "❌"; c.GATE_DOCS_DETAILS = "no docs"; })],
      // The findings index and the QUALITY tally are the same number stated twice.
      ["a findings index that disagrees with the QUALITY tally", mutate((c) => {
        c.FINDINGS = [{ title: "A finding", path: "a.ts", line: 1, tier: "high" }];
      })],
      // A tier is an enum, not prose: the glyph is looked up from it.
      ["a findings entry with an unknown tier", mutate((c) => {
        c.QUALITY = "produced 3 → posted inline 1 · cleared 1 · carried forward 0 · deferred 0 · below-bar 0";
        c.FINDINGS = [{ title: "A finding", path: "a.ts", line: 1, tier: "urgent" }];
      })],
      // A pipe in a title splits the index row into phantom columns.
      ["a findings title carrying a table pipe", mutate((c) => {
        c.QUALITY = "produced 3 → posted inline 1 · cleared 1 · carried forward 0 · deferred 0 · below-bar 0";
        c.FINDINGS = [{ title: "A | B", path: "a.ts", line: 1, tier: "high" }];
      })],
      // Zero findings and no CI note means the Fix-all button would hand Agent0 an empty worklist.
      ["a Fix-all button with nothing to fix", mutate((c) => {
        c.FIX_ALL_URL = "https://app.dash0.com/goto/agent0?auto_submit=true";
      })],
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
        r.out.includes("Memories — 53 indexed · 1 used"));
    }

    // A zero-delta run parses under the same {mode, delta_lines} grammar as every other mode,
    // and the footer — not the Run mode line — is what still names the zero-delta shape.
    {
      const r = run([], mutate((c) => {
        c.RUN = { mode: "zero-delta", sha: "bde3c2f", prior_sha: "70cf147", at: "2026-08-15T09:12:00Z" };
      }));
      s.check("G25 a zero-delta run renders", r.ok, r.err);
      s.check("G25 zero-delta parses as {incremental, 0}",
        /^incremental · 0 lines in delta$/m.test(r.out));
      s.check("G25 zero-delta keeps its footer form",
        r.out.includes("commit `bde3c2f` · no code changes since `70cf147`, gate checks only"));
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
          const line = (b.match(/^<sup>`pr-reviewer` · commit[^\n]*<\/sup>$/m) || [""])[0];
          const all = [...line.matchAll(/commit `([0-9a-f]{7})`/g)];
          return all.length ? { sha: all[all.length - 1][1] } : null;
        },
        "Run mode": (b) => {
          // One shape for every mode, zero-delta included — it renders `incremental · 0 lines in
          // delta`, so there is no second alternative to carry. The `**Run mode**` label is gone:
          // the `**Run**` group heading carries it and the line's own shape is the anchor.
          const m = b.match(/^(full|incremental|incremental-quick) · (\d+) lines in delta/m);
          return m ? { mode: m[1], delta_lines: Number(m[2]) } : null;
        },
        "Headline": (b) => {
          const lines = b.split("\n").filter((l) => l.trim() !== "");
          const i = lines.findIndex((l) => !l.startsWith("<!--") && !l.startsWith("⚠️ **Partial review"));
          return i !== -1 && lines[i].length > 0 ? { headline: lines[i] } : null;
        },
      };
      // Sections that only appear on some fixtures: assert they parse WHERE PRESENT.
      const CONDITIONAL = {
        "Additional findings": [/<summary>(\d+) more findings — verified, too minor to comment on<\/summary>/,
          /^- (?:\[)?`[^`]+`(?:\]\([^)]+\))? — \w+: .+ \(confidence \d+\)$/m],
        "Low-confidence findings": [/<summary>Less certain \((\d+)\) — advisory, below the confidence bar<\/summary>/,
          /^- (?:\[)?`[^`]+`(?:\]\([^)]+\))? — \w+: .+ \(confidence \d+\)$/m],
        "Optimality cards": [/<summary>Is there a better approach\? \((\d+)\)<\/summary>/,
          /^### Optimality proposal — \S+:\d+$/m],
        "Partial-review banner": [/⚠️ \*\*Partial review — tool budget exhausted after \d+ calls; \d+ of \d+ files scanned\.\*\*/, null],
      };
      for (const name of REPORT_FIXTURES) {
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
        // A collapsible lens renders EITHER its own labelled line in a group OR one entry in the
        // `Nothing to report` footnote — never both, and never neither. Both would say the same
        // thing twice; neither would silently drop a lens's run-state, which is the failure the
        // old always-render shape traded vertical space to avoid.
        const footnote = (body.match(/^<sup>Nothing to report — (.+)\.<\/sup>$/m) || [, ""])[1];
        for (const [lens, lineRe, token] of [
          ["Standards log", /^Standards — (ran|skipped)/m, "standards"],
          ["Optimality log", /^Optimality — (ran|skipped)/m, "optimality"],
          ["Integrations", /^Integrations — \S/m, "integrations"],
          ["Skipped files", /^Skipped files — \S/m, "files skipped"],
          ["Severity", /^Severity — \S/m, "severity"],
        ]) {
          const asLine = lineRe.test(body);
          const asFootnote = footnote.includes(token);
          s.check(`G25 round-trip: ${name} — "${lens}" renders as a line xor a footnote entry`,
            asLine !== asFootnote, `line=${asLine} footnote=${asFootnote} (footnote: ${footnote})`);
        }
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
    for (const name of REPORT_FIXTURES) {
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

    // (i2) The grouped accordion. Nine flat `**Label** — value` lines became three groups, and
    // three properties of that shape are load-bearing rather than cosmetic: the group headings
    // are the only bold lines left inside the accordion (so the eye lands on them), the
    // attention heading asserts something and therefore must not appear over an all-✅ table,
    // and a run caveat gets its own ⚠️ line instead of riding at the tail of the densest line.
    {
      const tpl = readFileSync(join(REPO_ROOT, "agents/pr-reviewer/templates/report-body.md"), "utf8");
      for (const slot of ["{{#NEEDS_ATTENTION}}**Needs attention**", "**Found**\n\n{{FOUND_LINES}}",
        "**Run**\n\n{{RUN_LINES}}", "<sup>Nothing to report — {{NOTHING_TO_REPORT}}.</sup>"]) {
        s.check(`G25 the template carries ${slot.split("\n")[0]}`, tpl.includes(slot));
      }
      // The pre-grouping labels must not come back: they are what the grouping replaced, and a
      // template carrying both shapes would render every line twice.
      for (const gone of ["**Run mode**", "**Memories**", "**Quality**", "**Integrations**",
        "**Optimality (2.4c)**", "**Standards (2.4d)**", "**Skipped files** —"]) {
        s.check(`G25 the template no longer carries the flat label ${gone}`, !tpl.includes(gone));
      }

      // `Needs attention` tracks the five gate rows, and only them. CI is excluded on purpose:
      // Gate 2 is informational-in-`Run`, so a red build must not label the gate table.
      const allPass = run([join(FIX, "pass.json")]);
      s.check("G25 an all-✅ gate table renders no attention heading",
        allPass.ok && !allPass.out.includes("**Needs attention**"), allPass.err);
      // The verdict travels with the gate change: the renderer now rejects a VERDICT that
      // contradicts the table, so a ⚠️ gate implies WARN and the payload has to say so.
      const oneWarn = run([], mutate((c) => {
        c.GATE_DOCS_STATUS = "⚠️"; c.GATE_DOCS_DETAILS = "x";
        c.VERDICT = "WARN"; c.WARN_REASONS = ["1 doc gap"];
      }));
      s.check("G25 one ⚠️ gate renders the attention heading",
        oneWarn.ok && oneWarn.out.includes("**Needs attention**"), oneWarn.err);
      // Red CI is informational-in-`Run` and never raises the verdict — it has no row in the gate
      // table and never contributes to `warning`, so an all-✅ payload with a red CI_NOTE stays a
      // clean PASS end to end.
      const ciOnly = run([], mutate((c) => {
        c.CI_NOTE = "2 checks red on `bde3c2f`.";
      }));
      s.check("G25 red CI alone renders the clean PASS headline — Gate 2 is informational, never a gate",
        ciOnly.ok && !ciOnly.out.includes("**Needs attention**")
          && /^### ✅ No issues found$/m.test(ciOnly.out), ciOnly.err);

      // RUN_ANOMALY owns its own line; the renderer owns the glyph.
      const anom = run([], mutate((c) => { c.RUN_ANOMALY = "a base-branch merge polluted the compare range"; }));
      s.check("G25 RUN_ANOMALY renders on its own ⚠️ line",
        anom.ok && /^⚠️ a base-branch merge polluted the compare range$/m.test(anom.out), anom.err);
      for (const [why, payload] of [
        ["a RUN_NOTE carrying a ⚠️", mutate((c) => { c.RUN_NOTE = "⚠️ compare range polluted"; })],
        ["a RUN_ANOMALY supplying its own glyph", mutate((c) => { c.RUN_ANOMALY = "⚠️ compare range polluted"; })],
      ]) {
        const r = run([], payload);
        s.check(`G25 the renderer rejects ${why}`, !r.ok && r.out === "", `exit ok=${r.ok}`);
      }

      // The xor above is asserted on the committed snapshots, so it only fires once a snapshot is
      // regenerated. Assert both directions against a LIVE render too, so a renderer change that
      // stops collapsing (or stops rendering) is caught before the snapshots are touched.
      const noisy = run([], mutate((c) => { c.STANDARDS_LOG = "ran · 2 docs · 3 finding(s)"; }));
      s.check("G25 a standards lens with findings renders its own line, not a footnote entry",
        noisy.ok && /^Standards — ran · 2 docs · 3 finding\(s\)$/m.test(noisy.out)
          && !/Nothing to report —[^\n]*standards/.test(noisy.out), noisy.err);
      const hushed = run([], mutate((c) => { c.STANDARDS_LOG = "ran · 2 docs · 0 finding(s)"; }));
      s.check("G25 a standards lens with nothing to say collapses to a footnote entry",
        hushed.ok && !/^Standards — /m.test(hushed.out)
          && /Nothing to report —[^\n]*standards \(2 docs\)/.test(hushed.out), hushed.err);
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
        // Anchored on the invariant half of the sentence, never the count: the count changes every
        // time an assertion is added, and a stale anchor CRASHES the whole run rather than failing
        // one check (`sliceBetween` throws), which surfaces as zero checks and no `✗` line at all.
        "things on `REPORT_BODY` immediately before the write",
        "On any `abort`: post no report object");
      const fence = preWrite.match(/```bash\n([\s\S]*?)```/);
      s.check("G25 the pre-write assertion block is extractable", !!fence);
      if (fence) {
        const script = `abort() { printf 'ABORT: %s\\n' "$*"; exit 3; }\n${fence[1]}\nexit 0\n`;
        const good = spawnSync("node", [join(REPO_ROOT, "agents/pr-reviewer/scripts/render-report.mjs"),
          join(REPO_ROOT, "scripts/eval/fixtures/report-body/warn.json")], { encoding: "utf8" }).stdout;
        // AGENT_SUPPORT is what the block resolves the shared checker through, so the extracted
        // block runs the REAL comment-spine.mjs rather than failing on an unset path. Without it
        // the `node` call errors and every case below aborts for the wrong reason — which is how
        // this omission was caught.
        const runAssert = (body) =>
          spawnSync("bash", ["-c", script], {
            env: { ...process.env, REPORT_BODY: body, AGENT_SUPPORT: join(REPO_ROOT, "agents") },
            encoding: "utf8",
          });

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
          // The MCP-write-path corruption (#165): renderer output re-encoded while being
          // reproduced into a tool-call argument. Every other case here is a body that was
          // never built from the template; this one WAS, and was damaged afterwards.
          ["a body whose inline HTML was escaped in transit",
            good.replace('"><picture><source', '"&gt;&lt;picture&gt;&lt;source')],
          ["a body with a backtick smuggled into an href",
            good.replace('<a href="https://', '<a href="``https://')],
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
        // Anchored on the invariant half of the sentence, never the count: the count changes every
        // time an assertion is added, and a stale anchor CRASHES the whole run rather than failing
        // one check (`sliceBetween` throws), which surfaces as zero checks and no `✗` line at all.
        "things on `REPORT_BODY` immediately before the write",
        "On any `abort`: post no report object");
      const fence = preWrite.match(/```bash\n([\s\S]*?)```/);
      s.check("G25 the pre-write assertion block is extractable", !!fence);
      if (fence) {
        const script = `abort() { printf 'ABORT: %s\\n' "$*"; exit 3; }\n${fence[1]}\nexit 0\n`;
        const good = spawnSync("node", [join(REPO_ROOT, "agents/pr-reviewer/scripts/render-report.mjs"),
          join(REPO_ROOT, "scripts/eval/fixtures/report-body/warn.json")], { encoding: "utf8" }).stdout;
        // AGENT_SUPPORT is what the block resolves the shared checker through, so the extracted
        // block runs the REAL comment-spine.mjs rather than failing on an unset path. Without it
        // the `node` call errors and every case below aborts for the wrong reason — which is how
        // this omission was caught.
        const runAssert = (body) =>
          spawnSync("bash", ["-c", script], {
            env: { ...process.env, REPORT_BODY: body, AGENT_SUPPORT: join(REPO_ROOT, "agents") },
            encoding: "utf8",
          });

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
          // The MCP-write-path corruption (#165): renderer output re-encoded while being
          // reproduced into a tool-call argument. Every other case here is a body that was
          // never built from the template; this one WAS, and was damaged afterwards.
          ["a body whose inline HTML was escaped in transit",
            good.replace('"><picture><source', '"&gt;&lt;picture&gt;&lt;source')],
          ["a body with a backtick smuggled into an href",
            good.replace('<a href="https://', '<a href="``https://')],
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
      // The MCP-write-path corruption: correct renderer output, re-encoded while being reproduced
      // into a tool-call argument. Invisible to every in-agent guard, which is why it belongs here.
      ["agent-skills-165-escaped-button.md",
        ["escaped-inline-html", "backtick-in-href", "caged-link-target"]],
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
    for (const name of REPORT_FIXTURES) {
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

  // ── G27: Gate 2 (CI) is informational-in-`Run`, it never grades and never fails. Red CI is a
  // fact about the branch, not a finding about the diff — this agent did not diagnose it and
  // cannot tell a regression from a flaky job,
  // a quota, a check that does not run on this base branch, or a draft with no workflow. GitHub
  // already blocks the merge on a required check. Observed on mthines/lorekit#490, whose headline
  // read "CI failing, 1 error, 2 warnings … Blocking: CI checks failing" — i.e. it reported the
  // reviewer as having found something blocking when it had not.
  {
    const gateStates = sliceBetween(prReviewer, "### Gate states", "`--skip-gates` bypasses");
    s.check("G27 Gate 2 is declared informational, not a graded warning gate",
      /Gate 1 is two-state/.test(gateStates) &&
      !/Gates 1 and 2 are two-state/.test(gateStates) &&
      /Gate 2 \(CI\) is neither hard nor graded/.test(gateStates) &&
      /\*\*Gate 2 \(CI\) is informational, never part of the grade\.\*\*/.test(gateStates));
    s.check("G27 the hard-gate set no longer contains Gate 2",
      /Gates 4 and 5 are \*\*hard\*\* gates/.test(gateStates) &&
      !/plus Gate 2 \(CI\), are \*\*hard\*\*/.test(gateStates));

    // No verdict rule may still route a CI failure to FAIL. `Gates 2/4/5` was the shared idiom for
    // the hard-gate set at four sites, so its absence is the load-bearing assertion.
    s.check("G27 no verdict rule still names Gates 2/4/5 as the hard set",
      !/Gates 2\/4\/5/.test(prReviewer));
    s.check("G27 the FAIL verdict rule names only Gates 4 and 5",
      /verdict is \*\*FAIL\*\* when Gate 4 or Gate 5 fails/.test(prReviewer));

    // CI must not reach the posted headline at all. The gate-count tally that used to lead it is
    // gone — the headline counts FINDINGS now, and `SEVERITY_TALLY` is terminal-only — so the
    // assertion moves to the two places CI could still leak into a verdict: the WARN ceiling in
    // the headline rules, and the reasons array.
    const headlines = sliceBetween(reportRendering, "#### Headlines", "| Gate | ❌ reason");
    s.check("G27 the headline rules exclude CI from the verdict entirely",
      /`CI_NOTE` \*\*never counts as a gate\*\*/.test(headlines));
    s.check("G27 the headline counts findings, not gate statuses",
      /\*\*It counts findings, not gates\.\*\*/.test(headlines));
    s.check("G27 SEVERITY_TALLY no longer reaches the posted headline",
      /`SEVERITY_TALLY` is a \*\*terminal-only\*\* term/.test(reportRendering));
    s.check("G27 the posted headline region carries no CI token",
      !/CI failing/.test(headlines));
    s.check("G27 FAIL_REASONS no longer leads with a CI phrase",
      !/leading\s*\n?`CI checks failing`/.test(headlines)
      && /CI is never\s*\n?among them/.test(headlines));

    // The reason table's CI row must offer neither a ❌ phrase nor a ⚠️ phrase — CI never grades.
    const ciRow = (reportRendering.match(/^\| CI \(Gate 2\) \|[^\n]*$/m) || [""])[0];
    s.check("G27 the reason table's CI row is declared informational, not a gate",
      /informational-in-`Run`, never a gate/.test(ciRow), ciRow.slice(0, 90));
    s.check("G27 the reason table's CI row supplies no ⚠️ phrase either — CI never joins WARN_REASONS",
      !/CI red:/.test(ciRow) && !/CI still pending/.test(ciRow), ciRow.slice(0, 90));

    // Gate 2's own result line must be two-state, informational, and explicitly never ❌.
    const gate2 = sliceBetween(prReviewer, "**Gate 2 — CI status**", "**Gate 3 —");
    s.check("G27 Gate 2's result is PASS/WARN, informational-in-Run, and explicitly never ❌",
      /Never ❌/.test(gate2) && /WARN \(⚠️\)/.test(gate2)
      && /informational-in-`Run`/.test(gate2) && /never feeds/.test(gate2));

    // Registered in the diagnostic surface, as an invariant and a failure mode.
    s.check("G27 diagnostic-surface registers F-ci-failed-the-verdict",
      prReviewerDiag.includes("F-ci-failed-the-verdict"));
    // Absence is not sufficiency here either: CI must be excluded consistently everywhere the
    // graded/warning gates are enumerated — the WARN presentation selectors and the
    // WARN_GATE_COUNT definition — or one surface would render a WARN a sibling surface calls
    // PASS for the identical payload.
    // The two selectors live in different files: Step 3's terminal one in the agent body, Step 4's
    // body-template one in the rendering reference. Pair each anchor with its source rather than
    // assuming one haystack.
    for (const [what, src, anchor] of [
      ["the Step 3 WARN selector", prReviewer, "Pick the presentation by verdict"],
      ["the Step 4 WARN selector", reportRendering, "Pick the body by verdict"],
    ]) {
      const sel = sliceBetween(src, anchor, "\n\n");
      s.check(`G27 ${what} no longer lists CI among the graded gates`,
        !/graded gate — Description vs\. code, CI,/.test(sel)
        && /graded gate — Description vs\. code, Prior review feedback, or Code review/.test(sel),
        sel.slice(0, 120));
    }
    {
      const wgc = sliceBetween(reportRendering, "- `WARN_GATE_COUNT` = the number of gates showing",
        "The top-level WARN headline leads with");
      s.check("G27 WARN_GATE_COUNT excludes CI from the warning gates",
        !/\*\*CI\*\*/.test(wgc) && /so 0 to 3/.test(wgc), wgc.slice(0, 140));
    }
    // The criteria list is read as normative, so it must not still call CI verdict-bearing.
    {
      const crit = sliceBetween(prReviewer, "2. **CI status**", "3. **Prior review feedback**");
      s.check("G27 criterion 2 declares CI informational-in-Run, not verdict-bearing",
        /informational-in-`Run`/.test(crit) && !/Contributes to verdict/.test(crit), crit.slice(0, 120));
    }
    // The reference fixtures must not demonstrate the shape G27 forbids — G25 diffs them, so a
    // stale fixture locks the forbidden headline in as the expected rendering.
    for (const name of REPORT_FIXTURES) {
      for (const ext of ["json", "expected.md"]) {
        const f = join(REPO_ROOT, `scripts/eval/fixtures/report-body/${name}.${ext}`);
        if (!existsSync(f)) continue;
        const t = readFileSync(f, "utf8");
        s.check(`G27 fixture ${name}.${ext} carries no CI-blocking headline`,
          !/CI failing/.test(t) && !/Blocking: CI checks failing/.test(t));
      }
    }
    // Every prior guard here checks whether a STRING is present or absent. That cannot see a
    // fixture whose headline COUNT disagrees with the payload it was rendered from — and because
    // G25 diffs the snapshots byte-for-byte, such a fixture locks the wrong semantics in as the
    // reference rendering.
    //
    // The headline used to count GATES (`1 error, 2 warnings`), which is what these checks read.
    // It now counts FINDINGS, because that is the number the author acts on and the one the inline
    // comments are — the gate/finding mismatch was why the report and the inline surface never
    // added up to one number. So the invariants change shape: the finding count and the blocking
    // subset are checked against FINDINGS[], and the verdict is checked against the gates that
    // decide it — CI excluded, since it is informational-in-`Run` only.
    for (const name of REPORT_FIXTURES) {
      const pj = join(REPO_ROOT, `scripts/eval/fixtures/report-body/${name}.json`);
      const mj = join(REPO_ROOT, `scripts/eval/fixtures/report-body/${name}.expected.md`);
      if (!existsSync(pj)) { s.check(`G27 fixture ${name}.json present`, false); continue; }
      const d = JSON.parse(readFileSync(pj, "utf8"));
      const statuses = ["GATE_DESCRIPTION_STATUS", "GATE_PRIOR_STATUS", "GATE_DOCS_STATUS",
        "GATE_SELFREVIEW_STATUS", "GATE_CODEREVIEW_STATUS"].map((k) => d[k]);
      const errors = statuses.filter((v) => v === "❌").length;
      // CI never counts toward `warning` — it is informational-in-`Run`, not a gate.
      const warnings = statuses.filter((v) => v === "⚠️").length;
      const implied = errors > 0 ? "FAIL" : warnings > 0 ? "WARN" : "PASS";
      s.check(`G27 ${name} VERDICT agrees with its own gate statuses (CI excluded)`,
        d.VERDICT === implied, `payload ${d.VERDICT}, gates imply ${implied}`);
      // CI can never move the verdict at all: a red check is never an error, and — since it is
      // excluded from `warnings` too — never even a warning.
      s.check(`G27 ${name} CI alone never produces a FAIL`,
        !(errors === 0 && d.VERDICT === "FAIL"), `${d.VERDICT} with 0 ❌ gates`);
      // One FAIL_REASONS phrase per ❌ gate, and CI is never among them.
      const reasons = Array.isArray(d.FAIL_REASONS) ? d.FAIL_REASONS : [];
      s.check(`G27 ${name} has one FAIL_REASONS phrase per ❌ gate`,
        reasons.length === errors, `${reasons.length} phrase(s), ${errors} ❌ gate(s)`);
      s.check(`G27 ${name} names no CI phrase in FAIL_REASONS`,
        !reasons.some((r) => /\bCI\b/.test(r)), reasons.join("; ").slice(0, 90));
      // A populated CI_NOTE with every real gate ✅ must never force a WARN_REASONS phrase — CI
      // is not a warning gate, so it names nothing there.
      if (d.CI_NOTE && errors === 0 && warnings === 0) {
        const warnReasonsArr = Array.isArray(d.WARN_REASONS) ? d.WARN_REASONS : [];
        s.check(`G27 ${name} names no CI phrase in WARN_REASONS when only CI_NOTE is populated`,
          !warnReasonsArr.some((r) => /\bCI\b/.test(r)), warnReasonsArr.join("; ").slice(0, 90));
      }
      if (!existsSync(mj)) continue;
      const body = readFileSync(mj, "utf8");
      const findings = Array.isArray(d.FINDINGS) ? d.FINDINGS : [];
      const blocking = findings.filter((f) => f.blocking === true).length;
      const head = (body.match(/^### .*$/m) || [""])[0];
      const claimed = Number((head.match(/(\d+) findings?/) || [0, 0])[1]);
      s.check(`G27 ${name} headline's finding count matches FINDINGS[]`,
        claimed === findings.length, `headline ${claimed}, payload ${findings.length}`);
      const claimedBlocking = Number((head.match(/(\d+) blocking/) || [0, 0])[1]);
      s.check(`G27 ${name} headline's blocking count matches FINDINGS[].blocking`,
        claimedBlocking === blocking, `headline ${claimedBlocking}, payload ${blocking}`);
      // The index is the worklist, so it must carry one row per finding and sit above the accordion.
      const indexRows = (body.split("<details>")[0].match(/^\| .* \| .* \| .* \|$/gm) || [])
        .filter((r) => !/^\|\s*(Finding|-{3})/.test(r) && !/^\|---\|/.test(r));
      s.check(`G27 ${name} findings index has one visible row per finding`,
        indexRows.length === findings.length, `${indexRows.length} row(s), ${findings.length} finding(s)`);
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
  // Sentinel so the guard can't silently stop finding agents. Was 3 until v3.23,
  // when the `aw` dispatcher stopped being an agent. A SKILL cannot grant itself
  // tools — it inherits the caller's — so the frontmatter invariant genuinely
  // does not apply to it. The equivalent obligation for the skill form is to
  // DEGRADE VISIBLY instead, which is checked immediately below rather than
  // dropped.
  s.check("G24 found the GitHub-using agents to guard", checked >= 2, `found ${checked}`);

  // G24b — the skill-shaped counterpart of G24. `aw` reaches GitHub through
  // create-pr / review-loop but has no `tools:` block to grant anything, so its
  // contract is that a missing grant is named in the terminal report, never
  // silently swallowed.
  // Collapse whitespace first: this repo uses semantic line breaks, so a phrase
  // that reads as one sentence is routinely split across lines mid-clause.
  const awSkill = readFileSync(join(AW, "aw/SKILL.md"), "utf8").replace(/\s+/g, " ");
  s.check(
    "G24b aw dispatcher skill documents tool-grant degradation",
    /inherit tools rather than declaring them/i.test(awSkill)
      && /absent from the caller's tool grant/i.test(awSkill),
    "aw/SKILL.md must state that it inherits the caller's grant and that a " +
    "missing tool is named in Degraded: — it cannot grant itself tools like an agent can",
  );
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

  // G32: the Agent0 fix prompts are one `/pr-fix` invocation plus an address — the skill owns the
  // method (gather the PR's comments, filter to one author, apply, commit, push), the URL owns the
  // target. Two regressions this guards, in opposite directions. Backwards: a revert to the marker
  // hop ("open the pr-reviewer report comment (marker PR_REVIEWER_REPORT)"), which cost four
  // discovery calls on mthines/lorekit#594 and is structurally stale — Gate 3 counts PRIOR threads,
  // while the run's own findings post at 4b after the 4a render. Forwards: re-inlining any part of
  // what /pr-fix now owns — an embedded gh api graphql worklist, a {lead} excerpt, a {count}
  // checksum — each of which is a second implementation that drifts, and together are what made the
  // prompts ~1100 and ~880 chars. The templates carry no code, so a fixture cannot cover them;
  // assert the argument grammar, the absence of the re-inlined parts, and the length win.
  const rule = readFileSync(join(REPO_ROOT, "agents/shared/rules/agent0-fix-links.md"), "utf8");
  const templates = [...rule.matchAll(/```text\n([^`]*?)\n```/g)].map((m) => m[1]);
  const implementTpls = templates.filter((t) => t.trimStart().startsWith("/pr-fix"));
  const fixThis = implementTpls.find((t) => t.includes("{path}:{line}"));
  const fixAll = implementTpls.find((t) => t.includes("{bot_login}") && !t.includes("{path}"));
  const fallback = implementTpls.find((t) => t.includes("{report_comment_url}"));
  const ciOnly = templates.find((t) => t.includes("{failing_checks}"));

  s.check("G32a the Fix-all template is a /pr-fix call carrying the PR URL and the reviewer's login",
    !!fixAll && /^\/pr-fix https:\/\/github\.com\/\{owner\}\/\{repo\}\/pull\/\{n\} \{bot_login\}$/.test(fixAll.trim()),
    `no text-fenced template is a bare "/pr-fix <pr-url> {bot_login}" — got ${JSON.stringify(fixAll ?? null)}`);

  s.check("G32b no template sends Agent0 to the report comment by marker first",
    !templates.some((t) => t.includes("PR_REVIEWER_REPORT")),
    "a prompt template names the PR_REVIEWER_REPORT marker again — that is the list-and-scan hop, and the report is stale for this run's own findings");

  s.check("G32c the Fix-this template is a /pr-fix call scoping to one {path}:{line}",
    !!fixThis && fixThis.includes("/pr-fix ") && fixThis.includes("{bot_login}"),
    "the fix-this template lost its /pr-fix call, its {path}:{line} scope, or its {bot_login} author argument — without the scope it duplicates Fix-all, and without the author /pr-fix skips a bot reviewer's own findings");

  // The login fallback is what narrowed the omit-the-button rule: an unresolved {bot_login} used to
  // drop the Fix-all button outright, and now the report comment's own permalink names the author by
  // naming a comment the reviewer wrote. It is unavailable on a first run (the sticky is POSTed after
  // the body renders), so it must stay a fallback and never replace the login form.
  s.check("G32l the Fix-all login fallback passes the report comment permalink to /pr-fix",
    !!fallback && /^\/pr-fix \{report_comment_url\}$/.test(fallback.trim())
      && /issuecomment-\{sticky_id\}/.test(rule)
      && /fallback, not the default/.test(rule),
    "the {report_comment_url} fallback, its #issuecomment-{sticky_id} definition, or its fallback-not-default rule is gone — an unresolved login is back to omitting the button");

  // G32l-count: the routing bullets are FIRST-MATCH-WINS, so the fallback branch needs the count
  // condition as well as the identity one. Shipped without it: an unresolved login plus a matched
  // sticky pre-empted the CI-only bullet AND the omit bullet below, emitting a /pr-fix call at a
  // count of 0 — the one state § Prompt templates forbids one in ("must not become one"). The
  // branch it replaced carried an explicit precedence marker ("regardless of {count} or CI state")
  // and the rewrite dropped it, which is what made the ordering ambiguous rather than merely terse.
  //
  // Anchored on the fallback bullet's own sentence, not on a file-wide count of OPEN_FINDING_COUNT:
  // the identifier appears in four bullets here, so a whole-body match would pass with this exact
  // condition deleted. Both owners are asserted — the agent body routes, the rule file explains —
  // because the two said different things and only the rule file was wrong-in-prose.
  const routingBody = readFileSync(join(REPO_ROOT, "agents/pr-reviewer.md"), "utf8");
  const fallbackBullet = /\*\*When `\{bot_login\}` is unresolved\*\*[^\n]*/.exec(routingBody)?.[0] ?? "";
  s.check("G32l the Fix-all login fallback is gated on OPEN_FINDING_COUNT, not on identity alone",
    /OPEN_FINDING_COUNT` is non-zero/.test(fallbackBullet),
    "first-match-wins: an identity-only fallback pre-empts the CI-only variant and the omit rule,"
      + " emitting a /pr-fix call at a finding count of 0");
  s.check("G32l the rule file states identity and count as independent conditions",
    /Identity and count are independent conditions/.test(rule)
      && /reached only\s*\nwhen the open reviewer-finding count is \*\*non-zero\*\*/.test(rule),
    "the rule file said to omit the button 'only when both identity paths are unavailable', which"
      + " reads as licensing a fallback at a count of 0");

  // Nothing /pr-fix owns may be re-inlined into a prompt. Each of these three IS the shape the
  // rewrite removed, so a match means a specific documented regression, not a style slip.
  for (const [what, re, why] of [
    ["an embedded gh api graphql worklist", /gh api graphql/,
      "/pr-fix gathers the PR's comments itself; an embedded query is a second implementation that drifts"],
    ["a {lead} body excerpt", /\{lead\}/,
      "quoting the finding's lead line went stale on a § Hard caps prose trim and is what made Fix-this ~880 chars"],
    ["a {count} checksum", /\{count\}/,
      "/pr-fix reports what it applied; a count in the URL is a second, staler answer to the same question"],
  ]) {
    s.check(`G32m no /pr-fix template re-inlines ${what}`,
      !implementTpls.some((t) => re.test(t)), why);
  }

  // The design target is 2500 — the point of the target is that MAX_URL (4000) stays a fail-closed
  // guard rather than a routine ceiling, since the real cliff behind it is the 8k request-line buffer
  // of a default nginx/Apache. G32k adds a much tighter bound to hold the /pr-fix win: without it,
  // a re-added clause is absorbed into ~2200 chars of headroom and never reads as a regression.
  // Filled from the LIVE templates, never hand-copied: a transcribed copy silently stops measuring
  // the real prompt the moment a template gains a clause, which is exactly when it matters.
  const TARGET = 2500;
  const SHORT = 500;
  // A 94-char path is Fix-this's documented worst case; owner/repo/login are realistic.
  const fillTemplate = (t) => (t ?? "")
    .replaceAll("{owner}", "mthines").replaceAll("{repo}", "lorekit")
    .replaceAll("{n}", "594").replaceAll("{bot_login}", "dash0-dev[bot]")
    .replaceAll("{path}", `packages/${"nested-directory/".repeat(4)}some-module-name.ts`)
    .replaceAll("{line}", "1204");
  const KNOWN_PLACEHOLDERS = ["{owner}", "{repo}", "{n}", "{bot_login}", "{path}", "{line}"];
  for (const [name, tpl, source] of [["Fix-all", fixAll, "fix-all"], ["Fix-this", fixThis, "fix-this"]]) {
    const filled = fillTemplate(tpl);
    const leftover = KNOWN_PLACEHOLDERS.find((p) => filled.includes(p));
    s.check(`G32d0 the ${name} fill leaves no unsubstituted placeholder`,
      filled !== "" && !leftover,
      `template gained a placeholder this fill does not substitute: ${leftover ?? "(no template)"}`);
    const len = buildLink(filled, "production", source).length;
    s.check(`G32d a filled ${name} URL stays under the ${TARGET}-char design target`,
      len < TARGET, `filled URL is ${len} chars — over the ${TARGET} design target`);
    s.check(`G32k a filled ${name} URL stays under the ${SHORT}-char /pr-fix bound`,
      len < SHORT,
      `filled URL is ${len} chars — the /pr-fix rewrite put both prompts near 200–300, so ${len} means a clause, a worklist, or an excerpt crept back in (agent0-fix-links.md § Deep-link format)`);
  }

  // The Agent0 runner lacks the headroom for a raw tsc/eslint invocation — even one scoped to a
  // single changed package still walks that package's whole project graph and crashes the run, so
  // scoping by file count alone (the earlier wording) was not sufficient; observed live when a run
  // honored "only the files you changed" but still reached for `npx tsc --noEmit --project
  // tsconfig.json` on the changed package. The CI-only template is the one that still carries its own
  // method — the two /pr-fix templates delegate verification to the skill — so it must route to
  // the repo's own lint/typecheck/test scripts and allow skipping verification outright.
  s.check("G32g the Fix-all — CI-only template verifies via the repo's own scripts, never a raw call or a whole-repo pass",
    !!ciOnly
      && /repo's own lint\/typecheck/.test(ciOnly)
      && /never a raw [\w/-]+ call or a whole-repo pass/.test(ciOnly)
      && /skip verification if none exist/.test(ciOnly),
    "Fix-all — CI-only lost the scoped-verification clause — a raw tsc/eslint call, even scoped to the changed package, still crashes the Agent0 runner on a large repo");

  s.check("G32n the CI-only template is not a /pr-fix call",
    !!ciOnly && !ciOnly.includes("/pr-fix") && /must not become one/.test(rule),
    "the CI-only variant became a /pr-fix call — /pr-fix applies review comments, and a red check with zero findings has none to apply");

  // G32o: the both-buttons-or-neither invariant must be scoped to the FLAG, and the one state
  // that diverges the placements must be named in the same breath. Shipped unqualified in both
  // owners while the login fallback renders Fix-all and skips Fix-this for its ENTIRE population
  // (an inline comment has no permalink to itself), so the absolute was false exactly where a
  // reader would go looking — the same contradiction class as CLAUDE.md's "always named".
  // Two checks, not one: the phrase is what a reader quotes, the exception is what makes it true.
  for (const [file, body] of [["agents/pr-reviewer.md", routingBody], ["agent0-fix-links.md", rule]]) {
    s.check(`G32o ${file} scopes both-buttons-or-neither to the flag`,
      !/(?:a run (?:has|either has)|so a run either has) both buttons or neither/.test(body)
        && /no per-placement opt-out/.test(body),
      "the invariant is stated as a property of the run, but the login fallback renders Fix all"
        + " with no Fix this for every run that reaches it — scope the claim to the flag");
    s.check(`G32o ${file} names the fallback's one-button divergence`,
      /has no permalink to itself|no permalink to itself/.test(body)
        && /entire\*\* population|\*\*entire\*\* population/.test(body),
      "the divergence is undocumented, so a reader treats the absent Fix this as a defect and"
        + " 'fixes' it by inventing a self-link GitHub cannot assign until POST");
  }

  // G32p: --relay-check must be GATED ON THE WRITE PATH, in the shell, at both call sites.
  // Every fix link is over the 140 budget by construction (floor 164), so an unconditional check
  // withholds the buttons on every run of every repo — including `gh` runs that rewrite nothing —
  // which is a silent permanent opt-out of a default-on affordance. It shipped that way: the
  // report block carried "on the `gh` path the buttons post intact and stay" as PROSE while the
  // shell asked unconditionally, and the inline block had neither. So this asserts the guard
  // condition sits in the same fenced block as the call, not that a sentence about it exists.
  for (const [site, marker] of [["report", "/tmp/report-body.md"], ["inline", "/tmp/finding-$i.md"]]) {
    const blocks = [...routingBody.matchAll(/```bash\n([\s\S]*?)```/g)]
      .map((m) => m[1])
      .filter((b) => b.includes(`--relay-check ${marker}`));
    s.check(`G32p the ${site} --relay-check call sits behind a write-path condition`,
      blocks.length > 0 && blocks.every((b) => /ACCESS_PATH.*=.*"?mcp"?/.test(b)
        && /if \[ -n "\$WRITE_IS_RELAYED" \]/.test(b)),
      blocks.length === 0
        ? `no bash block calls --relay-check ${marker} — the call site moved; re-anchor this guard`
        : "the call is unconditional, so the buttons are withheld on the `gh` path too and the"
          + " affordance never renders anywhere");

    // A gate that always answers "relayed" is the unconditional check wearing an `if`. The probe
    // shipped reading `repos/$RESOLVED_REPO`, which is bound at ONE site in a different tool call
    // — so it was empty here, probed `repos/`, 404'd, and pinned ACCESS_PATH to `mcp` forever.
    // The check above passed the whole time, which is why this one exists: assert the probe can
    // actually reach `gh`, not merely that a condition is written. G43b cannot see this — it
    // asks whether a name is bound anywhere in the file, and this one is.
    s.check(`G32p the ${site} write-path probe derives its own repo`,
      blocks.every((b) => !/repos\/\$RESOLVED_REPO/.test(b)
        && (!/gh api "repos\//.test(b) || /TARGET_REPO="\$\{RESOLVED_REPO:-/.test(b))),
      "the probe reads $RESOLVED_REPO, which Step 0.2 binds in a different tool call — empty here,"
        + " so it probes `repos/`, 404s, and reports `mcp` on every path including `gh`");
  }

  // The exit-3 re-check is meaningless without a re-render: asking the SAME file returns the same
  // 1 forever, so the branch reads as coverage while being dead. Its own comment said "re-render
  // first" while the shell only re-asked — the identical prose-vs-shell split as the gate above.
  const reportBlock = [...routingBody.matchAll(/```bash\n([\s\S]*?)```/g)]
    .map((m) => m[1])
    .find((b) => b.includes("--relay-check /tmp/report-body.md"));
  s.check("G32p the report's exit-3 re-check re-renders before re-asking",
    !!reportBlock && /del\(\.FIX_ALL_URL\)/.test(reportBlock)
      && reportBlock.indexOf("del(.FIX_ALL_URL)") < reportBlock.lastIndexOf("--relay-check"),
    "the second --relay-check reads an unchanged body, so it returns 1 again and can never reach"
      + " 3 — NOTE_MANGLED_LINK is unreachable and a mangled citation goes unnamed");
  s.check("G32p github-access.md binds ACCESS_PATH with how the body travels",
    (() => {
      const ga = readFileSync(join(REPO_ROOT, "agents/shared/rules/github-access.md"), "utf8");
      return /`ACCESS_PATH`/.test(ga) && /tool-call argument/.test(ga) && /Body travels as/.test(ga);
    })(),
    "the consumers compare $ACCESS_PATH against the literal \"mcp\" to decide whether their body"
      + " is relayed, so renaming the token here silently inverts the fail-safe: the comparison"
      + " goes always-false, WRITE_IS_RELAYED stays unset, and every write is treated as"
      + " file-based — posting a mangled button, the direction the default exists to avoid");

  // G32q: the buttons are ON BY DEFAULT, and that is a fact about the SHELL, not about a
  // sentence. Two prior defaults failed the same way — off-unless-flagged, then
  // on-only-where-an-agent0_environment-was-named — and in both the affordance was missing from
  // every run nobody had remembered to configure. So EXECUTE the resolution block from
  // review-config.md against fixture configs and assert what it resolves. A prose-presence check
  // would pass while a `[ "$fl" = "true" ]` truthiness test read every absent key as `false` and
  // quietly restored off-by-default, with the table, the schema and the prose all still claiming
  // otherwise — the same shape as G32p's unconditional --relay-check.
  {
    const cfg = readFileSync(join(REPO_ROOT, "agents/shared/rules/review-config.md"), "utf8");
    const block = [...cfg.matchAll(/```bash\n([\s\S]*?)```/g)]
      .map((m) => m[1])
      .find((b) => /^AGENT0_FIX_LINKS=/m.test(b));
    // Drop the fetch half — it needs `gh` and the network. The resolution half starts at the
    // first AGENT0_ variable and is pure string handling, so it runs as-is.
    const tail = block?.slice(block.search(/^AGENT0_FIX_LINKS=/m));
    const resolve = (content, readFailed = 0) => {
      const r = spawnSync("bash", ["-c",
        `CONFIG_READ_FAILED=${readFailed}\n`
        + `BASE_CONFIG_CONTENT=$(cat)\n${tail}\n`
        + `printf '%s %s\\n' "$AGENT0_FIX_LINKS" "$AGENT0_ENVIRONMENT"`,
      ], { input: content, encoding: "utf8" });
      return (r.stdout || "").trim();
    };

    s.check("G32q the review-config resolution block is still where this guard reads it",
      !!tail && /agent0_fix_links/.test(tail),
      "no bash block in review-config.md binds AGENT0_FIX_LINKS — the resolution moved;"
        + " re-anchor this guard rather than deleting it");

    if (tail) {
      // The whole point of the inversion: nothing configured must render buttons.
      s.check("G32q nothing configured resolves the buttons ON at the production host",
        resolve("") === "true production",
        `an empty config resolved "${resolve("")}" — a repo that configured nothing gets no`
          + " buttons again, which is the default this change replaced");
      s.check("G32q a config that never mentions Agent0 still resolves ON",
        resolve("profile: balanced\nfilters:\n  - naming-nits\n") === "true production",
        "an unrelated review config turned the buttons off — only `agent0_fix_links: false` may");

      // The one opt-out has to actually work: it is all that stands between a repo that declined
      // and a deep link to a host its readers cannot sign in to.
      s.check("G32q `agent0_fix_links: false` is a real opt-out",
        resolve("agent0_fix_links: false\n").startsWith("false"),
        "the documented repo-wide opt-out did not resolve off — the only way for a non-Dash0 repo"
          + " to decline the buttons is broken, and the config says it works");
      s.check("G32q the opt-out survives an inline comment after the value",
        resolve("agent0_fix_links: false   # we do not use Agent0\n").startsWith("false"),
        "an inline comment defeated the opt-out — the schema's own documented style puts one"
          + " there (the PR #149 regression, in the direction that now fails open)");

      // agent0_environment is HOST ONLY. It gated the buttons before; one key carrying both
      // meanings made them unsettable independently.
      s.check("G32q agent0_environment picks the host and does not gate rendering",
        resolve("agent0_environment: development\n") === "true development"
          && resolve("agent0_fix_links: false\nagent0_environment: development\n")
            === "false development",
        "agent0_environment still moves AGENT0_FIX_LINKS — a repo on `development` cannot turn"
          + " the buttons off without also losing its host, which is what splitting them fixed");

      // Fail-safe: an unreadable config may have carried the opt-out, so withhold.
      s.check("G32q an unreadable config withholds the buttons",
        resolve("", 1).startsWith("false"),
        "a config that could not be read resolved ON — the opt-out is discarded by any transient"
          + " read failure, which is the one direction that is not recoverable");

      // …and the fetch has to tell those two apart. EXECUTE it against a stub `gh`: the first
      // version of this function used `2>&1`, which put a success-path warning inside the JSON,
      // failed `--jq`, and returned empty — so a config carrying `agent0_fix_links: false` read
      // as "no config" and the buttons rendered. Verified: the `2>&1` form returns empty on
      // case 4 below. The fail-safe above cannot catch it, because the fetch reports success.
      const fetchFn = block.slice(0, block.indexOf("\nCONFIG_READ_FAILED=0"));
      const B64 = Buffer.from("agent0_fix_links: false\n").toString("base64");
      const withStub = (ghBody) => {
        const dir = mkdtempSync(join(tmpdir(), "l1-cfg-"));
        writeFileSync(join(dir, "gh"), `#!/bin/bash\n${ghBody}\n`, { mode: 0o755 });
        const r = spawnSync("bash", ["-c",
          `RESOLVED_REPO=o/r\n${fetchFn}\n`
          + `out=$(fetch_base_config .github/review.yaml)\nprintf '%s|%s' "$?" "$out"`,
        ], { encoding: "utf8", env: { ...process.env, PATH: `${dir}:${process.env.PATH}` } });
        rmSync(dir, { recursive: true, force: true });
        return (r.stdout || "").trim();
      };
      const cases = [
        ["a readable config returns its content", `echo "${B64}"`,
          `0|agent0_fix_links: false`],
        ["an absent config (404) is an answer, not a failure",
          'echo "gh: Not Found (HTTP 404)" >&2; exit 1', "0|"],
        ["an unreadable config (403) exits 2 so the caller withholds",
          'echo "gh: Resource not accessible (HTTP 403)" >&2; exit 1', "2|"],
        ["a warning on the SUCCESS path does not erase the config",
          `echo "warning: token from env" >&2; echo "${B64}"`, `0|agent0_fix_links: false`],
      ];
      for (const [what, stub, want] of cases) {
        const got = withStub(stub);
        s.check(`G32q fetch_base_config — ${what}`, got === want,
          `got "${got}", want "${want}" — the fetch cannot tell an absent config from an`
            + " unreadable one, so the only repo-wide opt-out is silently discardable");
      }
    }
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
  // EVERY call site — § Locating this agent's own files / Step 0.1, Step 1.2 (CLASSIFY), and
  // Step 4a (RENDER) — each with an edit-them-together note. This asserts the bodies have not
  // drifted; the regression that shipped was defining it at only one.
  const RESOLVE_SITES = 3;
  const resolves = [...readRepo("agents/pr-reviewer.md")
    .matchAll(/resolve\(\)\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1].replace(/\s+/g, " ").trim());
  const allSame = resolves.length > 0 && resolves.every((r) => r === resolves[0]);
  s.check("G33i resolve() is defined at every call site and the bodies are identical",
    resolves.length === RESOLVE_SITES && allSame,
    `found ${resolves.length} definition(s)${allSame ? "" : " that differ"}`);
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

// ── G36: weekly lesson-promotion sweep (2026-08-31) — three reviewer-lessons clusters ──
// (a) Step 4b's review POST must use `--input`, never `--field`/`--raw-field`, for the
//     `comments` array (gh's raw-field flags always serialize a value as a JSON string, so a
//     `comments` array 422s as "is not an array" — 5 independent lessons converged on this fix).
// (b) Step 1.2/3.5 must partition undiffable (binary) paths and route their findings to the
//     gate table as ANCHORLESS-BY-CONSTRUCTION, never as an ordinary line-validity casualty.
// (c) The dependency finder must name the cross-owner `gh api` 401 as scoping (not breakage) and pivot to a
//     `webfetch` HTTP fallback for any pin/spec verification outside the PR's own repository.
{
  const prm = readFileSync(join(REPO_ROOT, "agents/pr-reviewer.md"), "utf8");

  // (a) --input POST regression lock.
  s.check("G36a Step 4b posts the review with --input, not --field/--raw-field",
    /--method POST \\\s*\n\s*--input \/tmp\/review-payload\.json/.test(prm));
  s.check("G36a-neg Step 4b's review POST command no longer carries a --raw-field comments= flag",
    !/^\s*--raw-field comments=/m.test(prm));
  s.check("G36a the payload is built as one JSON document with commit_id, body, event, and comments",
    /json\.dump\(\s*\n\s*\{"commit_id": head_sha, "body": body, "event": "COMMENT", "comments": json\.loads\(comments_json\)\}/.test(prm));

  // (b) ANCHORLESS-BY-CONSTRUCTION regression lock.
  s.check("G36b Step 1.2 computes /tmp/pr-undiffable-paths.json from patch == null entries",
    /select\(\.patch == null\) \| \.filename\]/.test(prm) && prm.includes("/tmp/pr-undiffable-paths.json"));
  s.check("G36b Step 3.5 names ANCHORLESS-BY-CONSTRUCTION as a distinct, non-casualty outcome",
    /ANCHORLESS-BY-CONSTRUCTION.{0,400}never a line-validity casualty/s.test(prm));

  // (c) Cross-owner 401-is-scoping regression lock. The lesson moved out of the agent body with
  // Persona 4's retirement — the dependency finder is what reads an upstream changelog now, so
  // that is where the anchors have to be. Reverting the move without carrying the lesson leaves
  // rung 2 (`gh api repos/<upstream>/releases`) reading its own 401 as "unverifiable", which is
  // the exact defect this locks: a cross-owner 401 is credential scope, not an unreachable target.
  const dep = readFileSync(join(REPO_ROOT, "agents/pr-reviewer/rules/finder-dependency.md"), "utf8");
  s.check("G36c the dependency finder states the injected gh credential is scoped to the PR's own repository",
    dep.includes("The injected `gh` credential is scoped to this PR's own repository"));
  s.check("G36c the dependency finder prescribes the webfetch/raw.githubusercontent fallback for cross-owner targets",
    dep.includes("`webfetch` against `api.github.com`") && dep.includes("raw.githubusercontent.com"));
  s.check("G36c a dependency-bump PR's upstream claim is labelled unverified rather than asserted when unreachable",
    dep.includes("unverified (upstream unreachable)"));
  // And the lesson must not be orphaned: the agent body has to route to the file that carries it.
  s.check("G36c the agent body routes dependency review to finder-dependency.md",
    prm.includes("pr-reviewer/rules/finder-dependency.md"));

  // Guard-bites proof (documented, not executed, per the mock-that-reimplements lesson):
  // reverting any of the three edits above removes the literal anchor G36a/b/c greps for,
  // which flips the corresponding check red — confirmed by hand before landing this guard.
}

// ── G37: the Fix-with-Agent0 scripts are never invoked by a bare relative path ──
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
    s.check(`G37a ${f} never invokes build-agent0-link.mjs by a bare relative path`,
      !BARE_INVOCATION.test(readRepo(f)));
  }
  // Every script the agent runs is addressed through $AGENT_SUPPORT — the one variable
  // `Locating this agent's own files` derives from the resolved definition path. A call site
  // that re-derives `${AGENT_MD%/pr-reviewer.md}` inline is drift: it works, but it puts the
  // support-tree contract in N places, which is how the rule-file paths came to be bare
  // repo-relative in the first place.
  s.check("G37b pr-reviewer.md derives BUILD_LINK from $AGENT_SUPPORT, same as RENDER",
    /BUILD_LINK="\$AGENT_SUPPORT\/pr-reviewer\/scripts\/build-agent0-link\.mjs"/.test(
      readRepo("agents/pr-reviewer.md"))
    && /RENDER="\$AGENT_SUPPORT\/pr-reviewer\/scripts\/render-report\.mjs"/.test(
      readRepo("agents/pr-reviewer.md")));
}

// ── G38: the detection core — Phases A–F must actually be wired, not merely present ──
//
// Every phase shipped as a rule file plus a routing line in the agent body. The failure mode a
// text-presence check cannot see is a rule file that exists and is never read: the file is
// correct, the review does not run it, and nothing is red. So these assert the JOINT condition —
// the rule exists AND the agent body routes to it at a named step — plus the handful of
// invariants that are the whole reason each phase was split out.
{
  const prm = readFileSync(join(REPO_ROOT, "agents/pr-reviewer.md"), "utf8");
  const ruleOf = (p) => {
    const f = join(REPO_ROOT, p);
    return existsSync(f) ? readFileSync(f, "utf8") : null;
  };

  // (a) Each phase: file present, and routed from the body.
  const PHASES = [
    ["A workspace", "agents/pr-reviewer/rules/workspace.md", "1.1b"],
    ["B impact graph", "agents/pr-reviewer/rules/impact-graph.md", "1.2a"],
    ["C depth routing", "agents/pr-reviewer/rules/depth-routing.md", "1.2b"],
    ["D finders", "agents/pr-reviewer/rules/finders.md", "Step 2"],
    ["D consumer-impact", "agents/pr-reviewer/rules/finder-consumer-impact.md", "Step 2"],
    ["D dependency", "agents/pr-reviewer/rules/finder-dependency.md", "Step 2"],
    ["E verifier", "agents/shared/rules/finding-verifier.md", "2.6b"],
    ["memory contract", "agents/pr-reviewer/rules/memory.md", "1.0"],
    ["telemetry", "agents/pr-reviewer/rules/telemetry.md", "1.0"],
  ];
  for (const [label, path, step] of PHASES) {
    const body = ruleOf(path);
    s.check(`G38a Phase ${label} rule exists (${path})`, body !== null);
    if (!body) continue;
    // The basename is what a routing line must name; a rule nobody names is a rule nobody reads.
    const base = path.split("/").pop();
    s.check(`G38a the agent body routes to ${base} (Phase ${label}, ~Step ${step})`,
      prm.includes(base), "rule file present but never referenced from the agent body");
  }

  // (b) The polarity rule. This is the one invariant that, if lost, silently reverts the whole
  // refactor: a finder that knows the confidence bar prunes against it, and a candidate pruned
  // pre-verification is a defect nobody adjudicated. Assert it in the rule AND in the body.
  const finders = ruleOf("agents/pr-reviewer/rules/finders.md") || "";
  s.check("G38b finders.md states that a finder never sees the confidence bar",
    /never sees|does not see|never knows/.test(finders) && /confidence|threshold|bar/.test(finders));
  s.check("G38b the agent body carries the polarity rule at Step 2",
    /finder'?s? job is to \*\*flag\*\*|[Ff]inders flag, the verifier filters/.test(prm));
  s.check("G38b the candidate record requires bad_outcome and verify_by",
    finders.includes("bad_outcome") && finders.includes("verify_by")
    && prm.includes("bad_outcome") && prm.includes("verify_by"));

  // (c) The four verdicts, and the two that are NOT drops. `unobtainable` collapsing back into
  // `null` is the regression that silently discards every claim the runner could not check.
  const verifier = ruleOf("agents/shared/rules/finding-verifier.md") || "";
  const receipt = readFileSync(join(REPO_ROOT, "agents/shared/rules/verification-receipt.md"), "utf8");
  for (const v of ["confirmed", "contradicted", "ambiguous", "unobtainable"]) {
    s.check(`G38c finding-verifier.md defines the ${v} verdict`, verifier.includes(v));
  }
  s.check("G38c verification-receipt.md distinguishes unobtainable from null",
    receipt.includes("unobtainable") && /could not run/.test(receipt),
    "the unobtainable row is gone — a check that could not run is being read as a check that found nothing");
  s.check("G38c an unobtainable finding is re-framed, never asserted as an issue",
    /re-frame, do not drop/i.test(receipt)
    && /Capped at `suggestion:`[\s\S]{0,80}never `issue:`/.test(receipt),
    "the unobtainable cap is gone — an unverified claim can be filed as a blocking issue");
  s.check("G38c a contradicted candidate is logged with its reason, not silently dropped",
    /contradicted[\s\S]{0,600}(log|logged|record)/i.test(verifier),
    "an unlogged contradiction is a lesson the loop never learns");

  // (d) Suppression AFTER verification, and the two never-suppressible classes. Reverting the
  // step order drops the fourth instance of a pattern — the one that is actually a bug — on the
  // strength of the first three being won't-fixed.
  s.check("G38d the agent body applies memory suppression at 2.7b, after the verifier",
    /### 2\.7b Memory suppression \(after verification\)/.test(prm));
  s.check("G38d 2.7b comes after 2.6b in the body, not before it",
    prm.indexOf("### 2.7b Memory suppression") > prm.indexOf("### 2.6b Verify each candidate"));
  s.check("G38d no relevance-filtering step survives at 2.2",
    !/### 2\.2 Relevance-memory filtering/.test(prm),
    "the pre-verification suppression step is back");
  const rubric = readFileSync(join(REPO_ROOT, "agents/shared/rules/rubric-composition.md"), "utf8");
  for (const surface of [["the agent body", prm], ["rubric-composition.md", rubric],
    ["memory.md", ruleOf("agents/pr-reviewer/rules/memory.md") || ""]]) {
    s.check(`G38d ${surface[0]} names standards and (blocking) as never-suppressible`,
      /standards/i.test(surface[1]) && /\(blocking\)/.test(surface[1]) && /suppress/i.test(surface[1]));
  }

  // (e) Memory must be keyed structurally and filtered by author, or it cannot do the one thing
  // it was redesigned for: carry what one author's PR taught the reviewer onto the next author's.
  const memory = ruleOf("agents/pr-reviewer/rules/memory.md") || "";
  s.check("G38e memory.md keys records structurally, not by branch or PR",
    /finder:defect-class:symbol@path|fp_v/.test(memory));
  s.check("G38e memory.md requires a source.agent filter on every read",
    /source\.agent|source\.\{?login/.test(memory) && /filter/i.test(memory));
  s.check("G38e the agent body states the author filter is not optional",
    /source\.agent/.test(prm) && /not optional/.test(prm));
  s.check("G38e memory.md requires a knowledge fact to be re-verified or dropped",
    /re-verif/i.test(memory) && /drop/i.test(memory));
  // The filter's one carve-out has to be a FIELD the read path can key on. `/pr-review remember`
  // writes `type: human, agent: other` — byte-identical to the incidental human comment the filter
  // rejects — so without `explicit` on both sides, a literal implementation of the filter drops
  // every rule a maintainer ever wrote, silently.
  const rememberSkill = readFileSync(join(REPO_ROOT, "skills/quality/pr-review/SKILL.md"), "utf8");
  for (const [name, src] of [["memory.md", memory], ["the agent body", prm],
    ["pr-review/SKILL.md", rememberSkill]]) {
    s.check(`G38e ${name} carves out the remember rule with source.explicit, not prose`,
      /source\.explicit|explicit: true/.test(src),
      "the /pr-review remember carve-out names no field the read path can key on");
  }
  s.check("G38e the filter predicate names both usable cases",
    /source\.agent == "pr-reviewer"\s*(?:∨|\|\|)\s*source\.explicit == true/.test(memory)
    && /source\.agent == "pr-reviewer"\s*(?:∨|\|\|)\s*source\.explicit == true/.test(prm),
    "memory.md and the agent body must state the same two-case predicate");
  // A record value with no closed field set grows fields nobody reads. Observed once as a hotspot
  // carrying `fp_v` and `source{}` lifted off the relevance-rule schema, a `window_days` restating
  // the TTL LoreKit stores as a column, and three prose sections — one of them the checklist line
  // the READ side renders from the counters, frozen at write time so the next increment made it
  // wrong. Nothing objected, because the schemas were examples rather than contracts.
  s.check("G38e memory.md closes both record schemas against extra fields",
    /field sets are closed/i.test(memory) && /not listed is not written/i.test(memory),
    "the knowledge/hotspot value schemas must be stated as closed, not shown as examples");
  s.check("G38e memory.md forbids restating a LoreKit first-class property",
    /Never restate what LoreKit already stores as a first-class property/.test(memory)
    && /source_agent/.test(memory) && /`window_days: 90` in the value/.test(memory),
    "memory.md must name the columns a value may not duplicate, window_days included");
  s.check("G38e memory.md keeps in-value expires as the stated exception",
    /deliberate exception is the in-value \*\*`expires`\*\*/.test(memory)
    && /by \*marking\* it, not by dropping it/.test(memory),
    "the expires carve-out must give its mechanical reason: LoreKit marks rather than drops");
  s.check("G38e memory.md bans storing what the read side derives",
    /Never store what the read side derives/.test(memory)
    && /facts and not advice|facts, not advice/i.test(memory),
    "memory.md must forbid writing the rendered checklist line into the record");

  // (f) Telemetry's three invariants. Any of the three lost turns an exposure signal into a
  // correctness verdict about code that has, by construction, no telemetry yet.
  const tele = ruleOf("agents/pr-reviewer/rules/telemetry.md") || "";
  s.check("G38f telemetry.md states it raises priority and never lowers it",
    /raise/i.test(tele) && /never lower/i.test(tele));
  s.check("G38f telemetry.md states it never blocks", /never block/i.test(tele));
  s.check("G38f telemetry.md carries aggregates and signatures only",
    /aggregate/i.test(tele) && /signature/i.test(tele));
  // FAIL_REASONS is what flips the verdict. Telemetry contributing a phrase to it would make an
  // exposure figure blocking, which is exactly what invariant 2 forbids.
  s.check("G38f no telemetry term reaches FAIL_REASONS in the agent body",
    !/FAIL_REASONS[^\n]{0,200}(telemetry|traffic_band|span)/i.test(prm)
    && !/(telemetry|traffic_band)[^\n]{0,200}FAIL_REASONS/i.test(prm));

  // (g) The tier vocabulary is one vocabulary. Three surfaces name the tiers and a fourth
  // validates them; a rename applied to some of them is how a report claims a tier the router
  // cannot produce.
  const depth = ruleOf("agents/pr-reviewer/rules/depth-routing.md") || "";
  const renderer = readFileSync(join(REPO_ROOT, "agents/pr-reviewer/scripts/render-report.mjs"), "utf8");
  for (const tier of ["deep", "standard", "quick"]) {
    s.check(`G38g the tier "${tier}" is named by depth-routing.md, the body, and the renderer`,
      depth.includes(tier) && prm.includes(tier) && renderer.includes(tier));
  }
  for (const cap of ["checkout", "tarball", "diff-only"]) {
    s.check(`G38g the capability "${cap}" is named by workspace.md, the body, and the renderer`,
      (ruleOf("agents/pr-reviewer/rules/workspace.md") || "").includes(cap)
      && prm.includes(cap) && renderer.includes(cap));
  }
  s.check("G38g depth-routing.md caps a diff-only run below deep",
    /diff-only[\s\S]{0,300}cap/i.test(depth));
  s.check("G38g the renderer rejects tier deep with depth diff-only",
    /diff-only[\s\S]{0,300}deep|deep[\s\S]{0,300}diff-only/.test(renderer));
  // Rung 0 reaches `checkout` through a worktree the USER owns, which makes the cleanup line the
  // one place in this pipeline that can destroy data: an unconditional `rm -rf "$WORKDIR"` deletes
  // their uncommitted work and leaves a stale entry in the parent repo's `.git/worktrees`. Guard
  // both halves — the flag has to exist, and the trap has to read it.
  const ws = ruleOf("agents/pr-reviewer/rules/workspace.md") || "";
  s.check("G38g workspace.md passes --no-hooks on every gw invocation",
    /gw checkout/.test(ws) && !/gw checkout(?!.*--no-hooks)[^\n]*<(?:PR_NUMBER|PR_URL|PR)>/.test(ws),
    "a gw checkout without --no-hooks would install dependencies as a side effect of rung 0");
  // Rung 0 has THREE dispositions, not two, so the disposal method is an enum rather than an
  // owned/not-owned boolean: `rm -rf` on either kind of worktree leaves a stale entry in the
  // parent repo's .git/worktrees, which breaks the repo the review was reviewing.
  for (const disposition of ["none", "worktree", "rm"]) {
    s.check(`G38g workspace.md binds WORKDIR_CLEANUP=${disposition}`,
      new RegExp(`WORKDIR_CLEANUP=${disposition}\\b`).test(ws));
  }
  // Assert the bare trap in BOTH files. The agent body is the file an agent actually executes,
  // and a correct rule beside a wrong body loses: the body's line is the last word on cleanup.
  // Guarding only `ws` is how a verbatim copy of workspace.md's own ❌ WRONG case sat at
  // pr-reviewer.md:962 through a green 905/905 run.
  for (const [name, src] of [["workspace.md", ws], ["the agent body", prm]]) {
    s.check(`G38g ${name} dispatches disposal on WORKDIR_CLEANUP, never a bare rm -rf trap`,
      /case\s+"\$WORKDIR_CLEANUP"/.test(src) && !/trap\s+'rm -rf/.test(src),
      "an unconditional rm -rf trap deletes worktrees through git's back");
  }
  // The shell in these rule files is normative — an agent runs it verbatim — so a helper that is
  // never defined is dead code, not shorthand. `$(origin_repo)` and `worktree_is_clean_at_head`
  // both shipped undefined, which silently skipped the whole rung while still reporting
  // `Depth: checkout`. Every snake_case command the block calls must be defined in the same file.
  const SHELL_BUILTIN_UNDERSCORES = new Set([]);   // real commands with `_` are vanishingly rare
  for (const [name, src] of [["workspace.md", ws], ["the agent body", prm]]) {
    const blocks = [...src.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]).join("\n");
    const called = new Set();
    for (const m of blocks.matchAll(/\$\(([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\)/g)) called.add(m[1]);
    for (const m of blocks.matchAll(
      // Exclude `=` (assignment), `(` (a definition), and `:` / `,` — a `jq`/JSON key or a
      // Python tuple unpack inside a bash-fenced heredoc is not a command call.
      /(?:^|&&|\|\||;|\bthen\b|\belif\b|\bif\b)[ \t]*([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b(?![ \t]*[=(:,])/gm
    )) called.add(m[1]);
    const undefined_ = [...called].filter(
      (fn) => !SHELL_BUILTIN_UNDERSCORES.has(fn) && !new RegExp(`^\\s*${fn}\\(\\)`, "m").test(src),
    );
    s.check(`G38g every snake_case helper the ${name} shell calls is defined in it`,
      undefined_.length === 0,
      `undefined helper(s) called but never defined: ${undefined_.join(", ")}`);
  }
  s.check("G38g only the rm disposition uses rm -rf, and worktree uses git worktree remove",
    /worktree\)\s*git worktree remove/.test(ws) && /\brm\)\s*rm -rf/.test(ws));
  s.check("G38g workspace.md forbids removing a gw worktree at all",
    /never\*{0,2}\s+removed by this agent|not even with `gw remove`/i.test(ws));
  // The fallback is the point of the rung: `gw` is ergonomics, the local object store is the
  // capability. A rule that made `gw` a precondition would drop the rung on every machine
  // without it and pay for a network clone it did not need.
  s.check("G38g rung 0 falls back to plain git worktree when gw is absent",
    /git worktree add --detach/.test(ws) && /fallback/i.test(ws));
  s.check("G38g rung 0's precondition is the local clone, not gw being installed",
    /not\*{0,2}\s+a precondition/i.test(ws),
    "gw must select the implementation, never gate the rung");
  s.check("G38g rung 0 fetches the pull/<n>/head ref so fork PRs are not excluded",
    /pull\/\$PR_NUMBER\/head/.test(ws) && /fork/i.test(ws));
  s.check("G38g the agent body names the disposal hazard and the fallback, not just the command",
    /WORKDIR_CLEANUP/.test(prm) && /--no-hooks/.test(prm) && /\.git\/worktrees/.test(prm)
    && /git worktree add --detach/.test(prm),
    "Step 1.1b must carry the disposal rule and the no-gw path, since that is where it binds");

  // (h) The two pre-table routing rules in depth-routing.md. Both exist because "first match wins"
  // over the raw table produced a wrong answer that the file's own worked example contradicted:
  // a 412-line generated refresh routed `deep` on line count while reaching nothing, and a
  // review-answering push was claimed by the standard row's size band.
  s.check("G38h depth-routing.md excludes docs/test-only/generated deltas from the size triggers",
    /docs-only[\s\S]{0,200}test-only[\s\S]{0,400}size\s+trigger/i.test(depth));
  s.check("G38h the size exclusion still routes on every other row",
    /excused\s+from size, not from review/.test(depth));
  // Both conjuncts matter: `indexOf` on an absent string returns -1, which is less than any real
  // index, so a check that only compared positions would PASS on an override that had been
  // deleted outright — the very regression it exists to catch.
  const overrideAt = depth.indexOf("The `quick` override");
  const tableAt = depth.indexOf("| **deep**");
  s.check("G38h the quick override is stated, and before the table rather than as a row",
    overrideAt >= 0 && tableAt >= 0 && overrideAt < tableAt,
    overrideAt < 0 ? "the quick override is gone"
      : "the override sits inside or below the table, where first-match-wins lets the standard row outrank it");
  s.check("G38h the semver standard trigger is qualified by usage sites",
    /semver_delta`?\s*\*\*with ≥ 1 usage site\*\*/.test(depth),
    "an unused bump routes to standard again, so every automated bump PR buys a finder pass");
}

// ── G39: the bug-detection eval is executable and its golden set is well-formed ──
//
// A golden set is the only thing that says whether the detection core actually detects. Executing
// the runner's own self-test here means a malformed record — a control carrying a defect, a defect
// anchored in a file the finder is never shown — is caught in CI rather than by a strange L2 score
// nobody can explain. This runs offline; the LLM half needs a key and stays out of L1.
{
  const RUNNER = join(REPO_ROOT, "scripts/eval/l2-detection.mjs");
  const GOLDEN = join(REPO_ROOT, "scripts/eval/golden/bug-detection.jsonl");
  s.check("G39a the detection runner and its golden set exist",
    existsSync(RUNNER) && existsSync(GOLDEN));
  if (existsSync(RUNNER) && existsSync(GOLDEN)) {
    const r = spawnSync("node", [RUNNER, "--self-test"], { encoding: "utf8" });
    s.check("G39b the detection runner's self-test passes", r.status === 0,
      ((r.stdout || "") + (r.stderr || "")).split("\n").filter((l) => l.includes("✗")).join("; ").slice(0, 300));

    // The runner exits 0 without a key. That is correct behaviour, and it is also how a broken
    // runner hides: assert the skip is a SKIP and not a silent pass of the real thing.
    const noKey = spawnSync("node", [RUNNER], { encoding: "utf8", env: { ...process.env, ANTHROPIC_API_KEY: "" } });
    s.check("G39c the detection runner skips cleanly with no API key",
      noKey.status === 0 && /no ANTHROPIC_API_KEY/.test(noKey.stdout || ""));
  }
}

// ── G46: the inline comment surface has a renderer, and it shares ONE vocabulary with the report ──
//
// The report got `render-report.mjs` because runs stopped copying its template and started
// remembering it. The inline surface had the same problem and the opposite treatment: a prose rule
// plus a `passes_shape()` function in Python that nothing ever executed — so on dash0hq/dash0#18362
// one posted finding dropped three documented decorations at once (the severity label, the bold on
// `**(blocking)**`, and its position) and omitted the fix fence its own rule requires.
//
// These checks are behavioural, not textual, for the same reason G25's are: text-matching a correct
// prose spec was never going to catch a run that ignores it.
{
  const SPINE = join(REPO_ROOT, "agents/pr-reviewer/scripts/comment-spine.mjs");
  const RENDER = join(REPO_ROOT, "agents/pr-reviewer/scripts/render-comment.mjs");
  const FIX = join(REPO_ROOT, "scripts/eval/fixtures/inline-comment");
  const run = (args, input) => {
    const r = spawnSync("node", [RENDER, ...args], { input, encoding: "utf8" });
    return { ok: r.status === 0, out: r.stdout || "", err: (r.stderr || "").trim() };
  };

  s.check("G46a the inline renderer and the shared spine both exist",
    existsSync(RENDER) && existsSync(SPINE));

  if (existsSync(RENDER) && existsSync(SPINE)) {
    // (a) The renderer's own self-test. Every case in it is a shape that shipped or was one edit
    // from shipping, so a regression in the caps is a CI failure rather than a posted comment.
    const st = spawnSync("node", [RENDER, "--self-test"], { encoding: "utf8" });
    s.check("G46b the inline renderer's self-test passes", st.status === 0,
      ((st.stdout || "") + (st.stderr || "")).split("\n").filter((l) => l.includes("—"))
        .join("; ").slice(0, 400));

    // (b) Snapshot parity, discovered from disk so a new fixture is never silently exempt.
    const fixtures = existsSync(FIX)
      ? readdirSync(FIX).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort()
      : [];
    s.check("G46c the inline surface has committed reference renderings", fixtures.length >= 3,
      `${fixtures.length} fixture(s)`);
    for (const name of fixtures) {
      const expectedPath = join(FIX, `${name}.expected.md`);
      if (!existsSync(expectedPath)) {
        s.check(`G46d ${name} fixture + snapshot present`, false, "missing snapshot");
        continue;
      }
      const r = run([join(FIX, `${name}.json`)]);
      s.check(`G46d ${name}.json renders without error`, r.ok, r.err);
      const expected = readFileSync(expectedPath, "utf8");
      s.check(`G46d ${name} output matches its committed snapshot`, r.out === expected,
        r.out === expected ? "" : "output drifted — regenerate the snapshot and review the diff");
    }

    // (c) The invariants the posted comment in the screenshots broke. Asserted on every snapshot,
    // because these are the properties that make the two surfaces read as one reviewer.
    for (const name of fixtures) {
      const p = join(FIX, `${name}.expected.md`);
      if (!existsSync(p)) continue;
      const body = readFileSync(p, "utf8");
      const first = body.split("\n")[0];
      // The prefix stays at position 0 with the tier immediately after it, because
      // record-comment-relevance.mjs reads the tier off exactly that shape.
      s.check(`G46e ${name} opens with a Conventional-Comments prefix`,
        /^(praise|nitpick|suggestion|issue|question)( \((critical|high|medium|low)\)):/.test(first),
        first.slice(0, 60));
      // The recorder's own regex, verbatim — a guard that paraphrases it is not a guard on it.
      s.check(`G46e ${name} tier is readable by the relevance recorder's SEVERITY_RE`,
        /^\s*\*{0,2}(?:issue|suggestion|nitpick|nit|question|praise|chore)\s*\((critical|high|medium|low)\)/i
          .test(body), first.slice(0, 60));
      // The blocking/non-blocking token is bold and on line 1 — other rules parse it, and Gate 3
      // reads it to decide whether an open thread fails a PR.
      if (/\*\*\(blocking\)\*\*|\*\*\(non-blocking\)\*\*/.test(body)) {
        s.check(`G46e ${name} keeps its bold decoration on line 1`,
          /\*\*\((?:non-)?blocking\)\*\*\s*$/.test(first), first.slice(-40));
      }
      // The footer is the cue that makes an inline finding and the report the same reviewer, and
      // the only attribution visible in a notification email. What is SHARED is the identity half
      // — `pr-reviewer` plus the commit sha — and on this surface that is the whole footer: the
      // methodology link is report-only (`comment-spine.mjs` § footerLine, `docs` off by default),
      // because a reader asking how a finding was produced is asking about the run, and repeating
      // one link per finding restated it 4–20 times on a busy PR.
      s.check(`G46e ${name} carries the shared attribution footer`,
        /^<sup>`pr-reviewer` · commit `[0-9a-f]{7}`<\/sup>$/m.test(body));
      // Asserted as an absence too, in the direction this regresses: the check above matches the
      // whole line, so it would already fail — but naming the link makes the failure say WHICH
      // asymmetry broke rather than "the footer drifted".
      s.check(`G46e ${name} carries no methodology link (report-only)`,
        !body.includes("how these findings are produced"),
        "the report owns that link once per review; an inline copy is the drift the docs flag prevents");
      // No heading, no bullets — the shape rule the report's `### ` headline is the counterpart of.
      s.check(`G46e ${name} uses no heading`, !/^#{1,6} /m.test(body));
      // A claim carries a title in bold; a one-liner carries none. Both are checked, because the
      // interesting failure is a nitpick that grew a title as much as an issue that lost one.
      const isClaim = /^(issue|suggestion)/.test(first);
      s.check(`G46e ${name} ${isClaim ? "carries" : "carries no"} a bold title`,
        /\*\*[^*(]/.test(first) === isClaim, first.slice(0, 70));
    }

    // (d) The two surfaces import the SAME vocabulary. This is the check that makes consistency
    // structural: a glyph map or footer builder copied into one renderer would drift on the first
    // edit that touched only one of them, which is how the two surfaces came to share nothing.
    const spine = readFileSync(SPINE, "utf8");
    const inline = readFileSync(RENDER, "utf8");
    const report = readFileSync(join(REPO_ROOT, "agents/pr-reviewer/scripts/render-report.mjs"), "utf8");
    for (const [file, src] of [["render-comment.mjs", inline], ["render-report.mjs", report]]) {
      s.check(`G46f ${file} imports the shared spine`,
        /from "\.\/comment-spine\.mjs"/.test(src));
      for (const shared of ["TIER_GLYPH", "footerLine"]) {
        s.check(`G46f ${file} takes ${shared} from the spine, not a local copy`,
          new RegExp(`import[\\s\\S]*?${shared}[\\s\\S]*?comment-spine`).test(src)
          && !new RegExp(`(const|function)\\s+${shared}\\b`).test(src));
      }
    }
    // The glyph set is defined exactly once in the repo's renderer layer.
    for (const [file, src] of [["render-comment.mjs", inline], ["render-report.mjs", report]]) {
      s.check(`G46f ${file} declares no second glyph map`,
        !/\{\s*critical:\s*"/.test(src.replace(/^import[\s\S]*?;$/m, "")));
    }
    s.check("G46f the spine is where the glyph set lives", /TIER_GLYPH = \{ critical:/.test(spine));

    // `assertPlain` needs its own form. The report renderer legitimately WRAPS it — the spine
    // throws and this renderer must exit non-zero with nothing on stdout — so the no-local-binding
    // test above would reject a correct delegation. The defect it must catch is a second
    // IMPLEMENTATION, and the signal for that is the spine's own error strings appearing in a
    // renderer: this file carried a behaviourally identical copy through the whole parity change,
    // validating the same fields against a second definition of "plain".
    for (const [file, src] of [["render-comment.mjs", inline], ["render-report.mjs", report]]) {
      s.check(`G46f ${file} imports assertPlain from the spine`,
        /import[\s\S]*?assertPlain[\s\S]*?comment-spine/.test(src),
        "one definition of plain, or the two surfaces validate the same field two ways");
      s.check(`G46f ${file} carries no second assertPlain implementation`,
        !/contains a markdown link/.test(src) && !/contains a backtick/.test(src),
        "a behaviourally identical local copy is the drift the spine exists to prevent");
    }

    // The pipe is the FOURTH check on the finding title, and the one the parity change missed.
    // `render-report.mjs` rejects it (a table cell cannot be escaped out of) and the inline
    // renderer did not — the worst available failure ordering, since every comment posts and then
    // the report indexing them is lost. Both surfaces bound this string or neither does.
    for (const [file, src] of [["render-comment.mjs", inline], ["render-report.mjs", report]]) {
      s.check(`G46f ${file} rejects a pipe in the finding title`,
        /includes\("\|"\)/.test(src), "the title is one string on two surfaces");
    }
    const pipeTitle = JSON.parse(readFileSync(join(FIX, "issue-blocking.json"), "utf8"));
    pipeTitle.TITLE = "Fix button | costs too much";
    const pipeRun = run([], JSON.stringify(pipeTitle));
    s.check("G46f the inline renderer rejects a piped title", !pipeRun.ok,
      "it renders fine in bold and destroys the report row that indexes it");
    s.check("G46f rejecting a piped title emits nothing on stdout", (pipeRun.out || "") === "",
      (pipeRun.out || "").slice(0, 80));

    // (e) WCAG 1.4.1: the glyph is never the sole carrier of the tier. `🔴 3 · 🟠 1` is unreadable
    // to anyone who does not already know the mapping and announces as four colour names.
    s.check("G46g the tally pairs every glyph with its word",
      /`\$\{TIER_GLYPH\[t\]\} \$\{counts\[t\]\} \$\{t\}`/.test(spine));

    // (e2) The Step 4b pre-flight and the renderer must agree about what a well-formed body is.
    // They are two implementations of one contract in two languages, and the pre-flight aborts the
    // WHOLE post rather than dropping one comment — so a disagreement does not lose a finding, it
    // loses the review. Caught exactly that while writing this: the <picture> button markup is
    // ~430 chars and was being measured as prose, which rejected every rendered claim.
    //
    // Executed, not text-matched: extract `payload_is_safe` from the agent body and run the
    // committed reference renderings through it.
    {
      const agentBody = readFileSync(join(REPO_ROOT, "agents/pr-reviewer.md"), "utf8");
      const m = agentBody.match(/^def payload_is_safe\([\s\S]*?\n    return \(True, ""\)$/m);
      s.check("G46i the Step 4b pre-flight is extractable from the agent body", !!m,
        "payload_is_safe not found — the fence shape changed");
      if (m) {
        const comments = fixtures.map((name) => {
          const body = readFileSync(join(FIX, `${name}.expected.md`), "utf8");
          return { path: "a.ts", line: 1, side: "RIGHT", body };
        });
        const prog = `${m[0]}\nimport json,sys\n`
          + `ok, why = payload_is_safe({"event":"COMMENT","body":"<!-- PR_REVIEWER_POINTER -->",`
          + `"comments": json.loads(sys.argv[1])})\nprint(json.dumps([ok, why]))\n`;
        const r = spawnSync("python3", ["-c", prog, JSON.stringify(comments)], { encoding: "utf8" });
        s.check("G46i the pre-flight runs", r.status === 0, (r.stderr || "").slice(0, 300));
        if (r.status === 0) {
          let verdict = [null, ""];
          try { verdict = JSON.parse(r.stdout); } catch { /* reported below */ }
          s.check("G46i the pre-flight accepts every rendered reference body", verdict[0] === true,
            `rejected: ${verdict[1]}`);
        }
      }
    }

    // (f) Fail-closed, and silent on stdout — a caller that pipes stdout can never post a fragment.
    const good = JSON.parse(readFileSync(join(FIX, "issue-blocking.json"), "utf8"));
    const mutate = (fn) => { const c = structuredClone(good); fn(c); return JSON.stringify(c); };
    for (const [why, payload] of [
      ["a missing title on a claim", mutate((c) => { delete c.TITLE; })],
      ["a hand-typed fingerprint", mutate((c) => { c.FP = "persona1:vibes:f@a.ts"; })],
      ["a typo'd slot", mutate((c) => { c.TITEL = "x"; })],
      ["a non-Agent0 button host", mutate((c) => { c.FIX_URL = "https://evil.example.com/x"; })],
      ["a 40-char sha", mutate((c) => { c.SHA = "7389036aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; })],
      ["malformed JSON", "{nope"],
    ]) {
      const r = run([], payload);
      s.check(`G46h the inline renderer rejects ${why}`, !r.ok, r.ok ? "ACCEPTED" : "");
      s.check(`G46h rejecting ${why} emits nothing on stdout`, r.out === "", r.out.slice(0, 60));
    }

    // (j) The relay length budget. A write path that carries the body as a tool-call argument
    // rewrites a long unbroken run into a code span, which closes the href and escapes the markup
    // after it — measured on mthines/agent-skills#165. The budget is executable, not prose: it is a
    // number in the spine that both the agent body and the rule have to agree with, because the
    // whole failure mode was a correct renderer plus a documented cause that was wrong.
    // Read once, up front: the (j) / (k) / (l) / (m) groups all cross-check the same three
    // documents against the spine's live exports.
    const fixRule = readFileSync(join(REPO_ROOT, "agents/shared/rules/agent0-fix-links.md"), "utf8");
    const agentBody = readFileSync(join(REPO_ROOT, "agents/pr-reviewer.md"), "utf8");
    const assetMod = await import(pathToFileURL(SPINE).href);
    const relay = (body) => {
      const f = join(tmpdir(), `l1-relay-${Math.random().toString(36).slice(2)}.md`);
      writeFileSync(f, body);
      const r = spawnSync("node", [SPINE, "--relay-check", f], { encoding: "utf8" });
      rmSync(f, { force: true });
      return r;
    };
    const budget = 140;
    s.check("G46j the spine states the relay budget as an executable constant",
      new RegExp(`RELAY_SAFE_URL_MAX = ${budget}`).test(spine),
      "RELAY_SAFE_URL_MAX must be a named export the agent and the rule can both cite");

    const shortUrl = `https://app.dash0.com/goto/agent0?auto_submit=true&initial_prompt=Fix`;
    const longUrl = shortUrl + "%20" + "x".repeat(budget);
    s.check(`G46j a URL inside the ${budget}-char budget is relay-safe`,
      relay(`<a href="${shortUrl}"><img alt="Fix with Agent0" src="x"></a>`).status === 0,
      `rejected a ${shortUrl.length}-char url`);
    const over = relay(`<a href="${longUrl}"><img alt="Fix with Agent0" src="x"></a>`);
    s.check("G46j an over-budget URL is reported, with its length and the budget",
      over.status === 1 && /relay-unsafe url \(\d+ chars, over 140\)/.test(over.stderr),
      (over.stderr || "").slice(0, 200));
    s.check("G46j the over-budget message names the remedy, not a shorter prompt",
      /--no-fix-links|from a file/.test(over.stderr) && !/shorten the prompt/.test(over.stderr),
      "withholding the button is the remedy; truncating the prompt ships a useless button");
    // A fenced quote may legitimately contain anything, including a long url from the diff.
    s.check("G46j a long URL inside a fence is not a relay finding",
      relay(`before\n\n\`\`\`\n${longUrl}\n\`\`\`\n\nafter\n`).status === 0);
    // The real link is the case that matters: it does NOT fit, and the docs must not pretend it can.
    const realLink = spawnSync("node",
      [join(REPO_ROOT, "agents/pr-reviewer/scripts/build-agent0-link.mjs"),
        "--env", "production", "--source", "fix-this",
        "Fix the finding at agents/pr-reviewer/scripts/comment-spine.mjs:180 on mthines/agent-skills#165."],
      { encoding: "utf8" });
    s.check("G46j a full-fidelity fix-this link is over the budget, as documented",
      realLink.status === 0 && realLink.stdout.trim().length > budget,
      `link was ${realLink.stdout.trim().length} chars — if this now fits, the rule's table is stale`);

    // The exit code has to name what the REMEDY reaches, not what the relay damages. Reporting a
    // long non-fix-link as exit 1 sent the caller to `--no-fix-links`, which removes Agent0 deep
    // links and nothing else: the re-render failed the identical check with nothing left to try.
    const longDoc = `https://lorekit.example.com/${"d".repeat(budget)}`;
    const otherOver = relay(`see <${longDoc}>\n`);
    s.check("G46j a long URL that is not a fix link exits 3, not 1",
      otherOver.status === 3,
      `exit ${otherOver.status} — exit 1 points at a remedy that cannot remove this URL`);
    s.check("G46j the exit-3 message says the remedy does not apply",
      /--no-fix-links removes none of them/.test(otherOver.stderr),
      (otherOver.stderr || "").slice(0, 200));
    s.check("G46j a fix link still exits 1 when both kinds are over budget",
      relay(`see <${longDoc}>\n\n<a href="${longUrl}"><img alt="Fix with Agent0" src="x"></a>`)
        .status === 1,
      "a remediable URL present anywhere makes the run remediable");
    s.check("G46j the spine exports the fix-link partition",
      /export function relayUnsafeFixLinks\(/.test(spine),
      "the two classes need different answers, so the partition has to be a function");
    for (const [surface, target] of [
      ["the sticky", "--relay-check /tmp/report-body.md"],
      ["the inline surface", "--relay-check /tmp/finding-$i.md"],
    ]) {
      const idx = agentBody.indexOf(target);
      s.check(`G46j ${surface} branches on the relay exit code rather than on truthiness`,
        idx > 0 && /^\s*case \$\? in/m.test(agentBody.slice(idx, idx + 320)),
        "`|| withhold` collapses 3 into 1 and re-renders a body that cannot pass");
    }
    s.check("G46j the rule documents exit 3 as post-as-rendered",
      /Exit 3 — something else is over budget/.test(fixRule)
        && /relayUnsafeFixLinks\(\)/.test(fixRule),
      "agent0-fix-links.md owns the exit-code table; a third code that is not in it is invisible");

    // The codes are ONE exit status, so 1 outranks 3 and the exit-3 condition can survive the
    // withhold: a body with both a fix link and a cited link over budget re-renders, posts, and
    // never names the citation the relay is still going to mangle. Every place that acts on exit 1
    // must therefore ask again on the re-rendered body — both call sites and the rule that owns
    // the table, or the obligation is discharged in one and dropped in the others.
    for (const [where, src, anchorRe] of [
      ["the inline call site", agentBody, /finding-\$i\.md[\s\S]{0,400}?rc=\$\?/],
      ["the sticky call site", agentBody, /RERENDER_WITH_NO_FIX_LINKS[\s\S]{0,400}?rc=\$\?/],
      ["the rule", fixRule, /1 outranks 3[\s\S]{0,200}?rc=\$\?/],
    ]) {
      s.check(`G46j ${where} re-checks the relay after the exit-1 remedy`, anchorRe.test(src),
        "exit 1 means this RUN is remediable, not that the body is otherwise clean");
    }
    s.check("G46j the surviving exit-3 condition reaches the run line",
      /NOTE_MANGLED_LINK=1/.test(agentBody) && /note_mangled_link/.test(fixRule),
      "a re-check whose result goes nowhere is the same silence with an extra step");

    // (l) The post pre-flight's prose ceiling, measured against the renderer rather than restated.
    // `UNVERIFIED_MAX` was added to the spine and this ceiling did not move, so a finding legal
    // under every per-field cap tripped a predicate that ABORTS THE WHOLE POST — one maximal
    // finding took the entire batch down. The guard renders the maximal legal payload for each
    // shape and applies the pre-flight's own documented strips, so the next cap added to the spine
    // fails a check here instead of a review in production.
    const ceilingM = agentBody.match(/if len\(_prose\) > (\d+):/);
    s.check("G46l the post pre-flight states its prose ceiling as a number L1 can read",
      !!ceilingM, "payload_is_safe must keep the `if len(_prose) > N:` form");
    const ceiling = Number(ceilingM?.[1] ?? 0);
    // Exactly the strips payload_is_safe performs, in its order.
    const preflightProse = (body) => body
      .replace(/```[a-zA-Z0-9_+-]*\n[\s\S]*?\n```/g, "")
      .replace(/^Evidence:.*$/gm, "")
      .replace(/^<sup>`pr-reviewer`.*$/gm, "")
      .replace(/^<a href="https:\/\/app\.dash0(?:-dev)?\.com\/.*$/gm, "")
      .replace(/^_Pseudo-code — verify before applying\._$/gm, "")
      .replace(/\s*\(unverified: [^)]*\)/g, "")
      .replace(/<!--\s*fp:v\d+:[^\s>]+?\s*-->/g, "")
      .trim();
    // The SECOND ceiling in the same predicate, on the whole body rather than the prose. It had no
    // coverage at all while the prose one did, which is how it came to describe the fix button as
    // "~430 chars" long after the theme split doubled that element into two <source> plus an <img>.
    // Measured: a legal `issue:` at every cap with a 10-line fence and a 408-char link renders 2208
    // chars, 933 of it button — over a 2000 ceiling that ABORTS THE WHOLE POST. Both ceilings are
    // read out of the source and both are measured here, so neither can drift alone again.
    const bodyCeilingM = agentBody.match(/if len\(_body\) > (\d+):/);
    s.check("G46l the post pre-flight states its whole-body ceiling as a number L1 can read",
      !!bodyCeilingM, "payload_is_safe must keep the `if len(_body) > N:` form");
    const bodyCeiling = Number(bodyCeilingM?.[1] ?? 0);
    // The one strip the body measurement performs: the button, whose length is the deep link's.
    // Applied HERE only if the source actually applies it — a hand-copied strip would make this
    // measurement pass on a predicate that no longer strips anything, which is a guard measuring
    // its own copy of the rule. Conditioning on the source makes the measurement the real gate.
    const bodyStripsButton = /_body = _re\.sub\(\s*r'\^<a href="https:\/\/app\\\.dash0/.test(agentBody);
    const preflightBody = (body) => bodyStripsButton
      ? body.replace(/^<a href="https:\/\/app\.dash0(?:-dev)?\.com\/.*$/gm, "")
      : body;
    // A real link through the real builder, at a realistic prompt length — the encoding and the
    // `<picture>` markup around it are what this measures, so neither may be approximated here.
    const { buildLink } = await import(
      pathToFileURL(join(REPO_ROOT, "agents/pr-reviewer/scripts/build-agent0-link.mjs")).href);
    const maxFixUrl = buildLink(
      `/pr-fix https://github.com/${"o".repeat(20)}/${"r".repeat(20)}/pull/165 pr-reviewer — `
        + "apply only the finding at ".repeat(6), "development", "fix-this");
    const tenLineFence = { lang: "ts", code: Array.from({ length: 10 },
      (_, i) => `  const someValue${i} = computeSomething(argumentOne, argumentTwo);`).join("\n") };
    const maximal = [
      ["a claim at every cap, unverified", "suggestion-pseudo",
        { TITLE: "T".repeat(assetMod.TITLE_MAX), BODY: "P".repeat(assetMod.PROSE_MAX),
          UNVERIFIED: "U".repeat(assetMod.UNVERIFIED_MAX), EVIDENCE: undefined }],
      ["a claim at every cap, verified", "suggestion-pseudo",
        { TITLE: "T".repeat(assetMod.TITLE_MAX), BODY: "P".repeat(assetMod.PROSE_MAX) }],
      ["a one-liner at its cap", "nitpick", { BODY: "P".repeat(assetMod.PROSE_MAX) }],
      // The shape that broke the whole-body ceiling: every cap, a 10-line fence AND a fix button.
      ["a blocking claim at every cap with a 10-line fence and a fix button", "issue-blocking",
        { TITLE: "T".repeat(assetMod.TITLE_MAX), BODY: "P".repeat(assetMod.PROSE_MAX),
          FENCE: tenLineFence, FIX_URL: maxFixUrl }],
    ];
    for (const [label, base, over] of maximal) {
      const payload = { ...JSON.parse(readFileSync(join(FIX, `${base}.json`), "utf8")), ...over };
      for (const k of Object.keys(over)) if (over[k] === undefined) delete payload[k];
      const r = run([], JSON.stringify(payload));
      s.check(`G46l ${label} renders`, r.ok, (r.err || "").slice(0, 140));
      if (!r.ok) continue;
      const n = preflightProse(r.out).length;
      s.check(`G46l ${label} fits the ${ceiling}-char prose pre-flight (${n})`, n <= ceiling,
        `${n} > ${ceiling} — payload_is_safe aborts the WHOLE post, so this drops every finding`);
      const b = preflightBody(r.out).length;
      s.check(`G46l ${label} fits the ${bodyCeiling}-char body pre-flight (${b})`, b <= bodyCeiling,
        `${b} > ${bodyCeiling} — payload_is_safe aborts the WHOLE post, so this drops every finding`);
    }
    s.check("G46l the pre-flight strips the unverified tag it does not bound",
      /_prose = _re\.sub\(r"\\s\*\\\(unverified: \[\^\)\]\*\\\)"/.test(agentBody),
      "the tag is a rendered decoration like the fence and the button — strip it, do not re-bound it");
    // The body measurement is only survivable because the button is stripped from it too: the
    // element is ~525 chars of boilerplate plus a URL `build-agent0-link.mjs` bounds at 4000, so a
    // maximal button alone can exceed any ceiling this predicate could name.
    s.check("G46l the whole-body ceiling excludes the fix button",
      bodyStripsButton && /fix button excluded/.test(agentBody),
      "measure the body without the button, exactly as the prose measurement does");

    // (m) The finding title is one string on two surfaces, so one cap governs both. The report
    // renderer had `assertPlain` and no length check while the comment renderer enforced
    // TITLE_MAX — so an over-long title rendered a report row and then failed the comment that
    // row indexes, after the report had already been written.
    const reportRenderer = readFileSync(join(REPO_ROOT, "agents/pr-reviewer/scripts/render-report.mjs"), "utf8");
    s.check("G46m the report renderer imports TITLE_MAX from the spine",
      /TITLE_MAX/.test(reportRenderer.slice(0, reportRenderer.indexOf('} from "./comment-spine.mjs"'))),
      "a local copy of the cap is the drift this spine exists to prevent");
    const warnPayload = JSON.parse(readFileSync(join(FIX, "../report-body/warn.json"), "utf8"));
    const overTitle = structuredClone(warnPayload);
    overTitle.FINDINGS[0].title = "W".repeat(assetMod.TITLE_MAX + 1);
    const rr = spawnSync("node", [join(REPO_ROOT, "agents/pr-reviewer/scripts/render-report.mjs")],
      { input: JSON.stringify(overTitle), encoding: "utf8" });
    s.check("G46m the report renderer rejects a title over TITLE_MAX", rr.status !== 0,
      "the report indexes the inline finding; a title it accepts must be one the comment can post");
    s.check("G46m rejecting an over-long title emits nothing on stdout", rr.stdout === "",
      (rr.stdout || "").slice(0, 80));

    // The reasons line is the same count stated twice — once as a list, once as the gate table
    // above it. FAIL_REASONS was cross-checked against the ❌ count and WARN_REASONS against
    // nothing, so a WARN could claim more warnings than it had gates; `reasonList` truncates at
    // two phrases, so it did not even look wrong. Both polarities or neither.
    const renderReport = (mut) => {
      const p = structuredClone(warnPayload); mut(p);
      return spawnSync("node", [join(REPO_ROOT, "agents/pr-reviewer/scripts/render-report.mjs")],
        { input: JSON.stringify(p), encoding: "utf8" });
    };
    // The gate statuses are individual `GATE_<NAME>_STATUS` slots, not one array, and CI has no
    // row at all — `CI_NOTE` is its whole surface, and it is informational-in-`Run` only, so it
    // never counts toward the warning-gate total.
    const warnGates = Object.entries(warnPayload)
      .filter(([k, v]) => /^GATE_[A-Z]+_STATUS$/.test(k) && v === "⚠️").length;
    const tooManyWarn = renderReport((p) => {
      p.WARN_REASONS = Array.from({ length: warnGates + 2 }, (_, i) => `phantom warning ${i + 1}`);
    });
    s.check("G46m the report renderer rejects more WARN_REASONS than ⚠️ gates",
      tooManyWarn.status !== 0 && /WARN_REASONS has \d+ phrases but only \d+ gate/.test(tooManyWarn.stderr),
      (tooManyWarn.stderr || "").slice(0, 160));
    s.check("G46m a WARN verdict with no WARN_REASONS is rejected",
      renderReport((p) => { p.WARN_REASONS = []; }).status !== 0,
      "the FAIL branch requires a reason phrase; the WARN branch cannot be laxer");
    // Parity is all three checks the inline renderer applies to the same string, not just the
    // length one — a title is a noun phrase on both surfaces or on neither.
    for (const [what, bad] of [
      ["sentence punctuation", "The registry is never wired up."],
      ["block structure", "- a bulleted title"],
    ]) {
      s.check(`G46m the report renderer rejects a title carrying ${what}`,
        renderReport((p) => { p.FINDINGS[0].title = bad; }).status !== 0,
        `render-comment.mjs rejects it, so the row that indexes it cannot accept it`);
    }
    s.check("G46m the cross-check is symmetric in the source, not just in behaviour",
      /WARN_REASONS"\)\.length > warning/.test(reportRenderer)
        && /FAIL_REASONS"\)\.length > failing/.test(reportRenderer),
      "one polarity validated and not the other is the shape FINDINGS[].title had in this file");

    // The rule and the agent body both have to carry it. The wrong-cause version of this section
    // read as correct and was invisible to every other guard here.
    s.check("G46j the rule documents the relay length limit",
      /## Relay length limit/.test(fixRule) && /RELAY_SAFE_URL_MAX = 140/.test(fixRule),
      "agent0-fix-links.md must own the measured table and cite the same constant");
    s.check("G46j the rule forbids shrinking the prompt to fit",
      /worse than no button/.test(fixRule),
      "a truncated prompt opens a session with no idea what to fix — say so");
    // (k) The button's image has to exist at the URL the markup names. Offline, so this asserts the
    // FILE is in the repo and the markup follows GitHub's documented three-element form; the 404
    // case is a live HEAD check the agent runs (`--assets-check`), because whether a path is on the
    // default branch is not knowable from a working tree.
    const ASSETS = join(REPO_ROOT, "agents/pr-reviewer/assets");
    s.check("G46k the spine enumerates every asset file it can reference",
      Array.isArray(assetMod.ASSET_FILES) && assetMod.ASSET_FILES.length === 6,
      `ASSET_FILES = ${JSON.stringify(assetMod.ASSET_FILES)}`);
    for (const f of assetMod.ASSET_FILES ?? []) {
      s.check(`G46k ${f} exists in the repo`, existsSync(join(ASSETS, f)),
        "fixButton names it, so a missing file is a broken-image icon on every review");
    }
    // The unsuffixed default is what email and RSS render — they ignore <source> entirely — and it
    // is the one filename that predates the theme split, so it must equal the light variant rather
    // than being left as whatever art shipped before.
    for (const stem of ["fix-this-agent0", "fix-all-agent0"]) {
      const dflt = join(ASSETS, `${stem}.svg`);
      const light = join(ASSETS, `${stem}-light.svg`);
      s.check(`G46k ${stem}.svg (the <img> default) matches the light variant`,
        existsSync(dflt) && existsSync(light)
          && readFileSync(dflt, "utf8") === readFileSync(light, "utf8"),
        "email and RSS render the default, so it cannot be stale art");
    }
    const btn = assetMod.fixButton({ kind: "this", url: "https://app.dash0.com/goto/agent0?x=1" });
    s.check("G46k the button follows GitHub's documented picture form (dark, light, then default)",
      /<picture><source media="\(prefers-color-scheme: dark\)"[^>]*><source media="\(prefers-color-scheme: light\)"[^>]*><img alt="[^"]+" src="[^"]*\/fix-this-agent0\.svg"/.test(btn),
      btn.slice(0, 200));
    s.check("G46k the <img> default is not a theme-suffixed file",
      !/<img[^>]*src="[^"]*-(dark|light)\.svg"/.test(btn),
      "picture does NOT fall back to img on a failed srcset, so the default must be the stable name");
    const assetsUrls = assetMod.assetUrls(btn);
    s.check("G46k assetUrls() finds all three of a button's assets", assetsUrls.length === 3,
      JSON.stringify(assetsUrls));
    s.check("G46k assetUrls() ignores a non-asset url",
      assetMod.assetUrls("see https://example.com/x.svg").length === 0);
    s.check("G46k the rule documents the asset-availability failure and its three exit codes",
      /## Asset availability/.test(fixRule) && /inconclusive is not a missing asset/.test(fixRule),
      "a network failure must never withhold a button that would have rendered");
    for (const [surface, target] of [
      ["the sticky", "--assets-check /tmp/report-body.md"],
      ["the inline surface", "--assets-check /tmp/finding-$i.md"],
    ]) {
      s.check(`G46k ${surface} checks its button assets before posting`,
        agentBody.includes(target), `no \`${target}\` call site`);
    }

    // Anchor each call site by the file it checks, not by counting the flag: the body mentions
    // `--relay-check` in prose too, so a count-based guard passed with a call site deleted.
    for (const [surface, target] of [
      ["the sticky", "--relay-check /tmp/report-body.md"],
      ["the inline surface", "--relay-check /tmp/finding-$i.md"],
    ]) {
      s.check(`G46j ${surface} runs the relay check on the body it is about to post`,
        agentBody.includes(target), `no \`${target}\` call site`);
    }
    s.check("G46j the agent body no longer blames the copy for the #165 mangling",
      /The cause is the relay, not the copy/.test(agentBody)
        && !/is the specific hazard\*\*/.test(agentBody),
      "the first diagnosis was falsified by measurement; a stale root cause misroutes the next fix");
  }
}

// ── G40: a rule file may not state a contract the agent body does not implement ──
//
// The first review of the detection core found four instances of ONE shape: a new rule stating a
// contract nothing binds, reads, or can render. That shape is invisible to every other guard here,
// because each half is internally consistent — the rule reads correctly and the body runs
// correctly, and only the seam between them is broken.
//
// The THREAD_OVERLAP case is the instructive one: a guard for it DID exist (the L2
// shape-depth-routing suite) and was neutralised by being fed its own answer — every golden record
// hands the model the value in its prompt, so the suite measures the table's ordering and never the
// input's availability. A contract-existence check has to look at the binding, not the decision.
{
  const read = (p) => readFileSync(join(REPO_ROOT, p), "utf8");
  const body = read("agents/pr-reviewer.md");
  const depth = read("agents/pr-reviewer/rules/depth-routing.md");
  const cfg = read("agents/shared/rules/review-config.md");

  // (a) Every input the routing table votes on is bound somewhere in the body.
  //
  // Matched case-insensitively on purpose: the rule names the impact.json field
  // (`blast_radius.band`) while the body names the bound variable (`BLAST_RADIUS`). Those are the
  // same concept in two conventions, and requiring one literal spelling across both files would
  // fail on a naming difference rather than on a missing binding.
  // The body's OWN input table is excluded from the search, and that exclusion is the whole
  // check. Its rows are claims *about* the bindings, not the bindings — `TRAFFIC_BAND` occurred
  // exactly once in the body, in the row asserting Step 1.2a bound it, and nothing did. A
  // presence test over the whole file reads that row as its own evidence.
  const inputTable = sliceBetween(body, "| Input | Bound at |", "`THREAD_OVERLAP` is the one input");
  const bodyOutsideTable = body.replace(inputTable, "");
  for (const input of ["THREAD_OVERLAP", "DEPTH_CAPABILITY", "BLAST_RADIUS", "TRAFFIC_BAND"]) {
    const needle = input.toLowerCase();
    s.check(`G40a ${input} is named in depth-routing.md`, depth.toLowerCase().includes(needle));
    s.check(`G40a ${input} is bound outside the body's own input table`,
      bodyOutsideTable.toLowerCase().includes(needle),
      `${input} appears in depth-routing.md and in the "Bound at" table, but nowhere that binds it`
      + " — a row claiming a binding is not one, and the row that reads it can never fire");
  }
  // The two graph-sourced inputs must be fields the producing script actually emits, or the
  // binding sentence names a value that never arrives.
  const graph = read("agents/pr-reviewer/scripts/build-impact-graph.mjs");
  for (const field of ["traffic_band", "blast_radius"]) {
    s.check(`G40a build-impact-graph.mjs emits ${field}, which the routing table reads`,
      new RegExp(`${field}:`).test(graph),
      `depth-routing.md routes on impact.json's ${field} but the script does not emit it`);
  }
  s.check("G40a THREAD_OVERLAP's binding states it is computed at tier-binding time, not read from Step 2.9c",
    /THREAD_OVERLAP\s*=/.test(body) && /2\.9c/.test(body.slice(body.indexOf("THREAD_OVERLAP ="))),
    "the body must show the formula AND say why Step 2.9c's predicate cannot be read directly (it runs after the tier is bound)");

  // (b) A flag the rules advertise is parseable at the run's only parse point.
  const step0 = body.slice(body.indexOf("| Token | Meaning |"), body.indexOf("Parse the PR reference:"));
  s.check("G40b --effort is in Step 0's token table",
    step0.includes("--effort"),
    "depth-routing.md and CLAUDE.md advertise --effort, so Step 0 must accept it or both entry points are unreachable");
  s.check("G40b the review-config half of --effort is defined",
    /^\s*effort:/m.test(cfg),
    "CLAUDE.md says '(or effort: in review-config)' — review-config.md must define the key it names");

  // (c) No rule may mandate a payload key the fail-closed renderer rejects. Asserted against the
  // renderer's real key sets, so adding a slot is what retires the check — not editing it.
  const renderer = read("agents/pr-reviewer/scripts/render-report.mjs");
  for (const f of ["agents/pr-reviewer/rules/depth-routing.md", "agents/pr-reviewer/rules/report-rendering.md"]) {
    const txt = read(f);
    const mandated = [...txt.matchAll(/\brender the headline with a `([A-Z_]+)`/gi)].map((m) => m[1]);
    for (const key of mandated) {
      s.check(`G40c ${f} mandates headline key ${key}, which the renderer must accept`,
        renderer.includes(key),
        `${key} is required by a rule but is not a renderer payload key — render-report.mjs fails closed, so a run that obeys the rule posts no report at all`);
    }
  }

  // (d) The one-read-one-head invariant is not contradicted by a rule telling the run to re-read.
  //
  // Asserted as a PAIR — the mandate is absent AND the deferral is stated — rather than as
  // "headRefOid is not re-read anywhere". A bare absence test cannot tell a mandate from the
  // ❌-marked counter-example or from the prose that says the run does *not* re-read, so it fired
  // on the very text that fixes the contradiction. Naming the exact retired sentence keeps the
  // check specific, and the positive half is what stops the section from going silent instead.
  s.check("G40d depth-routing.md no longer mandates a second headRefOid read before posting",
    !/\*\*Immediately before Step 4 posts\*\*,\s*re-read/i.test(depth),
    "Step 1.2 forbids a second headRefOid read (torn state: the diff and the SHA would describe different commits)");
  s.check("G40d depth-routing.md states the one-read-one-head deferral instead",
    /does \*\*not\*\* re-read/.test(depth) && /one read, one head/i.test(depth),
    "removing the mandate is not enough — the section must say what the run does instead, or the moved-head case is simply unhandled");
}

// ── G41: the five defects two production runs exposed, each pinned where it failed ──
//
// A `/pr-review` dispatch at dash0hq/dash0#17523 improvised its way past five rules that were
// either absent or stated only once, in prose, somewhere the run never reached. All five had the
// same signature: the run produced *plausible* output, so nothing downstream was red. These are
// the joint conditions — the rule is stated AND the thing it forbids does not appear.
{
  const read = (p) => readFileSync(join(REPO_ROOT, p), "utf8");
  const body = read("agents/pr-reviewer.md");

  // (a) The support-tree contract exists and derives AGENT_SUPPORT from the resolved path.
  s.check("G41a the agent body has a support-tree section that derives AGENT_SUPPORT",
    /^### Locating this agent's own files$/m.test(body)
    && /AGENT_SUPPORT="\$\{AGENT_MD%\/pr-reviewer\.md\}"/.test(body));

  // (b) The naive install path is banned as a probe. The observed run ran `ls` against
  // $HOME/.claude/agents/pr-reviewer/scripts/, read the ENOENT as proof the tree was missing,
  // and hand-wrote its report. The ban has to be stated, because the probe looks reasonable.
  s.check("G41b probing the un-resolved install path is banned by name",
    /Never probe the un-resolved install path/i.test(body)
    && /`?resolve\(\)`? is the only admissible test/i.test(body));

  // (c) Resolution happens at Step 0.1 — BEFORE Step 0.5 — so a degraded run is known to be
  // degraded while nothing is invested, not discovered at Step 4a with findings in hand.
  const i01 = body.indexOf("### 0.1 Resolve the support tree");
  const i05 = body.indexOf("## Step 0.5");
  s.check("G41c the support tree is resolved at Step 0.1, ahead of Step 0.5",
    i01 !== -1 && i05 !== -1 && i01 < i05,
    `0.1 at ${i01}, 0.5 at ${i05}`);
  s.check("G41c resolving the support tree is not read as a permission to post",
    /AGENT_SUPPORT` is a location, not a permission/.test(body));

  // (d) One derivation point. Every script call site addresses $AGENT_SUPPORT; the
  // `${AGENT_MD%/pr-reviewer.md}` form appears exactly where AGENT_SUPPORT is defined.
  const derivations = [...body.matchAll(/\$\{AGENT_MD%\/pr-reviewer\.md\}/g)].length;
  s.check("G41d ${AGENT_MD%/pr-reviewer.md} appears only where AGENT_SUPPORT is defined",
    derivations === 1, `found ${derivations} occurrence(s)`);
  s.check("G41d no script is addressed by a bare agents/pr-reviewer/scripts/ path in a node call",
    !/node\s+"?agents\/pr-reviewer\/scripts\//.test(body));

  // (e) The sticky-write not-a-reason list. The run stood down on two invented rules — the
  // sticky's author login, and an unchanged verdict — and left the delta baseline pinned.
  for (const phrase of [
    /is \*\*diagnostic only\*\*/,
    /The sticky's author login is not this run's `ME`/,
    /The verdict is unchanged since the prior run/,
    /The run produced no new inline findings/,
    /Another bot already reviews this PR/,
    /It is the caller's own PR \(self relation\)/,
  ]) {
    s.check(`G41e the sticky not-a-reason list names ${phrase.source.slice(0, 46)}`,
      phrase.test(body));
  }
  s.check("G41e the not-a-reason list closes with the imperative",
    /If a\s*\nsituation is not a row in the table above, \*\*write the sticky\*\*/.test(body));

  // (f) No brace-escaped STICKY default survives. The expression was correct; its escaped brace
  // did not survive being retyped, and the run took four jq parse errors on the one rung that
  // recovers the delta baseline. A correct-but-fragile idiom is a defect at this scale.
  // The ban is on the LIVE idiom, not on the comment that explains why it was retired — the
  // explanation has to be able to quote the shape it is warning about.
  s.check("G41f no ${STICKY:-…} brace default is used at a read site",
    !/<<<\s*"\$\{STICKY:-/.test(body));
  s.check("G41f STICKY is normalised to a brace-free JSON literal once",
    /\[ -n "\$STICKY" \] \|\| STICKY=null/.test(body));

  // (g) The empty merge-base guard, in the phase that owns the workspace. Both forms must be
  // named: the three-dot failure (loud, benign) and the two-dot hazard (silent, wrong).
  const ws = read("agents/pr-reviewer/rules/workspace.md");
  s.check("G41g workspace.md guards an empty merge-base",
    /empty `MERGE_BASE` is a hard branch/i.test(ws)
    && /no merge base/.test(ws)
    && /two-dot form succeeds, and that is the dangerous one/i.test(ws));
  s.check("G41g the empty-merge-base fallback is the authoritative per-file patches",
    /DIFF_SOURCE=api/.test(ws) && /per-file patches/.test(ws));
  s.check("G41g the fallback is announced in RUN_ANOMALY, not RUN_NOTE",
    /RUN_ANOMALY/.test(ws) && !/RUN_NOTE:/.test(ws));

  // (h) The memory read budget is a bound, not a description.
  const mem = read("agents/pr-reviewer/rules/memory.md");
  s.check("G41h memory.md states a fixed read budget with no pagination",
    /calls per run \| exactly \*\*2\*\*/.test(mem)
    && /\| pagination \| \*\*never\.\*\*/.test(mem)
    && /\*\*top 10\*\* changed symbols/.test(mem));
  // Anchored on the mcp__ call lines, not on the budget table that repeats the same numbers —
  // a table row is a promise, the call is the thing that keeps it.
  // The second pattern read `memory_search\s+scope=` until G44a was written, so this guard
  // was asserting the broken call shape it was meant to bound — the parameter is `q`, and
  // `scopes` is the array. A guard that mirrors a call by hand can pin the wrong one.
  s.check("G41h both memory reads carry an explicit limit at the call site",
    /mcp__lorekit__memory_list\s+scope=[^\n]*limit=50/.test(mem)
    && /mcp__lorekit__memory_search\s+q=[^\n]*limit=25/.test(mem));
}

// ── G42: the measurability lens is wired, bounded, and cannot block ──
//
// Same joint-condition discipline as G38: the rule existing proves nothing if the body never
// routes to it, and a lens with no quiet-exit gates is one the author learns to ignore.
{
  const read = (p) => readFileSync(join(REPO_ROOT, p), "utf8");
  const body = read("agents/pr-reviewer.md");
  const rule = read("agents/shared/rules/measurability-review.md");

  s.check("G42a measurability-review.md exists and the body routes to it at Step 2.4e",
    rule.length > 0
    && /^### 2\.4e Measurability review/m.test(body)
    && /measurability-review\.md/.test(body));

  // audit mode only — pr-reviewer is read-only in both relations.
  s.check("G42b the lens is audit-mode only and says so in both files",
    /Skill\("measurable", "audit"\)/.test(rule) && /Skill\("measurable", "audit"\)/.test(body)
    && /\*\*Never\*\* `Skill\("measurable", "implement"\)`/.test(rule));
  s.check("G42b neither file ever calls measurable in implement mode",
    !/Skill\("measurable",\s*"implement"\)/.test(body)
    && !/^\s*Skill\("measurable",\s*"implement"\)/m.test(rule));

  // Two quiet-exit gates. Without them the lens asks "where's the telemetry" on every diff.
  s.check("G42c both quiet-exit gates are defined",
    /### Gate 1 — the diff touches a path kind that needs a signal/.test(rule)
    && /### Gate 2 — the change adds or alters observable behaviour/.test(rule)
    && /new failure mode/.test(rule));

  // The bounded-blocking invariant: strict is the default, but the lens never lowers a verdict
  // and `unlinked` never blocks under either level — only a `missing` new-failure-mode gates.
  s.check("G42d unlinked never blocks, and the lens never lowers a verdict",
    /never \*\*lowers\*\* a verdict/.test(rule)
    && /FAIL_REASONS/.test(rule)
    && /never blocks and is never an `issue:`/.test(rule));
  s.check("G42d the level is a repository claim, not the reviewer's own judgment",
    /on (the reviewer's|its) own judgment/.test(rule)
    && /Strict is the \*\*default\*\*/.test(rule)
    && /measurable: strict/.test(rule) && /--measurable-strict/.test(body)
    && /--measurable-advisory/.test(body));

  // The seam with telemetry.md — two rules, opposite questions, neither answers the other's.
  s.check("G42e the seam with telemetry.md is stated in both directions",
    /## Seam with `telemetry\.md`/.test(rule)
    && /\*\*today\*\*/.test(rule) && /\*\*tomorrow\*\*/.test(rule));

  // The renderer accepts the slot and treats a clean audit as quiet. A required slot the
  // fail-closed renderer rejects would mean a run that obeys the rule posts no report at all.
  const renderer = read("agents/pr-reviewer/scripts/render-report.mjs");
  // Membership of REQUIRED_SCALARS specifically: the name appears in three places in the
  // renderer, so a bare substring test passes while the slot is no longer required.
  const requiredBlock = /const REQUIRED_SCALARS = \[([\s\S]*?)\];/.exec(renderer)?.[1] ?? "";
  s.check("G42f MEASURABILITY_LOG is a required renderer slot",
    requiredBlock.includes('"MEASURABILITY_LOG"'));
  s.check("G42f the renderer folds a clean measurability run into the footnote",
    /key: "MEASURABILITY_LOG"/.test(renderer)
    && /0 missing\\b/.test(renderer)
    && /0 unlinked\\b/.test(renderer));
  s.check("G42f the lens log grammar is shared by rule and renderer",
    /MEASURABILITY_LOG: <ran\|skipped \(<reason>\)> · <N> paths classified · <M> missing · <U> unlinked/
      .test(rule)
    && /\["OPTIMALITY_LOG", "STANDARDS_LOG", "MEASURABILITY_LOG"\]/.test(renderer));

  // The flag exists in Step 0's token table, or a documented opt-out is unreachable.
  s.check("G42g --no-measurable is in Step 0's token table",
    /\| `--no-measurable` \| Skip the measurability review step \(Step 2\.4e\) \|/.test(body));
}


// ── G43: the normative shell in these files is executable ────────────────────
//
// The shell in the agent body and its rule files is not illustration — an agent runs it
// verbatim — so an invocation that cannot parse and a variable that was never bound are
// both broken rungs, not shorthand. Both halves below are the general form of a defect a
// live review found, rather than a string match on the specific instance:
//
//   G43a  Three documented `build-impact-graph.mjs` invocations fed the input on stdin
//         where the script takes a positional path (`exit=2`, usage string, zero bytes
//         written), and one carried a bare value-less `--overlaps`, which silently
//         swallows the next argument. The contract is derived from the script's own argv
//         parser, so it tracks the script instead of restating it.
//   G43b  `BASE_SHA` was read in four places and bound in none: Step 1.1 fetched
//         `baseRefName` (a branch name) and never `baseRefOid`. It failed quietly at every
//         reader — `merge-base ""` exits 128 into a `|| true`, and the impact graph's base
//         reader degrades to `() => null` and still exits 0 — so a `checkout` run reported
//         full depth while reading no base side at all.
{
  const SHELL_MD = [
    "agents/pr-reviewer.md",
    ...readdirSync(join(REPO_ROOT, "agents/pr-reviewer/rules"))
      .filter((f) => f.endsWith(".md"))
      .map((f) => `agents/pr-reviewer/rules/${f}`),
  ];
  const readMd = (p) => readFileSync(join(REPO_ROOT, p), "utf8");
  const bashBlocks = (text) => [...text.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]);

  // ---- G43a: documented invocations must satisfy the script's own argv parser ----

  // Join `\`-continued lines, then drop `${VAR:+ … }` conditional wrappers, keeping their
  // contents — the tokens inside are real arguments whenever the variable is set.
  const commandsIn = (block) =>
    block
      .replace(/\\\n\s*/g, " ")
      .split("\n")
      .map((l) => l.replace(/\$\{[A-Z_]+:\+(.*?)\}/g, "$1").trim())
      .filter((l) => /^node\s/.test(l));

  const tokenize = (cmd) => cmd.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];

  // The parser contract, read out of the script rather than restated here. Two shapes are
  // in use and both must be understood, or a script parsing the other way reports every
  // flag as unknown — a guard failing on itself, not a defect in the docs.
  const flagContract = (src) => {
    const takesValue = new Set();
    const boolean = new Set();
    // Shape 1 — a switch over argv (build-impact-graph.mjs).
    for (const m of src.matchAll(/a === "(--[a-z-]+)"\)\s*flags\.\w+\s*=\s*([^;\n]+)/g)) {
      (/argv\[\+\+i\]/.test(m[2]) ? takesValue : boolean).add(m[1]);
    }
    // Shape 2 — an indexOf lookup helper (fingerprint.mjs's `flag(args, "name")`), which
    // returns `args[i + 1]`, so every name it reads takes a value.
    for (const m of src.matchAll(/\bflag\(args,\s*"([a-z-]+)"\)/g)) takesValue.add(`--${m[1]}`);
    // Positional switches are boolean by construction.
    for (const m of src.matchAll(/args\[\d+\] === "(--[a-z-]+)"/g)) boolean.add(m[1]);
    for (const m of src.matchAll(/cmd === "(--[a-z-]+)"/g)) boolean.add(m[1]);
    return { takesValue, boolean };
  };

  let invocations = 0;
  for (const mdPath of SHELL_MD) {
    for (const block of bashBlocks(readMd(mdPath))) {
      for (const cmd of commandsIn(block)) {
        const all = tokenize(cmd);
        const scriptTok = all.find((t) => t.replace(/"/g, "").endsWith(".mjs"));
        if (!scriptTok) continue;
        const base = scriptTok.replace(/"/g, "").split("/").pop();
        const scriptPath = join(REPO_ROOT, "agents/pr-reviewer/scripts", base);
        if (!existsSync(scriptPath)) continue;
        invocations++;
        const src = readFileSync(scriptPath, "utf8");
        const { takesValue, boolean } = flagContract(src);
        const needsPositional = /usage: \S+ <[a-z-]+\.json>/.test(src);
        const where = `${mdPath} → ${base}`;

        // The stdin defect. A script taking a positional path writes nothing when fed on
        // stdin, and an `exit 2` inside a `$(…)` or a pipeline is easy to read past.
        s.check(`G43a ${where}: input is not fed on stdin`,
          !needsPositional || !/(^|\s)<\s/.test(cmd));

        const toks = all.slice(all.indexOf(scriptTok) + 1);
        const positional = [];
        const unknownFlags = [];
        const valuelessFlags = [];
        for (let i = 0; i < toks.length; i++) {
          const t = toks[i];
          if (t === ">" || t === ">>" || t === "2>" || t === "|") { i++; continue; }
          if (t.startsWith(">") || t.startsWith("2>")) continue;
          if (!t.startsWith("--")) { positional.push(t); continue; }
          if (takesValue.has(t)) {
            const next = toks[i + 1];
            if (!next || next.startsWith("-") || next.startsWith(">")) valuelessFlags.push(t);
            else i++;
            continue;
          }
          if (!boolean.has(t)) unknownFlags.push(t);
        }

        // Guard the guard: an empty contract means the extractor did not understand this
        // script's parser, and every flag would read as unknown.
        const flagsUsed = toks.filter((t) => t.startsWith("--"));
        s.check(`G43a ${where}: the parser contract was extractable`,
          flagsUsed.length === 0 || takesValue.size + boolean.size > 0);
        s.check(`G43a ${where}: every flag is one the parser knows (saw: ${unknownFlags.join(" ") || "none"})`,
          unknownFlags.length === 0);
        // A value-taking flag written bare eats the next argument, so the command still
        // exits 0 while one argument has silently become another's value.
        s.check(`G43a ${where}: no value-taking flag is written bare (saw: ${valuelessFlags.join(" ") || "none"})`,
          valuelessFlags.length === 0);
        s.check(`G43a ${where}: the required input path is passed positionally`,
          !needsPositional || positional.some((p) => p.replace(/"/g, "").endsWith(".json")));
      }
    }
  }
  // The guard is worthless if the extractor silently matches nothing.
  s.check(`G43a the invocation extractor found the documented commands (${invocations})`,
    invocations >= 4);

  // ---- G43b: every variable a normative block reads has a binding ----

  // Provided by the shell or the environment, never by this pipeline.
  const SHELL_PROVIDED = new Set(["HOME", "PATH", "ARG", "BASH_REMATCH", "DASH0_EXPOSURE"]);
  // Payloads the run constructs in context rather than in shell. Named explicitly so the
  // list stays a decision: anything NOT here must have an assignment that exists.
  const RUN_CONSTRUCTED = new Set([
    "VERDICT", "PR_STATE", "CARRIED_FINDINGS_JSON", "DIAGNOSTICS_JSON",
    "INLINE_COMMENTS_JSON", "OPEN_BOT_COMMENT_IDS_JSON",
  ]);

  const boundVars = new Set();
  const varReads = new Map();
  for (const mdPath of SHELL_MD) {
    const text = readMd(mdPath);
    // An assignment anywhere in the file counts: `elif WORKTREE_PARENT="$(mktemp -d)"` is a
    // binding, and requiring column 0 would have read it as unbound.
    for (const m of text.matchAll(/\b([A-Z][A-Z0-9_]{2,})=/g)) boundVars.add(m[1]);
    for (const block of bashBlocks(text)) {
      // Strip `#` comments first. A comment is not executed, and a rule explaining why a
      // variable was retired names it — G41f made exactly this mistake and flagged the
      // sentence documenting a fix as the defect.
      const live = block.replace(/(^|\s)#[^\n]*/g, "$1");
      for (const m of live.matchAll(/\$\{?([A-Z][A-Z0-9_]{2,})\b/g)) {
        if (!varReads.has(m[1])) varReads.set(m[1], mdPath);
      }
    }
  }
  const unbound = [...varReads.keys()]
    .filter((v) => !boundVars.has(v) && !SHELL_PROVIDED.has(v) && !RUN_CONSTRUCTED.has(v))
    .sort();
  s.check(`G43b every variable read in a normative block is bound (unbound: ${unbound.join(", ") || "none"})`,
    unbound.length === 0);

  // BASE_SHA specifically, because every one of its readers fails silently: assert the
  // fetch that makes it available and the assignment that binds it, not just the reads.
  const rbody = readMd("agents/pr-reviewer.md");
  s.check("G43b Step 1.1 requests baseRefOid, not only baseRefName",
    /--json [^\n]*\bbaseRefOid\b/.test(rbody));
  s.check("G43b BASE_SHA is bound from that response, next to HEAD_SHA",
    /BASE_SHA=\$\(jq -r '\.baseRefOid' <<< "\$PR_VIEW_JSON"\)/.test(rbody));
  s.check("G43b the merge-base rule refuses to run on an empty base OID",
    /\*\*the base OID itself empty\*\*/.test(readMd("agents/pr-reviewer/rules/workspace.md")));
}

// ── G44: the memory layer's read path can reach what its write path writes ───
//
// A memory bucket fails in one direction only, and it is the silent one: a read that
// cannot reach the records is indistinguishable from a repository that knows nothing, so
// every rule about reading still passes while the loop delivers nothing. An audit of the
// live store found four such breaks at once, and each check below is the general form of
// one:
//
//   G44a  `memory.md`'s second read call was written `memory_search scope=… query=…` —
//         neither parameter exists (the tool takes `q` and `scopes[]`). A validation error
//         on a best-effort read is swallowed, so the run reports 0 memories applied.
//   G44b  The relevance key was quoted as `rule::<fp>` with the bucket prefix dropped, so
//         a `memory_read` against it can only miss. The recorder is the authority; the
//         expected form is extracted from its source rather than restated here.
//   G44c  `knowledge::<symbol>@<path>` — the record the whole rule is named for — had a
//         read, a match table, a TTL and a write budget, and no producer anywhere. Zero
//         rows existed after four runs on the same PR.
//   G44d  `thread-resolution.md`, the one write path that had actually fired on this repo,
//         keyed every record into the v1 prose space (`promotable: false`) even though the
//         comment it was resolving carried a v2 marker to recover. 273 legacy rows, no
//         `rule::` row, `seen_count` accumulating on nothing.
{
  const read = (p) => readFileSync(join(REPO_ROOT, p), "utf8");
  const MEMORY_MD = read("agents/pr-reviewer/rules/memory.md");
  const RELEVANCE_MD = read("agents/shared/rules/comment-relevance-memory.md");
  const THREADS_MD = read("agents/shared/rules/thread-resolution.md");
  const BODY = read("agents/pr-reviewer.md");
  const RECORDER = read("scripts/record-comment-relevance.mjs");

  // ---- G44a: documented memory tool calls use the tools' real parameter names ----
  //
  // The two tools disagree, which is the whole trap: `memory_list` takes a singular
  // `scope` string, `memory_search` takes `scopes[]` plus `q`. Generalising either one to
  // the other produces a call that validates away to nothing.
  const memoryCalls = (text, tool) =>
    [...text.matchAll(new RegExp(`mcp__lorekit__${tool}\\b([^\\n]*)`, "g"))].map((m) => m[1]);

  for (const [file, text] of [
    ["memory.md", MEMORY_MD],
    ["comment-relevance-memory.md", RELEVANCE_MD],
  ]) {
    for (const args of memoryCalls(text, "memory_search")) {
      // Skip a prose mention that passes no arguments at all (e.g. "issue it as a real
      // mcp__lorekit__memory_search tool call"): there is no call shape to check.
      if (!/[:=]/.test(args)) continue;
      s.check(`G44a ${file}: memory_search puts the query in \`q\`, not \`query\``,
        /\bq\s*=/.test(args) && !/\bquery\s*=/.test(args));
      s.check(`G44a ${file}: memory_search takes \`scopes\` (array), not a singular \`scope\``,
        /\bscopes\s*=/.test(args) && !/(^|[^s])\bscope\s*=/.test(args));
    }
    for (const args of memoryCalls(text, "memory_list")) {
      if (!/[:=]/.test(args)) continue;
      s.check(`G44a ${file}: memory_list takes a singular \`scope\`, not \`scopes\``,
        !/\bscopes\s*=/.test(args));
    }
  }
  // The knowledge read is tag-filtered, not just kind/host-filtered. Both buckets carry
  // `kind: signal, host: reviewer`, and the relevance bucket grows per resolved thread while
  // this one grows per traced symbol — measured on this repo, an untagged call spent 48 of
  // its 50 recency-ordered slots on relevance rows the Step 1.0 calls already fetch.
  s.check("G44a memory.md's knowledge read filters on the `codebase-knowledge` tag",
    /mcp__lorekit__memory_list[^\n]*tags=\["codebase-knowledge"\][^\n]*limit=50/.test(MEMORY_MD));

  // ---- G44b: the keys the read path quotes are the keys the recorder writes ----
  //
  // Extracted from the recorder's template literals, so the assertion tracks the writer.
  // A prefix that changes there fails here instead of quietly re-keying the bucket.
  // `[^`;]*` reaches across the ternary's newline to the first branch without escaping the
  // statement, so the `key` position is what selects the literal — a `tags:` entry like
  // `source::${method}` is the same shape and must not be read as a key prefix.
  const recorderKeys = [...RECORDER.matchAll(/\bkey\s*[:=][^`;]*`([a-z-]+(?:::[a-z-]+)*::)\$\{/g)]
    .map((m) => m[1]);
  s.check(`G44b the recorder's key prefixes were extractable (saw: ${recorderKeys.join(" ") || "none"})`,
    recorderKeys.length >= 2);
  s.check("G44b the relevance rule's promotable key space is `reviewer-comment-relevance::rule::`",
    recorderKeys.includes("reviewer-comment-relevance::rule::"));
  for (const prefix of new Set(recorderKeys)) {
    s.check(`G44b memory.md quotes the key \`${prefix}…\` exactly as the recorder builds it`,
      MEMORY_MD.includes(prefix));
  }

  // ---- G44c: every record the read path matches on has a named producer ----
  //
  // `hotspot::` has two producers (the recorder and Step 4d); `knowledge::` has only
  // Step 4d, which is why its absence went unnoticed for so long. Require the agent body
  // to name a write for each — a match table pointed at rows nothing writes is the defect.
  const step4d = BODY.split(/### 4d\./)[1]?.split(/\n### |\n## /)[0] ?? "";
  s.check("G44c Step 4d exists and routes to the write section that holds the calls",
    step4d !== "" && /#write--the-two-calls-this-agent-makes-itself/.test(step4d));
  for (const record of ["knowledge", "hotspot"]) {
    s.check(`G44c Step 4d names the \`${record}\` write`, step4d.includes(record));
    // The literal key lives in one place — the rule file with the call — so the body
    // routing to it cannot drift from the key it writes.
    s.check(`G44c memory.md's write section spells the \`${record}::\` key`,
      MEMORY_MD.includes(`key      = "${record}::`));
  }
  // Per call, not file-wide: with the two calls in one section, a file-wide test passes on
  // either one's properties and the other can silently lose them.
  const writeCalls = {
    knowledge: MEMORY_MD.split("# A. Symbol knowledge")[1]?.split("# B. Hotspot")[0] ?? "",
    hotspot: MEMORY_MD.split("# B. Hotspot")[1]?.split("```")[0] ?? "",
  };
  for (const [name, call] of Object.entries(writeCalls)) {
    s.check(`G44c the ${name} write passes kind + host explicitly (a \`ci::\` tag infers neither)`,
      /kind\s*=\s*"signal"/.test(call) && /host\s*=\s*"reviewer"/.test(call));
    s.check(`G44c the ${name} write sets an explicit 90-day TTL`, /ttl_days\s*=\s*90/.test(call));
  }
  s.check("G44c the knowledge write is deep-tier only, so no unverified fact is stored",
    /deep tier only/i.test(MEMORY_MD));

  // ---- G44d: the in-run relevance write recovers its fingerprint, never re-derives it ----
  s.check("G44d thread-resolution.md writes the v2 `rule::` key when a marker is present",
    THREADS_MD.includes("reviewer-comment-relevance::rule::<fp>"));
  s.check("G44d thread-resolution.md recovers the fingerprint through fingerprint.mjs",
    /fingerprint\.mjs" extract/.test(THREADS_MD));
  s.check("G44d thread-resolution.md keeps the prose key as the marker-less fallback only",
    /fp_v: 1, promotable: false/.test(THREADS_MD));

  // ---- G44e: one value shape, and the licence that broke it is gone ----
  s.check("G44e the relevance bucket's value is JSON only",
    /### One value shape: JSON/.test(RELEVANCE_MD));
  s.check("G44e no write site still licenses a markdown record body",
    !/record body as JSON or markdown/.test(RELEVANCE_MD));

  // ---- G44f: the state scope's third segment is the branch NAME ----
  //
  // Derived from the body's own binding: a SHA-keyed scope mints a fresh scope per push,
  // so the record is written once and never read again.
  s.check("G44f STATE_SCOPE is bound from HEAD_REF, never HEAD_SHA",
    /STATE_SCOPE="branch::\$\{RESOLVED_REPO\}::\$\{HEAD_REF\}"/.test(BODY));
  for (const [file, text] of [
    ["memory.md", MEMORY_MD],
    ["memory-buckets.md", read("agents/shared/rules/memory-buckets.md")],
  ]) {
    s.check(`G44f ${file} names the state scope's third segment unambiguously`,
      text.includes("branch::{owner}/{repo}::{head-branch-name}") &&
      !/branch::\{owner\}\/\{repo\}::\{head\}/.test(text));
  }

  // ---- G44g: this repo calls the only committed writer it owns ----
  //
  // The reusable workflow was committed and documented as live while nothing in this
  // repository called it, so its own store could never gain a v2 row. The self-caller
  // mirrors the report-shape guard's: a local `uses:`, so a change here is exercised here.
  const CALLER = "\.github/workflows/pr-relevance-memory.yml";
  s.check("G44g this repo has a caller for reviewer-comment-relevance.yml",
    existsSync(join(REPO_ROOT, ".github/workflows/pr-relevance-memory.yml")));
  if (existsSync(join(REPO_ROOT, ".github/workflows/pr-relevance-memory.yml"))) {
    const caller = read(".github/workflows/pr-relevance-memory.yml");
    s.check("G44g the self-caller uses the local reusable workflow, not @main",
      caller.includes("uses: ./.github/workflows/reviewer-comment-relevance.yml") &&
      !caller.includes("reviewer-comment-relevance.yml@main"));
    const modes = [...caller.matchAll(/mode:\s*([a-z-]+)/g)].map((m) => m[1]);
    for (const mode of ["thread-resolved", "pr-merged", "human-comment"]) {
      s.check(`G44g the self-caller wires up \`${mode}\``, modes.includes(mode));
    }
    s.check("G44g the self-caller passes the LoreKit secret through",
      /lorekit_api_key:\s*\$\{\{\s*secrets\.LOREKIT_API_KEY\s*\}\}/.test(caller));
  }
  void CALLER;

  // ---- G45a: the knowledge read has a call site, not just a rule ----
  //
  // G44 guarded the write side and said so in its own comment. The read side stayed
  // prescribed-only: `memory.md § Read` carried two calls, a match table, a budget and a TTL,
  // while `agents/pr-reviewer.md` mentioned `codebase-knowledge`, `knowledge::` and
  // `hotspot::` zero times — so Step 4d's producer had no consumer, and a run reported
  // "0 memories applied" indistinguishably from a repo that had learned nothing.
  s.check("G45a the agent body issues the `codebase-knowledge` read",
    BODY.includes('tags=["codebase-knowledge"]'));
  s.check("G45a the agent body's knowledge read passes kind=signal host=reviewer",
    /tags=\["codebase-knowledge"\][^\n]*kind="signal"[^\n]*host="reviewer"/.test(BODY));
  // The call site is Phase B's tail, per memory.md. Assert it positionally rather than by
  // heading text: the read must come after the graph exists and before depth routing reads it.
  const iGraph = BODY.indexOf("#### 1.2a Build the impact graph (Phase B)");
  const iKnowledgeRead = BODY.indexOf('tags=["codebase-knowledge"]');
  const iDepthRouting = BODY.indexOf("### 1.2b Delta triage and depth routing (Phase C)");
  s.check("G45a the knowledge read sits inside Step 1.2a, after the graph is built",
    iGraph > 0 && iKnowledgeRead > iGraph && iDepthRouting > iKnowledgeRead);
  // Both files must name the other's half of the loop, so moving one fails here.
  s.check("G45a memory.md names its call site in the agent body",
    /call site is the tail of Step 1\.2a/.test(MEMORY_MD));
  s.check("G45a the agent body routes the read back to memory.md § Read",
    /Read — two calls, keyed by the impact graph|#read--two-calls-keyed-by-the-impact-graph/
      .test(BODY));

  // ---- G45b: the hotspot write merges its counters instead of clobbering them ----
  //
  // The template was a literal `confirmed:1` with field list `{v, path, confirmed,
  // last_touched_by}`, and the merge rule was scoped to "the knowledge write" by its own
  // heading — so every run reset a counter the read side classifies `hot` on, and the
  // `missed[]` the in-run signals table promises had nowhere to land.
  const hotspotBlock = MEMORY_MD.split("# B. Hotspot")[1]?.split("```")[0] ?? "";
  s.check("G45b the hotspot write is documented", hotspotBlock.length > 0);
  s.check("G45b the hotspot write merges onto the record read at Step 1.2a",
    /MERGED onto the record read at Step 1\.2a/.test(hotspotBlock));
  s.check("G45b the hotspot write template does not hardcode `confirmed:1`",
    !/confirmed\s*:\s*1\b/.test(hotspotBlock));
  // Every counter the read side branches on must exist in the written record. `missed` and
  // `regressed` are named by the four-records table and the match table; omitting them from
  // the write is what made those rows unreachable.
  for (const field of ["missed", "regressed", "classes", "confirmed_examples"]) {
    s.check(`G45b the hotspot record's value carries \`${field}\``,
      new RegExp(`"${field}"`).test(MEMORY_MD));
  }
  s.check("G45b the merge rule covers both writes, not the knowledge write alone",
    /Merge, never clobber — on both writes/.test(MEMORY_MD)
    && !/Four rules on the knowledge write/.test(MEMORY_MD));
  s.check("G45b Step 4d tells the run to merge rather than write the literals",
    /never write the rule file's literals/.test(BODY));

  // ---- G45c: `indexed` and `used` count one population ----
  //
  // The body defined `MEMORIES_READ_COUNT` as relevance-only and called itself authoritative;
  // a later step extended `MEMORIES_USED[]` to knowledge and hotspot; `render-report.mjs`
  // derives `used` from that array's length and FAILS CLOSED when it exceeds indexed. A run
  // applying a hotspot on a repo with no armed relevance rule therefore rendered nothing at
  // all — and that is the normal shape for a bucket in its first weeks.
  const RENDERING_MD = read("agents/pr-reviewer/rules/report-rendering.md");
  // Each file states the widened population in its own words, so each is pinned to its own
  // sentence rather than to proximity: a `MEMORIES_READ_COUNT … hotspot` window check passes
  // on the unrelated `kind` ∈ `rule`/`knowledge`/`hotspot` mention a few lines away, which is
  // how a probe that narrowed the definition back to relevance-only stayed green.
  for (const [file, text, claim] of [
    ["pr-reviewer.md", BODY, /plus the knowledge and hotspot records the\s+Step 1\.2a read returns/],
    ["report-rendering.md", RENDERING_MD,
      /relevance rules\s*\n?\(Step 1\.0\) \*\*plus\*\* knowledge and hotspot records \(Step 1\.2a\)/],
  ]) {
    s.check(`G45c ${file}: MEMORIES_READ_COUNT counts knowledge and hotspot too`,
      claim.test(text));
    s.check(`G45c ${file}: no relevance-only claim survives beside the widened pair`,
      !/MEMORIES_READ_COUNT[^\n]*counts `reviewer-comment-relevance` memories only/.test(text)
      && !/is how many relevance memories were loaded/.test(text));
  }
  // The renderer's fail-closed rule is the reason the two must agree; assert it is still there,
  // so a future relaxation of the docs cannot pass while the code still rejects the payload.
  const RENDER = read("agents/pr-reviewer/scripts/render-report.mjs");
  s.check("G45c the renderer still fails closed on used > indexed",
    /indexed is always >= used/.test(RENDER));

  // ---- G45d: relevance suppression is documented after verification, in every file ----
  //
  // G38d asserted the 2.7b ordering on the agent body alone, and G44a looped over both memory
  // files without an ordering check, so `comment-relevance-memory.md` kept describing Step 2.2
  // ("DROP the finding before it reaches the grounding step") at 1008/1008 green — the exact
  // pre-verification suppression this PR moved.
  for (const [file, text] of [
    ["comment-relevance-memory.md", RELEVANCE_MD],
    ["pr-reviewer.md", BODY],
  ]) {
    s.check(`G45d ${file}: no site claims relevance filtering runs at Step 2.2`,
      !/[Ss]tep 2\.2\b/.test(text));
    s.check(`G45d ${file}: no site drops a finding before grounding`,
      !/before it reaches the grounding step/.test(text));
  }
  s.check("G45d comment-relevance-memory.md names Step 2.7b as the match point",
    /In `pr-reviewer` that is Step 2\.7b/.test(RELEVANCE_MD));
}

// ── G47: the CI-only Fix-all trigger fires on a red/failed check, never on pending-only ──
//
// The trigger's own prose read "CI is not green", which subsumes a pending check that has
// produced no failure and no logs to view — the button then sent Agent0 to "fix the failing
// CI checks" on a check that had not failed (observed on mthines/lorekit#647: zero findings,
// CI state `pending (Darkplane auto-approval)`, a Fix-all button with nothing to fix). The
// fix narrows the trigger to the `CI red:` subset `CI_NOTE` already computes
// (`report-rendering.md`); this guard reads the two real shipped surfaces and asserts the
// red-only condition is present and the broader "not green" phrase is gone. Slices are bound
// on stable neighbouring headings/bullets, never on the reworded trigger sentence itself — a
// `sliceBetween` anchor pinned to the very text being edited throws on the next rename, and a
// thrown slice reads as 0 checks / green through a `grep "✗"` pipe (recorded repeat-failure).
{
  const read = (p) => readFileSync(join(REPO_ROOT, p), "utf8");
  const BODY = read("agents/pr-reviewer.md");
  const FIX_LINKS = read("agents/shared/rules/agent0-fix-links.md");

  const bodyTrigger = sliceBetween(BODY,
    "**When `{bot_login}` is unresolved**", "**Omit the slot**");
  const bodyOmit = sliceBetween(BODY,
    "**Omit the slot**", "- **Fix this (inline).**");

  s.check("G47 agent body: the CI-only trigger fires on a red/failed check",
    /red\/failed/i.test(bodyTrigger));
  s.check("G47 agent body: the CI-only trigger no longer reads \"not green\"",
    !/not green/i.test(bodyTrigger));
  s.check("G47 agent body: the omit rule covers both green and pending-only CI",
    /pending/i.test(bodyOmit));

  const ruleSection = sliceBetween(FIX_LINKS,
    "**Fix all — CI-only**", "**This one is not a `/pr-fix` invocation");
  const ruleOmit = sliceBetween(FIX_LINKS,
    "So the Fix-all button is omitted", "**Fix all — CI-only**");

  s.check("G47 agent0-fix-links.md: the CI-only trigger fires on a red/failed check",
    /red\/failed/i.test(ruleSection));
  s.check("G47 agent0-fix-links.md: the CI-only trigger no longer reads \"not green\"",
    !/not green/i.test(ruleSection));
  s.check("G47 agent0-fix-links.md: the omit summary covers pending-only, not just green",
    /pending/i.test(ruleOmit));

  // The template body is unchanged — still legitimately imperative about a real failure,
  // because the trigger now only fires when one has actually occurred.
  s.check("G47 the CI-only template body still reads \"Fix the failing CI checks\"",
    /Fix the failing CI checks on \{owner\}\/\{repo\}#\{n\}/.test(FIX_LINKS));
}

process.exit(s.report() ? 0 : 1);
