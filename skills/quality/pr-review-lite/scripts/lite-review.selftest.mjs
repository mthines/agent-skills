// @ts-check
// Offline self-test for lite-review.mjs: a stub transport with canned replies and usage numbers.
// `fetch` is replaced with a thrower for the whole run, so any network use fails the test.
import { unaccounted, crossDigest, capCandidates, threadsBlock, reflectWindows, claudeCliTransport, quotesDiff, lensBlock, parsePacket, dispatch, validLines, buildPrefix, runPipeline, parseJson, parseLiteConfig, globToRegex, filterCandidates, costUsd, emptyUsage, addUsage, summarizeImpact, resolveSupport } from "./lite-review.mjs";

const sec = (/** @type {string} */ path, /** @type {number} */ n, /** @type {number} */ start = 1) =>
  `## ${path}\n\n\`\`\`text\n${Array.from({ length: n }, (_, i) => `${String(start + i).padStart(5)}|+const v${i} = ${i};`).join("\n")}\n\`\`\`\n`;
const row = (/** @type {number} */ i, /** @type {string} */ p, /** @type {string} */ role, /** @type {string} */ mode, note = "") =>
  `| ${i} | \`${p}\` | modified | +10 −0 | ${role} | — | ${mode}${note ? ` (${note})` : ""} | 1–2 |`;

const PACKET = [
  "# Review packet — o/r#1 @ abc1234", "", "## PR description", "", "**Title**", "", "## A heading inside the description", "body", "",
  "## Files", "", "| # | Path | Status | +/− | Role | Consumers | In packet | Packet lines |", "|---|---|---|---|---|---|---|---|",
  row(1, "src/a.ts", "source", "full"), row(2, "src/b.ts", "source", "full"), row(3, "src/c.ts", "source", "full"),
  row(4, "pnpm-lock.yaml", "generated", "listed", "generated file"), row(5, "assets/logo.png", "config", "diff"),
  row(6, "docs/guide.md", "docs", "full"), row(7, "src/huge.ts", "source", "listed", "not inlined (packet cap)"), "",
  sec("src/a.ts", 10), sec("src/b.ts", 10), sec("src/c.ts", 10), sec("assets/logo.png", 2), sec("docs/guide.md", 4),
].join("\n");

