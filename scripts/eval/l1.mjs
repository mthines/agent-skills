#!/usr/bin/env node
// L1 — deterministic integrity checks. No LLM, no network, no cost. Run in CI on every PR.
//   node scripts/eval/l1.mjs
// Exits non-zero if any check fails.
//
// Admission is a closed list (scripts/eval/README.md § L1 admission rule). A check lives here
// only when it guards one of:
//   1. link / anchor / reference resolution      5. script self-tests and script behaviour
//   2. frontmatter validity                       6. size and token budgets
//   3. manifest ↔ disk sync (install, plugin)     7. executable idioms run against fixtures
//   4. eval-harness integrity                     8. machine-parsed contracts
// Every check carries a one-line comment naming the runtime failure it prevents.
// Prose presence, wording, and "two copies agree" checks are not admitted — behaviour claims
// belong in a `claude plugin eval` case under evals/ or an L2 golden case.
import { execFileSync, execSync, spawn, spawnSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync, writeFileSync, rmSync, mkdtempSync, mkdirSync, symlinkSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { REPO_ROOT, walk, headingSlugs, frontmatter, rel, sliceBetween, extractSection, Suite } from "./lib.mjs";
import { SUITES, DETECTION } from "./suites.mjs";
import { validateSkill } from "../../skills/authoring/create-skill/scripts/validate-skill.mjs";
import { escapingLinks, counts as escapingCounts, readBaseline as escapingBaseline } from "./escaping-links.mjs";

// Frozen archives (CLAUDE.md § Where knowledge goes): never kept current, so no live-fact walk
// reads them. The value is the G86d byte ceiling.
const FROZEN_ARCHIVES = { "docs/inventory.md": 118685, "docs/evals.md": 27529 };
const docsWalk = () => walk(join(REPO_ROOT, "docs")).filter((f) => !(rel(f) in FROZEN_ARCHIVES));

const AW = join(REPO_ROOT, "skills/workflow/autonomous-workflow");
const PRS = join(REPO_ROOT, "agents/pr-reviewer/scripts");
const read = (p) => readFileSync(join(REPO_ROOT, p), "utf8");
const readOr = (p) => { try { return read(p); } catch { return ""; } };
const s = new Suite("L1 integrity checks");

// Report-body fixtures, discovered from disk so a new fixture is never silently exempt.
const REPORT_FIX = join(REPO_ROOT, "scripts/eval/fixtures/report-body");
const REPORT_FIXTURES = existsSync(REPORT_FIX)
  ? readdirSync(REPORT_FIX).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort()
  : [];
const RENDER_REPORT = join(PRS, "render-report.mjs");
const renderReport = (payload) => {
  const r = spawnSync(process.execPath, [RENDER_REPORT], { input: typeof payload === "string" ? payload : JSON.stringify(payload), encoding: "utf8" });
  return { ok: r.status === 0, out: r.stdout || "", err: (r.stderr || "").trim() };
};

// ════════════════════════════════════════════════════════════════════════════════════════════
// 1. Links, anchors, and references
// ════════════════════════════════════════════════════════════════════════════════════════════

// ── A: link + anchor integrity — a broken relative link or anchor sends an agent to nothing ──
{
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
  const SIBLING_REPO = /git-worktree-workflows/; // lives in a sibling repo by design
  const files = [
    ...walk(join(REPO_ROOT, "skills")).filter((f) => !f.includes("/templates/") && !f.endsWith("/_template.md")),
    ...walk(join(REPO_ROOT, "agents")).filter((f) => !f.includes("/templates/")),
    ...walk(join(REPO_ROOT, "memory")),
    join(REPO_ROOT, "CLAUDE.md"),
    join(REPO_ROOT, "README.md"),
    ...docsWalk(),
  ];
  let broken = 0;
  for (const f of files) {
    for (const { line, target } of realLinks(f)) {
      if (/^(https?:|mailto:)/.test(target) || target.includes("<") || target.includes("{") || target === "...") continue;
      if (target.startsWith("/")) continue; // absolute path = illustrative example
      if (SIBLING_REPO.test(target)) continue;
      const [path, anchor] = target.split("#");
      const tf = path === "" ? f : join(f, "..", path);
      let bad = "";
      if (path && !existsSync(tf)) bad = `missing file: ${target}`;
      else if (anchor && tf.endsWith(".md") && !headingSlugs(tf).has(anchor)) bad = `no heading for #${anchor}`;
      if (!bad) continue;
      broken++;
      s.check(`link ${rel(f)}:${line}`, false, bad);
    }
  }
  s.check("A no broken links/anchors", broken === 0, broken ? `${broken} broken` : "");
}

// ── G71: an escaping `../` link breaks on hosts that import one skill folder at a time ──
{
  const found = escapingLinks();
  const now = escapingCounts(found);
  const base = escapingBaseline();
  // An empty baseline would let every escaping link through as "not above baseline".
  s.check("G71b the escaping-link baseline exists and is non-empty", Object.keys(base).length > 0);
  for (const [skill, n] of Object.entries(now)) {
    const b = base[skill] ?? 0;
    if (n > b) {
      const fresh = found[skill].slice(-3).map((l) => `${l.file} → ${l.target}`).join("; ");
      s.check(`G71c ${skill} adds no link that escapes its folder`, false,
        `${n} escaping vs baseline ${b} — ship the file inside the skill (e.g. ${fresh})`);
    }
  }
  const total = Object.values(now).reduce((a, c) => a + c, 0);
  const baseTotal = Object.values(base).reduce((a, c) => a + c, 0);
  s.check("G71c no skill's escaping-link count is above its baseline",
    Object.entries(now).every(([k, n]) => n <= (base[k] ?? 0)),
    total < baseTotal ? `${total} < baseline ${baseTotal}: lower it with --write` : `${total} escaping links`);
}

// ── G72: a Skill("<name>") naming a deleted skill is answered `Unknown skill`, which callers skip ──
{
  const EXTERNAL = new Set(["otel-instrumentation", "otel-semantic-conventions"]); // dash0hq/agent-skills
  const skillNames = new Set(walk(join(REPO_ROOT, "skills")).filter((p) => p.endsWith("/SKILL.md"))
    .map((p) => p.split("/").slice(-2)[0]));
  const agentNames = new Set([
    ...readdirSync(join(REPO_ROOT, "agents")).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, "")),
    ...walk(join(REPO_ROOT, "skills")).filter((p) => p.endsWith(".agent.md")).map((p) => p.split("/").pop().replace(/\.agent\.md$/, "")),
  ]);
  const PROHIBITION = /never|do not|don't|not a skill|unknown skill|❌|wrong/i;
  const bad = [];
  const files = [...walk(join(REPO_ROOT, "skills")), ...walk(join(REPO_ROOT, "agents")), join(REPO_ROOT, "CLAUDE.md"), join(REPO_ROOT, "README.md"), ...docsWalk()];
  for (const f of files) {
    const lines = readFileSync(f, "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const m of line.matchAll(/Skill\("([a-z0-9][a-z0-9-]*)"/g)) {
        const name = m[1];
        if (skillNames.has(name) || EXTERNAL.has(name)) continue;
        const windowText = lines.slice(Math.max(0, i - 2), i + 1).join(" ");
        if (agentNames.has(name) && PROHIBITION.test(windowText)) continue;
        bad.push(`${rel(f)}:${i + 1} Skill("${name}")`);
      }
    });
  }
  s.check("G72 every Skill(\"<name>\") names an existing skill, a declared external skill, or an agent inside a prohibition",
    bad.length === 0, bad.slice(0, 5).join("; "));
}

