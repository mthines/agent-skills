#!/usr/bin/env node
// deployment-verify controller. Runs the rollout with no model: read state, do the unit that is due,
// write state, exit. An agent is woken (on_exception) only when the outcome needs one.
//
//   node tick.mjs --pr <n> | --all            one tick per PR, state in the PR's report comment (gh)
//   node tick.mjs --local <state.json> --contract <contract.json> [--deployed-at <ISO>]
//                                             one tick, state in a local file (no GitHub)
//   add --run                                 tick until the outcome is terminal, sleeping between ticks
//   add --env <name>                          release.yml environment (default production)
//   node tick.mjs --draft-contract --pr <n>   print a contract to review, built from the PR's acceptance criteria
//   node tick.mjs --draft-contract --from-plan <plan.md> [--pr <n>]
//                                             the same from an /aw brief, before its criteria are on the PR;
//                                             prefills flag.key when the brief names exactly one feature flag
//   node tick.mjs --check-config              validate .agents/aw/release.yml and exit
//   node tick.mjs --self-test                 simulated rollouts, no network
//
//   node tick.mjs --pr <n> --approve | --override   a human's decision at a hold (rules/hold.md); refused unattended
//
// Exit: 0 in progress or PASS/STOPPED/OVERRIDDEN, 3 an exception outcome (ROLLED_BACK, ESCALATE, INCONCLUSIVE)
// or a rollout that just reached a hold (AWAITING_APPROVAL), 1 error.
// Rules this implements: rules/state.md, rules/loop.md, rules/hold.md, rules/rollback.md, rules/telemetry.md.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { decide, DEFAULT_THRESHOLDS } from "./decide.mjs";
import { recommend, riskClass, RISK_CLASSES } from "./promote.mjs";
import { readEvidence, updateSignal } from "./signal.mjs";
import { parseYaml } from "./yaml-lite.mjs";

const REPORT_MARKER = "<!-- deployment-verify:v1:report -->";
const STATE_RE = /<!-- deployment-verify:v1:state (\{.*?\}) -->/s;
// The JSON fence may sit bare (older PRs) or inside a visible, closed <details> (rules/contract.md § Visible).
const CONTRACT_START = "<!-- deployment-verify:v1 -->";
const CONTRACT_END = "<!-- /deployment-verify:v1 -->";
const MALFORMED = "contract block malformed: only one ```json fence may sit between the markers";
const CONTRACT_RE = /<!-- deployment-verify:v1 -->\s*(?:<details>[\s\S]*?<\/summary>\s*)?```json\s*([\s\S]*?)```\s*(?:<\/details>\s*)?<!-- \/deployment-verify:v1 -->/;
// aw-verify's `intent` region of the PR's verify report (its writer is aw-verify/scripts/verify-comment.mjs;
// L1 G132 keeps this reader and that writer's parseIntent in step).
const INTENT_RE = /<!-- verify:section=intent -->([\s\S]*?)<!-- \/verify:section=intent -->/;
const CRITERION_RE = /^- (?:(⬜|✅|❌|⏭️) )?(?:(🚀) )?((?:AC|G)-\d+) \[([a-z]+)(?::([^\]]*))?\] (.+)$/;
// The table form of the same region: `| ✅&nbsp;AC‑1 | text | api:PUT /x · w1 · [link] |` (ID with a non-breaking hyphen).
const ROW_RE = /^\|\s*(?:(⬜|✅|❌|⏭️)(?:&nbsp;| ))?(?:(🚀)(?:&nbsp;| ))?(?:🛡️(?:&nbsp;| ))?((?:AC|G)[-\u2011]\d+)\s*\|\s*((?:\\\||\\(?!\|)|[^|\\])+?)\s*\|\s*((?:\\\||\\(?!\|)|[^|\\])*?)\s*\|$/;
const EXCEPTION_OUTCOMES = ["ROLLED_BACK", "ESCALATE", "INCONCLUSIVE"];
const HOLD_EVENT = "AWAITING_APPROVAL";
const LABEL = "deployment-verify";
const LEASE_MS = 15 * 60 * 1000;

// ───────────────────────────── config ─────────────────────────────

export function loadConfig(env, { cwd = process.cwd(), slug = null } = {}) {
	const dir = join(cwd, ".agents", "aw");
	const json = join(dir, "release.json");
	const yml = join(dir, "release.yml");
	let base;
	if (existsSync(json)) base = JSON.parse(readFileSync(json, "utf8"));
	else if (existsSync(yml)) base = parseYaml(readFileSync(yml, "utf8"));
	else throw new Error("no .agents/aw/release.yml — run /deployment-verify setup");
	const overlayPath = join(homedir(), ".agents", "aw", "config.yml");
	const overlay = existsSync(overlayPath) ? parseYaml(readFileSync(overlayPath, "utf8")) : {};
	const repo = (slug && overlay.repos?.[slug]) || {};
	const merged = deepMerge(base, repo.release || {});
	const environment = merged.environments?.[env];
	if (!environment) throw new Error(`release.yml has no environment "${env}"`);
	const policies = { ...(overlay.policies || {}), ...(repo.policies || {}) };
	const holdError = checkHoldAfter(merged);
	if (holdError) throw new Error(holdError);
	return { ...merged, env, environment, policies, thresholds: { ...DEFAULT_THRESHOLDS, ...(merged.thresholds || {}) } };
}

// `hold_after` is absent (no hold), or a step value other than the last: a hold at 100 % has nothing left to approve.
export function checkHoldAfter(config) {
	if (config.hold_after === undefined || config.hold_after === null) return null;
	const steps = config.steps || [1, 10, 50, 100];
	if (!steps.slice(0, -1).includes(config.hold_after)) return `release.yml hold_after: ${config.hold_after} must be one of steps ${JSON.stringify(steps.slice(0, -1))}`;
	return null;
}

function deepMerge(a, b) {
	if (Array.isArray(b) || typeof b !== "object" || b === null) return b === undefined ? a : b;
	const out = { ...(a || {}) };
	for (const [k, v] of Object.entries(b)) out[k] = deepMerge(out[k], v);
	return out;
}

// ──────────────────────────── contract ────────────────────────────

export function parseContract(body) {
	const m = body?.match(CONTRACT_RE);
	// Both markers without a match is a block with something besides the fence between the markers
	// (a prose line, a second fence): say so, or an author re-adds the contract and duplicates the markers.
	if (!m && body?.includes(CONTRACT_START) && body.indexOf(CONTRACT_END) > body.indexOf(CONTRACT_START)) return { error: MALFORMED };
	if (!m) return { error: "no contract — add a <!-- deployment-verify:v1 --> ```json block to the PR body" };
	// A second fence matches as one capture that spans both: the same malformed block, not bad JSON.
	if (m[1].includes("```")) return { error: MALFORMED };
	try {
		return { contract: JSON.parse(m[1]) };
	} catch (e) {
		return { error: `contract is not valid JSON: ${e.message}` };
	}
}

// The acceptance criteria aw-verify left on the PR: from the description's report, else from the newest
// trusted verify comment. [] when none. `comments` is [{ body, trusted }].
function criterionOf(line) {
	const l = line.trim();
	const c = CRITERION_RE.exec(l);
	if (c) return { id: c[3], kind: c[4], target: c[5] || "", text: c[6], status: c[1] || null, prod: Boolean(c[2]) };
	const r = ROW_RE.exec(l);
	if (!r) return null;
	const id = r[3].replace("\u2011", "-");
	const k = /^([a-z]+)(?::(.*))?$/.exec(r[5].replace(/\\\|/g, "|").split(" · ")[0].trim());
	const kind = id.startsWith("G-") ? "guardrail" : k ? k[1] : null;
	if (!kind) return null;
	return { id, kind, target: kind === "guardrail" || !k ? "" : (k[2] || "").trim(), text: r[4].replace(/\\\|/g, "|"), status: r[1] || null, prod: Boolean(r[2]) };
}

export function parseCriteria(body, comments = []) {
	const region = [body, ...comments.filter((c) => c.trusted).map((c) => c.body)]
		.map((t) => (t && /^<!-- verify:report -->[ \t]*$/m.test(t) ? t.match(INTENT_RE)?.[1] : null)).find(Boolean);
	return (region || "").split("\n").map(criterionOf).filter(Boolean);
}

// What the rollout watches: an api:/worker:/telemetry: criterion is `watched` when a contract root span
// names its target (`PUT /x` for `api:PUT /x`), else `not watched`; ui: ones were proven in the browser
// before the merge and say so; a guardrail is listed as a guardrail.
export function criteriaLines(criteria, contract) {
	if (!criteria) return [];
	if (!criteria.length) return ["criteria: none on the PR (run /aw-verify before the merge)"];
	const spans = new Set(contract?.root_spans || []);
	const head = `criteria: ${criteria.filter((c) => c.id.startsWith("AC")).length} on the PR, ${criteria.filter((c) => c.id.startsWith("G-")).length} guardrails`;
	return [head, ...criteria.map((c) => {
		const how = c.kind === "guardrail" ? "guardrail" : c.kind === "ui" ? "browser-proven before the merge"
			: spans.has(c.target) ? "watched" : "not watched";
		return `  ${c.prod ? "🚀 " : ""}${c.status ? `${c.status} ` : ""}${c.id} ${c.kind}${c.target ? ` ${c.target}` : ""} — ${how}`;
	})];
}

// After a PASS: the criteria this rollout watched (a root span names their target) get 🚀 on the PR's
// `intent` region, through aw-verify's verify-comment.mjs, which changes only that leading mark. Returns the
// IDs marked, [] when none was watched, or null when aw-verify is not installed or the write failed.
export function prodMarks(criteria, contract) {
	const spans = new Set(contract?.root_spans || []);
	return Object.fromEntries((criteria || []).filter((c) => c.kind !== "guardrail" && c.kind !== "ui" && !c.prod && spans.has(c.target)).map((c) => [c.id, { prod: true }]));
}