const checks = /** @type {{name:string,fn:()=>Promise<void>|void}[]} */ ([]);
const check = (/** @type {string} */ name, /** @type {()=>Promise<void>|void} */ fn) => checks.push({ name, fn });
const eq = (/** @type {any} */ a, /** @type {any} */ b, /** @type {string} */ m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (/** @type {any} */ c, /** @type {string} */ m) => { if (!c) throw new Error(m); };

/** A stub transport: records every request, answers by stage. */
const stub = (/** @type {(req:any)=>string} */ reply, usage = { input_tokens: 100, cache_read_input_tokens: 900, cache_creation_input_tokens: 0, output_tokens: 20 }) => {
  /** @type {any[]} */ const calls = [];
  const t = async (/** @type {any} */ req) => { calls.push(req); return { text: reply(req), usage }; };
  return Object.assign(t, { calls });
};
const reviewReply = (/** @type {any} */ req) => {
  if (req.system) return JSON.stringify({ veto: [] });
  const path = /^## (\S+)/m.exec(req.user)?.[1];
  return JSON.stringify([{ path, line: 3, severity: "high", claim: "off by one", bad_outcome: "wrong count", verify_by: "run it" }]);
};

check("parse: preamble keeps description headings and file sections come from the index", () => {
  const p = parsePacket(PACKET);
  ok(p.preamble.includes("## A heading inside the description"), "description heading lost");
  eq(p.files.map((f) => f.path), ["src/a.ts", "src/b.ts", "src/c.ts", "pnpm-lock.yaml", "assets/logo.png", "docs/guide.md", "src/huge.ts"]);
  ok(validLines(p.files[0].text).has(3), "section text missing");
});

check("dispatch: same input gives the same units and skips", () => {
  const f = parsePacket(PACKET).files;
  eq(dispatch(f, { unitTokens: 40 }), dispatch(f, { unitTokens: 40 }));
});

check("exclusions: lockfile, binary asset, unlisted file land in skipped with a reason", () => {
  const { skipped } = dispatch(parsePacket(PACKET).files);
  const by = Object.fromEntries(skipped.map((s) => [s.path, s.reason]));
  ok(/generated/.test(by["pnpm-lock.yaml"]), "lockfile reason");
  ok(/binary/.test(by["assets/logo.png"]), "asset reason");
  ok(/not inlined/.test(by["src/huge.ts"]), "unlisted reason");
});

check("exclusions: lite.yaml globs exclude and are named in the reason", () => {
  const cfg = parseLiteConfig('exclude:\n  - "docs/**"\n  - "*.md"\nother: 1\n');
  eq(cfg.exclude, ["docs/**", "*.md"]);
  const { skipped, units } = dispatch(parsePacket(PACKET).files, { exclude: cfg.exclude });
  ok(skipped.some((s) => s.path === "docs/guide.md" && /lite\.yaml/.test(s.reason)), "glob skip");
  ok(!units.flatMap((u) => u.files).some((f) => f.path === "docs/guide.md"), "glob file still in a unit");
  ok(globToRegex("src/**/x.ts").test("src/a/b/x.ts") && !globToRegex("*.md").test("a/b.md"), "glob semantics");
});

check("grouping: units stay under the token budget and keep packet order", () => {
  const f = parsePacket(PACKET).files;
  const big = dispatch(f, { unitTokens: 100000 });
  eq(big.units.length, 1);
  const small = dispatch(f, { unitTokens: 40 });
  ok(small.units.length > 1, "small budget should split");
  for (const u of small.units) ok(u.files.length === 1 || u.tokens <= 40, `unit ${u.id} over budget`);
  eq(small.units.flatMap((u) => u.files.map((x) => x.path)), ["src/a.ts", "src/b.ts", "src/c.ts", "docs/guide.md"]);
});

check("grouping: the unit cap records every file past it as skipped", () => {
  const { units, skipped } = dispatch(parsePacket(PACKET).files, { unitTokens: 1, maxUnits: 2 });
  eq(units.length, 2);
  ok(skipped.filter((s) => /unit cap/.test(s.reason)).length === 2, "cap skips");
});

check("line validity: a line outside the packet is dropped and reported", () => {
  const unit = { id: 1, files: parsePacket(PACKET).files.slice(0, 1) };
  const { kept, dropped } = filterCandidates([
    { path: "src/a.ts", line: 3, claim: "ok" }, { path: "src/a.ts", line: 99, claim: "bad line" },
    { path: "nope.ts", line: 3, claim: "bad path" }, { path: "src/a.ts", line: 4, claim: " " },
  ], unit);
  eq(kept.length, 1);
  eq(dropped.map((d) => d.why), ["line not in packet", "path not in unit", "empty claim"]);
  eq([...validLines(unit.files[0].text)].length, 10);
});

check("prefix: byte-identical across every unit call and cache-marked on the transport request", async () => {
  const t = stub(reviewReply);
  await runPipeline({ packetText: PACKET, finders: "RUBRIC", transport: t, opts: { unitTokens: 40 } });
  const reviews = t.calls.filter((c) => !c.system);
  ok(reviews.length > 1, "need several unit calls");
  ok(reviews.every((c) => c.cachePrefix === reviews[0].cachePrefix), "prefix differs between units");
  ok(reviews[0].cachePrefix.startsWith("RUBRIC") && reviews[0].cachePrefix.includes("## A heading inside the description"), "prefix content");
  ok(reviews.every((c) => !c.user.includes("RUBRIC")), "rubric leaked into the per-unit part");
  eq(buildPrefix({ finders: "F", preamble: "P", impactSummary: "" }), buildPrefix({ finders: "F", preamble: "P", impactSummary: "" }));
});

check("prefix: the first unit call finishes before the others start (cache warm-up)", async () => {
  /** @type {string[]} */ const order = [];
  let firstDone = false;
  const t = async (/** @type {any} */ req) => {
    if (!req.system) { const first = !order.length; order.push(first ? "first-start" : firstDone ? "later-after" : "later-BEFORE"); if (first) { await new Promise((r) => setTimeout(r, 15)); firstDone = true; } }
    return { text: req.system ? '{"veto":[]}' : "[]", usage: {} };
  };
  await runPipeline({ packetText: PACKET, finders: "R", transport: t, opts: { unitTokens: 100, concurrency: 4 } });
  ok(!order.includes("later-BEFORE") && order.includes("later-after"), `order ${order}`);
});

check("reflection: vetoes only with a quoted reason, ignores unknown ids, never adds", async () => {
  const t = stub((req) => req.system ? JSON.stringify({ veto: [{ id: 1, reason: "  " }, { id: 2, reason: "x" }, { id: 77, reason: "x" }, { id: 1 }] }) : reviewReply(req), {});
  const r = await runPipeline({ packetText: PACKET, finders: "R", transport: t, opts: { unitTokens: 100000 } });
  eq(r.vetoed.length, 0, "blank reason, unknown id, missing reason are all ignored");
  const t2 = stub((req) => req.system ? JSON.stringify({ veto: [{ id: 1, reason: "const v2 = 2;" }, { id: 99, reason: "added" }] }) : reviewReply(req), {});
  const r2 = await runPipeline({ packetText: PACKET, finders: "R", transport: t2, opts: { unitTokens: 100000 } });
  eq([r2.findings.length, r2.vetoed.length], [0, 1]);
  ok(r2.findings.every((f) => f.claim === "off by one"), "reflection must not rewrite");
});

check("reflection: fails open on garbage, a throw, and a wrong-shape reply", async () => {
  for (const bad of ["not json at all", "[]", '{"nope":1}']) {
    const t = stub((req) => req.system ? bad : reviewReply(req));
    const r = await runPipeline({ packetText: PACKET, finders: "R", transport: t, opts: { unitTokens: 100000 } });
    eq([r.findings.length, r.reflectFailOpen], [1, 1], `reply ${bad}`);
  }
  const boom = async (/** @type {any} */ req) => { if (req.system) throw new Error("503"); return { text: reviewReply(req), usage: {} }; };
  const r = await runPipeline({ packetText: PACKET, finders: "R", transport: boom, opts: { unitTokens: 100000 } });
  eq([r.findings.length, r.errors.some((e) => e.stage === "reflect")], [1, true]);
});

check("usage: tokens sum per stage and USD appears only when a price is supplied", async () => {
  const u = { input_tokens: 10, cache_read_input_tokens: 90, cache_creation_input_tokens: 5, output_tokens: 7 };
  const t = stub(reviewReply, u);
  const r = await runPipeline({ packetText: PACKET, finders: "R", transport: t, opts: { unitTokens: 40 } });
  const n = r.units.length;
  eq([r.usage.review.calls, r.usage.review.input, r.usage.review.cache_read, r.usage.review.cache_write, r.usage.review.output], [n, 10 * n, 90 * n, 5 * n, 7 * n]);
  ok(r.usage.reflect.calls >= 1, "reflect stage counted");
  eq(r.usage.review.usd, null);
  const priced = await runPipeline({ packetText: PACKET, finders: "R", transport: stub(reviewReply, u), opts: { unitTokens: 100000 }, prices: { "claude-sonnet-5-5": { input: 1e6, cache_read: 0, cache_write: 0, output: 0 } } });
  eq(priced.usage.review.usd, 10);
  const acc = emptyUsage(); addUsage(acc, u); addUsage(acc, u);
  eq([acc.calls, acc.input], [2, 20]);
  eq(costUsd(acc, undefined), null);
});

check("network: the pipeline never touches fetch when the transport is stubbed", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = /** @type {any} */ (() => { throw new Error("network used"); });
  try { await runPipeline({ packetText: PACKET, finders: "R", transport: stub(reviewReply), opts: {} }); } finally { globalThis.fetch = real; }
});