// ── G46k: the Fix-with-Agent0 button names asset files; a missing one is a broken image on every review ──
{
  const spineMod = await import(pathToFileURL(join(PRS, "comment-spine.mjs")).href);
  const ASSETS = join(REPO_ROOT, "agents/pr-reviewer/assets");
  s.check("G46k the spine enumerates the asset files it can reference",
    Array.isArray(spineMod.ASSET_FILES) && spineMod.ASSET_FILES.length > 0);
  for (const f of spineMod.ASSET_FILES ?? []) {
    s.check(`G46k ${f} exists in the repo`, existsSync(join(ASSETS, f)));
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 2. Frontmatter
// ════════════════════════════════════════════════════════════════════════════════════════════

// ── F: a bad semver or a name that is not its directory fails install/discovery ──
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

// ── F1b: a description over 1024 chars makes a git import reject the whole skill (validator FM05) ──
{
  for (const f of walk(join(REPO_ROOT, "skills")).filter((p) => p.endsWith("/SKILL.md"))) {
    const dir = f.slice(0, -"/SKILL.md".length);
    const fm05 = validateSkill(dir).findings.filter((x) => x.id === "FM05" && x.level === "FAIL");
    s.check(`F1b ${rel(f)} description is within the 1024-char cap`, fm05.length === 0,
      fm05.length ? fm05[0].message : "");
  }
}

// ── F2: a bare ": " in a plain YAML scalar makes a strict parser drop the whole frontmatter ──
{
  const files = [
    ...walk(join(REPO_ROOT, "skills")).filter((p) => p.endsWith("/SKILL.md")),
    ...walk(join(REPO_ROOT, "agents")).filter((p) => /\/agents\/[^/]+\.md$/.test(p)),
  ];
  for (const f of files) {
    const parts = readFileSync(f, "utf8").split("---\n");
    if (parts.length < 3 || parts[0] !== "") continue;
    const offenders = parts[1].split("\n")
      .map((line) => /^([A-Za-z_][\w-]*): (.+)$/.exec(line))
      .filter((m) => m && !/^["'|>]/.test(m[2]) && m[2].includes(": "))
      .map((m) => m[1]);
    s.check(`F2 ${rel(f)} frontmatter has no bare ": " in a plain scalar`, offenders.length === 0,
      offenders.length ? `key(s): ${offenders.join(", ")} — quote the value or use an em dash` : "");
  }
}

// ── D: installs are flat by skill name, so two category folders holding one name collide ──
{
  const names = walk(join(REPO_ROOT, "skills")).filter((p) => p.endsWith("/SKILL.md"))
    .map((p) => p.split("/").slice(-2)[0]);
  const dupes = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
  s.check("D every skill name is unique across categories", dupes.length === 0, dupes.join(", "));
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 3. Manifests and install
// ════════════════════════════════════════════════════════════════════════════════════════════

// ── G2c: install.sh links aw- agents from templates/; a mismatch installs a missing or stale agent ──
{
  const installer = readFileSync(join(AW, "install.sh"), "utf8");
  const linked = new Set([...installer.matchAll(/ln -sf[n]?\s+\S+\s+"\$CLAUDE_DIR\/agents\/(aw-[a-z0-9-]+)\.md"/g)].map((m) => m[1]));
  s.check("G2c install.sh links a discoverable set of aw- agents", linked.size >= 1,
    linked.size ? [...linked].join(", ") : "no `ln -sf` into agents/aw-*.md found");
  const templated = new Set(readdirSync(join(AW, "templates"))
    .filter((f) => /^aw-[a-z0-9-]+\.agent\.md$/.test(f)).map((f) => f.replace(/\.agent\.md$/, "")));
  const onlyLinked = [...linked].filter((a) => !templated.has(a));
  const onlyTemplated = [...templated].filter((a) => !linked.has(a));
  s.check("G2c the installer's aw- agent set matches templates/ on disk",
    onlyLinked.length === 0 && onlyTemplated.length === 0,
    `linked-not-templated: [${onlyLinked}] · templated-not-linked: [${onlyTemplated}]`);
}

// ── G110: plugin.json and the `claude plugin eval` cases — an unreachable skill or unloadable case ships broken ──
{
  const EVALS = join(REPO_ROOT, "evals");
  const PROMPT_KEYS = new Set(["schema_version", "name", "description", "tags", "plugins", "runs", "expected_outcome",
    "model", "max_turns", "timeout_seconds", "allowed_tools", "append_system_prompt", "env"]);
  const DETERMINISTIC = new Set(["regex", "tool_used", "tool_order", "file_exists"]);
  const fmBlock = (text) => /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? null;
  const fmKeys = (block) => [...block.matchAll(/^([A-Za-z_][\w-]*):/gm)].map((m) => m[1]);
  const cases = existsSync(EVALS)
    ? readdirSync(EVALS, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name !== "results" && d.name !== "mocks")
        .map((d) => d.name)
        .filter((n) => existsSync(join(EVALS, n, "prompt.md")) || existsSync(join(EVALS, n, "case.yaml")))
    : [];
  // Guards the loop below: zero discovered cases would pass every per-case check vacuously.
  s.check("G110a evals/ holds plugin-eval cases", cases.length > 0, `found ${cases.length}`);
  for (const c of cases) {
    const promptPath = join(EVALS, c, "prompt.md");
    const block = existsSync(promptPath) ? fmBlock(readFileSync(promptPath, "utf8")) : null;
    const unknown = block ? fmKeys(block).filter((k) => !PROMPT_KEYS.has(k)) : [];
    // An unknown key or missing frontmatter fails the case at load time, after the run is paid for.
    s.check(`G110b evals/${c}/prompt.md has frontmatter with only known keys`, block !== null && unknown.length === 0,
      block === null ? "missing prompt.md or its --- frontmatter block" : `unknown keys: ${unknown.join(", ")}`);
    const gdir = join(EVALS, c, "graders");
    const types = existsSync(gdir)
      ? readdirSync(gdir).filter((f) => f.endsWith(".md"))
          .map((f) => /^type:\s*(\S+)/m.exec(fmBlock(readFileSync(join(gdir, f), "utf8")) ?? "")?.[1])
      : [];
    // A judge-only case scores noise: the with/without delta needs a free deterministic grader.
    s.check(`G110c evals/${c} has ≥ 1 deterministic grader (regex / tool_used / tool_order / file_exists)`,
      types.some((t) => DETERMINISTIC.has(t)), `grader types: ${types.join(", ") || "none"}`);
    s.check(`G110d evals/${c} has at most one llm grader`, types.filter((t) => t === "llm").length <= 1,
      `${types.filter((t) => t === "llm").length} llm graders`);
  }
  const manifest = JSON.parse(read(".claude-plugin/plugin.json"));
  const skillRoots = [manifest.skills ?? []].flat().map((p) => join(REPO_ROOT, p));
  const reachable = (skillDir) => skillRoots.some((root) => {
    const r = root.replace(/\/$/, "");
    return skillDir === r || join(skillDir, "..") === r;
  });
  const unreached = walk(join(REPO_ROOT, "skills")).filter((f) => f.endsWith("/SKILL.md"))
    .map((f) => join(f, "..")).filter((d) => !reachable(d));
  s.check("G110e every SKILL.md is reachable from a plugin.json `skills` entry (scanned one level deep)",
    unreached.length === 0, `unreached: ${unreached.map(rel).join(", ")}`);
  const agents = [manifest.agents ?? []].flat();
  s.check("G110f plugin.json `agents` lists existing .md files only (a directory invalidates the whole manifest)",
    agents.every((a) => a.endsWith(".md") && existsSync(join(REPO_ROOT, a))), `agents: ${agents.join(", ")}`);
  const shippedAgents = (dir, suffix) => readdirSync(join(REPO_ROOT, dir), { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(suffix)).map((d) => `./${dir}/${d.name}`);
  const unlisted = [...shippedAgents("agents", ".md"), ...shippedAgents("skills/workflow/autonomous-workflow/templates", ".agent.md")]
    .filter((a) => !agents.includes(a));
  s.check("G110h every agents/*.md and autonomous-workflow templates/*.agent.md is listed in plugin.json `agents`",
    unlisted.length === 0, `unlisted: ${unlisted.join(", ")}`);
}

// ── G111: marketplace.json and skills-lock.json point at things that exist, or installs fail ──
{
  const market = JSON.parse(read(".claude-plugin/marketplace.json"));
  const plugins = market.plugins ?? [];
  s.check("G111a marketplace.json lists plugins", plugins.length > 0);
  for (const p of plugins) {
    const path = p.source?.path;
    if (p.source?.source !== "git-subdir" || !path) continue;
    s.check(`G111a marketplace plugin '${p.name}' source path ${path} exists`, existsSync(join(REPO_ROOT, path)));
  }
  const lock = JSON.parse(read("skills-lock.json"));
  const skillNames = new Set(walk(join(REPO_ROOT, "skills")).filter((p) => p.endsWith("/SKILL.md"))
    .map((p) => p.split("/").slice(-2)[0]));
  const missing = Object.entries(lock.skills ?? {})
    .filter(([, v]) => v.source === "mthines/agent-skills").map(([k]) => k).filter((k) => !skillNames.has(k));
  s.check("G111b every skills-lock.json skill sourced from this repo exists", missing.length === 0, missing.join(", "));
}

// ── G112: the CI typecheck job only covers tsconfig files[]; an unlisted @ts-check script is never typechecked ──
{
  const ts = read("agents/pr-reviewer/scripts/tsconfig.json");
  const scripts = execFileSync("git", ["ls-files", "*.mjs"], { cwd: PRS, encoding: "utf8" }).split("\n").filter(Boolean);
  const unlisted = scripts.filter((f) => /@ts-check/.test(readFileSync(join(PRS, f), "utf8").split("\n").slice(0, 3).join("\n"))
    && !ts.includes(`"${f}"`));
  s.check("G112 every // @ts-check pr-reviewer script is listed in its tsconfig.json files[]",
    unlisted.length === 0, unlisted.join(", "));
}

// ── G113: every tracked shell script parses — a syntax error surfaces only when a host runs it ──
{
  const shells = execFileSync("git", ["ls-files", "*.sh"], { cwd: REPO_ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
  for (const f of shells) {
    const r = spawnSync("bash", ["-n", join(REPO_ROOT, f)], { encoding: "utf8" });
    s.check(`G113 ${f} parses (bash -n)`, r.status === 0, (r.stderr || "").trim().slice(0, 160));
  }
}

// ── G115: no workflow splices attacker-controlled PR/issue text into a shell `run:` — script injection ──
{
  const UNTRUSTED = /\$\{\{\s*github\.(?:event\.(?:comment|review|issue|pull_request|discussion)\.(?:body|title)|head_ref|event\.pull_request\.head\.ref)\s*\}\}/;
  const workflows = execFileSync("git", ["ls-files", "*.yml", "*.yaml"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\n").filter((f) => /(^|\/)(\.github\/workflows|templates)\//.test(f));
  for (const f of workflows) {
    const lines = readFileSync(join(REPO_ROOT, f), "utf8").split("\n");
    const hits = [];
    let runIndent = -1;
    lines.forEach((line, i) => {
      const indent = line.search(/\S/);
      if (runIndent >= 0 && indent !== -1 && indent <= runIndent) runIndent = -1;
      const run = line.match(/^(\s*)(?:-\s+)?run:\s*(.*)$/);
      if (run) {
        runIndent = line.indexOf("run:");
        if (UNTRUSTED.test(run[2])) hits.push(i + 1);
      } else if (runIndent >= 0 && UNTRUSTED.test(line)) hits.push(i + 1);
    });
    s.check(`G115 ${f} binds untrusted event text via env, never inside run:`, hits.length === 0, `lines ${hits.join(", ")}`);
  }
}

// ── G58 / G85 / G59: the Agent0 sandbox install — what the rules expect must be what the installer lays down ──
{
  const host = readOr("agents/shared/rules/agent0-host.md");
  const loop = readOr("skills/quality/review-loop/SKILL.md");
  const rule = readOr("skills/quality/review-loop/rules/agent0-runtime.md");
  const uv = readOr("skills/testing/ui-verify/SKILL.md");
  const uvRule = readOr("skills/testing/ui-verify/rules/agent0-runtime.md");
  const SETUP_REL = "scripts/agent0-setup.sh";
  const setup = readOr(SETUP_REL);
  const RAW = "https://raw.githubusercontent.com/mthines/agent-skills/main/";

  // A rule that reads an installed file the installer never verifies fails on a half-installed sandbox.
  const named = new Set();
  for (const t of [host, rule, uvRule]) {
    for (const m of t.matchAll(/(?:\$AGENT_SKILLS_ROOT|\/tmp\/workspace\/pr-reviewer)\/skills\/([a-z0-9-]+\/[A-Za-z0-9._/-]+\.(?:md|mjs))/g)) named.add(m[1]);
  }
  const unverified = [...named].filter((n) => !setup.includes(`"$S/${n}"`));
  s.check("G58e the installer verifies every installed file the Agent0 rules name",
    named.size > 0 && unverified.length === 0,
    `named=${[...named].join(",") || "∅"}; unverified by ${SETUP_REL}: ${unverified.join(",") || "none"}`);

  // The on-demand install block runs verbatim on the sandbox: it must parse and fetch a script that exists.
  const step0 = (loop.match(/### Step 0:[\s\S]*?(?=\n### Step 1:)/) || [""])[0];
  const installBlock = ((step0.match(/#### On-demand install — Step 0 row 4\n[\s\S]*?\n```bash\n([\s\S]*?)\n```/) || ["", ""])[1]);
  const synI = installBlock ? spawnSync("bash", ["-n"], { input: installBlock, encoding: "utf8" }) : { status: -1 };
  s.check("G58i review-loop's on-demand install block parses and fetches the shipped setup script",
    synI.status === 0 && installBlock.includes(`${RAW}${SETUP_REL}`) && existsSync(join(REPO_ROOT, SETUP_REL)),
    `bash -n=${synI.status}; the block must fetch ${RAW}${SETUP_REL}`);

  // The Agent0 host test, executed against fake roots: a wrong answer installs on a laptop or never on Agent0.
  const probeHost = (hostLine, mk) => {
    const root = mkdtempSync(join(tmpdir(), "l1-a0-"));
    try {
      for (const m of mk) mkdirSync(join(root, m), { recursive: true });
      if (mk.includes(".opencode/agents")) writeFileSync(join(root, ".opencode/agents/general.md"), "x");
      const sh = hostLine.replaceAll("/tmp/", `${root}/`) + "\necho $A0";
      return spawnSync("bash", ["-c", sh], { encoding: "utf8" }).stdout.trim();
    } finally { rmSync(root, { recursive: true, force: true }); }
  };
  const uvBlk = ((uv.match(/#### On-demand browser install — run and verify\n[\s\S]*?```bash\n([\s\S]*?)\n```/) || ["", ""])[1]);
  for (const [name, blk] of [["review-loop", installBlock], ["ui-verify", uvBlk]]) {
    const hostLine = (blk.match(/^if \[ -d \/tmp\/workspace \][^\n]*A0=0; fi$/m) || [""])[0];
    const probes = hostLine
      ? [[], ["workspace"], [".opencode/skills"], [".opencode/agents"]].map((mk) => probeHost(hostLine, mk)).join("/")
      : "-";
    s.check(`G85b ${name}'s Agent0 host test answers none/workspace/skills/agents = 0/1/1/1 (executed)`,
      probes === "0/1/1/1", `host line ${hostLine ? "found" : "missing"}; probes ${probes}`);
  }
  // Both browser-install URLs the ui-verify block fetches must be files this repo ships.
  for (const u of [...uvBlk.matchAll(/https:\/\/raw\.githubusercontent\.com\/mthines\/agent-skills\/main\/(\S+?\.sh)/g)].map((m) => m[1])) {
    s.check(`G85e ui-verify's on-demand install fetches ${u}, which exists`, existsSync(join(REPO_ROOT, u)));
  }

  // agent0-playwright.sh rewrites env.sh; a duplicated or dropped export breaks the next run's browser lookup.
  {
    const d = mkdtempSync(join(tmpdir(), "l1-pw-env-"));
    const envFile = join(d, "env.sh");
    writeFileSync(envFile, "export AGENT_SKILLS_ROOT=/x\nexport UI_VERIFY_BROWSER=ok\nexport PLAYWRIGHT_BROWSERS_PATH=/old\n");
    let allOk = true;
    for (let i = 0; i < 2; i++) {
      const r = spawnSync("bash", [join(REPO_ROOT, "scripts/agent0-playwright.sh")], {
        encoding: "utf8",
        env: { ...process.env, ENV_FILE: envFile, PW: join(d, "pw"), WITH_PLAYWRIGHT: "0" },
      });
      if (r.status !== 0) allOk = false;
    }
    const out = (() => { try { return readFileSync(envFile, "utf8"); } catch { return ""; } })();
    const once = (re) => (out.match(re) || []).length === 1;
    const keepsOtherLines = once(/^export AGENT_SKILLS_ROOT=\/x$/gm);
    const fourOnce = ["UI_VERIFY_BROWSER", "UI_VERIFY_BROWSER_REASON", "UI_VERIFY_PLAYWRIGHT_NODE_MODULES", "PLAYWRIGHT_BROWSERS_PATH"]
      .every((v) => once(new RegExp(`^export ${v}=`, "gm")));
    const skippedValue = once(/^export UI_VERIFY_BROWSER=skipped$/gm);
    rmSync(d, { recursive: true, force: true });
    s.check("G59g agent0-playwright.sh WITH_PLAYWRIGHT=0 rewrites the four export lines idempotently, keeping every other line (executed)",
      allOk && keepsOtherLines && fourOnce && skippedValue,
      `exit-ok=${allOk} keeps-other-lines=${keepsOtherLines} four-lines-once=${fourOnce} skipped-value=${skippedValue}`);
  }

  // The reviewer installer's env.sh block, executed: it must write the run's paths and never the OTLP token.
  {
    const setupTxt = read("agents/pr-reviewer/scripts/agent0-setup.sh");
    const from = setupTxt.indexOf('ENV_FILE="$ROOT/env.sh"');
    const to = setupTxt.indexOf('if [ -n "${DASH0_AGENT_ENV:-}" ]');
    const token = "Authorization=Bearer l1-canary-token,Dash0-Dataset=default";
    const dir = mkdtempSync(join(tmpdir(), "l1-envsh-"));
    let envSh = "", installerOut = "", status = -1;
    try {
      writeFileSync(join(dir, "block.sh"), from > 0 && to > from ? setupTxt.slice(from, to) : "exit 3\n");
      const r = spawnSync("bash", ["-u", join(dir, "block.sh")], {
        encoding: "utf8",
        env: { PATH: process.env.PATH || "", ROOT: dir, BUNDLE: join(dir, "b.md"), PIN: "abc1234", PR_REVIEWER_LOGIN: "bot",
          PR_REVIEWER_OTLP_ENDPOINT: "https://ingress.example.com", PR_REVIEWER_OTLP_HEADERS: token },
      });
      status = r.status ?? -1;
      installerOut = `${r.stdout || ""}${r.stderr || ""}`;
      if (existsSync(join(dir, "env.sh"))) envSh = readFileSync(join(dir, "env.sh"), "utf8");
    } finally { rmSync(dir, { recursive: true, force: true }); }
    s.check("G84p the reviewer installer writes the run's paths to env.sh and never the export settings or their token (executed)",
      status === 0 && /export PR_REVIEWER_ROOT=/.test(envSh) && !/OTLP|PR_REVIEWER_TELEMETRY|Bearer/.test(envSh)
        && !installerOut.includes("l1-canary-token"),
      `status=${status} envSh=${JSON.stringify(envSh.slice(0, 200))}`);
  }
}

// ── G49: the skill runs is-ui-diff.mjs through a symlink; a main-guard that compares raw paths never fires there ──
{
  const realScript = join(REPO_ROOT, "skills/testing/ui-verify/scripts/is-ui-diff.mjs");
  let fired = false, detail = "";
  try {
    const dir = mkdtempSync(join(tmpdir(), "uiv-symlink-"));
    const link = join(dir, "is-ui-diff.mjs");
    symlinkSync(realScript, link);
    const r = spawnSync(process.execPath, [link, "--self-test"], { encoding: "utf8" });
    fired = r.status === 0 && (r.stdout || "").includes("passed, 0 failed");
    detail = `status=${r.status} stdout=${JSON.stringify((r.stdout || "").trim().slice(0, 80))}`;
    rmSync(dir, { recursive: true, force: true });
  } catch (e) { detail = `spawn error: ${e.message}`; }
  s.check("G49 is-ui-diff's CLI main-guard fires through a symlink (documented invocation)", fired, detail);
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 4. Eval-harness integrity
// ════════════════════════════════════════════════════════════════════════════════════════════

// ── G21: the L2 suites — an unparseable golden, an unextractable rubric, or an unexercised choice grades nothing ──
{
  for (const f of readdirSync(join(REPO_ROOT, "scripts/eval/golden")).filter((x) => x.endsWith(".jsonl"))) {
    const lines = read(`scripts/eval/golden/${f}`).split("\n").filter(Boolean);
    const bad = lines.findIndex((ln) => { try { JSON.parse(ln); return false; } catch { return true; } });
    s.check(`G21b golden/${f} is non-empty and every line is valid JSON`, lines.length > 0 && bad === -1,
      bad === -1 ? "" : `line ${bad + 1} does not parse`);
  }

  // extractSection is the function l2.mjs feeds the model; a missing anchor throws, a bare heading grades an empty rubric.
  const BODY_MIN = 80;
  for (const suite of SUITES) {
    const sections = suite.rubric.sections ?? (suite.rubric.section === null ? [] : [suite.rubric.section]);
    if (suite.rubric.section === null) {
      s.check(`G21g ${suite.name}: whole-file rubric ${suite.rubric.file} exists`, existsSync(join(REPO_ROOT, suite.rubric.file)));
    }
    for (const section of sections) {
      let body = "", err = null;
      try { body = extractSection(suite.rubric.file, section).slice(section.length).trim(); }
      catch (e) { err = e instanceof Error ? e.message : String(e); }
      s.check(`G21g ${suite.name}: rubric '${section}' in ${suite.rubric.file} extracts a non-empty body`,
        err === null && body.length > BODY_MIN, err ?? `body length ${body.length} <= ${BODY_MIN}`);
    }

    // A choice with no golden case is untested; a renamed choice leaves every label unmatchable (0%).
    const goldenAbs = join(REPO_ROOT, "scripts/eval", suite.golden);
    if (!existsSync(goldenAbs)) { s.check(`G21j ${suite.name}: golden file exists`, false, suite.golden); continue; }
    const seen = new Set(readFileSync(goldenAbs, "utf8").split("\n").filter(Boolean)
      .map((l) => { try { return JSON.parse(l).expected; } catch { return null; } }).filter(Boolean));
    const uncovered = suite.choices.filter((c) => !seen.has(c));
    const unknown = [...seen].filter((e) => !suite.choices.includes(e));
    s.check(`G21j ${suite.name}: every choice has at least one golden case`,
      uncovered.length === 0, uncovered.length ? `no case labelled: ${uncovered.join(", ")}` : "");
    s.check(`G21j ${suite.name}: every golden label is one of the suite's choices`,
      unknown.length === 0, unknown.length ? `label not in choices: ${unknown.join(", ")}` : "");
  }
  s.check("G21g the detection eval's declared inputs exist",
    [DETECTION.runner, ...DETECTION.rubrics, DETECTION.golden].every((p) => existsSync(join(REPO_ROOT, p))));

  // A golden set whose majority label clears the CI floor lets an always-one-answer responder pass.
  const yml = read(".github/workflows/evals-l2.yml");
  {
    const labels = read("scripts/eval/golden/code-review-retrieval-relevance.jsonl").split("\n").filter(Boolean)
      .map((ln) => JSON.parse(ln).expected);
    const tally = new Map();
    for (const v of labels) tally.set(v, (tally.get(v) ?? 0) + 1);
    const baseline = (Math.max(...tally.values()) / labels.length) * 100;
    const gateLiteral = (yml.match(/EVAL_GATE:\s*"?(\d+)"?/) || [])[1];
    const gate = gateLiteral === undefined ? null : Number(gateLiteral);
    s.check("G21n code-review-retrieval-relevance majority-class baseline is below the EVAL_GATE floor",
      gate !== null && baseline < gate,
      gate === null ? "no EVAL_GATE literal in evals-l2.yml — fails closed" : `baseline ${baseline.toFixed(1)}% >= gate ${gate}%`);
  }

  // CI wiring: these are the paths by which a red, skipped, or unselected eval reads as a green check.
  {
    const suiteIf = (yml.match(/^\s{2}suite:[\s\S]*?^\s{4}if:\s*(.+)$/m) || [])[1] || "";
    s.check("G21i the suite jobs run only on an opted-in run (no unasked token spend)",
      suiteIf.includes("needs.gate.outputs.opted_in == 'true'"), `suite if: ${suiteIf.trim()}`);
    const l2If = (yml.match(/^\s{2}l2:[\s\S]*?^\s{4}if:\s*(.+)$/m) || [])[1] || "";
    s.check("G21i the aggregator check runs on every PR (a gated required check hangs forever)",
      l2If.trim() === "always()" && /^on:[\s\S]*?^\s{2}pull_request:/m.test(yml), `l2 if: ${l2If.trim()}`);
    s.check("G21d evals-l2.yml derives the affected suites from the selector",
      yml.includes("scripts/eval/select-suites.mjs") && yml.includes("fromJSON(needs.select.outputs.suites)"));
    const l2Job = (yml.match(/^\s{2}l2:[\s\S]*$/m) || [""])[0];
    const detCase = (l2Job.match(/case "\$DETECTION_RESULT" in[\s\S]*?esac/) || [""])[0];
    s.check("G21m the aggregator reads the detection job's result and fails on it",
      /needs:\s*\[[^\]]*\bdetection\b[^\]]*\]/.test(l2Job)
        && /DETECTION_RESULT:\s*\$\{\{\s*needs\.detection\.result\s*\}\}/.test(l2Job)
        && /^\s*\*\)[^\n]*FAILED=/m.test(detCase) && /if \[ -n "\$FAILED" \][\s\S]{0,120}exit 1/.test(l2Job));
    s.check("G50f a selection that did not succeed fails the run, loudly",
      /^\s*SELECT_RESULT: \$\{\{ needs\.select\.result \}\}$/m.test(l2Job)
        && /affected subset is unknown[\s\S]{0,120}exit 1/.test(l2Job));
  }

  // The runner must reject an unknown --suite: CI drives it from a generated matrix, so a no-op exit 0 reads as a pass.
  const bad = spawnSync(process.execPath, [join(REPO_ROOT, "scripts/eval/l2.mjs"), "--suite", "no-such-suite"],
    { encoding: "utf8", env: { ...process.env, ANTHROPIC_API_KEY: "" } });
  s.check("G21h l2.mjs exits non-zero on an unknown --suite name", bad.status !== 0, `exit ${bad.status}`);

  // The detection runner skips without a key; that skip must say so rather than pass silently.
  const noKey = spawnSync(process.execPath, [join(REPO_ROOT, DETECTION.runner)], { encoding: "utf8", env: { ...process.env, ANTHROPIC_API_KEY: "" } });
  s.check("G39c the detection runner skips cleanly and visibly with no API key",
    noKey.status === 0 && /no ANTHROPIC_API_KEY/.test(noKey.stdout || ""));

  // The scorer decides every L2 accuracy; a parse that picks the first enumerated choice scores template text.
  const l2runner = read("scripts/eval/l2.mjs");
  const fnSrc = l2runner.slice(l2runner.indexOf("function parseChoice"), l2runner.indexOf("const summary = []"));
  let parseChoice = null;
  try { parseChoice = eval(`(${fnSrc.slice(fnSrc.indexOf("function parseChoice"))})`); } catch { /* reported below */ }
  s.check("G21l parseChoice is extractable and callable from the live runner", typeof parseChoice === "function");
  if (typeof parseChoice === "function") {
    const C = ["Micro", "Lite", "Full"];
    const amb = (r) => typeof r === "string" && r.startsWith("?(");
    s.check("G21l a one-word reply parses to that choice",
      parseChoice("Full", C) === "Full" && parseChoice("  lite ", C) === "Lite");
    s.check("G21l a reply that enumerates every choice is ambiguous, never the first one",
      amb(parseChoice("- Tier: [Micro | Lite | Full]", C)) && amb(parseChoice("Micro | Lite | Full", C)));
    s.check("G21l a structured reply still parses", parseChoice("MODE SELECTION:\n- Tier: Full", C) === "Full");
    s.check("G21l a bracketed placeholder is scaffolding, not a second claim", parseChoice("Tier: Full [not Micro]", C) === "Full");
    s.check("G21l an unparseable reply carries its own raw text", parseChoice("I decline", C).includes("I decline"));
    const N = ["optimal", "suboptimal"], P = ["promoted", "not-promoted"];
    s.check("G21l a choice that contains another parses to the one that was said",
      parseChoice("suboptimal.", N) === "suboptimal" && parseChoice("not-promoted.", P) === "not-promoted");
    s.check("G21l the contained choice is still reachable",
      parseChoice("optimal.", N) === "optimal" && parseChoice("promoted.", P) === "promoted");
  }
}

// ── G82: an L2-read rubric section edited without its suite re-run is an unverified behaviour change ──
{
  const G82_SECTIONS = [
    { heading: "### 1.0 Prior-comment awareness + relevance memory load (default ON)", file: "agents/pr-reviewer.md", suite: "code-review-retrieval-relevance" },
    { heading: "### 1.2c Diff-keyed lesson search (all modes)", file: "agents/pr-reviewer.md", suite: "code-review-retrieval-relevance" },
    { heading: "## Cross-rubric agreement", file: "agents/shared/rules/rubric-composition.md", suite: "reviewer-agreement-bump" },
  ];
  const git = (args) => execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const refs = process.env.L1_BASE_REF ? [process.env.L1_BASE_REF] : ["origin/main", "main"];
  let base = "", baseRef = "";
  for (const ref of refs) {
    try { base = git(["merge-base", "HEAD", ref]).trim(); baseRef = ref; break; } catch { /* try the next ref */ }
  }
  // An unresolvable base fails rather than passing blind (CI checks out with fetch-depth: 0).
  s.check(`G82 the L2-read-section comparison base resolves (merge-base HEAD ${refs.join(" | ")})`,
    /^[0-9a-f]{40}$/.test(base), "fetch origin/main or set L1_BASE_REF");
  if (/^[0-9a-f]{40}$/.test(base)) {
    let changed = [], messages = "";
    try { changed = git(["diff", "--name-only", base]).split("\n").filter(Boolean); } catch { /* empty */ }
    try { messages = git(["log", "--format=%B", `${base}..HEAD`]); } catch { /* empty */ }
    const baseDir = mkdtempSync(join(tmpdir(), "l1-g82-base-"));
    for (const { heading, file, suite } of G82_SECTIONS) {
      let baseText = "";
      try { baseText = git(["show", `${base}:${file}`]); } catch { /* absent at base */ }
      const baseFile = join(baseDir, `${suite}-${Buffer.from(heading).toString("hex").slice(0, 16)}.md`);
      writeFileSync(baseFile, baseText);
      let now = "", then = "";
      try { now = extractSection(file, heading); } catch { /* asserted below */ }
      try { then = extractSection(relative(REPO_ROOT, baseFile), heading); } catch { /* new section */ }
      const verified = changed.includes(`scripts/eval/golden/${suite}.jsonl`)
        || new RegExp(`^L2-verified:\\s*.*\\b${suite.replace(/[-]/g, "\\-")}\\b`, "m").test(messages);
      s.check(`G82 "${heading}" is unchanged from base (${baseRef} ${base.slice(0, 7)}) or its ${suite} edit is verified`,
        now !== "" && (now === then || verified),
        now === "" ? "section not found" : `drifted with neither golden/${suite}.jsonl changed nor an \`L2-verified: ${suite}\` trailer`);
    }
    rmSync(baseDir, { recursive: true, force: true });
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 5. Script self-tests and script behaviour
// ════════════════════════════════════════════════════════════════════════════════════════════

// ── G114: every script that ships a `--self-test` runs it here — its own cases are its regression suite ──
// Discovered, not listed: a new script's self-test is covered the day it lands.
{
  const tracked = execFileSync("git", ["ls-files", "agents", "skills", "scripts", "plugins"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\n").filter((f) => /\.m?js$/.test(f) && !f.startsWith("scripts/eval/fixtures/") && f !== "scripts/eval/l1.mjs");
  const HANDLER = /(?:===|includes\(|indexOf\()\s*["']--self-test["']|\[["']self-test["']\]/;
  const withSelfTest = tracked.filter((f) => HANDLER.test(read(f)));
  // Guards the discovery itself: a regex that stops matching would pass with zero self-tests run.
  for (const must of ["skills/workflow/autonomous-workflow/scripts/run-checks.mjs", "scripts/eval/select-suites.mjs",
    "scripts/eval/telemetry.mjs", "scripts/eval/l2-detection.mjs", "scripts/eval/escaping-links.mjs",
    "skills/authoring/create-skill/scripts/validate-skill.mjs", "agents/pr-reviewer/scripts/finalize.mjs"]) {
    s.check(`G114 self-test discovery finds ${must}`, withSelfTest.includes(must));
  }
  const runOne = (f) => new Promise((resolve) => {
    const child = spawn(process.execPath, [join(REPO_ROOT, f), "--self-test"], { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    const timer = setTimeout(() => child.kill("SIGKILL"), 120000);
    child.on("close", (code) => { clearTimeout(timer); resolve({ f, code, out }); });
  });
  const results = [];
  const queue = [...withSelfTest];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) results.push(await runOne(queue.shift()));
  }));
  for (const { f, code, out } of results.sort((a, b) => a.f.localeCompare(b.f))) {
    s.check(`G114 ${f} --self-test passes`, code === 0,
      `exit ${code}: ${out.split("\n").filter((l) => /✗|FAIL|Error/.test(l)).slice(0, 4).join(" | ").slice(0, 300)}`);
  }
}

// ── G25 / G19 / G46m / G61f / G84 / G89 / G94: render-report.mjs has no self-test; these are its tests ──
// A renderer that accepts a bad payload posts a wrong report; one that rejects a good one posts nothing.
{
  const FIX = REPORT_FIX;
  // Snapshot parity: a renderer or template change must land with a regenerated, reviewed snapshot.
  for (const name of REPORT_FIXTURES) {
    const payload = join(FIX, `${name}.json`);
    const expectedPath = join(FIX, `${name}.expected.md`);
    if (!existsSync(expectedPath)) { s.check(`G25 ${name} fixture + snapshot present`, false); continue; }
    const r = renderReport(readFileSync(payload, "utf8"));
    const expected = readFileSync(expectedPath, "utf8");
    let detail = r.err;
    if (r.ok && r.out !== expected) {
      let i = 0;
      while (i < Math.min(r.out.length, expected.length) && r.out[i] === expected[i]) i++;
      detail = `drifted at index ${i}: got ${JSON.stringify(r.out.slice(i, i + 40))} want ${JSON.stringify(expected.slice(i, i + 40))}`;
    }
    s.check(`G25 ${name} output matches its committed snapshot`, r.ok && r.out === expected, detail);
  }

  const base = JSON.parse(readFileSync(join(FIX, "pass.json"), "utf8"));
  const mutate = (fn) => { const c = structuredClone(base); fn(c); return JSON.stringify(c); };
  const render = (fn) => renderReport(mutate(fn));

  // Headline forms the ingest grammar and readers depend on.
  s.check("G19a the renderer emits the PASS form", /^### ✅ No issues found$/m.test(renderReport(base).out));
  const warnForm = render((c) => { c.VERDICT = "WARN"; c.GATE_DOCS_STATUS = "⚠️"; c.GATE_DOCS_DETAILS = "x"; c.WARN_REASONS = ["1 doc gap"]; });
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
  const noBlocking = render((c) => {
    c.QUALITY = "produced 3 → posted inline 1 · cleared 1 · carried forward 0 · deferred 0 · below-bar 0";
    c.FINDINGS = [{ title: "A quieter one", path: "b.ts", line: 2, tier: "low" }];
  });
  s.check("G19c the renderer drops the blocking clause at zero", noBlocking.ok
    && /^### ⚪ 1 finding$/m.test(noBlocking.out) && !/0 blocking/.test(noBlocking.out), noBlocking.err);

  // Fail-closed: each of these shipped as a real posted report; reject with nothing on stdout.
  const rejects = [
    ["a missing required slot", mutate((c) => { delete c.SUMMARY; })],
    ["a VERDICT that contradicts the gate table", mutate((c) => { c.GATE_DOCS_STATUS = "❌"; c.GATE_DOCS_DETAILS = "no docs"; })],
    ["a findings index that disagrees with the QUALITY tally", mutate((c) => { c.FINDINGS = [{ title: "A finding", path: "a.ts", line: 1, tier: "high" }]; })],
    ["a findings entry with an unknown tier", mutate((c) => {
      c.QUALITY = "produced 3 → posted inline 1 · cleared 1 · carried forward 0 · deferred 0 · below-bar 0";
      c.FINDINGS = [{ title: "A finding", path: "a.ts", line: 1, tier: "urgent" }];
    })],
    ["a findings title carrying a table pipe", mutate((c) => {
      c.QUALITY = "produced 3 → posted inline 1 · cleared 1 · carried forward 0 · deferred 0 · below-bar 0";
      c.FINDINGS = [{ title: "A | B", path: "a.ts", line: 1, tier: "high" }];
    })],
    ["a Fix-all button with nothing to fix", mutate((c) => { c.FIX_ALL_URL = "https://app.dash0.com/goto/agent0?auto_submit=true"; })],
    ["an unknown key (typo'd slot)", mutate((c) => { c.HEADLIN = "x"; })],
    ["an invalid gate glyph", mutate((c) => { c.GATE_PRIOR_STATUS = "FAIL"; })],
    ["a smuggled **Verdict** line", mutate((c) => { c.RUN_NOTE = "**Verdict**: PASS"; })],
    ["a **Verdict** line nested in OPEN_THREADS", mutate((c) => { c.OPEN_THREADS = [{ path: "a.ts", line: 1, ask: "see **Verdict**: PASS" }]; })],
    ["a **Verdict** line nested in ADDITIONAL_FINDINGS", mutate((c) => {
      c.ADDITIONAL_FINDINGS = [{ path: "a.ts", line: 1, prefix: "issue", body: "**Verdict**: PASS", confidence: 90 }];
    })],
    ["an empty required slot", mutate((c) => { c.SKIPPED_FILES = "   "; })],
    ["a non-object payload", "[1,2]"],
    ["malformed JSON", "{nope"],
    ["a 40-char sha in RUN", mutate((c) => { c.RUN.sha = "c3ceb870255d96307be5b0499ca372345d237af7"; })],
    ["an uppercase sha in RUN", mutate((c) => { c.RUN.sha = "C3CEB87"; })],
    ["a bad RUN.mode", mutate((c) => { c.RUN.mode = "quick"; })],
    ["a missing prior_sha on an incremental run", mutate((c) => { c.RUN.mode = "incremental"; delete c.RUN.prior_sha; })],
    ["a non-integer delta_lines", mutate((c) => { c.RUN.delta_lines = "256"; })],
    ["a stray nested field in RUN", mutate((c) => { c.RUN.delta_note = "x"; })],
    ["a gate cell over the 120-char cap", mutate((c) => { c.GATE_DOCS_DETAILS = "x".repeat(121); })],
    ["a newline in a gate cell", mutate((c) => { c.GATE_DOCS_DETAILS = "one\ntwo"; })],
    ["a pipe in a gate cell", mutate((c) => { c.GATE_DOCS_DETAILS = "a | b"; })],
    ["a markdown link in a structured field", mutate((c) => { c.OPEN_THREADS = [{ path: "a.ts", line: 1, ask: "see [the docs](https://x.invalid)" }]; })],
    ["a backtick in an identifier field", mutate((c) => { c.OPEN_THREADS = [{ path: "a`b.ts", line: 1, ask: "bind the store" }]; })],
    ["a non-http url", mutate((c) => { c.OPEN_THREADS = [{ path: "a.ts", line: 1, url: "javascript:alert(1)", ask: "x" }]; })],
    ["a non-numeric line", mutate((c) => { c.OPEN_THREADS = [{ path: "a.ts", line: "top", url: "https://x.invalid/1", ask: "x" }]; })],
    ["a bad Conventional-Comments prefix", mutate((c) => { c.ADDITIONAL_FINDINGS = [{ path: "a.ts", line: 1, prefix: "warning", body: "x", confidence: 90 }]; })],
    ["an out-of-range confidence", mutate((c) => { c.ADDITIONAL_FINDINGS = [{ path: "a.ts", line: 1, prefix: "issue", body: "x", confidence: 150 }]; })],
    ["RESOLVED_SINCE with no open threads", mutate((c) => { c.RESOLVED_SINCE = { count: 4, sha: "70cf147" }; })],
    ["an optimality card with no anchored heading", mutate((c) => { c.OPTIMALITY_CARDS = ["> just prose"]; })],
    ["a log slot that does not start ran/skipped", mutate((c) => { c.STANDARDS_LOG = "2 docs · 0 findings"; })],
    ["a QUALITY line in the wrong shape", mutate((c) => { c.QUALITY = "4 findings posted"; })],
    ["a v1 payload (FOOTER_LINE / MEMORIES / counts)", mutate((c) => {
      c.FOOTER_LINE = "Reviewed for commit `abc1234`."; c.MEMORIES = "53 indexed"; c.OPEN_THREADS_COUNT = "2";
    })],
    ["OPEN_THREADS supplied as a markdown string", mutate((c) => { c.OPEN_THREADS = "- x"; })],
    ["a non-zero delta_lines on a zero-delta run", mutate((c) => { c.RUN = { mode: "zero-delta", sha: "bde3c2f", prior_sha: "70cf147", delta_lines: 12 }; })],
    ["a MEMORIES_USED entry with no key", mutate((c) => { c.MEMORIES_USED = [{ url: "https://lorekit.io/lore?x=1", note: "promoted" }]; })],
    ["a hand-written used count in MEMORIES_SUMMARY", mutate((c) => { c.MEMORIES_SUMMARY = "53 indexed · 3 used"; })],
    ["MEMORIES_USED beside a not-connected summary", mutate((c) => { c.MEMORIES_SUMMARY = "not connected"; c.MEMORIES_USED = [{ key: "a-lesson-key" }]; })],
    ["more memories used than indexed", mutate((c) => { c.MEMORIES_SUMMARY = "1 indexed"; c.MEMORIES_USED = [{ key: "a" }, { key: "b" }]; })],
    ["PARTIAL_REVIEW scanned over total", mutate((c) => { c.PARTIAL_REVIEW = { calls: 40, scanned: 90, total: 12 }; })],
    ["RESOLVED_SINCE supplied as a pre-rendered string", mutate((c) => { c.RESOLVED_SINCE = " <sup>7 resolved since `abc1234`</sup>"; })],
    ["a markdown link caged in a code span in a prose field", mutate((c) => {
      c.MEMORIES_USED = [{ key: "a-lesson-key", note: "``[a-lesson-key](https://lorekit.io/lore?x=1)`` — promoted" }];
    })],
    ["a markdown link caged in a code span in an optimality card", mutate((c) => {
      c.OPTIMALITY_CARDS = ["### Optimality proposal — a.ts:1\n\n``[the docs](https://lorekit.io/lore?x=1)``"];
    })],
    ["a RUN_NOTE carrying a ⚠️", mutate((c) => { c.RUN_NOTE = "⚠️ compare range polluted"; })],
    ["a RUN_ANOMALY supplying its own glyph", mutate((c) => { c.RUN_ANOMALY = "⚠️ compare range polluted"; })],
    ["a title over TITLE_MAX", mutate((c) => {
      c.QUALITY = "produced 3 → posted inline 1 · cleared 1 · carried forward 0 · deferred 0 · below-bar 0";
      c.FINDINGS = [{ title: "W".repeat(400), path: "a.ts", line: 1, tier: "low" }];
    })],
    ["a title carrying sentence punctuation", mutate((c) => {
      c.QUALITY = "produced 3 → posted inline 1 · cleared 1 · carried forward 0 · deferred 0 · below-bar 0";
      c.FINDINGS = [{ title: "The registry is never wired up.", path: "a.ts", line: 1, tier: "low" }];
    })],
    ["a claim prefix in NOTES", mutate((c) => { c.NOTES = [{ path: "n.ts", line: 3, prefix: "issue", body: "A short note.", confidence: 91 }]; })],
  ];
  // Only these two may fail on the unknown-key check; any other case failing there has lost its own guard.
  const UNKNOWN_KEY_CASES = new Set(["an unknown key (typo'd slot)", "a v1 payload (FOOTER_LINE / MEMORIES / counts)"]);
  for (const [why, input] of rejects) {
    const r = renderReport(input);
    s.check(`G25 the renderer rejects ${why}, with nothing on stdout`, !r.ok && r.out === "", r.ok ? "ACCEPTED" : r.out.slice(0, 60));
    if (!UNKNOWN_KEY_CASES.has(why)) {
      s.check(`G25 rejecting ${why} is not an unknown-key rejection`, !/unknown payload key/.test(r.err), r.err.slice(0, 90));
    }
  }

  // The discriminating half: well-formed inputs in the same slots still render.
  const mem = render((c) => { c.MEMORIES_USED = [{ key: "a-lesson-key", url: "https://lorekit.io/lore?x=1", note: "promoted" }]; });
  s.check("G25 MEMORIES_USED renders as a renderer-built link with a derived used count",
    mem.ok && mem.out.includes("[`a-lesson-key`](https://lorekit.io/lore?x=1) — promoted") && mem.out.includes("Memories — 53 indexed · 1 used"), mem.err);
  const zd = render((c) => { c.RUN = { mode: "zero-delta", sha: "bde3c2f", prior_sha: "70cf147", at: "2026-08-15T09:12:00Z" }; });
  s.check("G25 a zero-delta run renders under the incremental grammar with its footer form",
    zd.ok && /^incremental · 0 lines in delta$/m.test(zd.out)
      && zd.out.includes("commit `bde3c2f` · no code changes since `70cf147`, gate checks only"), zd.err);
  const ask = render((c) => { c.OPEN_THREADS = [{ path: "a.ts", line: 1, url: "https://x.invalid/1", ask: "bind `LocalStore.search`" }]; });
  s.check("G25 a backticked ask renders verbatim", ask.ok && ask.out.includes("— bind `LocalStore.search`"), ask.err);
  const threads = render((c) => { c.OPEN_THREADS = [{ path: "a.ts", line: 1, url: "https://x.invalid/1", ask: "bind the store" }]; });
  s.check("G25 a structured OPEN_THREADS array renders its derived count inside the accordion",
    threads.ok && threads.out.includes("**Open review threads (1)**")
      && threads.out.includes("<summary>Review details — 1 open review thread</summary>")
      && !threads.out.split("<details>")[0].includes("**Open review threads ("), threads.err);
  const ciOnly = render((c) => { c.CI_NOTE = "2 checks red on `bde3c2f`."; });
  s.check("G25 red CI alone renders the clean PASS headline (Gate 2 is informational)",
    ciOnly.ok && !ciOnly.out.includes("**Needs attention**") && /^### ✅ No issues found$/m.test(ciOnly.out), ciOnly.err);
  const anom = render((c) => { c.RUN_ANOMALY = "a base-branch merge polluted the compare range"; });
  s.check("G25 RUN_ANOMALY renders on its own ⚠️ line",
    anom.ok && /^⚠️ a base-branch merge polluted the compare range$/m.test(anom.out), anom.err);

  // Headline counts posted notes, never claims.
  const note = (prefix, line) => ({ path: "n.ts", line, prefix, body: "A short note.", confidence: 91 });
  const withNote = render((c) => {
    c.QUALITY = "produced 4 → posted inline 2 · cleared 2 · carried forward 0 · deferred 0 · below-bar 0";
    c.FINDINGS = [
      { title: "A blocking finding", path: "a.ts", line: 1, tier: "high", blocking: true },
      { title: "A quieter one", path: "b.ts", line: 2, tier: "low" },
    ];
    c.NOTES = [note("nitpick", 3)];
  });
  s.check("G84h the note clause is appended after the blocking clause",
    withNote.ok && /^### 🟠 2 findings — 1 blocking · 1 note$/m.test(withNote.out), withNote.err);
  const passNotes = render((c) => { c.NOTES = [note("nitpick", 3), note("question", 4)]; });
  s.check("G84l posted notes render under `Notes (<M>) — posted inline` and are counted in a PASS headline",
    passNotes.ok && /^### ✅ No issues found · 2 notes$/m.test(passNotes.out)
      && /<summary>Notes \(2\) — posted inline<\/summary>/.test(passNotes.out), passNotes.err);

  // WARN_REASONS cross-checked against the ⚠️ gates, both polarities.
  const warnPayload = JSON.parse(readFileSync(join(FIX, "warn.json"), "utf8"));
  const warnGates = Object.entries(warnPayload).filter(([k, v]) => /^GATE_[A-Z]+_STATUS$/.test(k) && v === "⚠️").length;
  const tooMany = renderReport({ ...warnPayload, WARN_REASONS: Array.from({ length: warnGates + 2 }, (_, i) => `phantom ${i + 1}`) });
  s.check("G46m the renderer rejects more WARN_REASONS than ⚠️ gates", !tooMany.ok && /WARN_REASONS has \d+ phrases but only \d+ gate/.test(tooMany.err));
  s.check("G46m a WARN verdict with no WARN_REASONS is rejected", !renderReport({ ...warnPayload, WARN_REASONS: [] }).ok);

  // A depth capped to diff-only must render, and only with the anomaly that names the cap.
  const deep = JSON.parse(readFileSync(join(FIX, "deep.json"), "utf8"));
  const capped = { ...deep, RUN: { ...deep.RUN, tier: "standard", depth: "diff-only" },
    RUN_ANOMALY: "workspace ladder exhausted — DEPTH_CAPABILITY=diff-only, tier capped at standard" };
  s.check("G61f a capped run renders", renderReport(capped).ok, renderReport(capped).err.slice(0, 200));
  const silentCap = { ...capped }; delete silentCap.RUN_ANOMALY;
  s.check("G61f the same capped run with no RUN_ANOMALY is rejected", !renderReport(silentCap).ok);
  s.check("G61f mode=full + tier=quick is still rejected under the cap",
    !renderReport({ ...capped, RUN: { ...capped.RUN, tier: "quick" } }).ok);

  // The reach section and the Checked/Progress lines.
  {
    const reach = JSON.parse(readFileSync(join(FIX, "reach-progress.json"), "utf8"));
    const clone = () => JSON.parse(JSON.stringify(reach));
    const good = renderReport(reach);
    const reachAt = good.out.indexOf("<details>\n<summary>What this change reaches — ");
    const detailsAt = good.out.indexOf("<details>\n<summary>Review details");
    const fenceAt = good.out.indexOf("```mermaid");
    s.check("G89a the reach accordion renders above Review details and holds the only Mermaid block",
      good.ok && reachAt !== -1 && reachAt < detailsAt && fenceAt > reachAt
        && fenceAt < good.out.indexOf("</details>", reachAt) && good.out.split("```mermaid").length === 2, good.err);
    const mismatch = clone(); mismatch.IMPACT.symbols[0].verified_unaffected = 6;
    s.check("G89c a consumers list that disagrees with verified_unaffected is rejected", !renderReport(mismatch).ok);
    const quoted = clone();
    quoted.IMPACT.symbols[0].consumers[0].path = 'src/jobs/we"ird.ts';
    quoted.IMPACT.symbols[0].consumers[5].path = "src/x#y/poll.ts";
    const q = renderReport(quoted);
    const fence = (q.out.match(/```mermaid\n([\s\S]*?)```/) || [])[1] || "";
    s.check("G89d Mermaid labels are entity-escaped (a quote or # in a path cannot break the diagram)",
      q.ok && fence.includes("we#quot;ird") && !fence.includes('we"ird') && fence.includes("x#35;y") && !fence.includes("x#y"), q.err);
    const badRound = clone(); badRound.ROUNDS[0].blocking = 9;
    const partial = clone(); partial.PARTIAL_REVIEW = { calls: 60, scanned: 13, total: 22 };
    s.check("G89f ROUNDS with blocking > open, and COVERAGE that disagrees with PARTIAL_REVIEW, are rejected",
      !renderReport(badRound).ok && !renderReport(partial).ok);
    const overRead = clone(); overRead.IMPACT.dependencies[0].checked_sites = 9;
    s.check("G89r more checked dependency sites than exist is rejected", !renderReport(overRead).ok);

    const modules = JSON.parse(readFileSync(join(FIX, "reach-modules.json"), "utf8"));
    const bad = (mut) => { const c = JSON.parse(JSON.stringify(modules)); mut(c.IMPACT.modules[0]); return renderReport(c).ok; };
    s.check("G94d the renderer rejects importers over importer_files, the file as its own importer, a repeated importer, or a stray field",
      !bad((m) => { m.importer_files = 2; }) && !bad((m) => { m.importers.push("src/api/backoff.ts"); })
        && !bad((m) => { m.importers.push("src/jobs/sync.ts"); }) && !bad((m) => { m.checked = true; }));
  }
}

// ── G29: render-pointer.mjs has no self-test; a pointer it should refuse would post as a hand-shaped body ──
{
  const RENDER = join(PRS, "render-pointer.mjs");
  const FIX = join(REPO_ROOT, "scripts/eval/fixtures/report-pointer");
  const run = (args, input) => {
    const r = spawnSync(process.execPath, [RENDER, ...args], { input, encoding: "utf8" });
    return { ok: r.status === 0, out: r.stdout || "", err: (r.stderr || "").trim() };
  };
  for (const name of ["pointer", "degraded"]) {
    const expectedPath = join(FIX, `${name}.expected.md`);
    if (!existsSync(expectedPath)) { s.check(`G29 ${name} fixture + snapshot present`, false); continue; }
    const r = run([join(FIX, `${name}.json`)]);
    s.check(`G29 ${name} output matches its committed snapshot`, r.ok && r.out === readFileSync(expectedPath, "utf8"), r.err);
  }
  const rejects = [
    ["a missing FORM", '{"HEAD_SHA":"bde3c2f"}'],
    ["an invalid FORM", '{"FORM":"summary","HEAD_SHA":"bde3c2f"}'],
    ["a non-7-char sha", '{"FORM":"pointer","HEAD_SHA":"abc","FINDINGS_COUNT":1}'],
    ["an uppercase sha", '{"FORM":"pointer","HEAD_SHA":"BDE3C2F","FINDINGS_COUNT":1}'],
    ["the retired escalation form", '{"FORM":"escalation","HEAD_SHA":"bde3c2f","VERDICT":"FAIL","PRIOR_VERDICT":"PASS","REASONS":"x","STICKY_URL":"https://x/1"}'],
    ["degraded missing DEGRADED_REASON", '{"FORM":"degraded","HEAD_SHA":"bde3c2f","FINDINGS_COUNT":1,"HEADLINE_LINE":"x"}'],
    ["degraded HEADLINE_LINE carrying the report marker", '{"FORM":"degraded","HEAD_SHA":"bde3c2f","FINDINGS_COUNT":1,"HEADLINE_LINE":"<!-- PR_REVIEWER_REPORT -->","DEGRADED_REASON":"x"}'],
    ["a ledger block smuggled into DEGRADED_REASON", '{"FORM":"degraded","HEAD_SHA":"bde3c2f","FINDINGS_COUNT":1,"HEADLINE_LINE":"x","DEGRADED_REASON":"see <!-- PR_REVIEWER_LEDGER {\\"v\\":1} -->"}'],
    ["an unknown payload key", '{"FORM":"pointer","HEAD_SHA":"bde3c2f","FINDINGS_COUNT":1,"EXTRA":"nope"}'],
    ["a non-object payload", "[1,2]"],
    ["malformed JSON", "{nope"],
  ];
  for (const [label, input] of rejects) {
    const r = run([], input);
    s.check(`G29 rejects ${label}, with nothing on stdout`, !r.ok && r.out === "", r.out ? `stdout: ${r.out.slice(0, 80)}` : r.err);
  }
}

// ── G31: build-agent0-link.mjs has no self-test; a bad encoding ships a button that opens the wrong prompt or org ──
{
  const LINK_MOD = join(PRS, "build-agent0-link.mjs");
  const { encodePrompt, buildLink } = await import(pathToFileURL(LINK_MOD).href);
  const throws = (fn) => { try { fn(); return false; } catch { return true; } };
  s.check("G31a encodePrompt escapes '(', ')', and \"'\"", encodePrompt("fix(this)'now") === "fix%28this%29%27now");
  s.check("G31b buildLink never leaves a literal ')' in the URL (it would end the markdown link)",
    !buildLink("close (this) paren", "production", "fix-all").includes(")"));
  s.check("G31c buildLink prefixes the Agent0 base and auto_submit flag",
    buildLink("hi", "production", "fix-all").startsWith("https://app.dash0.com/goto/agent0?auto_submit=true&initial_prompt="));
  s.check("G31g buildLink throws on a missing or unknown source",
    throws(() => buildLink("hi", "production", undefined)) && throws(() => buildLink("hi", "production", "bogus")));
  s.check("G31h buildLink appends the utm_source tag matching the source",
    buildLink("hi", "production", "fix-all").includes("&utm_source=pr-reviewer-fix-all")
      && buildLink("hi", "production", "fix-this").includes("&utm_source=pr-reviewer-fix-this"));
  for (const [what, org] of [["omitted", undefined], ["null", null], ["empty", ""], ["blank", "  "]]) {
    s.check(`G31j buildLink sends no org param when the org is ${what}`, !buildLink("hi", "production", "fix-all", org).includes("org="));
  }
  s.check("G31k buildLink appends &org=<slug> last when one is configured",
    buildLink("hi", "production", "fix-all", "dash0-development") === `${buildLink("hi", "production", "fix-all")}&org=dash0-development`);
  for (const bad of ["a&b=c", "a#b", "a b", "-leading", "x".repeat(64), "a/b", "a?b"]) {
    s.check(`G31l buildLink rejects the malformed org ${JSON.stringify(bad)}`, throws(() => buildLink("hi", "production", "fix-all", bad)));
  }
  const runCli = (args) => spawnSync(process.execPath, [LINK_MOD, ...args], { encoding: "utf8" });
  const empty = runCli(["--source", "fix-all", ""]);
  s.check("G31d CLI rejects an empty prompt with nothing on stdout", empty.status !== 0 && empty.stdout === "");
  const oversized = runCli(["--source", "fix-all", "a".repeat(4500)]);
  s.check("G31e CLI rejects a prompt whose URL exceeds MAX_URL", oversized.status !== 0 && oversized.stdout === "" && /over 4000/.test(oversized.stderr));
  const ok = runCli(["--source", "fix-all", "fix this thing"]);
  s.check("G31f CLI prints one URL for a normal prompt", ok.status === 0 && ok.stdout.trim() === buildLink("fix this thing", "production", "fix-all"));
  const noSource = runCli(["fix this thing"]);
  s.check("G31i CLI rejects a missing --source", noSource.status !== 0 && noSource.stdout === "" && /source must be one of/.test(noSource.stderr));
  const withOrg = runCli(["--env", "development", "--org", "dash0-development", "--source", "fix-this", "fix it"]);
  s.check("G31m CLI --org composes with --env / --source",
    withOrg.status === 0 && withOrg.stdout.trim() === buildLink("fix it", "development", "fix-this", "dash0-development"));
  const badOrg = runCli(["--org", "bad&org", "--source", "fix-all", "fix it"]);
  s.check("G31m CLI rejects a malformed --org", badOrg.status !== 0 && badOrg.stdout === "" && /org must match/.test(badOrg.stderr));
}

// ── G46: comment-spine.mjs has no self-test; render-comment.mjs's output must pass the post pre-flight ──
{
  const SPINE = join(PRS, "comment-spine.mjs");
  const RENDER = join(PRS, "render-comment.mjs");
  const FIX = join(REPO_ROOT, "scripts/eval/fixtures/inline-comment");
  const spine = await import(pathToFileURL(SPINE).href);
  const { payloadIsSafe } = await import(pathToFileURL(join(PRS, "execute-write-plan.mjs")).href);
  const run = (args, input) => {
    const r = spawnSync(process.execPath, [RENDER, ...args], { input, encoding: "utf8" });
    return { ok: r.status === 0, out: r.stdout || "", err: (r.stderr || "").trim() };
  };

  // sentenceCount gates the one-liner shape; counting characters scores a dotted filename as sentences.
  const cases = [["Bump `x` to 3.2.6 in foo.md", 0], ["One. Two. Three.", 3], ["Really?! Yes.", 2], ["See foo.md.", 1]];
  const wrong = cases.filter(([input, want]) => spine.sentenceCount(input) !== want);
  s.check("G46n sentenceCount counts terminal-punctuation runs, not characters", wrong.length === 0,
    wrong.map(([i]) => JSON.stringify(i)).join("; "));

  // assetUrls drives the live asset check before posting; a miss posts a broken button.
  const btn = spine.fixButton({ kind: "this", url: "https://app.dash0.com/goto/agent0?x=1" });
  s.check("G46k assetUrls() finds all three of a button's assets, and ignores a non-asset url",
    spine.assetUrls(btn).length === 3 && spine.assetUrls("see https://example.com/x.svg").length === 0);

  const fixtures = existsSync(FIX) ? readdirSync(FIX).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort() : [];
  s.check("G46c the inline surface has committed reference renderings", fixtures.length > 0);
  for (const name of fixtures) {
    const expectedPath = join(FIX, `${name}.expected.md`);
    if (!existsSync(expectedPath)) { s.check(`G46d ${name} fixture + snapshot present`, false); continue; }
    const r = run([join(FIX, `${name}.json`)]);
    const body = readFileSync(expectedPath, "utf8");
    s.check(`G46d ${name} output matches its committed snapshot`, r.ok && r.out === body, r.err);
    const first = body.split("\n")[0];
    // record-comment-relevance.mjs reads the tier with this regex, verbatim.
    s.check(`G46e ${name} tier is readable by the relevance recorder's SEVERITY_RE`,
      /^\s*\*{0,2}(?:issue|suggestion|nitpick|nit|question|praise|chore)\s*\((critical|high|medium|low)\)/i.test(body), first.slice(0, 60));
    // Gate 3 parses the bold (blocking) token off line 1 to decide whether an open thread fails a PR.
    if (/\*\*\(blocking\)\*\*|\*\*\(non-blocking\)\*\*/.test(body)) {
      s.check(`G46e ${name} keeps its bold blocking decoration on line 1`, /\*\*\((?:non-)?blocking\)\*\*\s*$/.test(first), first.slice(-40));
    }
  }
  // payloadIsSafe aborts the WHOLE post: every rendered reference body, and every maximal legal one, must pass.
  const refVerdict = payloadIsSafe({ event: "COMMENT", body: "<!-- PR_REVIEWER_POINTER -->",
    comments: fixtures.map((name) => ({ path: "a.ts", line: 1, side: "RIGHT", body: readFileSync(join(FIX, `${name}.expected.md`), "utf8") })) });
  s.check("G46i the post pre-flight accepts every rendered reference body", refVerdict.ok === true, `rejected: ${refVerdict.reason}`);
  const { buildLink } = await import(pathToFileURL(join(PRS, "build-agent0-link.mjs")).href);
  const maxFixUrl = buildLink(`/pr-fix https://github.com/${"o".repeat(20)}/${"r".repeat(20)}/pull/165 pr-reviewer — `
    + "apply only the finding at ".repeat(6), "development", "fix-this");
  const tenLineFence = { lang: "ts", code: Array.from({ length: 10 }, (_, i) => `  const someValue${i} = computeSomething(argumentOne, argumentTwo);`).join("\n") };
  for (const [label, baseName, over] of [
    ["a claim at every cap, unverified", "suggestion-pseudo", { TITLE: "T".repeat(spine.TITLE_MAX), BODY: "P".repeat(spine.PROSE_MAX), UNVERIFIED: "U".repeat(spine.UNVERIFIED_MAX), EVIDENCE: undefined }],
    ["a one-liner at its cap", "nitpick", { BODY: "P".repeat(spine.PROSE_MAX) }],
    ["a blocking claim at every cap with a 10-line fence and a fix button", "issue-blocking",
      { TITLE: "T".repeat(spine.TITLE_MAX), BODY: "P".repeat(spine.PROSE_MAX), FENCE: tenLineFence, FIX_URL: maxFixUrl }],
  ]) {
    const payload = { ...JSON.parse(readFileSync(join(FIX, `${baseName}.json`), "utf8")), ...over };
    for (const k of Object.keys(over)) if (over[k] === undefined) delete payload[k];
    const r = run([], JSON.stringify(payload));
    const verdict = r.ok ? payloadIsSafe({ event: "COMMENT", body: "<!-- PR_REVIEWER_POINTER -->", comments: [{ path: "a.ts", line: 1, side: "RIGHT", body: r.out }] }) : { ok: false, reason: r.err };
    s.check(`G46l ${label} renders and passes payloadIsSafe`, verdict.ok === true, `rejected: ${verdict.reason}`);
  }

  // --relay-check: exit 1 withholds the fix link, exit 3 posts as rendered; a wrong code loses the review or the button.
  const relay = (body) => {
    const f = join(tmpdir(), `l1-relay-${Math.random().toString(36).slice(2)}.md`);
    writeFileSync(f, body);
    const r = spawnSync(process.execPath, [SPINE, "--relay-check", f], { encoding: "utf8" });
    rmSync(f, { force: true });
    return r;
  };
  const budget = spine.RELAY_SAFE_URL_MAX;
  const shortUrl = "https://app.dash0.com/goto/agent0?auto_submit=true&initial_prompt=Fix";
  const longUrl = shortUrl + "%20" + "x".repeat(budget);
  const longDoc = `https://lorekit.example.com/${"d".repeat(budget)}`;
  s.check("G46j a URL inside the budget is relay-safe",
    relay(`<a href="${shortUrl}"><img alt="Fix with Agent0" src="x"></a>`).status === 0);
  const over = relay(`<a href="${longUrl}"><img alt="Fix with Agent0" src="x"></a>`);
  s.check("G46j an over-budget fix link exits 1 with its length and the budget",
    over.status === 1 && new RegExp(`relay-unsafe url \\(\\d+ chars, over ${budget}\\)`).test(over.stderr), (over.stderr || "").slice(0, 200));
  s.check("G46j a long URL inside a fence is not a relay finding",
    relay(`before\n\n\`\`\`\n${longUrl}\n\`\`\`\n\nafter\n`).status === 0);
  s.check("G46j a long URL that is not a fix link exits 3", relay(`see <${longDoc}>\n`).status === 3);
  s.check("G46j a fix link still exits 1 when both kinds are over budget",
    relay(`see <${longDoc}>\n\n<a href="${longUrl}"><img alt="Fix with Agent0" src="x"></a>`).status === 1);
}

// ── G26: validate-report-shape.mjs has no self-test; it is the only guard that sees what reached a PR ──
{
  const VALIDATOR = join(REPO_ROOT, "scripts/validate-report-shape.mjs");
  const POSTED = join(REPO_ROOT, "scripts/eval/fixtures/posted-bodies");
  const run = (input) => {
    const r = spawnSync(process.execPath, [VALIDATOR], { input, encoding: "utf8" });
    let verdict = null;
    try { verdict = JSON.parse(r.stdout); } catch { /* reported below */ }
    return { status: r.status, verdict, err: (r.stderr || "").trim() };
  };
  const codes = (r) => (r.verdict?.violations || []).map((v) => v.code);
  for (const [file, expected] of [
    ["lorekit-503-flat.md", ["missing-report-marker", "no-review-details-accordion", "accordion-owned-line-at-top-level"]],
    ["lorekit-503-report-as-pointer.md", ["report-marked-as-pointer"]],
    ["agent-skills-165-escaped-button.md", ["escaped-inline-html", "backtick-in-href", "caged-link-target"]],
  ]) {
    const p = join(POSTED, file);
    if (!existsSync(p)) { s.check(`G26 posted fixture ${file} present`, false); continue; }
    const r = run(readFileSync(p, "utf8"));
    const got = codes(r);
    s.check(`G26 ${file} is rejected with ${expected.join(", ")}`, r.status === 1 && expected.every((c) => got.includes(c)),
      `exit ${r.status}; got ${got.join(", ")}`);
  }
  // The renderer's own output must pass the external validator, or the two disagree about the contract.
  for (const name of REPORT_FIXTURES) {
    const p = join(REPORT_FIX, `${name}.expected.md`);
    if (!existsSync(p)) continue;
    const r = run(readFileSync(p, "utf8"));
    s.check(`G26 the rendered ${name} snapshot passes the external validator`, r.status === 0, `exit ${r.status}: ${r.err.slice(0, 120)}`);
  }
  for (const [why, sep] of [["tight pipes", "|---|---|---|"], ["padded pipes", "| --- | --- | --- |"]]) {
    const r = run(`Reviewed your changes — no blocking issues.\n\n| Gate | Status | Details |\n${sep}\n| Code review | ✅ | fine |\n`);
    s.check(`G26 the gate table alone classifies a body as a report (${why})`, r.status === 1 && r.verdict?.kind === "report-unmarked");
  }
  {
    const marker = "<!-- PR_REVIEWER_POINTER -->";
    const r = run(`${marker}\n${"x".repeat(600 - marker.length + 5)}\n`);
    s.check("G26 the pointer budget counts the marker", r.status === 1 && codes(r).includes("pointer-too-long"));
  }
  {
    const r = run("Reviewed your changes.\n\n| Gate | Status | Details |\n|---|---|---|\n| Code review | OK | x |\n");
    const notice = ["<!-- PR_REVIEWER_SHAPE_GUARD -->", "⚠️ **The last `pr-reviewer` body does not match the report shape contract.**", "",
      ...(r.verdict?.violations || []).map((v) => `- \`${v.code}\` — ${v.detail}`), ""].join("\n");
    const back = run(notice);
    s.check("G26 the guard's own notice is not itself a reviewer body", back.status === 0 && back.verdict?.kind === "not-a-reviewer-body");
  }
  for (const [why, body] of [["a plain human comment", "LGTM, nice work on the caching layer."], ["an incidental bold label", "**Note** — rebased onto main."]]) {
    const r = run(body);
    s.check(`G26 the validator ignores ${why}`, r.status === 0 && r.verdict?.kind === "not-a-reviewer-body");
  }
  for (const [why, body] of [
    ["a one-line pointer", '<!-- PR_REVIEWER_POINTER -->\nReviewed `abc1234` — 3 finding(s) inline.\n\n<!-- PR_REVIEWER_LEDGER {"v":1,"runs":[]} -->\n'],
    ["a marker-only pointer", "<!-- PR_REVIEWER_POINTER -->\n"],
  ]) {
    const r = run(body);
    s.check(`G26 ${why} conforms`, r.status === 0 && r.verdict?.kind === "pointer");
  }
  const good = readOr("scripts/eval/fixtures/report-body/warn.expected.md");
  s.check("G26 report-body snapshot warn.expected.md present (the synthesis base)", good !== "");
  for (const [why, body, code] of good ? [
    ["a pre-expanded accordion", good.replace("<details>\n<summary>Review details", "<details open>\n<summary>Review details"), "accordion-pre-expanded"],
    ["a **Verdict** line", `${good}\n**Verdict**: PASS\n`, "verdict-in-posted-body"],
    ["a caged markdown link", good.replace(/^- (\[[^\]]*\]\([^)]*\))/m, "- ``$1``"), "link-caged-in-code-span"],
    ["a count disagreeing with its list", good.replace("**Open review threads (2)**", "**Open review threads (5)**"), "count-disagrees-with-list"],
    ["a drift-worded count disagreeing with its list", good.replace("**Open review threads (2)**", "**Open threads (5)**"), "count-disagrees-with-list"],
    ["a flat body preceded by an unrelated <details> fold",
      "Reviewed your changes.\n\n<details>\n<summary>Additional findings</summary>\n\n- a\n\n</details>\n\n"
        + "| Gate | Status | Details |\n|---|---|---|\n| Code review | ✅ | fine |\n\n**Run mode** — full\n", "accordion-owned-line-at-top-level"],
  ] : []) {
    const r = run(body);
    s.check(`G26 the validator flags ${why} as ${code}`, r.status === 1 && codes(r).includes(code), codes(r).join(", "));
  }
  // The reusable workflow and its caller template are how a consuming repo reaches the validator.
  const wf = readOr(".github/workflows/reviewer-report-shape.yml");
  s.check("G26 the reusable workflow runs the validator", wf.includes("scripts/validate-report-shape.mjs") && wf.includes("workflow_call"));
  s.check("G26 the caller template targets the reusable workflow",
    readOr("plugins/pr-reviewer-shape-guard/templates/report-shape-caller.yml").includes("mthines/agent-skills/.github/workflows/reviewer-report-shape.yml@main"));
}

// ── Cross-script and fixture-driven behaviour of scripts that do have self-tests ──
{
  // G33: classify-shape.mjs must parse GitHub's real /tmp/pr-files.json shapes (NDJSON and a one-file object).
  const CLS = join(PRS, "classify-shape.mjs");
  const DT = join(REPO_ROOT, "scripts/eval/fixtures/delta-triage");
  const run = spawnSync(process.execPath, [CLS, join(DT, "pr-files.ndjson")], { encoding: "utf8" });
  let cls = {};
  try { cls = JSON.parse(run.stdout || "{}"); } catch { /* asserted below */ }
  s.check("G33d the NDJSON fixture classifies auth as a risky high-stakes shape",
    run.status === 0 && Array.isArray(cls.shapes) && cls.shapes.includes("auth") && cls.risky === true
      && (cls.high_stakes_files || []).includes("src/auth/login.ts"), (run.stderr || "").slice(0, 120));
  const one = spawnSync(process.execPath, [CLS, join(DT, "one-file.ndjson")], { encoding: "utf8" });
  let oneCls = {};
  try { oneCls = JSON.parse(one.stdout || "{}"); } catch { /* asserted below */ }
  s.check("G33h a single-file PR classifies instead of failing the parse",
    one.status === 0 && Array.isArray(oneCls.shapes) && oneCls.shapes.includes("auth"));

  // G52c: branch-reviewer's adapter must feed the UNMODIFIED impact-graph builder, or a local review finds nothing.
  const ADAPTER = join(REPO_ROOT, "agents/branch-reviewer/scripts/local-diff-files.mjs");
  const GRAPH = join(PRS, "build-impact-graph.mjs");
  const tmp = mkdtempSync(join(tmpdir(), "g52-"));
  try {
    const fixture = join(tmp, "repo");
    mkdirSync(join(fixture, "src"), { recursive: true });
    const git = (...a) => spawnSync("git", ["-C", fixture, ...a], { encoding: "utf8" });
    writeFileSync(join(fixture, "src/parse.ts"), "export function parseThing(raw: string): number {\n  return Number(raw);\n}\n");
    writeFileSync(join(fixture, "src/use.ts"), "import { parseThing } from './parse';\nexport const run = (s: string) => parseThing(s) + 1;\n");
    git("init", "-q", "-b", "main");
    git("config", "user.email", "l1@example.invalid");
    git("config", "user.name", "l1");
    git("config", "commit.gpgsign", "false");
    git("add", "-A");
    git("commit", "-qm", "fixture base");
    writeFileSync(join(fixture, "src/parse.ts"), "export function parseThing(raw: string, radix: number): number {\n  return parseInt(raw, radix);\n}\n");
    const adapt = spawnSync(process.execPath, [ADAPTER, "--base", "HEAD", "--workdir", fixture], { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
    let files = [];
    try { files = JSON.parse(adapt.stdout || "[]"); } catch { /* asserted below */ }
    const REQUIRED = ["filename", "patch", "status", "additions", "deletions", "sha"];
    s.check("G52c the adapter emits records carrying the graph builder's six keys",
      adapt.status === 0 && Array.isArray(files) && files.length > 0 && files.every((f) => REQUIRED.every((k) => k in f)),
      `exit ${adapt.status}`);
    if (Array.isArray(files) && files.length > 0) {
      const filesPath = join(tmp, "files.json");
      writeFileSync(filesPath, JSON.stringify(files));
      const g = spawnSync(process.execPath, [GRAPH, filesPath, "--workdir", fixture, "--base-ref", "HEAD"], { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
      let graph = null;
      try { graph = JSON.parse(g.stdout || "null"); } catch { /* asserted below */ }
      s.check("G52c the adapter's output drives the unmodified impact-graph builder",
        g.status === 0 && graph && typeof graph === "object" && "symbols" in graph, (g.stderr || "").slice(0, 200));
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }

  // G80: a historical (--review-sha) review must refuse before any `gh` process — it would write to a live PR.
  const PREPARE = join(PRS, "prepare-review.mjs");
  const EWP = join(PRS, "execute-write-plan.mjs");
  const withShim = (fn) => {
    const shimDir = mkdtempSync(join(tmpdir(), "g80-gh-shim-"));
    const logPath = join(shimDir, "log");
    writeFileSync(join(shimDir, "gh"), `#!/bin/sh\necho "$@" >> ${JSON.stringify(logPath)}\n`, { mode: 0o755 });
    writeFileSync(logPath, "");
    try { return fn(shimDir, { ...process.env, PATH: `${shimDir}:${process.env.PATH}` }, () => readFileSync(logPath, "utf8").trim()); }
    finally { rmSync(shimDir, { recursive: true, force: true }); }
  };
  const sha = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
  withShim((dir, env, log) => {
    const a = spawnSync(process.execPath, [PREPARE, "--pr", "o/r#1", "--review-sha", sha, "--out", join(dir, "c1.json")], { encoding: "utf8", env });
    const b = spawnSync(process.execPath, [PREPARE, "--pr", "o/r#1", "--review-sha", sha, "--isolated", "--pin-head", sha, "--out", join(dir, "c2.json")], { encoding: "utf8", env });
    s.check("G80 prepare-review refuses --review-sha without --isolated, and with --pin-head, before spawning gh",
      a.status === 2 && /--isolated/.test(a.stderr || "") && b.status === 2 && /--pin-head/.test(b.stderr || "") && log() === "",
      `exits ${a.status}/${b.status}; gh log ${JSON.stringify(log())}`);
  });
  withShim((dir, env, log) => {
    const planPath = join(dir, "plan.json");
    writeFileSync(planPath, JSON.stringify({ dry_run: true, historical: { review_sha: sha }, thread_ops: [], lorekit: { write: [] } }));
    const r = spawnSync(process.execPath, [EWP, "--plan", planPath, "--repo", "o/r"], { encoding: "utf8", env });
    s.check("G80 execute-write-plan refuses a historical/dry_run plan before spawning gh",
      r.status !== 0 && r.status !== null && log() === "", `exit ${r.status}; gh log ${JSON.stringify(log())}`);
  });

  // G62: validate-judgments interprets judgments.schema.json; an unsupported keyword or a drifted enum is ignored silently.
  const SCHEMA_PATH = join(REPO_ROOT, "agents/pr-reviewer/schemas/judgments.schema.json");
  const vj = await import(pathToFileURL(join(PRS, "validate-judgments.mjs")).href);
  const fp = await import(pathToFileURL(join(PRS, "fingerprint.mjs")).href);
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  s.check("G62b judgments.schema.json uses only the keyword subset the validator interprets",
    vj.checkSchemaKeywords(schema).length === 0, vj.checkSchemaKeywords(schema).join(" | "));
  const sortedEq = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  s.check("G62c schema finder / defect_class enums equal fingerprint.mjs FINDERS / DEFECT_CLASSES",
    sortedEq(schema.$defs?.finder?.enum ?? [], fp.FINDERS) && sortedEq(schema.$defs?.defect_class?.enum ?? [], fp.DEFECT_CLASSES));
  const JF = join(REPO_ROOT, "scripts/eval/fixtures/judgments");
  const loadJ = (n) => JSON.parse(readFileSync(join(JF, n), "utf8"));
  s.check("G62d fixtures/judgments/valid.json validates with zero errors", vj.validateJudgments(schema, loadJ("valid.json")).length === 0);
  for (const [name, needle] of [["invalid-unknown-top-level-key.json", "unknown property"], ["invalid-secret-exempt.json", "secret"],
    ["invalid-title-mismatch.json", "title"], ["invalid-unverified-reason.json", "unverified_reason"], ["invalid-thread-reply.json", "reply"]]) {
    const errs = existsSync(join(JF, name)) ? vj.validateJudgments(schema, loadJ(name)) : [];
    s.check(`G62d fixtures/judgments/${name} is rejected (mentions "${needle}")`, errs.some((e) => e.includes(needle)));
  }

  // G84j: finalize must reproduce the committed report-body and inline snapshots from their judgments.
  const rep = spawnSync(process.execPath, [join(PRS, "finalize.mjs"), "--replay-fixtures"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  s.check("G84j finalize.mjs --replay-fixtures reproduces the snapshots with no unexplained mismatch",
    !/unexplained mismatch/.test(rep.stderr || "") && /report-body\/warn\.expected\.md — byte-identical/.test(rep.stdout || ""),
    (rep.stdout || rep.stderr || "").split("\n").filter((l) => /✗|FAIL|differ/.test(l)).join(" | ").slice(0, 300));

  // G83 / G65e: the A/B benchmark plans from the real manifest; a malformed entry breaks every arm.
  const MANIFEST = join(REPO_ROOT, "scripts/eval/benchmarks/reviewer-ab.manifest.json");
  const m = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const entries = Array.isArray(m) ? m : m.entries;
  const ALLOW = new Set(["repo", "number", "head_sha", "base_sha", "review_sha", "class", "status"]);
  s.check("G65e every manifest entry has only the allowed keys and full lowercase SHAs",
    entries.every((e) => Object.keys(e).every((k) => ALLOW.has(k)) && /^[0-9a-f]{40}$/.test(e.head_sha) && /^[0-9a-f]{40}$/.test(e.base_sha)));
  const scratch = mkdtempSync(join(tmpdir(), "g83-plan-"));
  const planRun = spawnSync(process.execPath, [join(REPO_ROOT, "scripts/eval/ab-review.mjs"), "plan", "--manifest", MANIFEST,
    "--worktree", REPO_ROOT, "--arms", "A,B", "--runs", "1", "--out", scratch], { encoding: "utf8" });
  let dispatches = null;
  try { dispatches = JSON.parse(readFileSync(join(scratch, "matrix.json"), "utf8")).dispatches; } catch { /* asserted below */ }
  rmSync(scratch, { recursive: true, force: true });
  s.check("G83 ab-review.mjs plan runs end to end against the real manifest, every dispatch dry-run and isolated",
    planRun.status === 0 && Array.isArray(dispatches) && dispatches.length > 0
      && dispatches.every((d) => { const p = JSON.stringify(d); return /--dry-run/.test(p) && /--isolated/.test(p) && /--review-sha [0-9a-f]{40}/.test(p); }),
    `exit ${planRun.status} ${(planRun.stderr || "").slice(0, 120)}`);
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 6. Size and token budgets
// ════════════════════════════════════════════════════════════════════════════════════════════

// ── G86: the root CLAUDE.md loads into every session; the frozen archives never grow ──
{
  const root = read("CLAUDE.md");
  const MAX_ROOT = 40000;   // Claude Code's session-start "Large CLAUDE.md" warning threshold
  const MAX_HOOK = 300;
  s.check(`G86a root CLAUDE.md is under ${MAX_ROOT} chars`, root.length < MAX_ROOT, `${root.length} chars`);
  const longHooks = root.split("\n").filter((l) => /^- `/.test(l) && l.length > MAX_HOOK);
  s.check(`G86b every root inventory hook is ≤ ${MAX_HOOK} chars`, longHooks.length === 0,
    longHooks.map((l) => `${l.length}: ${l.slice(0, 60)}…`).join(" | "));
  const tags = root.match(/\(v\d+\.\d+(?:\.\d+)?\)|\bv\d+\.\d+\.\d+\b/g) || [];
  s.check("G86c root CLAUDE.md carries no version-tag narrative", tags.length === 0, tags.join(", "));
  for (const [f, ceiling] of Object.entries(FROZEN_ARCHIVES)) {
    const size = statSync(join(REPO_ROOT, f)).size;
    s.check(`G86d ${f} has not grown past its frozen size (${ceiling} bytes)`, size <= ceiling, `${size} bytes`);
  }
}

// ── G82: pr-reviewer.md is read on every review; a ratchet stops it regrowing ──
{
  const txt = read("agents/pr-reviewer.md");
  const CEILING = 64000;
  const normalized = Buffer.byteLength(txt.replace(/\s+/g, " "), "utf8");
  const raw = Buffer.byteLength(txt, "utf8");
  s.check(`G82 pr-reviewer.md normalized bytes (${normalized}) stay at or under ${CEILING}`, normalized <= CEILING);
  s.check(`G82 pr-reviewer.md raw bytes (${raw}) stay at or under ${CEILING}`, raw <= CEILING);
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 7. Executable idioms run against fixtures
// ════════════════════════════════════════════════════════════════════════════════════════════

// ── C: the confidence plan-rule idioms, executed against plan fixtures (rules #2, #3, #9, #10, #11) ──
{
  const sh = (cmd) => execSync(cmd, { shell: "/bin/bash" }).toString().trim();
  const passes = (cmd) => { try { execSync(cmd, { shell: "/bin/bash" }); return true; } catch { return false; } };
  const coreSectionCount = (plan) => Number(sh(`grep -E '^## (TL;DR|Requirements|Decisions|Acceptance Criteria|Implementation Order|File Changes|Verification|Progress Log)' "${plan}" | wc -l`));
  const briefSectionCount = (plan) => Number(sh(`grep -cE '^## (Task|Requirements|Guardrails|Acceptance Criteria|Turn Cap|File Changes)' "${plan}" || true`));
  const acceptanceCriteriaCount = (plan) => Number(sh(`awk '/^## Acceptance Criteria/{f=1;next} /^###? /{f=0} f' "${plan}" | grep -c '^- \\|^[0-9]' || true`));
  const requirementCoveragePasses = (plan) => passes(
    `awk '/^## Requirements/ {rs=1; as=0; next} /^## Acceptance Criteria/ {as=1; rs=0; next} /^###? / {rs=0; as=0} rs && /^[-0-9]/ {n++; if (index($0,"[user-stated]")) us[n]=1} as {s=$0; while (match(s, /covers:[^)]*/)) {seg=substr(s,RSTART,RLENGTH); s=substr(s,RSTART+RLENGTH); while (match(seg,/R[0-9]+/)) {cov[substr(seg,RSTART+1,RLENGTH-1)]=1; seg=substr(seg,RSTART+RLENGTH)}}} END {for (i in us) if (!(i in cov)) exit 1; exit 0}' "${plan}"`);
  const existingCodeSurveyPasses = (plan) => passes(
    `awk -F'[|]' '/^## File Changes/ {fc=1; es=0; next} /^## Existing Code Survey/ {es=1; fc=0; next} /^###? / {fc=0; es=0} fc && /^[|]/ && $2 ~ /create/ {creates++} es && /^[|]/ {if (index($0,"EXTEND") + index($0,"WRAP") + index($0,"BUILD NEW") > 0) rows++} END {if (creates == 0) exit 0; exit (rows < 1)}' "${plan}"`);
  const checksInSync = (plan, checks) => {
    const planIds = sh(`awk '/^## Acceptance Criteria/{f=1;next} /^###? /{f=0} f' "${plan}" | grep -oE 'AC-[0-9]+' | sort -u`).split("\n").filter(Boolean);
    const checkIds = sh(`grep -oE '^- id: AC-[0-9]+' "${checks}" | grep -oE 'AC-[0-9]+' | sort -u`).split("\n").filter(Boolean);
    return planIds.length > 0 && JSON.stringify(planIds) === JSON.stringify(checkIds);
  };
  const fx = join(REPO_ROOT, "scripts/eval/fixtures/plans");
  const valid = join(fx, "valid-core.md");
  s.check("rule#2: valid plan has all 8 Core sections", coreSectionCount(valid) >= 8, `got ${coreSectionCount(valid)}`);
  s.check("rule#2: missing-core plan fails (< 8)", coreSectionCount(join(fx, "missing-core.md")) < 8);
  s.check("rule#2: valid brief plan has all 6 brief Core sections", briefSectionCount(join(fx, "valid-brief.md")) >= 6);
  s.check("rule#2: brief missing Guardrails + Turn Cap fails (< 6)", briefSectionCount(join(fx, "missing-brief.md")) < 6);
  s.check("rule#3: valid plan has ≥1 Acceptance Criterion", acceptanceCriteriaCount(valid) >= 1);
  s.check("rule#3 (#31 guard): empty-AC plan counts 0", acceptanceCriteriaCount(join(fx, "empty-ac.md")) === 0);
  s.check("rule#9: valid plan covers every [user-stated] requirement", requirementCoveragePasses(valid));
  s.check("rule#9: uncovered-req plan fails", !requirementCoveragePasses(join(fx, "uncovered-req.md")));
  s.check("rule#10: valid plan (create + survey) passes", existingCodeSurveyPasses(valid));
  s.check("rule#10: create-no-survey plan fails", !existingCodeSurveyPasses(join(fx, "create-no-survey.md")));
  s.check("rule#10: modification-only plan passes vacuously", existingCodeSurveyPasses(join(fx, "empty-ac.md")));
  s.check("rule#11: in-sync checks.yaml passes", checksInSync(valid, join(fx, "checks-valid.yaml")));
  s.check("rule#11: drifted checks.yaml fails", !checksInSync(valid, join(fx, "checks-drifted.yaml")));

  // G130: the executor's bail greps, extracted and run — a grep that rejects a valid plan stops every Full run.
  const EXE = read("skills/workflow/autonomous-workflow/templates/aw-executor.agent.md");
  const grepOf = (name) => (EXE.match(new RegExp(`echo "${name}=\\$\\(grep -cE '([^']+)' "\\$P"\\)"`)) || [])[1];
  const count = (re, file) => (re ? Number(sh(`grep -cE '${re}' "${file}" || true`)) : -1);
  const BRIEF = grepOf("BRIEF"), FASTLANE = grepOf("FASTLANE");
  s.check("G130b the executor's BRIEF and FASTLANE greps are extractable", Boolean(BRIEF && FASTLANE));
  s.check("G130b the BRIEF grep accepts a valid brief (6) and rejects one missing sections",
    count(BRIEF, join(fx, "valid-brief.md")) >= 6 && count(BRIEF, join(fx, "missing-brief.md")) < 6);
  s.check("G130b the FASTLANE grep accepts a valid fast-lane plan (8)", count(FASTLANE, valid) >= 8);
  // aw-create-plan's brief template is what every planner emits; the executor's grep must count it as complete.
  const ACP = read("skills/workflow/aw-create-plan/SKILL.md");
  const tpl = (ACP.match(/^## The brief \(Core\)[\s\S]*?````markdown\n([\s\S]*?)\n````/m) || ["", ""])[1];
  const tplFile = join(tmpdir(), `l1-brief-${process.pid}.md`);
  writeFileSync(tplFile, tpl);
  s.check("G130a aw-create-plan's brief template passes the executor's BRIEF grep (6 Core headings)",
    tpl !== "" && count(BRIEF, tplFile) >= 6, `template ${tpl ? "found" : "missing"}; count ${count(BRIEF, tplFile)}`);
  rmSync(tplFile, { force: true });
}

// ── G35: Step 1.2b's delta-triage jq/awk snippets, extracted and run — a syntax error throws mid-review ──
{
  const prm = read("agents/pr-reviewer/rules/fetch-and-triage.md");
  const FIX = join(REPO_ROOT, "scripts/eval/fixtures/delta-triage");
  const compareJq = /--jq '(\{\n\s*delta_lines:[\s\S]*?\n {2}\})'\)/.exec(prm)?.[1];
  s.check("G35a the compare-extraction jq program is extractable", !!compareJq);
  if (compareJq) {
    const r = spawnSync("jq", [compareJq], { input: readFileSync(join(FIX, "compare-intact.json"), "utf8"), encoding: "utf8" });
    let out = {};
    try { out = JSON.parse(r.stdout || "{}"); } catch { /* asserted below */ }
    s.check("G35c compare jq runs clean and extracts delta_lines=8, new_files=1, files=2",
      r.status === 0 && out.delta_lines === 8 && out.new_files === 1 && Array.isArray(out.files) && out.files.length === 2,
      (r.stderr || "").slice(0, 160));
  }
  const hsAwk = /awk '([^']*)' "\$HS_CFG"/.exec(prm)?.[1];
  s.check("G35g the high_stakes_paths awk program is extractable", !!hsAwk);
  if (hsAwk) {
    const r = spawnSync("awk", [hsAwk, join(FIX, "review.yaml")], { encoding: "utf8" });
    s.check("G35h the awk strips inline comments, quotes, and empty entries",
      r.status === 0 && r.stdout === " --extra-high-stakes (^|/)ledger(/|$) --extra-high-stakes packages/tenant-isolation/",
      `status=${r.status} out=${JSON.stringify(r.stdout)}`);
  }
  const blobJq = /jq -s --slurpfile prior \S+ '\n([\s\S]*?)' \\/.exec(prm)?.[1];
  s.check("G35d the blob-diff jq program is extractable", !!blobJq);
  if (blobJq) {
    const r = spawnSync("jq", ["-s", "--slurpfile", "prior", join(FIX, "tree-prior.json"), blobJq],
      { input: readFileSync(join(FIX, "pr-files.ndjson"), "utf8"), encoding: "utf8" });
    let files = [];
    try { files = JSON.parse(r.stdout || "[]"); } catch { /* asserted below */ }
    s.check("G35f blob diff keeps changed + added + removed files and drops the identical blob",
      r.status === 0 && JSON.stringify(files.map((f) => f.filename).sort()) === JSON.stringify(["assets/logo.png", "src/legacy/cleanup.ts", "src/util.ts"]),
      (r.stderr || "").slice(0, 160));
  }
}

// ── G32q: the review-config resolution block, executed — a wrong default hides or forces the Agent0 buttons ──
{
  const cfg = read("agents/shared/rules/review-config.md");
  const block = [...cfg.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]).find((b) => /^AGENT0_FIX_LINKS=/m.test(b));
  const tail = block?.slice(block.search(/^AGENT0_FIX_LINKS=/m));
  const resolve = (content, readFailed = 0) => (spawnSync("bash", ["-c",
    `CONFIG_READ_FAILED=${readFailed}\nBASE_CONFIG_CONTENT=$(cat)\n${tail}\n`
    + `printf '%s %s %s\\n' "$AGENT0_FIX_LINKS" "$AGENT0_ENVIRONMENT" "\${AGENT0_ORG:-(none)}"`,
  ], { input: content, encoding: "utf8" }).stdout || "").trim();
  s.check("G32q the review-config resolution block is extractable", !!tail && /agent0_fix_links/.test(tail));
  if (tail) {
    s.check("G32q nothing configured resolves the buttons ON at the production host", resolve("") === "true production (none)", resolve(""));
    s.check("G32q a config that never mentions Agent0 still resolves ON", resolve("profile: balanced\nfilters:\n  - naming-nits\n") === "true production (none)");
    s.check("G32q `agent0_fix_links: false` is a real opt-out, inline comment or not",
      resolve("agent0_fix_links: false\n").startsWith("false") && resolve("agent0_fix_links: false   # no\n").startsWith("false")
        && resolve("agent0_fix_links: false#x\n").startsWith("false"));
    s.check("G32q agent0_environment picks the host and does not gate rendering",
      resolve("agent0_environment: development\n") === "true development (none)"
        && resolve("agent0_fix_links: false\nagent0_environment: development\n") === "false development (none)");
    s.check("G32q agent0_org resolves, survives an inline comment, and gates nothing",
      resolve("agent0_org: dash0-development\n") === "true production dash0-development"
        && resolve("agent0_org: dash0-development   # our org\n") === "true production dash0-development"
        && resolve("agent0_fix_links: false\nagent0_org: dash0-development\n") === "false production dash0-development");
    for (const bad of ["a&b=c", "a b c", "-leading", "x".repeat(64), "org#123", "a#b", '"org # 123"', "'org # 123'", '"org#123"', 'org "x"']) {
      s.check(`G32q a malformed agent0_org (${JSON.stringify(bad)}) resolves to no org`, resolve(`agent0_org: ${bad}\n`).endsWith(" (none)"));
    }
    s.check("G32q an unreadable config withholds the buttons", resolve("", 1).startsWith("false"));
    // The fetch must tell an absent config (404) from an unreadable one (403), and survive a stderr warning.
    const fetchFn = block.slice(0, block.indexOf("\nCONFIG_READ_FAILED=0"));
    const B64 = Buffer.from("agent0_fix_links: false\n").toString("base64");
    const withStub = (ghBody) => {
      const dir = mkdtempSync(join(tmpdir(), "l1-cfg-"));
      writeFileSync(join(dir, "gh"), `#!/bin/bash\n${ghBody}\n`, { mode: 0o755 });
      const r = spawnSync("bash", ["-c", `RESOLVED_REPO=o/r\n${fetchFn}\nout=$(fetch_base_config .github/review.yaml)\nprintf '%s|%s' "$?" "$out"`],
        { encoding: "utf8", env: { ...process.env, PATH: `${dir}:${process.env.PATH}` } });
      rmSync(dir, { recursive: true, force: true });
      return (r.stdout || "").trim();
    };
    for (const [what, stub, want] of [
      ["a readable config returns its content", `echo "${B64}"`, "0|agent0_fix_links: false"],
      ["an absent config (404) is an answer, not a failure", 'echo "gh: Not Found (HTTP 404)" >&2; exit 1', "0|"],
      ["an unreadable config (403) exits 2", 'echo "gh: Resource not accessible (HTTP 403)" >&2; exit 1', "2|"],
      ["a warning on the success path does not erase the config", `echo "warning: token from env" >&2; echo "${B64}"`, "0|agent0_fix_links: false"],
    ]) {
      const got = withStub(stub);
      s.check(`G32q fetch_base_config — ${what}`, got === want, `got "${got}", want "${want}"`);
    }
  }
}

// ── G43 / G38g: the agent runs its fenced shell verbatim — a bad flag, an unbound variable, or an undefined helper fails mid-review ──
{
  const SHELL_MD = ["agents/pr-reviewer.md",
    ...readdirSync(join(REPO_ROOT, "agents/pr-reviewer/rules")).filter((f) => f.endsWith(".md")).map((f) => `agents/pr-reviewer/rules/${f}`)];
  const bashBlocks = (text) => [...text.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]);
  const commandsIn = (block) => block.replace(/\\\n\s*/g, " ").split("\n")
    .map((l) => l.replace(/\$\{[A-Z_]+:\+(.*?)\}/g, "$1").trim()).filter((l) => /^node\s/.test(l));
  const tokenize = (cmd) => cmd.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  // The parser contract, read out of each script rather than restated.
  const flagContract = (src) => {
    const takesValue = new Set(), boolean = new Set();
    for (const m of src.matchAll(/a === "(--[a-z-]+)"\)\s*(?:flags|opts)\.\w+\s*=\s*([^;\n]+)/g)) (/argv\[\+\+i\]/.test(m[2]) ? takesValue : boolean).add(m[1]);
    for (const m of src.matchAll(/\bflag\(args,\s*"([a-z-]+)"\)/g)) takesValue.add(`--${m[1]}`);
    for (const m of src.matchAll(/args\[\d+\] === "(--[a-z-]+)"/g)) boolean.add(m[1]);
    for (const m of src.matchAll(/cmd === "(--[a-z-]+)"/g)) boolean.add(m[1]);
    for (const m of src.matchAll(/\b(?:argv|process\.argv|args)\.includes\("(--[a-z-]+)"\)/g)) boolean.add(m[1]);
    for (const m of src.matchAll(/const (\w+) = (?:argv|args)\.indexOf\("(--[a-z-]+)"\);/g)) {
      if (new RegExp(`\\b(?:argv|args)\\[${m[1]} \\+ 1\\]`).test(src)) takesValue.add(m[2]);
    }
    return { takesValue, boolean };
  };
  let invocations = 0;
  for (const mdPath of SHELL_MD) {
    for (const block of bashBlocks(read(mdPath))) {
      for (const cmd of commandsIn(block)) {
        const all = tokenize(cmd);
        const scriptTok = all.find((t) => t.replace(/"/g, "").endsWith(".mjs"));
        if (!scriptTok) continue;
        const base = scriptTok.replace(/"/g, "").split("/").pop();
        const scriptPath = join(PRS, base);
        if (!existsSync(scriptPath)) continue;
        invocations++;
        const src = readFileSync(scriptPath, "utf8");
        const { takesValue, boolean } = flagContract(src);
        const needsPositional = /usage: \S+ <[a-z-]+\.json>/.test(src);
        const where = `${mdPath} → ${base}`;
        const toks = all.slice(all.indexOf(scriptTok) + 1);
        const positional = [], flagValues = [], unknownFlags = [], valuelessFlags = [];
        for (let i = 0; i < toks.length; i++) {
          const t = toks[i];
          if (t === ">" || t === ">>" || t === "2>" || t === "|") { i++; continue; }
          if (t.startsWith(">") || t.startsWith("2>")) continue;
          if (!t.startsWith("--")) { positional.push(t); continue; }
          if (takesValue.has(t)) {
            const next = toks[i + 1];
            if (!next || next.startsWith("-") || next.startsWith(">")) valuelessFlags.push(t);
            else { flagValues.push(next); i++; }
            continue;
          }
          if (!boolean.has(t)) unknownFlags.push(t);
        }
        const flagsUsed = toks.filter((t) => t.startsWith("--"));
        s.check(`G43a ${where}: valid invocation (flags known, values present, input positional, not on stdin)`,
          (flagsUsed.length === 0 || takesValue.size + boolean.size > 0) && unknownFlags.length === 0 && valuelessFlags.length === 0
            && (!needsPositional || !/(^|\s)<\s/.test(cmd))
            && (!needsPositional || [...positional, ...flagValues].some((p) => p.replace(/"/g, "").endsWith(".json"))),
          `unknown: ${unknownFlags.join(" ") || "none"}; bare: ${valuelessFlags.join(" ") || "none"}`);
      }
    }
  }
  // Guards the extractor: matching nothing would pass every invocation vacuously.
  s.check(`G43a the invocation extractor found the documented commands (${invocations})`, invocations >= 4);

  const SHELL_PROVIDED = new Set(["HOME", "PATH", "ARG", "BASH_REMATCH", "DASH0_EXPOSURE", "DASH0_AGENT_ENV"]);
  const RUN_CONSTRUCTED = new Set(["VERDICT", "PR_STATE", "CARRIED_FINDINGS_JSON", "DIAGNOSTICS_JSON", "INLINE_COMMENTS_JSON", "OPEN_BOT_COMMENT_IDS_JSON"]);
  const boundVars = new Set();
  const varReads = new Set();
  for (const mdPath of SHELL_MD) {
    const text = read(mdPath);
    for (const m of text.matchAll(/\b([A-Z][A-Z0-9_]{2,})=/g)) boundVars.add(m[1]);
    for (const block of bashBlocks(text)) {
      const live = block.replace(/(^|\s)#[^\n]*/g, "$1");
      for (const m of live.matchAll(/\$\{?([A-Z][A-Z0-9_]{2,})\b/g)) varReads.add(m[1]);
    }
  }
  const unbound = [...varReads].filter((v) => !boundVars.has(v) && !SHELL_PROVIDED.has(v) && !RUN_CONSTRUCTED.has(v)).sort();
  s.check(`G43b every variable read in a normative block is bound (unbound: ${unbound.join(", ") || "none"})`, unbound.length === 0);

  for (const name of ["agents/pr-reviewer/rules/workspace.md", "agents/pr-reviewer.md", "agents/pr-reviewer/rules/fetch-and-triage.md"]) {
    const src = read(name);
    const blocks = bashBlocks(src).join("\n");
    const called = new Set();
    for (const m of blocks.matchAll(/\$\(([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\)/g)) called.add(m[1]);
    for (const m of blocks.matchAll(/(?:^|&&|\|\||;|\bthen\b|\belif\b|\bif\b)[ \t]*([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b(?![ \t]*[=(:,])/gm)) called.add(m[1]);
    const undef = [...called].filter((fn) => !new RegExp(`^\\s*${fn}\\(\\)`, "m").test(src));
    s.check(`G38g every snake_case helper the ${name} shell calls is defined in it`, undef.length === 0, undef.join(", "));
  }
}

// ── G25e: posting.md's pre-write assertion block, extracted and run — a net that cannot fire posts a broken report ──
{
  const postingMd = read("agents/pr-reviewer/rules/posting.md");
  const preWrite = sliceBetween(postingMd, "things on `REPORT_BODY` immediately before the write", "On any `abort`: post no report object");
  const fence = preWrite.match(/```bash\n([\s\S]*?)```/);
  s.check("G25e the pre-write assertion block is extractable", !!fence);
  if (fence) {
    const script = `abort() { printf 'ABORT: %s\\n' "$*"; exit 3; }\n${fence[1]}\nexit 0\n`;
    const good = renderReport(readFileSync(join(REPORT_FIX, "warn.json"), "utf8")).out;
    const runAssert = (body) => spawnSync("bash", ["-c", script],
      { env: { ...process.env, REPORT_BODY: body, AGENT_SUPPORT: join(REPO_ROOT, "agents") }, encoding: "utf8" });
    const ok = runAssert(good);
    s.check("G25e the pre-write assertions accept a valid rendered body", ok.status === 0, `exit ${ok.status}: ${(ok.stdout || "").trim()}`);
    for (const [why, body] of [
      ["a body with no marker", good.replace("<!-- PR_REVIEWER_REPORT -->\n", "")],
      ["a flattened body (no accordion)", good.replace(/<details>\n<summary>Review details[^\n]*\n/, "")],
      ["a pre-expanded accordion", good.replace("<details>\n<summary>Review details", "<details open>\n<summary>Review details")],
      ["a smuggled **Verdict** line", `${good}\n**Verdict**: PASS\n`],
      ["a body whose inline HTML was escaped in transit", good.replace('"><picture><source', '"&gt;&lt;picture&gt;&lt;source')],
      ["a body with a backtick smuggled into an href", good.replace('<a href="https://', '<a href="``https://')],
    ]) {
      s.check(`G25e the pre-write assertions reject ${why}`, runAssert(body).status === 3);
    }
  }
}

// ── G90b: review-loop's apply-first block, run alone with only `gh` stubbed — a wrong decision skips a needed review ──
{
  const AF = (() => { try { return extractSection("skills/quality/review-loop/rules/apply-first.md", "# Iteration 1 — apply first when the last review still stands"); } catch { return ""; } })();
  const blk = (AF.match(/```bash\n([\s\S]*?)\n```/) || ["", ""])[1];
  const run = (c) => {
    const dir = mkdtempSync(join(tmpdir(), "l1-g90-"));
    try {
      const ctx = join(dir, "context.json");
      if (c.mode !== null) writeFileSync(ctx, JSON.stringify({ mode: c.mode, priorRun: { priorSha: "abc1234" } }));
      const nodes = c.open === null ? null : [
        ...Array.from({ length: c.open }, (_, i) => ({ isResolved: false, comments: c.malformed ? "unreadable" : { totalCount: i < c.replied ? 2 : 1 } })),
        { isResolved: true, comments: { totalCount: 3 } }];
      const response = JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes } } } } });
      const gh = nodes === null
        ? 'gh() { echo "HTTP 502" >&2; return 1; }'
        : ['gh() {', '  local q="" f=""', '  while [ $# -gt 0 ]; do', '    case "$1" in',
          '      -f) case "$2" in query=*) q="${2#query=}" ;; esac; shift 2 ;;', '      --jq) f="$2"; shift 2 ;;',
          '      *) shift ;;', '    esac', '  done',
          '  case "$q" in *isResolved*"comments{ totalCount }"*) ;; *) echo "stub: query lacks isResolved / comments{ totalCount }" >&2; return 1 ;; esac',
          '  [ -n "$f" ] || { echo "stub: no --jq filter" >&2; return 1; }',
          "  printf '%s\\n' '" + response + "' | jq \"$f\"", '}'].join("\n");
      const sh = [gh, blk.replaceAll("<ITERATION>", String(c.iter)).replaceAll("<NO_FEEDBACK>", String(c.nofb))
        .replaceAll("<OWNER>", "o").replaceAll("<REPO>", "r").replaceAll("<PR_NUMBER>", "1").replaceAll("<dir>/context.json", ctx)].join("\n");
      return spawnSync("bash", ["-c", sh], { encoding: "utf8" }).stdout;
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  const decision = (out) => (out.match(/^APPLY_FIRST=(\d)\b/m) || ["", "∅"])[1];
  const base = { iter: 1, nofb: 0, mode: "zero-delta", open: 2, replied: 0 };
  const wrong = [
    ["all five hold", {}, "1"], ["iteration 2", { iter: 2 }, "0"], ["--no-feedback", { nofb: 1 }, "0"],
    ["mode incremental", { mode: "incremental" }, "0"], ["no open thread", { open: 0 }, "0"],
    ["an open thread has a reply", { replied: 1 }, "0"], ["context.json missing", { mode: null }, "0"],
    ["thread query fails", { open: null }, "0"], ["reply count unreadable", { malformed: true }, "0"],
  ].map(([n, d, want]) => [n, want, decision(run({ ...base, ...d }))]).filter(([, want, got]) => got !== want);
  s.check("G90b the apply-first block decides correctly on all nine cases and fails closed (executed)",
    blk !== "" && wrong.length === 0 && /PRIOR_SHA=abc1234/.test(run(base)),
    blk === "" ? "no ```bash block in the apply-first section" : wrong.map(([n, w, g]) => `${n} (want ${w}, got ${g})`).join(" · "));
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// 8. Machine-parsed contracts
// ════════════════════════════════════════════════════════════════════════════════════════════

// ── G130c: Phase 4 exits on run-checks.mjs's sentinel line; a renamed sentinel never exits Phase 4 ──
{
  const P4 = read("skills/workflow/autonomous-workflow/rules/phase-4-testing.md");
  const EXE = read("skills/workflow/autonomous-workflow/templates/aw-executor.agent.md");
  const RC = read("skills/workflow/autonomous-workflow/scripts/run-checks.mjs");
  const SENT = /CHECKS M\/M PASS \(<sha>\)|CHECKS <M>\/<M> PASS \(<sha>\)/;
  s.check("G130c run-checks.mjs prints the sentinel phase-4 and the executor gate on",
    /sentinel: `CHECKS \$\{passed\}\/\$\{total\} PASS \(\$\{shortSha\(cwd\)\}\)`/.test(RC) && SENT.test(P4) && SENT.test(EXE));
}

// ── G25h: reviewer-report-ingest.md's grammar parses the rendered report; a shape it cannot read is re-ingested wrong ──
{
  const EXTRACT = {
    "Footer SHA": (b) => {
      const line = (b.match(/^<sup>`pr-reviewer` · commit[^\n]*<\/sup>$/m) || [""])[0];
      return /commit `[0-9a-f]{7}`/.test(line);
    },
    "Run mode": (b) => /^(full|incremental|incremental-quick) · (\d+) lines in delta/m.test(b),
    "Marker": (b) => b.includes("<!-- PR_REVIEWER_REPORT -->"),
    "Review details accordion": (b) => /<details>\n<summary>Review details/.test(b),
  };
  for (const name of REPORT_FIXTURES) {
    const p = join(REPORT_FIX, `${name}.expected.md`);
    if (!existsSync(p)) continue;
    const body = readFileSync(p, "utf8");
    for (const [section, fn] of Object.entries(EXTRACT)) {
      s.check(`G25h ${name}: the ingest grammar parses "${section}"`, fn(body));
    }
    const rows = [...body.matchAll(/^\| (Description vs\. code|Prior review feedback|Documentation|Self-review signals|Code review) \| (✅|⚠️|❌|⏭️) \| ([^|]*) \|$/gm)];
    s.check(`G25h ${name}: the gate table parses to 5 typed rows`, rows.length === 5, `parsed ${rows.length}`);
    const declared = body.match(/\*\*Open review threads \((\d+)\)\*\*/);
    if (declared) {
      const region = body.split("**Open review threads (")[1].split("\n\n")[1] || "";
      const bullets = region.split("\n").filter((l) => l.startsWith("- ")).length;
      s.check(`G25h ${name}: the open-threads count equals the bullets rendered`, Number(declared[1]) === bullets);
    }
  }

  // The agent builds REPORT_BODY from report-rendering.md's payload table; a key the renderer does not know exits 1.
  const rendererSrc = readFileSync(RENDER_REPORT, "utf8");
  const keysIn = (arr) => new Set([...sliceBetween(rendererSrc, `const ${arr} = [`, "];").matchAll(/"([A-Z0-9_]+)"/g)].map((m) => m[1]));
  const payloadKeys = new Set([...keysIn("REQUIRED_SCALARS"), ...keysIn("OPTIONAL_SCALARS"), ...keysIn("STRUCTURED")]);
  const contract = sliceBetween(read("agents/pr-reviewer/rules/report-rendering.md"), "#### REPORT_BODY payload", "#### Headlines");
  const named = [...contract.matchAll(/^\|\s*((?:`[A-Z][A-Z0-9_]{3,}`(?:\s*[·+]\s*)?)+)\s*\|/gm)]
    .flatMap((m) => [...m[1].matchAll(/`([A-Z][A-Z0-9_]{3,})`/g)].map((x) => x[1]));
  const wrong = [...new Set(named)].filter((n) => !payloadKeys.has(n));
  s.check("G25g every slot named in the payload contract is a real payload key", named.length > 0 && wrong.length === 0, wrong.join(", "));
}

// ── G44: the memory read path must use the tools' real parameters and the recorder's real keys, or it reads nothing ──
{
  const MEMORY_MD = read("agents/pr-reviewer/rules/memory.md");
  const RELEVANCE_MD = read("agents/shared/rules/comment-relevance-memory.md");
  const RECORDER = read("scripts/record-comment-relevance.mjs");
  const memoryCalls = (text, tool) => [...text.matchAll(new RegExp(`mcp__lorekit__${tool}\\b([^\\n]*)`, "g"))].map((m) => m[1]);
  for (const [file, text] of [["memory.md", MEMORY_MD], ["comment-relevance-memory.md", RELEVANCE_MD]]) {
    for (const args of memoryCalls(text, "memory_search")) {
      if (!/[:=]/.test(args)) continue;
      s.check(`G44a ${file}: memory_search takes \`q\` and \`scopes\`, not \`query\` / \`scope\``,
        /\bq\s*=/.test(args) && !/\bquery\s*=/.test(args) && /\bscopes\s*=/.test(args) && !/(^|[^s])\bscope\s*=/.test(args), args.slice(0, 100));
    }
    for (const args of memoryCalls(text, "memory_list")) {
      if (!/[:=]/.test(args)) continue;
      s.check(`G44a ${file}: memory_list takes a singular \`scope\`, not \`scopes\``, !/\bscopes\s*=/.test(args), args.slice(0, 100));
    }
  }
  const recorderKeys = [...RECORDER.matchAll(/\bkey\s*[:=][^`;]*`([a-z-]+(?:::[a-z-]+)*::)\$\{/g)].map((m) => m[1]);
  s.check(`G44b the recorder's key prefixes were extractable (saw: ${recorderKeys.join(" ") || "none"})`, recorderKeys.length > 0);
  for (const prefix of new Set(recorderKeys)) {
    s.check(`G44b memory.md quotes the key \`${prefix}…\` exactly as the recorder builds it`, MEMORY_MD.includes(prefix));
  }
}

// ── G96: review-loop's description refresh preserves the attach-media region by its markers; a mismatch erases the media ──
{
  const OPEN = "<!-- attach-media:v1 -->";
  const CLOSE = "<!-- /attach-media:v1 -->";
  const missing = ["skills/delivery/attach-media/rules/body-region.md", "skills/delivery/create-pr/rules/description-contract.md",
    "skills/quality/review-loop/SKILL.md"].filter((f) => { const t = readOr(f); return !t.includes(OPEN) || !t.includes(CLOSE); });
  s.check("G96a every attach-media region writer and refresher names both markers", missing.length === 0, missing.join(", "));
}

// ── G97: a script's main guard survives a symlinked install; Node realpaths import.meta.url but not argv[1] ──
{
  const tracked = execFileSync("git", ["ls-files", "*.mjs"], { cwd: REPO_ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
  const bad = tracked.filter((f) => readOr(f).split("\n").some((l) =>
    /process\.argv\[1\]/.test(l) && /import\.meta\.url/.test(l) && !/realpathSync/.test(l)));
  s.check("G97a every main guard comparing argv[1] to import.meta.url realpaths argv[1]", bad.length === 0, bad.join(", "));
  const dir = mkdtempSync(join(tmpdir(), "l1-g97-"));
  const link = join(dir, "run-checks.mjs");
  symlinkSync(join(REPO_ROOT, "skills/workflow/autonomous-workflow/scripts/run-checks.mjs"), link);
  const r = spawnSync(process.execPath, [link, "--self-test"], { encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });
  s.check("G97b run-checks.mjs --self-test run through a symlink prints PASS", /self-test: PASS/.test(r.stdout), (r.stdout + r.stderr).slice(-200) || "no output");
}

process.exit(s.report() ? 0 : 1);