function markProduction(prNumber, marks) {
	if (!Object.keys(marks).length) return [];
	const vc = fileURLToPath(new URL("../../aw-verify/scripts/verify-comment.mjs", import.meta.url));
	if (!existsSync(vc)) return null;
	const r = spawnSync(process.execPath, [vc, "--pr", String(prNumber), "--section", "intent", "--marks", JSON.stringify(marks)], { encoding: "utf8" });
	if (r.status !== 0) console.error(`[deployment-verify] criteria not marked: ${(r.stderr || r.stdout).trim().split("\n")[0]}`);
	return r.status === 0 ? Object.keys(marks) : null;
}

// A contract to review for a PR that has none: root_spans from its api: criteria, the rest left to fill.
// Printed for a human or /aw to confirm and write into the PR body before the merge; never written here.
// With `flagKey` (from planFlags) the draft ships behind that flag: `flag` and a `cohort` to fill, reversibility `flag`.
export function draftContract(criteria, { flagKey = null } = {}) {
	const root_spans = [...new Set(criteria.filter((c) => c.kind === "api" && /^[A-Z]+ \//.test(c.target)).map((c) => c.target))];
	const base = { service: "<service.name>", root_spans: root_spans.length ? root_spans : ["<METHOD /route>"] };
	if (!flagKey) return { ...base, reversibility: "redeploy" };
	return {
		...base,
		flag: { key: flagKey, provider: "<release.yml flags.providers[].name>" },
		cohort: { attribute: "<span attribute>", test: "true", control: "false", on: "root" },
		reversibility: "flag",
	};
}

// The feature flags an /aw brief names in its `## Requirements`, `## Acceptance Criteria`, and `## Guardrails`: a
// backticked key in one of three shapes — "`checkoutV2` feature flag" / "feature flag `checkoutV2`", "behind the
// `checkoutV2` flag", or "flag key `checkoutV2`". An acceptance criterion also names one as "`flag.key` is
// `checkoutV2`", "the `checkoutV2` flag on/off", "the/with flag `checkoutV2`" (never the verb "shall flag `x`"),
// or "read `checkoutV2`" on a line that says
// "flag". A bare "`archived` flag" is a record field, not a feature flag, and never counts; nor does a key with a
// dot, slash, or space. A guardrail names a flag the change must not touch ("Keep the `x` feature flag on"), so
// `## Guardrails` counts only the "behind" shape, and not on a line that keeps, leaves, or forbids something
// ("Leave the code behind the `legacyCart` flag untouched"). Returns the distinct keys in order; the caller
// prefills only for one.
const KEY = "`([A-Za-z][\\w-]*)`";
const FLAG_AFTER = new RegExp(`(?:${KEY}\\s+feature[ -]flag\\b|\\bbehind\\s+(?:the\\s+)?${KEY}\\s+(?:feature[ -])?flag\\b)`, "gi");
const FLAG_BEFORE = new RegExp(`\\b(?:feature[ -]flag|flag\\s+key)\\s*[:=]?\\s*${KEY}`, "gi");
const FLAG_BEHIND = new RegExp(`\\bbehind\\s+(?:the\\s+)?${KEY}\\s+(?:feature[ -])?flag\\b`, "gi");
const FLAG_AC = [
	new RegExp(`\`?\\bflag\\.key\`?\\s+(?:is|=|:)\\s*${KEY}`, "gi"),
	new RegExp(`${KEY}\\s+(?:feature[ -])?flag\\s+(?:is\\s+)?(?:on|off|enabled|disabled)\\b`, "gi"),
	new RegExp(`\\b(?:the|with|its)\\s+flag\\s+${KEY}`, "gi"),
];
const FLAG_AC_READ = new RegExp(`\\breads?\\s+(?:the\\s+)?${KEY}`, "gi");
const GUARD_KEEP = /\b(?:keep|leave|never|not|untouched|unchanged|don't|unrelated)\b/i;
export function planFlags(planMd) {
	const lines = String(planMd || "").split("\n");
	const keys = [];
	let section = null;
	for (const line of lines) {
		if (/^##\s/.test(line)) { section = /^##\s+(Requirements|Guardrails|Acceptance Criteria)\b/i.exec(line)?.[1].toLowerCase() ?? null; continue; }
		if (!section) continue;
		let res;
		if (section === "requirements") res = [FLAG_AFTER, FLAG_BEFORE];
		else if (section === "guardrails") res = GUARD_KEEP.test(line) ? [] : [FLAG_BEHIND];
		else res = [FLAG_AFTER, FLAG_BEFORE, ...FLAG_AC, ...(/\bflag\b/i.test(line) ? [FLAG_AC_READ] : [])];
		for (const re of res) for (const m of line.matchAll(re)) { const k = m[1] || m[2]; if (!keys.includes(k)) keys.push(k); }
	}
	return keys;
}

// The brief's acceptance criteria as draftContract reads them, through aw-verify's own plan parser.
async function planCriteriaOf(planMd) {
	const vc = new URL("../../aw-verify/scripts/verify-comment.mjs", import.meta.url);
	if (!existsSync(fileURLToPath(vc))) throw new Error("--from-plan needs the aw-verify skill installed beside deployment-verify");
	const { planCriteria } = await import(vc.href);
	return planCriteria(planMd).acs;
}

export function validateContract(contract, config) {
	// A cohort only exists when a flag splits traffic; a no-flag contract is measured before/after the deploy.
	for (const k of contract.flag ? ["service", "root_spans", "cohort"] : ["service", "root_spans"]) if (!contract[k]) return `contract is missing "${k}"`;
	if (contract.flag && !providerFor(contract, config)) return `unknown provider ${contract.flag.provider}`;
	for (const [k, v] of Object.entries(contract.thresholds || {})) {
		const base = config.thresholds[k];
		if (base === undefined) return `unknown threshold ${k}`;
		if ((k.startsWith("max_") && v > base) || (k.startsWith("min_") && v < base)) return `contract loosens ${k} — thresholds may only tighten`;
	}
	return null;
}

// A rollout that has not reached step 1 yet: no state, or still waiting for its deploy or baseline (flag never set on).
export const beforeStepOne = (state) => !state || !state.phase || state.phase === "deploy" || state.phase === "baseline";
// A live lease means another tick is mid-rollout: never stop it from outside; the next tick decides.
const leaseLive = (state, now = Date.now()) => Boolean(state?.lease && Date.parse(state.lease.until) > now);
export const holdCheckDue = (state, now) => beforeStepOne(state) && !leaseLive(state, now);

// Before step 1 only: a configured hold the rollout cannot reach (contract steps, a boolean provider) would
// ship unheld, so the rollout stops instead. A rollout already in flight is never stopped by a later config edit.
export function checkHoldReachable(contract, config) {
	if (!contract.flag || config.hold_after === undefined || config.hold_after === null) return null;
	const steps = stepsFor(contract, config);
	return steps.slice(0, -1).includes(config.hold_after) ? null : `hold_after: ${config.hold_after} is not a step before the last in this rollout's steps ${JSON.stringify(steps)}`;
}

function providerFor(contract, config) {
	return (config.flags?.providers || []).find((p) => p.name === contract.flag?.provider);
}

function stepsFor(contract, config) {
	const p = providerFor(contract, config);
	if (!contract.flag || p?.rollout === "boolean") return [100];
	return contract.steps || config.steps || [1, 10, 50, 100];
}

// ──────────────────────────── telemetry ───────────────────────────

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

export function cohortQuery(contract) {
	const c = contract.cohort;
	const spans = contract.root_spans.map(q).join(", ");
	const values = [c.test, c.control].map(q).join(", ");
	if (c.on === "child") {
		return `SELECT c.span_attributes[${q(c.attribute)}] AS variant, count() AS n, countIf(r.status_code = 'ERROR') AS errors, round(avg(r.duration) / 1000000, 1) AS avg_ms FROM spans AS c INNER JOIN spans AS r ON c.trace_id = r.trace_id WHERE c.resource_attributes['service.name'] = ${q(contract.service)} AND c.span_attributes[${q(c.attribute)}] IN (${values}) AND r.kind = 'SERVER' AND r.name IN (${spans}) GROUP BY variant`;
	}
	return `SELECT span_attributes[${q(c.attribute)}] AS variant, count() AS n, countIf(status_code = 'ERROR') AS errors, round(avg(duration) / 1000000, 1) AS avg_ms FROM spans WHERE resource_attributes['service.name'] = ${q(contract.service)} AND kind = 'SERVER' AND name IN (${spans}) AND span_attributes[${q(c.attribute)}] IN (${values}) GROUP BY variant`;
}

// No-flag measurement: one aggregate over SERVER root spans, split by deploy version instead of cohort.
//   before — spans of any version that does not contain the change; after — spans of the versions that do.
//   any — everything (the recovery window after a platform rollback). `versions` empty → time window only.
export function windowQuery(contract, { attribute, versions = [], mode }) {
	const spans = contract.root_spans.map(q).join(", ");
	let filter = "";
	if (attribute && versions.length && mode !== "any") {
		const k = `resource_attributes[${q(attribute)}]`;
		const list = versions.map(q).join(", ");
		filter = mode === "after" ? ` AND ${k} IN (${list})` : ` AND ${k} != '' AND ${k} NOT IN (${list})`;
	}
	return `SELECT count() AS n, countIf(status_code = 'ERROR') AS errors, round(avg(duration) / 1000000, 1) AS avg_ms FROM spans WHERE resource_attributes['service.name'] = ${q(contract.service)} AND kind = 'SERVER' AND name IN (${spans})${filter}`;
}

// The values of the detect attribute currently serving, most traffic first.
export function deployQuery(contract, detect) {
	const k = q(detect.attribute);
	return `SELECT resource_attributes[${k}] AS live, count() AS n FROM spans WHERE resource_attributes['service.name'] = ${q(contract.service)} AND resource_attributes[${k}] != '' GROUP BY live ORDER BY n DESC LIMIT 5`;
}

// Live when a serving value equals the target, or (merge_sha) a serving commit already contains the merge:
// a busy repo deploys a later commit and never the merge commit itself.
export async function liveValues(rows, detect, sha, contains) {
	const want = detect.equals === "merge_sha" ? sha : detect.equals;
	const live = [];
	for (const r of rows) {
		if (r.live === want || (detect.equals === "merge_sha" && contains && (await contains(sha, r.live, detect)))) live.push(r.live);
	}
	return live;
}

export async function isDeployed(rows, detect, sha, contains) {
	return (await liveValues(rows, detect, sha, contains)).length > 0;
}

// Git refs to try for a serving `service.version`: a commit SHA is itself; a release tag is tried with and
// without the "v" (or only `detect.tag_prefix` when set). Anything else cannot be resolved → no refs.
export function releaseRefs(live, tagPrefix) {
	const v = String(live);
	if (/^[0-9a-f]{7,40}$/.test(v)) return [v];
	if (!/^v?\d+\.\d+\.\d+$/.test(v)) return [];
	const bare = v.replace(/^v/, "");
	return tagPrefix === undefined ? [`v${bare}`, bare] : [`${tagPrefix}${bare}`];
}

// No-flag stats: the single aggregate row lands in `test` (before/after) or `control` (any).
function toWindowStats(rows, mode) {
	const r = rows[0];
	const x = r && Number(r.n) > 0 ? { n: Number(r.n), errors: Number(r.errors), avg_ms: Number(r.avg_ms) || 0 } : { n: 0, errors: 0, avg_ms: 0 };
	return mode === "any" ? { test: { n: 0, errors: 0, avg_ms: 0 }, control: x } : { test: x, control: { n: 0, errors: 0, avg_ms: 0 } };
}

function toStats(rows, contract) {
	const empty = { n: 0, errors: 0, avg_ms: 0 };
	const find = (v) => {
		const r = rows.find((x) => String(x.variant) === String(v));
		return r ? { n: Number(r.n), errors: Number(r.errors), avg_ms: Number(r.avg_ms) } : { ...empty };
	};
	return { test: find(contract.cohort.test), control: find(contract.cohort.control) };
}

// Dash0 MCP over HTTP with an auth token (the documented route for scripts and CI).
export function dash0Mcp({ url, token }) {
	let session = null;
	let id = 0;
	async function rpc(method, params, notify = false) {
		const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}` };
		if (session) headers["Mcp-Session-Id"] = session;
		const body = notify ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: ++id, method, params };
		const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
		session = res.headers.get("mcp-session-id") || session;
		if (notify) return null;
		if (!res.ok) throw new Error(`Dash0 MCP ${method}: HTTP ${res.status}`);
		const text = await res.text();
		const payload = (res.headers.get("content-type") || "").includes("event-stream")
			? text.split("\n").filter((l) => l.startsWith("data:")).map((l) => JSON.parse(l.slice(5))).find((m) => m.id === id)
			: JSON.parse(text);
		if (payload?.error) throw new Error(`Dash0 MCP ${method}: ${payload.error.message}`);
		return payload.result;
	}
	let ready = null;
	return {
		async sql(query, { dataset, from, to }) {
			ready ??= rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "deployment-verify", version: "0.3.0" } }).then(() => rpc("notifications/initialized", {}, true));
			await ready;
			const result = await rpc("tools/call", { name: "sql", arguments: { query, dataset, timeRange: { from, to } } });
			const text = (result?.content || []).map((c) => c.text || "").join("\n");
			if (result?.isError) throw new Error(`Dash0 sql: ${text.slice(0, 300)}`);
			return parseMarkdownTable(text);
		},
	};
}

export function parseMarkdownTable(text) {
	const rows = text.split("\n").filter((l) => l.trim().startsWith("|"));
	if (rows.length < 2) return [];
	const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
	const head = cells(rows[0]);
	return rows.slice(2).map((l) => Object.fromEntries(cells(l).map((v, i) => [head[i], v])));
}

// A backend as a command: SQL on stdin, FROM/TO/DATASET in the environment, JSON rows on stdout.
function commandBackend(cmd) {
	return {
		async sql(query, { dataset, from, to }) {
			const out = execFileSync("sh", ["-c", cmd], { input: query, env: { ...process.env, FROM: from, TO: to, DATASET: dataset || "" }, encoding: "utf8" });
			return JSON.parse(out);
		},
	};
}

// ───────────────────────────── the tick ───────────────────────────

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * One tick for one rollout. Pure apart from `io`:
 *   io.now() ms · io.sql(query, {dataset, from, to}) rows · io.setFlag(value) · io.sendTraffic(n)
 *   io.sleep(ms) · io.platformRollback() bool · io.log(msg) · io.recommend?() {recommendation, reason, risk_class}
 * `decision` = { action: "approve" | "override", at, by } — a human's answer at a hold; never passed unattended.
 * Returns the new state. A terminal state has phase "done" and an `outcome`.
 */
export async function tick(state, { contract, config, sha, mergedAt, deployedAt, io, decision = null }) {
	const s = structuredClone(state || {});
	const env = config.environment;
	const t = { ...config.thresholds, ...(contract.thresholds || {}) };
	const steps = stepsFor(contract, config);
	const window = (config.step_window_minutes ?? 10) * 60_000;
	const ingest = (env.ingest_wait_seconds ?? 45) * 1000;
	const propagation = (providerFor(contract, config)?.propagation_seconds ?? 0) * 1000;
	const synthetic = env.traffic && env.traffic !== "real";
	const holdCap = (config.max_hold_minutes ?? 30) * 60_000;
	const detectAttr = env.deploy?.detect?.attribute;
	const query = (from, to, mode) =>
		contract.flag
			? io.sql(cohortQuery(contract), { dataset: env.dataset, from: iso(from), to: iso(to) }).then((r) => toStats(r, contract))
			: io.sql(windowQuery(contract, { attribute: detectAttr, versions: s.live_values || [], mode }), { dataset: env.dataset, from: iso(from), to: iso(to) }).then((r) => toWindowStats(r, mode));
	const end = (outcome, reason) => Object.assign(s, { phase: "done", outcome, reason, ended_at: iso(io.now()) });
	const offValue = providerFor(contract, config)?.rollout === "boolean" ? false : 0;
	const valueFor = (pct) => (providerFor(contract, config)?.rollout === "boolean" ? pct > 0 : pct);
	const trafficFor = (pct) => Math.max(200, Math.ceil((t.min_test_requests / (pct / 100)) * 1.5));
	const holdAfter = Number.isFinite(config.hold_after) ? config.hold_after : null;

	// Send traffic (synthetic environments) or let the window elapse (real traffic); return the window.
	async function produceWindow(pct, startMs) {
		if (!synthetic) return { from: startMs, to: startMs + window, due: startMs + window + ingest };
		const from = io.now();
		const n = pct === 0 ? 200 : trafficFor(pct);
		await io.sendTraffic(n);
		const to = io.now();
		s.sent = (s.sent || 0) + n;
		await io.sleep(ingest);
		return { from, to, due: io.now() };
	}

	async function measure(from, to, mode) {
		let stats = await query(from, to, mode);
		if (synthetic && s.sent && stats.test.n + stats.control.n < 0.9 * s.sent) {
			await io.sleep(ingest);
			stats = await query(from, to, mode);
		}
		return stats;
	}

	if (!s.phase) Object.assign(s, { phase: "deploy", env: config.env, steps: [], notified: [] });

	for (let guard = 0; guard < 100; guard++) {
		const now = io.now();
		if (s.phase === "done") return s;

		if (s.phase === "deploy") {
			if (env.deploy?.detect === "manual") {
				if (!deployedAt) return end("STOPPED", "manual deploy detection needs --deployed-at");
				s.deploy_live_at = deployedAt;
			} else {
				const rows = await io.sql(deployQuery(contract, env.deploy.detect), { dataset: env.dataset, from: iso(now - 15 * 60_000), to: iso(now) });
				const live = await liveValues(rows, env.deploy.detect, sha, io.contains);
				if (!live.length) {
					const minutes = env.deploy.timeout_minutes ?? 60;
					if (mergedAt && now - Date.parse(mergedAt) > minutes * 60_000) return end("STOPPED", `deploy not detected in ${minutes} min — nothing changed`);
					return s;
				}
				s.deploy_live_at = iso(now);
				s.live_values = live;
			}
			s.phase = "baseline";
			continue;
		}

		if (s.phase === "baseline" && !contract.flag) {
			// No flag: the baseline is the past — the old version's traffic just before the deploy. Nothing to wait for.
			if (!s.baseline_window) {
				const to = Date.parse(s.deploy_live_at) - ingest;
				s.baseline_window = { from: iso(to - 2 * window), to: iso(to), due: iso(now) };
			}
			const st = await measure(Date.parse(s.baseline_window.from), Date.parse(s.baseline_window.to), "before");
			if (st.test.n < t.min_reference_requests) {
				if (s.baseline_extended) return end("STOPPED", `not enough traffic to verify — ${st.test.n} requests before the deploy`);
				s.baseline_extended = true;
				s.baseline_window = { ...s.baseline_window, from: iso(Date.parse(s.baseline_window.from) - 4 * window) };
				continue;
			}
			s.baseline = { ...st.test, ...s.baseline_window };
			Object.assign(s, { phase: "step", step_index: 0, last_passed_value: 0, window: null, hold_since: null });
			continue;
		}

		if (s.phase === "baseline") {
			if (!s.baseline_window) {
				if (contract.flag) await io.setFlag(offValue);
				const start = synthetic ? now : Math.max(now, Date.parse(s.deploy_live_at));
				const w = await produceWindow(0, start);
				s.baseline_window = { from: iso(w.from), to: iso(w.to), due: iso(w.due) };
			}
			if (io.now() < Date.parse(s.baseline_window.due)) return s;
			const st = await measure(Date.parse(s.baseline_window.from), Date.parse(s.baseline_window.to));
			if (st.control.n < t.min_reference_requests) {
				if (s.baseline_extended) return end("STOPPED", `not enough traffic to verify — ${st.control.n} requests in the baseline`);
				s.baseline_extended = true;
				const w = await produceWindow(0, Date.parse(s.baseline_window.to));
				s.baseline_window = { from: s.baseline_window.from, to: iso(w.to), due: iso(w.due) };
				continue;
			}
			s.baseline = { ...st.control, ...s.baseline_window };
			Object.assign(s, { phase: "step", step_index: 0, last_passed_value: 0, window: null, hold_since: null });
			continue;
		}

		if (s.phase === "step") {
			const pct = steps[s.step_index];
			s.step_value = pct;
			if (!s.window) {
				if (contract.flag) await io.setFlag(valueFor(pct));
				s.step_set_at = iso(io.now());
				await io.sleep(synthetic ? propagation : 0);
				// No flag: the after window opens at the deploy, not at this tick.
				const w = await produceWindow(pct, contract.flag ? io.now() + (synthetic ? 0 : propagation) : Date.parse(s.deploy_live_at));
				s.window = { from: iso(w.from), to: iso(w.to), due: iso(w.due) };
			}
			if (io.now() < Date.parse(s.window.due)) return s;
			const stats = await measure(Date.parse(s.window.from), Date.parse(s.window.to), contract.flag ? undefined : "after");
			const total = stats.test.n + stats.control.n;
			const share = total ? stats.test.n / total : 0;
			const live = pct === 100 ? stats.test.n > 0 && (stats.control.n === 0 || share >= 0.95) : total < 200 || share >= pct / 200;
			let verdict = live ? decide({ ...stats, baseline: s.baseline }, t) : { verdict: "HOLD", reason: `step not live: test share ${(share * 100).toFixed(1)}% at ${pct}%` };
			if (!live && s.not_live_once) {
				if (contract.flag) await io.setFlag(valueFor(s.last_passed_value));
				return end("INCONCLUSIVE", contract.flag ? "flag change not visible in telemetry — check the provider's set command and the cohort attribute" : "new version not seen in the after window — check the environment's detect attribute");
			}
			if (!live) s.not_live_once = true;
			s.steps = s.steps.filter((x) => x.value !== pct).concat([{ value: pct, ...s.window, test: stats.test, control: stats.control, verdict: verdict.verdict, reason: verdict.reason }]);
			io.log(`step ${pct}%: ${verdict.verdict} — ${verdict.reason}`);
			if (verdict.verdict === "PASS") {
				s.last_passed_value = pct;
				if (s.step_index + 1 >= steps.length) return end("PASS", contract.flag ? `${pct}% passed; flag left on` : "after window held against the before window");
				Object.assign(s, { step_index: s.step_index + 1, window: null, hold_since: null, holds: 0, not_live_once: false });
				if (contract.flag && pct === holdAfter) {
					// A human hold: the flag stays at this step until approve or override (rules/hold.md).
					const rec = io.recommend ? await io.recommend() : null;
					s.hold = { at: pct, since: iso(io.now()), recommendation: rec?.recommendation || "HUMAN", reason: rec?.reason || "no recommender", risk_class: rec?.risk_class || null, degraded: rec?.degraded || null, decision: null };
					s.phase = "hold";
					io.log(`hold at ${pct}%: waiting for approve or override — recommendation ${s.hold.recommendation} (${s.hold.reason})`);
					return s;
				}
				continue;
			}
			if (verdict.verdict === "HOLD") {
				s.hold_since ??= iso(io.now());
				s.holds = (s.holds || 0) + 1;
				// Real traffic: a time cap. Synthetic traffic: an attempt cap, since a burst takes seconds.
				if (io.now() - Date.parse(s.hold_since) > holdCap || (synthetic && s.holds > 5)) {
					if (contract.flag) await io.setFlag(valueFor(s.last_passed_value));
					return end("INCONCLUSIVE", `held ${config.max_hold_minutes ?? 30} min at ${pct}%: ${verdict.reason}`);
				}
				const w = await produceWindow(pct, Date.parse(s.window.to));
				s.window = { from: s.window.from, to: iso(w.to), due: iso(w.due) };
				if (!synthetic) return s;
				continue;
			}
			// ROLLBACK
			s.rollback_verdict = verdict.reason;
			s.rollback_at = iso(io.now());
			const policy = config.policies?.rollback || "ask";
			if (policy === "never") return end("ESCALATE", `ROLLBACK verdict (${verdict.reason}); rollback policy is never`);
			if (contract.flag && (contract.reversibility || "flag") === "flag") {
				s.phase = "rollback";
				continue;
			}
			if (!contract.flag && (await io.platformRollback())) {
				s.phase = "rollback";
				continue;
			}
			return end("ESCALATE", `ROLLBACK verdict (${verdict.reason}); rollback needs a human (reversibility: ${contract.reversibility || "none"})`);
		}

		if (s.phase === "hold") {
			// Nothing is due at a hold: only a human decision moves it. An unattended tick changes nothing.
			if (!decision) return s;
			const at = decision.at || iso(io.now());
			s.hold.decision = { action: decision.action, at, by: decision.by || null, seconds: Math.round((Date.parse(at) - Date.parse(s.hold.since)) / 1000) };
			if (decision.action === "approve") {
				decision = null;
				s.phase = "step";
				io.log(`hold at ${s.hold.at}%: approved after ${s.hold.decision.seconds} s`);
				continue;
			}
			if (decision.action === "override") {
				await io.setFlag(offValue);
				return end("OVERRIDDEN", `human override at the ${s.hold.at}% hold — flag returned to off`);
			}
			throw new Error(`unknown hold decision ${decision.action}`);
		}

		if (s.phase === "rollback") {
			if (!s.recovery_window) {
				if (contract.flag) await io.setFlag(offValue); // repeated on an interrupted tick — set is idempotent
				await io.sleep(synthetic ? propagation : 0);
				const w = await produceWindow(0, io.now() + (synthetic ? 0 : propagation));
				s.recovery_window = { from: iso(w.from), to: iso(w.to), due: iso(w.due) };
			}
			if (io.now() < Date.parse(s.recovery_window.due)) return s;
			const st = await measure(Date.parse(s.recovery_window.from), Date.parse(s.recovery_window.to), contract.flag ? undefined : "any");
			const rate = (x) => (x.n ? (100 * x.errors) / x.n : 0);
			const secs = Math.round((io.now() - Date.parse(s.rollback_at)) / 1000);
			if (contract.flag && st.test.n > 0) {
				if (s.recovery_extended) return end("ESCALATE", "rollback did not take effect — flag-on traffic still arriving");
				s.recovery_extended = true;
				s.recovery_window = null;
				continue;
			}
			if (rate(st.control) > rate(s.baseline) + t.max_error_rate_delta_pp) return end("ESCALATE", "errors persist after rollback; likely not this change");
			s.recovery = { ...st.control, seconds: secs };
			return end("ROLLED_BACK", `${s.rollback_verdict}; RECOVERED in ${secs} s`);
		}
	}
	throw new Error("tick did not settle — controller bug");
}

// ───────────────────────────── report ─────────────────────────────

export function renderReport(s, contract, pr) {
	const f = (x) => (x ? `${x.n}/${x.errors}/${x.avg_ms}` : "-");
	const rows = (s.steps || []).map((x) => `${String(x.value + " %").padEnd(7)}${f(x.test).padEnd(17)}${f(x.control).padEnd(19)}${x.verdict} ${x.reason}`);
	const status = s.phase === "done" ? s.outcome : "IN PROGRESS";
	const lines = [
		`DEPLOYMENT ${status}`,
		`change:   ${pr?.title ? `${pr.title} (#${pr.number})` : "local run"} · flag ${contract.flag?.key || "none"}${contract.flag ? ` via ${contract.flag.provider}` : ""} · ${s.env}`,
		...(contract.flag ? [] : ["mode:     no flag — before/after only, attribution weaker"]),
		`deploy:   ${s.deploy_live_at ? `live at ${s.deploy_live_at}` : "waiting"}`,
		`baseline: ${s.baseline ? `${s.baseline.n} requests, ${s.baseline.errors} errors, ${s.baseline.avg_ms} ms` : "pending"}`,
		`step   test n/err/ms    control n/err/ms   verdict`,
		...rows,
	];
	lines.push(...criteriaLines(pr?.criteria, contract));
	if (s.hold) {
		const d = s.hold.decision;
		lines.push(d ? `hold:     ${s.hold.at} % — ${d.action === "approve" ? "approved" : "overridden"}${d.by ? ` by ${d.by}` : ""} after ${d.seconds} s`
			: `hold:     ${s.hold.at} % since ${s.hold.since} — waiting: /deployment-verify approve|override ${pr?.number ?? "<pr>"}`);
		lines.push(`recommend: ${s.hold.recommendation} — ${s.hold.reason}${s.hold.risk_class ? ` (risk class ${s.hold.risk_class})` : ""}; advisory only`);
		if (s.hold.degraded) lines.push(s.hold.degraded);
	}
	if (s.signal_note) lines.push(`signal:   ${s.signal_note}`);
	if (s.phase === "rollback" || s.recovery) lines.push(`action:   flag off at ${s.rollback_at}${s.recovery ? `; RECOVERED in ${s.recovery.seconds} s` : ""}`);
	if (s.phase === "done") lines.push(`result:   ${s.reason}`);
	if (s.outcome === "ROLLED_BACK") lines.push(`next:     /fix-bug ${pr?.url || "<PR URL>"} — failing window ${s.steps.at(-1)?.from}..${s.steps.at(-1)?.to}`);
	if (s.outcome === "PASS") lines.push(`not watched: no soak window — run ended at ${s.ended_at}`);
	return `${REPORT_MARKER}\n\`\`\`text\n${lines.join("\n")}\n\`\`\`\n<!-- deployment-verify:v1:state ${JSON.stringify(s)} -->`;
}

// ────────────────────────── state stores ──────────────────────────

function gh(args, input) {
	return execFileSync("gh", args, { encoding: "utf8", input });
}

function prStore(number) {
	const pr = JSON.parse(gh(["pr", "view", String(number), "--json", "number,title,body,url,mergedAt,mergeCommit,state,labels"]));
	const comments = JSON.parse(gh(["api", `repos/{owner}/{repo}/issues/${number}/comments`, "--paginate", "--jq", "[.[] | {id, body, trusted: ((.author_association | IN(\"OWNER\", \"MEMBER\", \"COLLABORATOR\")) or .user.type == \"Bot\")}]"]).replace(/\]\s*\[/g, ","));
	pr.criteria = parseCriteria(pr.body, [...comments].reverse());
	let comment = comments.find((c) => c.body?.includes(REPORT_MARKER));
	return {
		pr,
		read() {
			const m = comment?.body.match(STATE_RE);
			return m ? JSON.parse(m[1]) : null;
		},
		write(body) {
			if (comment) gh(["api", "-X", "PATCH", `repos/{owner}/{repo}/issues/comments/${comment.id}`, "-f", `body=${body}`]);
			else comment = JSON.parse(gh(["api", `repos/{owner}/{repo}/issues/${number}/comments`, "-f", `body=${body}`]));
			comment.body = body;
		},
		reread() {
			comment.body = JSON.parse(gh(["api", `repos/{owner}/{repo}/issues/comments/${comment.id}`])).body;
		},
		finish() {
			gh(["pr", "edit", String(number), "--remove-label", LABEL, "--add-label", `${LABEL}:done`]);
		},
	};
}

function localStore(path) {
	return {
		pr: null,
		read: () => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")).state : null),
		write: (body) => writeFileSync(path, JSON.stringify({ state: JSON.parse(body.match(STATE_RE)[1]), report: body }, null, 2)),
		reread() {},
		finish() {},
	};
}

// ───────────────────────────── real io ────────────────────────────

// The PR's risk class from its diff (promote.mjs → pr-reviewer's classify-shape); `unknown` when unreadable.
function prRiskClass(number) {
	if (!number) return "unknown";
	try {
		const files = JSON.parse(gh(["api", `repos/{owner}/{repo}/pulls/${number}/files`, "--paginate"]).replace(/\]\s*\[/g, ","));
		return riskClass(files);
	} catch {
		return "unknown";
	}
}

function realIo({ config, contract, pr = null, slug = null }) {
	const env = config.environment;
	const tel = config.telemetry || {};
	const backend =
		tel.kind === "command"
			? commandBackend(tel.run)
			: dash0Mcp({ url: tel.url, token: process.env[tel.token_env || "DASH0_AUTH_TOKEN"] || fail(`set ${tel.token_env || "DASH0_AUTH_TOKEN"} to a Dash0 auth token with read access`) });
	const provider = providerFor(contract, config);
	const fill = (cmd, vars) => cmd.replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined ? `{${k}}` : String(vars[k])));
	const sh = (cmd) => {
		const r = spawnSync("sh", ["-c", cmd], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
		if (r.status !== 0) throw new Error(`command failed (${r.status}): ${cmd}\n${(r.stderr || "").slice(0, 500)}`);
		return r.stdout;
	};
	return {
		now: () => Date.now(),
		sql: (query, opts) => backend.sql(query, opts),
		setFlag: async (value) => provider && sh(fill(provider.set, { flag: contract.flag.key, value, env: config.env })),
		sendTraffic: async (n) => sh(fill(env.traffic, { n })),
		sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
		platformRollback: async () => {
			const p = (config.rollback || []).find((r) => r.kind === "platform" && r.run);
			if (!p) return false;
			sh(p.run);
			return true;
		},
		// Does commit `live` contain commit `merge`? GitHub compare: merge...live is "ahead" or "identical".
		contains: async (merge, live, detect) => {
			for (const ref of releaseRefs(live, detect?.tag_prefix)) {
				const r = spawnSync("gh", ["api", `repos/{owner}/{repo}/compare/${merge}...${ref}`, "--jq", ".status"], { encoding: "utf8" });
				if (r.status === 0) return ["ahead", "identical"].includes(r.stdout.trim());
			}
			return false;
		},
		log: (m) => console.error(`[deployment-verify] ${m}`),
		// Advisory only: printed beside the hold, never acted on (rules/autonomy.md). No promotion rule → no LoreKit call.
		recommend: async () => {
			if (!config.promotion) return { ...recommend(null, null), risk_class: null };
			const risk = prRiskClass(pr?.number);
			const ev = readEvidence({ repo: slug, risk, model: contract.model || null });
			return { ...recommend(config.promotion, ev.evidence), risk_class: risk, degraded: ev.line || null };
		},
	};
}

// The signal events a tick produced, in order: a human decision at a hold, then a rollback verdict.
// One tick can produce both (synthetic traffic runs the next step inside the approving tick).
export function signalEvents(prev, next, contract) {
	const model = contract.model || null;
	const events = [];
	const d = next.hold?.decision;
	if (prev?.phase === "hold" && d && !prev.hold?.decision) events.push({ type: d.action, seconds: d.seconds, model, at: d.at });
	if (prev?.phase !== "done" && next.phase === "done" && next.rollback_verdict && ["ROLLED_BACK", "ESCALATE"].includes(next.outcome)) {
		events.push({ type: "rollback", model, at: next.ended_at });
	}
	return events;
}

const JUST_HELD = new WeakSet();

function fail(msg) {
	throw new Error(msg);
}

function exception(config, event) {
	if (!config.on_exception) return;
	const dir = mkdtempSync(join(tmpdir(), "deployment-verify-"));
	const file = join(dir, "event.json");
	writeFileSync(file, JSON.stringify(event, null, 2));
	const r = spawnSync("sh", ["-c", config.on_exception.replace(/\{event\}/g, file)], { stdio: "inherit" });
	if (r.status !== 0) console.error(`[deployment-verify] on_exception failed (${r.status}); the PR comment still holds the outcome`);
}

async function runOne({ store, contract, config, sha, mergedAt, deployedAt, loop, decision = null, slug = null }) {
	const io = realIo({ config, contract, pr: store.pr, slug });
	const holder = `${process.env.GITHUB_RUN_ID || process.pid}-${Date.now()}`;
	for (;;) {
		let state = store.read();
		// A hold with no decision has nothing due: leave the comment untouched (no lease churn every tick).
		if (state?.phase === "hold" && !decision) return state;
		// Refuse a misplaced decision before taking the lease, so scheduled ticks are never locked out by it.
		if (decision && state?.phase !== "hold") throw new Error(`not at a hold (phase ${state?.phase || "none"}) — nothing to ${decision.action}`);
		if (state?.lease && Date.parse(state.lease.until) > Date.now() && state.lease.holder !== holder) {
			io.log(`lease held by ${state.lease.holder}; skipping`);
			return state;
		}
		state = { ...(state || {}), lease: { holder, until: iso(Date.now() + LEASE_MS) } };
		store.write(renderReport(state, contract, store.pr));
		store.reread();
		if (store.read()?.lease?.holder !== holder) return state;
		const next = await tick(state, { contract, config, sha, mergedAt, deployedAt, io, decision });
		decision = null;
		next.lease = null;
		const events = config.promotion ? signalEvents(state, next, contract) : [];
		const notes = [];
		for (const event of events) {
			const risk = next.hold?.risk_class || next.risk_class || (next.risk_class = prRiskClass(store.pr?.number));
			// A class no recommendation reads (`unknown`: no PR, or its files unreadable) is never written.
			const r = RISK_CLASSES.includes(risk) ? updateSignal({ repo: slug, risk, event, rule: config.promotion })
				: { status: "degraded", line: `Degraded: earned-autonomy signal not updated — risk class ${risk}` };
			notes.push(r.status === "ok" ? `${risk}: ${event.type} — ${r.note}` : r.line);
		}
		if (notes.length) {
			next.signal_note = notes.join("; ");
			io.log(next.signal_note);
		}
		const heldNow = next.phase === "hold" && !next.hold?.decision && !(next.notified || []).includes(HOLD_EVENT);
		if (heldNow) next.notified = [...(next.notified || []), HOLD_EVENT];
		store.write(renderReport(next, contract, store.pr));
		if (heldNow) {
			exception(config, { outcome: HOLD_EVENT, reason: `hold at ${next.hold.at}%: recommendation ${next.hold.recommendation} (${next.hold.reason})`, pr: store.pr?.url || null, contract, state: next });
			JUST_HELD.add(next);
		}
		if (next.phase === "hold") return next;
		if (next.phase === "done") {
			if (next.outcome === "PASS" && store.pr?.number) {
				const marked = markProduction(store.pr.number, prodMarks(store.pr.criteria, contract));
				io.log(marked === null ? "criteria not marked 🚀 (aw-verify missing or the write failed)" : `criteria marked 🚀: ${marked.join(", ") || "none watched"}`);
			}
			store.finish();
			io.log(`outcome ${next.outcome}: ${next.reason}`);
			if (EXCEPTION_OUTCOMES.includes(next.outcome)) {
				exception(config, { outcome: next.outcome, reason: next.reason, pr: store.pr?.url || null, contract, state: next });
			}
			return next;
		}
		if (!loop) return next;
		const due = [next.window?.due, next.baseline_window?.due, next.recovery_window?.due].filter(Boolean).map(Date.parse);
		const wait = Math.min(60_000, Math.max(5_000, (due.length ? Math.min(...due) : Date.now() + 60_000) - Date.now()));
		await io.sleep(wait);
	}
}

// ──────────────────────────── self-test ───────────────────────────

async function selfTest() {
	const base = {
		env: "local",
		environment: { dataset: "x", deploy: { detect: "manual" }, traffic: "sim", ingest_wait_seconds: 0 },
		flags: { providers: [{ name: "sim", rollout: "percent", propagation_seconds: 0 }] },
		steps: [1, 10, 50, 100],
		step_window_minutes: 10,
		max_hold_minutes: 30,
		policies: { rollback: "ask" },
		thresholds: { ...DEFAULT_THRESHOLDS },
	};
	const contract = { service: "ui", root_spans: ["GET /x"], flag: { key: "f", provider: "sim" }, cohort: { attribute: "v", test: "test", control: "control", on: "root" }, reversibility: "flag" };

	// A simulated service: requests split by the flag percent; `fault` decides what the test cohort does.
	function world({ fault = "none", requestsPerTraffic = 1, stuck = false } = {}) {
		let clock = Date.parse("2026-11-11T10:00:00Z");
		let percent = 0;
		const log = [];
		const windows = [];
		return {
			log,
			io: {
				now: () => clock,
				sleep: async (ms) => void (clock += ms),
				setFlag: async (v) => {
					log.push(`set ${v}`);
					if (!stuck) percent = Number(v);
				},
				sendTraffic: async (n) => {
					const from = clock;
					clock += 1000;
					windows.push({ from, to: clock, n: Math.round(n * requestsPerTraffic), percent });
				},
				platformRollback: async () => false,
				sql: async (query, { from, to }) => {
					const a = Date.parse(from), b = Date.parse(to);
					let test = { n: 0, errors: 0, ms: 0 }, control = { n: 0, errors: 0, ms: 0 };
					for (const w of windows.filter((w) => w.from >= a && w.to <= b)) {
						const tn = Math.round((w.n * w.percent) / 100);
						control.n += w.n - tn;
						control.ms += (w.n - tn) * 5;
						test.n += tn;
						test.errors += fault === "errors" ? Math.round(tn * 0.25) : 0;
						test.ms += tn * (fault === "latency" ? 405 : fault === "errors" ? 305 : 5);
					}
					const row = (v, x) => (x.n ? [{ variant: v, n: x.n, errors: x.errors, avg_ms: x.ms / x.n }] : []);
					return [...row("test", test), ...row("control", control)];
				},
				log: () => {},
			},
		};
	}
	async function rollout(w, config = base, c = contract) {
		let s = null;
		for (let i = 0; i < 50 && s?.phase !== "done"; i++) s = await tick(s, { contract: c, config, deployedAt: "2026-11-11T09:59:00Z", io: w.io });
		return s;
	}
	const cases = [
		["healthy change passes every step", { fault: "none" }, "PASS", (s, w) => s.steps.length === 4 && w.log.at(-1) === "set 100"],
		["error regression rolls back at 1 %", { fault: "errors" }, "ROLLED_BACK", (s, w) => s.steps.length === 1 && w.log.at(-1) === "set 0"],
		["latency-only regression rolls back", { fault: "latency" }, "ROLLED_BACK", (s) => /latency/.test(s.reason)],
		["flag never reaches traffic → inconclusive, flag returned", { fault: "errors", stuck: true }, "INCONCLUSIVE", (s, w) => w.log.at(-1) === "set 0"],
		["thin traffic holds, then gives up at the cap", { fault: "none", requestsPerTraffic: 0.02 }, "STOPPED", (s) => /not enough traffic/.test(s.reason)],
	];
	let failed = 0;
	for (const [name, opts, expected, check] of cases) {
		const w = world(opts);
		let s, err;
		try {
			s = await rollout(w);
		} catch (e) {
			err = e;
		}
		const ok = !err && s.outcome === expected && check(s, w);
		if (!ok) failed++;
		console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${err ? err.message : `${s.outcome} — ${s.reason}`}`);
	}
	// An interrupted rollback: state says rollback, flag still on → the next tick sets it off again.
	{
		const w = world({ fault: "errors" });
		const s0 = { phase: "rollback", env: "local", steps: [], notified: [], baseline: { n: 300, errors: 0, avg_ms: 5 }, rollback_at: "2026-11-11T10:00:00Z", rollback_verdict: "test" };
		const s = await tick(s0, { contract, config: base, io: w.io });
		const ok = w.log[0] === "set 0" && s.outcome === "ROLLED_BACK";
		if (!ok) failed++;
		console.log(`${ok ? "ok  " : "FAIL"} interrupted rollback repeats the flag-off first: ${s.outcome}`);
	}
	// Policy never: a ROLLBACK verdict escalates without touching the flag.
	{
		const w = world({ fault: "errors" });
		const s = await rollout(w, { ...base, policies: { rollback: "never" } });
		const ok = s.outcome === "ESCALATE" && !w.log.slice(1).includes("set 0");
		if (!ok) failed++;
		console.log(`${ok ? "ok  " : "FAIL"} rollback policy never escalates without acting: ${s.outcome}`);
	}
	// Hold step (rules/hold.md): hold_after stops a passing rollout until a human decides; an unattended tick never moves it.
	{
		const holdConfig = { ...base, hold_after: 10 };
		const hold = async (rec) => {
			const w = world({ fault: "none" });
			if (rec) w.io.recommend = async () => rec;
			return { w, s: await rollout(w, holdConfig) };
		};
		const report = (name, ok, detail = "") => {
			if (!ok) failed++;
			console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
		};
		{
			const { w, s } = await hold();
			report("hold: stops at the hold step with the flag left there", s.phase === "hold" && s.hold.at === 10 && s.steps.length === 2 && w.log.at(-1) === "set 10" && s.hold.recommendation === "HUMAN", `${s.phase} at ${s.hold?.at}%`);
			const before = JSON.stringify(s);
			const calls = w.log.length;
			const again = await tick(s, { contract, config: holdConfig, io: w.io });
			report("hold: an unattended tick never advances", JSON.stringify(again) === before && w.log.length === calls);
			await w.io.sleep(120_000);
			let a = await tick(s, { contract, config: holdConfig, io: w.io, decision: { action: "approve", at: iso(w.io.now()), by: "octocat" } });
			const ev = signalEvents(s, a, { model: "m1" })[0];
			for (let i = 0; i < 50 && a.phase !== "done"; i++) a = await tick(a, { contract, config: holdConfig, io: w.io });
			report("hold: approve advances to the next step and the rollout passes", a.outcome === "PASS" && a.steps.length === 4 && a.hold.decision.seconds === 120 && w.log.at(-1) === "set 100", `${a.outcome}, approved after ${a.hold.decision.seconds} s`);
			report("hold: approve yields one approve signal event with time-to-approve", ev?.type === "approve" && ev.seconds === 120 && ev.model === "m1" && signalEvents(a, a, {}).length === 0);
		}
		{
			const { w, s } = await hold();
			const o = await tick(s, { contract, config: holdConfig, io: w.io, decision: { action: "override", at: iso(w.io.now()) } });
			report("hold: override returns the flag to off and ends OVERRIDDEN", o.outcome === "OVERRIDDEN" && w.log.at(-1) === "set 0" && signalEvents(s, o, {})[0]?.type === "override", o.outcome);
		}
		{
			const { s } = await hold({ recommendation: "AUTO", reason: "earned", risk_class: "ui" });
			report("hold: an AUTO recommendation is printed but still waits for a human", s.phase === "hold" && s.hold.recommendation === "AUTO" && /recommend: AUTO — earned \(risk class ui\); advisory only/.test(renderReport(s, contract, null)));
		}
		{
			const w = world({ fault: "errors" });
			const s = await rollout(w);
			report("hold: a rollback verdict yields a rollback signal event", signalEvents({ phase: "rollback" }, s, {})[0]?.type === "rollback" && s.outcome === "ROLLED_BACK");
		}
		{
			const { w, s } = await hold();
			const ticked = await tick(s, { contract: { ...contract, steps: [1, 10, 100] }, config: { ...holdConfig, steps: [1, 10, 100] }, io: w.io, decision: { action: "approve", at: iso(w.io.now()) } });
			report("hold: an approving tick that completes the rollout records only approve", ticked.outcome === "PASS" && JSON.stringify(signalEvents(s, ticked, {}).map((e) => e.type)) === '["approve"]', ticked.outcome);
			const rolled = { ...ticked, phase: "done", outcome: "ROLLED_BACK", rollback_verdict: "error rate", ended_at: "T" };
			report("hold: an approving tick that rolls back records approve, then rollback", JSON.stringify(signalEvents(s, rolled, {}).map((e) => e.type)) === '["approve","rollback"]');
		}
		report("hold: a contract whose steps skip hold_after stops before step 1", /hold_after: 10 is not a step/.test(checkHoldReachable({ ...contract, steps: [1, 25, 100] }, holdConfig) || "") && checkHoldReachable(contract, holdConfig) === null
			&& /hold_after: 10 is not a step/.test(checkHoldReachable(contract, { ...holdConfig, flags: { providers: [{ name: "sim", rollout: "boolean" }] } }) || "")
			&& validateContract({ ...contract, steps: [1, 25, 100] }, holdConfig) === null
			&& beforeStepOne(null) && beforeStepOne({ phase: "deploy" }) && beforeStepOne({ phase: "baseline" }) && !beforeStepOne({ phase: "step" }) && !beforeStepOne({ phase: "hold" })
			&& holdCheckDue({ phase: "baseline", lease: null }, 0) && !holdCheckDue({ phase: "baseline", lease: { holder: "x", until: "2099-01-01T00:00:00Z" } }, 0));
		report("hold: hold_after must be a step before the last", checkHoldAfter({ steps: [1, 10, 50, 100] }) === null && checkHoldAfter({ hold_after: 10 }) === null && /must be one of/.test(checkHoldAfter({ hold_after: 100 }) || "") && /must be one of/.test(checkHoldAfter({ hold_after: 5 }) || ""));
	}
	// Deploy detection: a later commit that contains the merge counts as live; an older one does not.
	{
		const detect = { attribute: "vercel.sha", equals: "merge_sha" };
		const contains = async (merge, live) => live === "later";
		const ok =
			(await isDeployed([{ live: "m", n: 9 }], detect, "m", contains)) &&
			(await isDeployed([{ live: "later", n: 9 }], detect, "m", contains)) &&
			!(await isDeployed([{ live: "older", n: 9 }], detect, "m", contains));
		if (!ok) failed++;
		console.log(`${ok ? "ok  " : "FAIL"} deploy detection accepts a later commit that contains the merge`);
	}
	// Release tags: a serving v2.0.N / 2.0.N resolves to a git ref; hex SHAs pass through; noise does not.
	{
		const detect = { attribute: "service.version", equals: "merge_sha" };
		const contains = async (merge, live, d) => releaseRefs(live, d?.tag_prefix).includes("v2.0.4541");
		const ok =
			JSON.stringify(releaseRefs("2.0.4541")) === '["v2.0.4541","2.0.4541"]' &&
			JSON.stringify(releaseRefs("v2.0.4541")) === '["v2.0.4541","2.0.4541"]' &&
			JSON.stringify(releaseRefs("2.0.4541", "rel-")) === '["rel-2.0.4541"]' &&
			JSON.stringify(releaseRefs("abc1234")) === '["abc1234"]' &&
			releaseRefs("dpl_xyz").length === 0 &&
			(await isDeployed([{ live: "2.0.4541", n: 9 }], detect, "m", contains)) &&
			(await isDeployed([{ live: "v2.0.4541", n: 9 }], detect, "m", contains)) &&
			!(await isDeployed([{ live: "dpl_xyz", n: 9 }], detect, "m", contains));
		if (!ok) failed++;
		console.log(`${ok ? "ok  " : "FAIL"} deploy detection resolves release tags to refs`);
	}
	// No flag: a contract needs a cohort only when a flag is set.
	{
		const nf = { service: "api", root_spans: ["GET /x"] };
		const ok = validateContract(nf, base) === null && /cohort/.test(validateContract({ ...nf, flag: { key: "f", provider: "sim" } }, base) || "");
		if (!ok) failed++;
		console.log(`${ok ? "ok  " : "FAIL"} contract requires cohort only with a flag`);
	}
	// Criteria on the PR (aw-verify's `intent` region), the visible-collapsed contract, and the draft contract.
	{
		const region = "<details><summary>📋 Acceptance criteria</summary>\n\n- AC-1 [ui:/settings] Saving shows a toast\n- AC-2 [api:PUT /api/x] 400 for an empty name\n- AC-3 [api:GET /api/y] lists views\n- G-1 [guardrail] Keep unchanged: the API shape\n\n</details>";
		const body = `Intro.\n\n<!-- verify:report -->\n\n<!-- verify:section=intent -->\n${region}\n<!-- /verify:section=intent -->\n\n<!-- /verify:report -->\n`;
		const got = parseCriteria(body);
		const lines = criteriaLines(got, { root_spans: ["PUT /api/x"] }).join("\n");
		const fromComment = parseCriteria("No report here.", [{ body: body.slice(body.indexOf("<!-- verify:report -->")), trusted: true }]);
		const untrusted = parseCriteria("", [{ body: body.slice(body.indexOf("<!-- verify:report -->")), trusted: false }]);
		const wrapped = `<!-- deployment-verify:v1 -->\n<details><summary>🚦 Deployment contract</summary>\n\n\`\`\`json\n{"service":"api","root_spans":["GET /x"]}\n\`\`\`\n\n</details>\n<!-- /deployment-verify:v1 -->`;
		const living = parseCriteria("<!-- verify:report -->\n<!-- verify:section=intent -->\n<details><summary>x</summary>\n\n- ✅ 🚀 AC-1 [api:GET /a] one\n- ❌ AC-2 [api:GET /b] two\n- ⬜ AC-3 [ui:/c] three\n- G-1 [guardrail] g\n\n</details>\n<!-- /verify:section=intent -->");
		const pm = prodMarks(living, { root_spans: ["GET /a", "GET /b"] });
		const okLiving = living.length === 4 && living[0].status === "✅" && living[0].prod && living[1].status === "❌" && !living[1].prod && living[2].status === "⬜" && living[3].status === null
			&& JSON.stringify(pm) === '{"AC-2":{"prod":true}}' && /🚀 ✅ AC-1 api GET \/a/.test(criteriaLines(living, { root_spans: ["GET /a"] }).join("\n"));
		if (!okLiving) failed++;
		console.log(`${okLiving ? "ok  " : "FAIL"} status and 🚀 marks parse, show in the report, and only unmarked watched criteria get 🚀`);
		const ok = got.length === 4 && got[1].kind === "api" && got[1].target === "PUT /api/x" && fromComment.length === 4 && untrusted.length === 0
			&& /AC-2 api PUT \/api\/x — watched/.test(lines) && /AC-3 api GET \/api\/y — not watched/.test(lines) && /AC-1 ui \/settings — browser-proven/.test(lines) && /G-1 guardrail — guardrail/.test(lines)
			&& criteriaLines([], {})[0].startsWith("criteria: none") && criteriaLines(null, {}).length === 0
			&& parseContract(wrapped).contract?.service === "api" && parseContract(wrapped.replace(/<details>.*?<\/summary>\n\n/s, "").replace("\n\n</details>", "")).contract?.service === "api"
			&& JSON.stringify(draftContract(got).root_spans) === '["PUT /api/x","GET /api/y"]';
		if (!ok) failed++;
		console.log(`${ok ? "ok  " : "FAIL"} criteria are read from the PR (body, trusted comment), marked watched or not, and drafted into a contract`);
	}
	// A start marker whose block does not match says "malformed", never "no contract"; an absent block still says "no contract".
	{
		const json = '```json\n{"service":"api","root_spans":["GET /x"]}\n```';
		const prose = `<!-- deployment-verify:v1 -->\n<details><summary>🚦 Deployment contract</summary>\n\n${json}\n\nWhy this threshold: the path is hot.\n\n</details>\n<!-- /deployment-verify:v1 -->`;
		const twoFences = `<!-- deployment-verify:v1 -->\n${json}\n${json}\n<!-- /deployment-verify:v1 -->`;
		const malformed = "contract block malformed: only one ```json fence may sit between the markers";
		const ok = parseContract(prose).error === malformed && parseContract(twoFences).error === malformed
			&& parseContract("No block here.").error?.startsWith("no contract") && parseContract("").error?.startsWith("no contract")
			&& parseContract("Add a `<!-- deployment-verify:v1 -->` block before the merge.").error?.startsWith("no contract")
			&& parseContract(`<!-- deployment-verify:v1 -->\n${json}\n<!-- /deployment-verify:v1 -->`).contract?.service === "api";
		if (!ok) failed++;
		console.log(`${ok ? "ok  " : "FAIL"} a block with prose or a second fence between the markers is "malformed", a missing one "no contract"`);
	}
	// --draft-contract --from-plan: criteria from the brief, flag.key only when the brief names exactly one flag.
	{
		const plan = (req, guard = "- Keep the API shape.") => `# Plan\n\n## Task\n\nx\n\n## Requirements\n\n${req}\n\n## Guardrails\n\n${guard}\n\n## Acceptance Criteria\n\n- [ ] AC-1 (covers: R1) [api:PUT /api/x] — 400 for an empty name.\n- [ ] AC-2 [ui:/settings] — a toast.\n\n## Notes\n\nThe \`legacyMode\` flag is unrelated.\n`;
		const one = plan("- R1: Ship it behind the `checkoutV2` feature flag.", "- Never flip flag `checkoutV2` in production by hand.");
		const none = plan("- R1: Validate the name. Do not edit `src/flags/registry.ts`.");
		const two = plan("- R1: Behind the `checkoutV2` flag.\n- R2: Add the `legacyCart` feature flag.");
		const guardOnly = plan("- R1: Validate the name.", "- Keep the `legacyCart` feature flag on.\n- Ship only behind the `newCart` flag.");
		const ok1 = JSON.stringify(planFlags(one)) === '["checkoutV2"]' && planFlags(none).length === 0 && JSON.stringify(planFlags(two)) === '["checkoutV2","legacyCart"]' && JSON.stringify(planFlags(guardOnly)) === '["newCart"]'
			&& JSON.stringify(planFlags("## Requirements\n\n- feature flag: `a-b_c`\n- `x.y` feature flag\n- the feature flag `src/a.ts`\n- Set the `archived` flag on the record.\n- Keep the admin page behind `requireAuth`.\n- flag key `k2`")) === '["a-b_c","k2"]';
		const crit = await planCriteriaOf(one);
		const flagged = draftContract(crit, { flagKey: "checkoutV2" });
		const ok2 = JSON.stringify(flagged.root_spans) === '["PUT /api/x"]' && flagged.flag?.key === "checkoutV2" && flagged.reversibility === "flag" && flagged.cohort?.on === "root"
			&& draftContract(crit).flag === undefined && draftContract(crit).reversibility === "redeploy";
		const dir = mkdtempSync(join(tmpdir(), "dv-plan-"));
		const cli = (md) => { writeFileSync(join(dir, "plan.md"), md); return spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--draft-contract", "--from-plan", join(dir, "plan.md")], { cwd: dir, encoding: "utf8" }); };
		const r1 = cli(one), r0 = cli(none), r2 = cli(two);
		const ok3 = r1.status === 0 && JSON.parse(r1.stdout).flag?.key === "checkoutV2" && /flag: checkoutV2 \(named in the brief\)/.test(r1.stderr)
			&& r0.status === 0 && JSON.parse(r0.stdout).flag === undefined && /flag: none named/.test(r0.stderr)
			&& r2.status === 0 && JSON.parse(r2.stdout).flag === undefined && /flag: 2 named in the brief \(checkoutV2, legacyCart\)/.test(r2.stderr);
		const ok = ok1 && ok2 && ok3;
		if (!ok) failed++;
		console.log(`${ok ? "ok  " : "FAIL"} --draft-contract --from-plan drafts from the brief and prefills flag.key only for exactly one named flag${ok ? "" : ` (${ok1},${ok2},${ok3} ${r1.stderr}${r0.stderr})`}`);
	}
	// A flag named only in the acceptance criteria (the real #29652 brief), and a guardrail that leaves a flag alone.
	{
		const real = readFileSync(new URL("./fixtures/plan-ac-flag.md", import.meta.url), "utf8");
		const ac = (lines) => `## Acceptance Criteria\n\n${lines}\n`;
		const checks = [
			["the real brief's AC-5/AC-6 name enableAutomationProposeFlow once", JSON.stringify(planFlags(real)) === '["enableAutomationProposeFlow"]', planFlags(real)],
			["a guardrail that leaves the code behind a flag untouched names no flag", planFlags("## Guardrails\n\n- Leave the code behind the `legacyCart` flag untouched.\n").length === 0],
			["a guardrail that ships behind a flag still names it", JSON.stringify(planFlags("## Guardrails\n\n- Ship only behind the `newCart` flag.\n")) === '["newCart"]'],
			["AC shapes: flag.key is, `k` flag on/off, flag `k`", JSON.stringify(planFlags(ac("- [ ] AC-1 — `flag.key` is `a1`.\n- [ ] AC-2 — with the `b2` flag off, nothing renders.\n- [ ] AC-3 — with flag `c3` on, it renders."))) === '["a1","b2","c3"]'],
			["'flag' used as a verb names no flag", planFlags(ac("- [ ] AC-1 — The linter shall flag `any` usages.")).length === 0],
			["an AC that reads a key on a line with no 'flag' names none", planFlags(ac("- [ ] AC-1 — The page shall read `userId` from the session.")).length === 0],
			["a non-AC section is still not scanned", planFlags("## Notes\n\n- `flag.key` is `zz`.\n").length === 0],
		];
		const dir = mkdtempSync(join(tmpdir(), "dv-plan-"));
		writeFileSync(join(dir, "plan.md"), real);
		const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--draft-contract", "--from-plan", join(dir, "plan.md")], { cwd: dir, encoding: "utf8" });
		checks.push(["the CLI prefills the real brief's flag", r.status === 0 && JSON.parse(r.stdout).flag?.key === "enableAutomationProposeFlow", r.stderr]);
		for (const [name, ok, detail] of checks) {
			if (!ok) failed++;
			console.log(`${ok ? "ok  " : "FAIL"} --from-plan flags: ${name}${ok ? "" : ` (${JSON.stringify(detail ?? "")})`}`);
		}
	}
	// No flag, before/after: old versions serve before the deploy, the new version after. Version filter splits them.
	async function noFlagWorld({ afterErrorRate = 0, afterMs = 5, beforeN = 300 }) {
		let clock = Date.parse("2026-11-11T10:00:00Z");
		const deployAt = clock;
		const queries = [];
		const io = {
			now: () => clock,
			sleep: async (ms) => void (clock += ms),
			setFlag: async () => assertNever(),
			sendTraffic: async () => {},
			platformRollback: async () => false,
			contains: async () => true,
			sql: async (query, { from, to }) => {
				queries.push(query);
				if (/GROUP BY live/.test(query)) return [{ live: "v2.0.9", n: 50 }];
				const a = Date.parse(from), b = Date.parse(to);
				const after = / IN \('v2.0.9'\)/.test(query);
				const before = /NOT IN \('v2.0.9'\)/.test(query);
				if (before) return b <= deployAt ? [{ n: beforeN, errors: 0, avg_ms: 5 }] : [{ n: 0, errors: 0, avg_ms: 0 }];
				if (after) return a >= deployAt ? [{ n: 200, errors: Math.round(200 * afterErrorRate), avg_ms: afterMs }] : [{ n: 0, errors: 0, avg_ms: 0 }];
				return [{ n: 200, errors: 0, avg_ms: 5 }];
			},
			log: () => {},
		};
		return { io, queries };
	}
	function assertNever() {
		throw new Error("setFlag called for a no-flag contract");
	}
	const nfConfig = { ...base, environment: { dataset: "x", deploy: { detect: { attribute: "service.version", equals: "merge_sha" } }, ingest_wait_seconds: 0 }, steps: [100] };
	const nfContract = { service: "api", root_spans: ["GET /x"] };
	for (const [name, opts, expected, check] of [
		["no flag: healthy rollout passes on before/after", {}, "PASS", (s) => s.baseline.n === 300 && s.steps.length === 1 && s.live_values[0] === "v2.0.9"],
		["no flag: regression escalates, never touches a flag", { afterErrorRate: 0.3 }, "ESCALATE", (s) => /rollback needs a human/.test(s.reason)],
		["no flag: no traffic before the deploy stops, not passes", { beforeN: 3 }, "STOPPED", (s) => /before the deploy/.test(s.reason)],
	]) {
		const w = await noFlagWorld(opts);
		let s = null, err;
		try {
			for (let i = 0; i < 50 && s?.phase !== "done"; i++) {
				s = await tick(s, { contract: nfContract, config: nfConfig, sha: "m", mergedAt: "2026-11-11T09:00:00Z", io: w.io });
				await w.io.sleep(60_000); // real traffic: the window closes as time passes
			}
		} catch (e) {
			err = e;
		}
		const ok = !err && s.outcome === expected && check(s);
		if (!ok) failed++;
		console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${err ? err.message : `${s.outcome} — ${s.reason}`}`);
	}
	const total = 36;
	console.log(failed ? `${failed}/${total} failed` : `${total}/${total} passed`);
	process.exit(failed ? 1 : 0);
}

// ─────────────────────────────── cli ──────────────────────────────

// --draft-contract: criteria from the PR's intent region, else from --from-plan's brief; flag.key from the brief.
async function draftCommand(a) {
	const planPath = typeof a["from-plan"] === "string" ? a["from-plan"] : null;
	if (a["from-plan"] && !planPath) throw new Error("--from-plan needs a path to plan.md");
	if (!a.pr && !planPath) throw new Error("--draft-contract needs --pr <n> or --from-plan <plan.md>");
	let criteria = [];
	if (a.pr && a.pr !== true) {
		const pr = JSON.parse(gh(["pr", "view", String(a.pr), "--json", "body,mergedAt"]));
		if (pr.mergedAt) throw new Error("the PR is merged: a contract written now is chosen after the numbers; start a new rollout instead");
		const comments = JSON.parse(gh(["api", `repos/{owner}/{repo}/issues/${a.pr}/comments`, "--paginate", "--jq", "[.[] | {body, trusted: ((.author_association | IN(\"OWNER\", \"MEMBER\", \"COLLABORATOR\")) or .user.type == \"Bot\")}]"]).replace(/\]\s*\[/g, ","));
		criteria = parseCriteria(pr.body, [...comments].reverse());
	}
	const planMd = planPath ? readFileSync(planPath, "utf8") : null;
	if (!criteria.length && planMd) criteria = await planCriteriaOf(planMd);
	if (!criteria.length) throw new Error(planMd ? "no criteria on the PR or in the brief" : "no criteria on the PR — run /aw-verify first, or pass --from-plan <plan.md>");
	const flags = planMd ? planFlags(planMd) : [];
	console.log(JSON.stringify(draftContract(criteria, { flagKey: flags.length === 1 ? flags[0] : null }), null, 2));
	if (!planMd) console.error("flag: not read (no --from-plan) — add flag and cohort if the change ships behind one");
	else if (flags.length === 1) console.error(`flag: ${flags[0]} (named in the brief) — fill flag.provider and cohort`);
	else if (!flags.length) console.error("flag: none named in the brief's Requirements, Acceptance Criteria, or Guardrails — left out; add flag and cohort if the change ships behind one");
	else console.error(`flag: ${flags.length} named in the brief (${flags.join(", ")}) — left out; add the one this change ships behind`);
}

function args(argv) {
	const out = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (!a.startsWith("--")) continue;
		const next = argv[i + 1];
		if (next === undefined || next.startsWith("--")) out[a.slice(2)] = true;
		else out[a.slice(2)] = argv[++i];
	}
	return out;
}

async function main() {
	const a = args(process.argv.slice(2));
	if (a["self-test"]) return selfTest();
	// Drafting reads no release.yml: it runs before the config loads, so a repo not yet set up can draft.
	if (a["draft-contract"]) return draftCommand(a);
	const slug = (() => {
		try {
			return execFileSync("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
		} catch {
			return null;
		}
	})();
	const defaultEnv = a.env && a.env !== true ? a.env : "production";
	const config = loadConfig(defaultEnv, { slug });
	// A contract's own `env` picks its release.yml environment unless --env was passed explicitly.
	const configs = new Map([[defaultEnv, config]]);
	const configFor = (contract) => {
		const name = (!a.env && contract?.env) || defaultEnv;
		if (!configs.has(name)) configs.set(name, loadConfig(name, { slug }));
		return configs.get(name);
	};
	if (a["check-config"]) {
		console.log(`release.yml ok: environment ${config.env}, ${config.flags?.providers?.length || 0} provider(s), steps ${JSON.stringify(config.steps)}${config.hold_after !== undefined ? `, hold after ${config.hold_after}%` : ""}${config.promotion ? ", promotion rule set" : ""}`);
		return;
	}
	let decision = null;
	if (a.approve || a.override) {
		if (a.approve && a.override) throw new Error("pass --approve or --override, not both");
		if (a.all) throw new Error("a hold decision names one rollout: --pr <n> or --local, never --all");
		if (a.unattended || existsSync("/tmp/workspace/agent-skills/env.sh")) throw new Error("a hold decision is a human's: refused in an unattended run");
		const by = (() => {
			try {
				return execFileSync("gh", ["api", "user", "--jq", ".login"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
			} catch {
				return null;
			}
		})();
		decision = { action: a.approve ? "approve" : "override", at: iso(Date.now()), by };
	}
	const exitFor = (s) => (JUST_HELD.has(s) || (s.phase === "done" && EXCEPTION_OUTCOMES.includes(s.outcome)) ? 3 : 0);
	let worst = 0;
	if (a.local) {
		const contract = JSON.parse(readFileSync(a.contract, "utf8"));
		const cfg = configFor(contract);
		const local = localStore(a.local);
		const err = validateContract(contract, cfg) || (holdCheckDue(local.read()) ? checkHoldReachable(contract, cfg) : null);
		if (err) throw new Error(err);
		const s = await runOne({ store: local, contract, config: cfg, deployedAt: a["deployed-at"], loop: !!a.run, decision, slug });
		console.log(renderReport(s, contract, null).split("\n").slice(2, -2).join("\n"));
		return process.exit(exitFor(s));
	}
	const numbers = a.all
		? JSON.parse(gh(["pr", "list", "--state", "merged", "--label", LABEL, "--json", "number", "--limit", "100"])).map((p) => p.number)
		: [a.pr];
	for (const n of numbers) {
		try {
			const store = prStore(n);
			if (!store.pr.mergedAt) {
				store.finish();
				console.error(`#${n}: closed without merge — nothing deployed`);
				continue;
			}
			const { contract, error } = parseContract(store.pr.body);
			let cfg = config;
			let invalid = error;
			if (!invalid) {
				try {
					cfg = configFor(contract);
				} catch (e) {
					invalid = e.message;
				}
			}
			invalid ||= validateContract(contract, cfg) || (holdCheckDue(store.read()) ? checkHoldReachable(contract, cfg) : null);
			if (invalid) {
				const s = { phase: "done", outcome: "STOPPED", reason: invalid, env: cfg.env, steps: [] };
				store.write(renderReport(s, contract || {}, store.pr));
				store.finish();
				continue;
			}
			const s = await runOne({ store, contract, config: cfg, sha: store.pr.mergeCommit?.oid, mergedAt: store.pr.mergedAt, deployedAt: a["deployed-at"], loop: !!a.run, decision, slug });
			if (exitFor(s) === 3) worst = Math.max(worst, 3);
		} catch (e) {
			console.error(`#${n}: ${e.message}`);
			worst = Math.max(worst, 1);
		}
	}
	process.exit(worst);
}

const self = (() => {
	try {
		return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
	} catch {
		return false;
	}
})();
if (self) main().catch((e) => {
	console.error(`tick.mjs: ${e.message}`);
	process.exit(1);
});