check("shadow: the pipeline spawns no process and so makes no gh write", async () => {
  const cp = await import("node:child_process");
  const spawned = [];
  const orig = cp.spawnSync;
  // The pipeline imports nothing but pure helpers; assert by checking its source for process spawning.
  const src = (await import("node:fs")).readFileSync(new URL("./lite-review.mjs", import.meta.url), "utf8");
  const pipeline = src.slice(src.indexOf("export async function runPipeline"), src.indexOf("export function renderReport"));
  ok(!/spawn|exec\(|\bgh\b|child_process/.test(pipeline), "runPipeline must not spawn");
  ok(!/pulls\/.*\/(reviews|comments)|--method (POST|PATCH|PUT)|issue_comment/.test(src), "no GitHub write endpoint in the script");
  eq(spawned, []); void orig;
});

check("parse: parseJson tolerates a fence, rejects prose; impact summary ranks by consumers", () => {
  eq(parseJson('```json\n[{"a":1}]\n```'), [{ a: 1 }]);
  eq(parseJson("no json here"), undefined);
  eq(summarizeImpact({ symbols: [{ path: "a.ts", name: "f", consumer_count: 2 }, { path: "b.ts", name: "g", consumer_count: 9 }, { path: "c.ts", consumer_count: 0 }] }).split("\n")[0], "- b.ts g — 9 consumers");
  ok(resolveSupport({}) === null || typeof resolveSupport({}) === "string", "resolveSupport shape");
});

check("parse: a `## Files` heading inside the description does not end the preamble", () => {
  const text = PACKET.replace("## A heading inside the description\nbody", "## Files\nin the description\nREVIEW NOTE");
  const p = parsePacket(text);
  ok(p.preamble.includes("REVIEW NOTE"), "preamble cut at the description's own heading");
  eq(p.files.length, 7);
});

check("reflection: a veto whose reason does not quote the diff is ignored", async () => {
  const t = stub((req) => req.system ? JSON.stringify({ veto: [{ id: 1, reason: "probably handled upstream" }] }) : reviewReply(req), {});
  const r = await runPipeline({ packetText: PACKET, finders: "R", transport: t, opts: { unitTokens: 100000 } });
  eq([r.findings.length, r.vetoed.length], [1, 0]);
  eq(r.rejectedVetoes, 1);
  ok(quotesDiff("00003|+const v2 = 2;", "    3|+const v2 = 2;") && !quotesDiff("ab", "ab cd"), "quotesDiff");
  ok(quotesDiff("`const v2 = 2;`", "    3|+const v2 = 2;") && quotesDiff('"const v2 = 2;"', "    3|+const v2 = 2;"), "wrapping quotes are stripped");
});

check("lens: loaded lens text is in the shared prefix, scoped to its files, and identical across units", async () => {
  const lenses = [{ name: "ledger", origin: "repo", files: ["src/a.ts"], text: "- Money is integer cents." }];
  const t = stub(reviewReply);
  const r = await runPipeline({ packetText: PACKET, finders: "R", transport: t, lenses, opts: { unitTokens: 40 } });
  const reviews = t.calls.filter((c) => !c.system);
  ok(reviews.length > 1 && reviews.every((c) => c.cachePrefix === reviews[0].cachePrefix), "prefix differs");
  ok(reviews[0].cachePrefix.includes("### Lens: ledger") && reviews[0].cachePrefix.includes("Applies to: src/a.ts") && reviews[0].cachePrefix.includes("Money is integer cents."), "lens missing");
  eq(r.lenses.map((l) => l.name), ["ledger"]);
  eq(lensBlock([]), "");
});

check("lens: a finding keeps a loaded lens name and drops an unknown one", () => {
  const unit = { id: 1, files: parsePacket(PACKET).files.slice(0, 1) };
  const { kept } = filterCandidates([{ path: "src/a.ts", line: 3, claim: "x", lens: "ledger" }, { path: "src/a.ts", line: 4, claim: "y", lens: "made-up" }], unit, ["ledger"]);
  eq(kept.map((k) => k.lens), ["ledger", undefined]);
});

check("failed unit: a throw or an unparseable reply puts its files in skipped.json", async () => {
  const boom = async (/** @type {any} */ req) => { if (!req.system) throw new Error("429 rate limited"); return { text: "{}", usage: {} }; };
  const r = await runPipeline({ packetText: PACKET, finders: "R", transport: boom, opts: { unitTokens: 100000 } });
  ok(r.skipped.some((s) => s.path === "src/a.ts" && /review call failed: 429/.test(s.reason)), "throw not recorded");
  const garbage = stub((req) => req.system ? '{"veto":[]}' : "I could not parse that");
  const g = await runPipeline({ packetText: PACKET, finders: "R", transport: garbage, opts: { unitTokens: 100000 } });
  ok(g.skipped.some((s) => s.path === "src/b.ts" && /unparseable/.test(s.reason)), "garbage not recorded");
});

check("veto: a short fragment, a path heading, or a repeated id does not veto twice or at all", async () => {
  ok(!quotesDiff("const", "    3|+const v2 = 2;") && !quotesDiff("## src/a.ts", "## src/a.ts\n```text\n    3|+x = 1;"), "fragment or heading accepted");
  ok(quotesDiff("v2 = 2; // and more text", "    3|+const v2 = 2; // and more text here") === true, "long in-line quote rejected");
  const t = stub((req) => req.system ? JSON.stringify({ veto: [{ id: 1, reason: "const v2 = 2;" }, { id: 1, reason: "const v2 = 2;" }, { id: 42, reason: "const v2 = 2;" }] }) : reviewReply(req), {});
  const r = await runPipeline({ packetText: PACKET, finders: "R", transport: t, opts: { unitTokens: 100000 } });
  eq([r.vetoed.length, r.rejectedVetoes], [1, 2]);
});

check("prefix: PR text is framed as untrusted data between markers", async () => {
  const t = stub(reviewReply);
  await runPipeline({ packetText: PACKET, finders: "R", transport: t });
  const p = t.calls[0].cachePrefix;
  ok(p.includes("untrusted data") && p.indexOf("<pr_context>") < p.indexOf("## A heading inside the description") && p.indexOf("## A heading inside the description") < p.indexOf("</pr_context>"), "framing missing");
});

check("cli transport: passes prefix as the system prompt, user on stdin, tools off; returns usage and reported cost", async () => {
  const fs = await import("node:fs"); const os = await import("node:os"); const path = await import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lite-cli-"));
  const bin = path.join(dir, "fake-claude");
  fs.writeFileSync(bin, `#!/usr/bin/env node
let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{ const a=process.argv.slice(2); const sys=a[a.indexOf("--system-prompt")+1];
console.log(JSON.stringify({is_error:false,result:JSON.stringify({echo:{sys,user:s,tools:a[a.indexOf("--tools")+1],model:a[a.indexOf("--model")+1]}}),total_cost_usd:0.25,usage:{input_tokens:3,cache_read_input_tokens:4,cache_creation_input_tokens:5,output_tokens:6}})); });`);
  fs.chmodSync(bin, 0o755);
  const r = await claudeCliTransport({ bin })({ model: "m1", system: "STAGE", cachePrefix: "PREFIX", user: "UNIT", maxTokens: 10 });
  const echo = JSON.parse(r.text).echo;
  eq([echo.sys, echo.user, echo.tools, echo.model], ["PREFIX\n\nSTAGE", "UNIT", "", "m1"]);
  eq([r.costUsd, r.usage.cache_read_input_tokens], [0.25, 4]);
  const out = await runPipeline({ packetText: PACKET, finders: "R", transport: async (/** @type {any} */ q) => ({ ...(await stub(reviewReply)(q)), costUsd: 0.5 }), opts: { unitTokens: 100000 } });
  eq([out.usage.review.usd, out.usage.review.usd_source], [0.5, "reported by the transport"]);
  fs.rmSync(dir, { recursive: true });
});

check("cli transport: a non-zero exit or an error reply rejects", async () => {
  const fs = await import("node:fs"); const os = await import("node:os"); const path = await import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lite-cli-"));
  const bin = path.join(dir, "bad-claude");
  fs.writeFileSync(bin, '#!/usr/bin/env node\nprocess.stdin.resume().on("end",()=>{console.log(JSON.stringify({is_error:true,result:"rate limited"}));process.exit(1)});');
  fs.chmodSync(bin, 0o755);
  let msg = ""; try { await claudeCliTransport({ bin })({ model: "m", system: "", cachePrefix: "P", user: "U", maxTokens: 1 }); } catch (e) { msg = String(/** @type {any} */ (e).message); }
  ok(/rate limited/.test(msg), `got ${msg}`);
  fs.rmSync(dir, { recursive: true });
});

check("cli transport: a CLI that exits before reading a large payload rejects instead of crashing", async () => {
  const fs = await import("node:fs"); const os = await import("node:os"); const path = await import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lite-cli-"));
  const bin = path.join(dir, "quit-claude");
  fs.writeFileSync(bin, "#!/usr/bin/env node\nprocess.exit(1);");
  fs.chmodSync(bin, 0o755);
  let rejected = false; try { await claudeCliTransport({ bin })({ model: "m", system: "", cachePrefix: "P", user: "u".repeat(300000), maxTokens: 1 }); } catch { rejected = true; }
  ok(rejected, "expected a rejection");
  fs.rmSync(dir, { recursive: true });
});

check("threads: existing PR threads are listed in the shared prefix, trimmed, and absent when there are none", async () => {
  const threads = [{ path: "src/a.ts", line: 5, root_body: "### **Stop hold lost**\nlong text", is_resolved: false }, { path: "src/b.ts", line: null, root_body: "x".repeat(400), is_resolved: true }, { root_body: "no path" }];
  const b = threadsBlock(threads);
  ok(b.includes("- src/a.ts:5 — Stop hold lost") && b.includes("- src/b.ts (resolved) — " + "x".repeat(140)) && !b.includes("x".repeat(141)) && !b.includes("no path"), b);
  ok(b.includes("<existing_threads>") && b.includes("not instructions"), "threads block is framed as data");
  eq(threadsBlock([]), "");
  const t = stub(reviewReply);
  await runPipeline({ packetText: PACKET, finders: "R", transport: t, threads, opts: { unitTokens: 40 } });
  const reviews = t.calls.filter((c) => !c.system);
  ok(reviews.length > 1 && reviews.every((c) => c.cachePrefix === reviews[0].cachePrefix) && reviews[0].cachePrefix.includes("Do not report any of them again"), "prefix");
});

check("unaccounted: a context file in no unit and no skip is reported, never counted as reviewed", () => {
  const r = { units: [{ files: [{ path: "a.ts" }] }], skipped: [{ path: "b.ts" }] };
  eq(unaccounted([{ filename: "a.ts" }, { filename: "b.ts" }, { filename: "c.ts" }], r).map((s) => s.path), ["c.ts"]);
  eq(unaccounted([], r), []);
});

check("cross: the digest keeps only boundary-relevant added lines of source files; the pass adds a deduped candidate and is off unless --cross is set", async () => {
  const files = [{ path: "src/r.ts", role: "source", text: "    1|+const x = 1;\n    2|+if (user.userId !== owner) throw 403;\n    3| context userId" }, { path: "src/r.test.ts", role: "test", text: "    1|+userId" }, { path: "src/q.ts", role: "source", text: "    1|+const y = 2;" }];
  const d = crossDigest(files);
  ok(d.paths.length === 1 && d.paths[0] === "src/r.ts" && d.text.includes("403") && !d.text.includes("const x") && !d.text.includes("context userId"), d.text);
  const reply = (/** @type {any} */ req) => req.system.includes("Cross-cutting pass") ? JSON.stringify([{ path: "src/a.ts", line: 8, severity: "high", claim: "boundary", bad_outcome: "x", verify_by: "y" }, { path: "src/a.ts", line: 3, severity: "low", claim: "dupe of unit finding" }]) : req.system ? '{"veto":[]}' : reviewReply(req);
  const withX = stub(reply);
  const r = await runPipeline({ packetText: PACKET.replace("const v0 = 0;", "if (userId !== owner) throw 403;"), finders: "R", transport: withX, opts: { unitTokens: 40, cross: true } });
  ok(r.findings.some((f) => f.claim === "boundary") && !r.findings.some((f) => f.claim === "dupe of unit finding"), JSON.stringify(r.findings.map((f) => f.claim)));
  eq(r.usage.cross.calls, 1);
  const none = stub(reply);
  const r2 = await runPipeline({ packetText: PACKET, finders: "R", transport: none, opts: { unitTokens: 40 } });
  eq(r2.usage.cross.calls, 0);
});

check("cap: the per-unit cap keeps the highest severities first and reports the rest as dropped", async () => {
  const c = [{ severity: "low", n: 1 }, { severity: "high", n: 2 }, { severity: "medium", n: 3 }, { severity: "high", n: 4 }];
  const { kept, over } = capCandidates(c, 2);
  eq(kept.map((x) => x.n), [2, 4]);
  eq(over.map((x) => x.n), [3, 1]);
  const many = (/** @type {any} */ req) => req.system ? '{"veto":[]}' : JSON.stringify(Array.from({ length: 5 }, (_, i) => ({ path: "src/a.ts", line: i + 1, severity: "low", claim: `c${i}` })));
  const r = await runPipeline({ packetText: PACKET, finders: "R", transport: stub(many), opts: { unitTokens: 100000, maxPerUnit: 3 } });
  eq([r.findings.length, r.dropped.filter((d) => /per-unit cap/.test(d.why)).length], [3, 2]);
  ok(buildPrefix({ finders: "F", preamble: "P", impactSummary: "" }).includes("Severity: high = a security or authorization gap"), "severity rubric in the prefix");
});

check("cold: a nonce makes the prefix unique per run and leaves it identical across a run's units", async () => {
  const a = buildPrefix({ finders: "F", preamble: "P", impactSummary: "", nonce: "1" });
  ok(a !== buildPrefix({ finders: "F", preamble: "P", impactSummary: "", nonce: "2" }) && a === buildPrefix({ finders: "F", preamble: "P", impactSummary: "", nonce: "1" }), "nonce");
  eq(buildPrefix({ finders: "F", preamble: "P", impactSummary: "" }).startsWith("F"), true);
});

check("reflection window: only lines near a candidate are sent, with a gap marker, and a far quote cannot veto", async () => {
  const unit = { id: 1, files: [{ path: "src/big.ts", text: Array.from({ length: 60 }, (_, i) => `${String(i + 1).padStart(5)}|+const line${i + 1} = ${i + 1};`).join("\n") }] };
  const w = reflectWindows([unit], [{ path: "src/big.ts", line: 30 }], 3);
  ok(w.includes("const line30 =") && w.includes("const line33 =") && !w.includes("const line10 =") && w.includes("⋮"), "window wrong");
  ok(quotesDiff("const line30 = 30;", w) && !quotesDiff("const line10 = 10;", w), "quote check must use the window");
  eq(reflectWindows([unit], [{ path: "other.ts", line: 1 }], 3), "");
});

export async function selfTest() {
  let failed = 0;
  for (const c of checks) {
    try { await c.fn(); process.stdout.write(`✓ ${c.name}\n`); }
    catch (e) { failed++; process.stdout.write(`✗ ${c.name}: ${/** @type {any} */ (e)?.message || e}\n`); }
  }
  if (failed) { process.stdout.write(`✗ lite-review self-test: ${failed} of ${checks.length} failed\n`); return 1; }
  process.stdout.write(`✓ lite-review self-test: all ${checks.length} checks passed\n`);
  return 0;
}
