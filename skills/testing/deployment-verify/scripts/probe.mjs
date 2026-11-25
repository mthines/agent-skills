#!/usr/bin/env node
// deployment-verify synthetic probes: the same tagged requests before and after a no-flag deploy,
// timed by the client, summarised per route. tick.mjs drives it; rules/probes.md is its specification.
//
//   node probe.mjs --check [--env <name>]      validate .agents/aw/probes.yml (+ the identities it names) and exit
//   node probe.mjs --run <probe> [--env <name>] run one window now and print its per-route stats as JSON
//   node probe.mjs --self-test                 simulated requests, no network
//
// Zero dependencies. A token is read from the environment or minted by a command, held in memory and in a
// 0600 cache file outside the repo, and never written to a report, the state, or a log line.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, chmodSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseYaml } from "./yaml-lite.mjs";

export const KINDS = ["http", "mcp", "command"];
const DEFAULTS = { warmup: { requests: 3, discard: true }, budget: { max_rpm: 60 }, rounds: 20, mcp_path: "" };
// A value that is a credential, not the name of one: a bearer string or a known token prefix.
const SECRET_RE = /^\s*(?:bearer|basic)\s+\S{8,}|\b(?:lk_(?:rw|ro|wo)_|sk_(?:live|test)_|ghp_|gho_|xox[bp]-|eyJ)[A-Za-z0-9._-]{8,}/i;

export class ProbeAuthError extends Error {}

// ─────────────────────────────── config ──────────────────────────────

export function loadProbes(cwd = process.cwd()) {
	const path = join(cwd, ".agents", "aw", "probes.yml");
	return existsSync(path) ? parseYaml(readFileSync(path, "utf8")) : null;
}

export function loadEnvironments(cwd = process.cwd()) {
	const path = join(cwd, ".agents", "aw", "environments.yml");
	return existsSync(path) ? parseYaml(readFileSync(path, "utf8")) : null;
}

function walkStrings(node, at, out) {
	if (typeof node === "string") out.push([at, node]);
	else if (Array.isArray(node)) node.forEach((v, i) => walkStrings(v, `${at}[${i}]`, out));
	else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) walkStrings(v, at ? `${at}.${k}` : k, out);
	return out;
}

// Every problem in probes.yml, one line each; [] when it is valid. Names the path so the fix is obvious.
export function validateProbes(cfg) {
	const problems = [];
	if (!cfg || typeof cfg !== "object") return ["probes.yml is empty or not a map"];
	if (cfg.version !== 1) problems.push("version: must be 1");
	const probes = cfg.probes;
	if (!probes || typeof probes !== "object" || !Object.keys(probes).length) problems.push("probes: needs at least one probe");
	for (const [name, p] of Object.entries(probes || {})) {
		if (!Array.isArray(p?.covers) || !p.covers.length) problems.push(`probes.${name}.covers: list the contract root_spans this probe exercises`);
		if (!Array.isArray(p?.requests) || !p.requests.length) problems.push(`probes.${name}.requests: needs at least one request`);
		for (const [i, r] of (p?.requests || []).entries()) {
			const at = `probes.${name}.requests[${i}]`;
			const kinds = KINDS.filter((k) => r && r[k]);
			const kind = kinds[0];
			if (!kind) problems.push(`${at}: unknown request kind — use one of ${KINDS.join(", ")}`);
			if (kinds.length > 1) problems.push(`${at}: one request kind only — found ${kinds.join(" and ")}`);
			if (!r?.name) problems.push(`${at}.name: required`);
			if (!r?.route) problems.push(`${at}.route: required — the http.route its span reports, so it is compared per route`);
			if (kind === "http" && !r.http.path) problems.push(`${at}.http.path: required`);
			if (kind === "mcp" && !r.mcp.tool) problems.push(`${at}.mcp.tool: required`);
			if (kind === "command" && !r.command.run) problems.push(`${at}.command.run: required`);
		}
	}
	const d = cfg.defaults || {};
	if (d.budget?.max_rpm !== undefined && !(Number(d.budget.max_rpm) > 0)) problems.push("defaults.budget.max_rpm: must be a positive number");
	if (d.history !== undefined && d.history !== "issue") problems.push("defaults.history: only `issue` is supported, or leave it out");
	if (d.rounds !== undefined &&!(Number.isInteger(Number(d.rounds)) && Number(d.rounds) > 0)) problems.push("defaults.rounds: must be a positive integer");
	for (const [at, v] of walkStrings(cfg, "", [])) {
		if (SECRET_RE.test(v)) problems.push(`${at}: looks like a credential — name an env var in environments.yml (auth.identities.<role>.token.env) instead`);
	}
	return problems;
}

// The identity a probe sends as: environments.yml → environments.<env>.auth.identities.<role>, strategy bearer.
export function identityFor(environments, env, role) {
	const auth = environments?.environments?.[env]?.auth;
	const id = auth?.identities?.[role];
	if (!id) throw new Error(`environments.yml has no environments.${env}.auth.identities.${role}`);
	if (id.strategy !== "bearer") throw new Error(`identity ${role}: strategy must be bearer for a probe`);
	if (!id.token?.env && !id.token?.command) throw new Error(`identity ${role}: token needs env or command`);
	if (typeof id.token === "string" || SECRET_RE.test(JSON.stringify(id.token))) throw new Error(`identity ${role}: token must name an env var or a command, never a value`);
	return { role, header: id.header || "Authorization", token: id.token, check: id.check || null, bypass: auth.bypass_header || null };
}

// The probes whose `covers` names one of the contract's root spans.
export function probesFor(cfg, rootSpans) {
	const want = new Set(rootSpans || []);
	return Object.entries(cfg?.probes || {}).filter(([, p]) => (p.covers || []).some((s) => want.has(s))).map(([name, probe]) => ({ name, probe }));
}

// ─────────────────────────────── auth ──────────────────────────────

const cacheFile = (role, cwd) => join(tmpdir(), `deployment-verify-${createHash("sha256").update(`${cwd}\0${role}`).digest("hex").slice(0, 16)}.json`);

// The token: from an env var, or minted by a command (stdout) and cached until ttl_seconds. Never logged.
export function makeTokenSource(identity, { env = process.env, exec = shOut, now = Date.now, cwd = process.cwd(), cache = true } = {}) {
	let held = null;
	const file = cacheFile(identity.role, cwd);
	return {
		async get({ fresh = false } = {}) {
			if (identity.token.env) {
				const v = env[identity.token.env];
				if (!v) throw new ProbeAuthError(`identity ${identity.role}: env ${identity.token.env} is not set`);
				return v;
			}
			if (!fresh && held && held.expires_at > now()) return held.token;
			if (!fresh && cache && existsSync(file)) {
				try {
					const c = JSON.parse(readFileSync(file, "utf8"));
					if (c.expires_at > now()) return (held = c).token;
				} catch {}
			}
			let token;
			try {
				token = String(exec(identity.token.command)).trim();
			} catch {
				throw new ProbeAuthError(`identity ${identity.role}: token command failed`);
			}
			if (!token) throw new ProbeAuthError(`identity ${identity.role}: token command printed nothing`);
			held = { token, expires_at: now() + (Number(identity.token.ttl_seconds) || 3000) * 1000 };
			if (cache) {
				writeFileSync(file, JSON.stringify(held), { mode: 0o600 });
				chmodSync(file, 0o600);
			}
			return token;
		},
		canRefresh: Boolean(identity.token.command),
	};
}

export function redact(text, secrets) {
	let out = String(text);
	for (const s of secrets) if (s && s.length >= 4) out = out.split(s).join("«redacted»");
	return out;
}

// ─────────────────────────────── run ──────────────────────────────

const fill = (v, vars) => (typeof v === "string" ? v.replace(/\{fixture\.(\w+)\}/g, (_, k) => (vars[k] === undefined ? `{fixture.${k}}` : String(vars[k]))) : v && typeof v === "object" ? JSON.parse(fill(JSON.stringify(v), vars)) : v);

function jsonPathHas(obj, path) {
	if (!path) return true;
	let cur = obj;
	for (const part of String(path).replace(/^\$\.?/, "").split(".").filter(Boolean)) {
		if (cur == null || !(part in Object(cur))) return false;
		cur = cur[part];
	}
	return cur !== undefined;
}

// One request → { ok, auth, ms }. `send` does the I/O and returns { status, ms, json, exit }.
async function one(req, { send, headers, vars, base }) {
	const kind = KINDS.find((k) => req[k]);
	const spec = fill(req[kind], vars);
	const res = await send({ kind, spec, headers, base });
	if (kind !== "command" && (res.status === 401 || res.status === 403)) return { ok: false, auth: true, ms: res.ms };
	const e = req.expect || {};
	let ok;
	if (kind === "command") ok = res.exit === 0;
	else if (kind === "mcp") ok = res.status >= 200 && res.status < 300 && Boolean(res.json?.result) && Boolean(res.json.result.isError) === Boolean(e.isError);
	else ok = (e.status !== undefined ? res.status === Number(e.status) : res.status >= 200 && res.status < 300) && jsonPathHas(res.json, e.json);
	return { ok, auth: false, ms: res.ms };
}

export function percentile(sorted, p) {
	if (!sorted.length) return 0;
	return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

export function summarize(samples) {
	const by = {};
	for (const s of samples) (by[s.route] ||= []).push(s);
	return Object.fromEntries(Object.entries(by).map(([route, xs]) => {
		const ms = xs.map((x) => x.ms).sort((a, b) => a - b);
		const avg = ms.reduce((a, b) => a + b, 0) / ms.length;
		return [route, { n: xs.length, errors: xs.filter((x) => !x.ok).length, p50: Math.round(percentile(ms, 50)), p95: Math.round(percentile(ms, 95)), avg_ms: Math.round(avg * 10) / 10 }];
	}));
}

// Run one window of one probe: preflight, warm-up (discarded), then `rounds` passes over its requests,
// paced under budget.max_rpm. Returns { routes, sent, discarded }. An auth failure throws ProbeAuthError,
// never a sample: a 401 is not the change's error, and must never become a ROLLBACK.
export async function runProbe({ probe, defaults = {}, identity = null, tokens = null, send, sleep, vars = {}, base = {} }) {
	const d = { ...DEFAULTS, ...defaults, warmup: { ...DEFAULTS.warmup, ...(defaults.warmup || {}) }, budget: { ...DEFAULTS.budget, ...(defaults.budget || {}) } };
	const gap = 60_000 / Number(d.budget.max_rpm);
	const tagHeaders = d.tag?.header || {};
	let token = identity && tokens ? await tokens.get() : null;
	const headersFor = () => ({ ...tagHeaders, ...(identity && token ? { [identity.header]: identity.header.toLowerCase() === "authorization" ? `Bearer ${token}` : token } : {}), ...(base.bypass || {}) });

	if (identity?.check) {
		let r = await one({ ...identity.check, route: "check" }, { send, headers: headersFor(), vars, base });
		if (r.auth && tokens.canRefresh) {
			token = await tokens.get({ fresh: true });
			r = await one({ ...identity.check, route: "check" }, { send, headers: headersFor(), vars, base });
		}
		if (r.auth) throw new ProbeAuthError(`identity ${identity.role}: preflight check refused (401/403) after ${tokens.canRefresh ? "one refresh" : "no refresh possible"}`);
	}

	const samples = [];
	let discarded = 0;
	let sent = 0;
	const pass = async (keep) => {
		for (const req of probe.requests) {
			const r = await one(req, { send, headers: headersFor(), vars, base });
			sent++;
			if (r.auth) throw new ProbeAuthError(`identity ${identity?.role || "none"}: request ${req.name} refused (401/403)`);
			if (keep) samples.push({ route: req.route, ok: r.ok, ms: r.ms });
			else discarded++;
			await sleep(gap);
		}
	};
	const warm = d.warmup.discard === false ? 0 : Number(d.warmup.requests) || 0;
	for (let i = 0; i < warm; i++) await pass(false);
	for (let i = 0; i < Number(d.rounds); i++) await pass(true);
	return { routes: summarize(samples), samples, sent, discarded };
}

// Real I/O: fetch for http and mcp (JSON-RPC tools/call, JSON or SSE reply), sh for command.
function shOut(cmd) {
	const r = spawnSync("sh", ["-c", cmd], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	if (r.status !== 0) throw new Error(`command failed (${r.status})`);
	return r.stdout;
}

export async function realSend({ kind, spec, headers, base }) {
	const t0 = performance.now();
	if (kind === "command") {
		const r = spawnSync("sh", ["-c", spec.run], { encoding: "utf8", stdio: ["ignore", "ignore", "ignore"] });
		return { exit: r.status, ms: performance.now() - t0 };
	}
	const isMcp = kind === "mcp";
	const url = isMcp ? base.mcp_url : `${base.url.replace(/\/$/, "")}${spec.path}`;
	const body = isMcp ? JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: spec.tool, arguments: spec.args || {} } }) : spec.body === undefined ? undefined : typeof spec.body === "string" ? spec.body : JSON.stringify(spec.body);
	const res = await fetch(url, {
		method: isMcp ? "POST" : spec.method || "GET",
		headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(isMcp ? { Accept: "application/json, text/event-stream" } : {}), ...(spec.headers || {}), ...headers },
		body,
	});
	const text = await res.text();
	const ms = performance.now() - t0;
	let json = null;
	try {
		const data = text.trim().startsWith("{") ? text : text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5)).pop();
		json = data ? JSON.parse(data) : null;
	} catch {}
	return { status: res.status, ms, json };
}

// Fixtures: an idempotent setup command whose stdout is a JSON object of {fixture.<key>} values.
export function runFixtures(probe, exec = shOut) {
	if (!probe.fixtures?.setup) return {};
	const out = String(exec(probe.fixtures.setup)).trim();
	if (!out) return {};
	try {
		return JSON.parse(out);
	} catch {
		throw new Error("fixtures.setup must print a JSON object (or nothing)");
	}
}

// Everything tick.mjs needs for one environment, or null when the repo has no probes.yml.
export function probeRunner({ env, rootSpans, only = null, cwd = process.cwd(), send = realSend, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
	const cfg = loadProbes(cwd);
	if (!cfg) return null;
	const problems = validateProbes(cfg);
	if (problems.length) throw new Error(`probes.yml: ${problems[0]}${problems.length > 1 ? ` (+${problems.length - 1} more)` : ""}`);
	const picked = probesFor(cfg, rootSpans).filter((p) => !only || p.name === only);
	if (!picked.length) return null;
	const environments = loadEnvironments(cwd);
	const e = environments?.environments?.[env];
	if (!e?.url) throw new Error(`environments.yml has no environments.${env}.url for the probes`);
	const defaults = cfg.defaults || {};
	const identity = defaults.identity ? identityFor(environments, env, defaults.identity) : null;
	const tokens = identity ? makeTokenSource(identity, { cwd }) : null;
	const bypass = identity?.bypass?.env && process.env[identity.bypass.env] ? { [identity.bypass.name]: process.env[identity.bypass.env] } : {};
	const base = { url: e.url, mcp_url: e.mcp_url || `${e.url.replace(/\/$/, "")}${defaults.mcp_path || DEFAULTS.mcp_path}`, bypass };
	return {
		names: picked.map((p) => p.name),
		spanFilter: defaults.tag?.span_filter || null,
		history: defaults.history || null,
		async run() {
			// Pool every probe's samples, then summarize once: two probes on one route are one route.
			const samples = [];
			let sent = 0;
			for (const { probe } of picked) {
				const vars = runFixtures(probe);
				const r = await runProbe({ probe, defaults, identity, tokens, send, sleep, vars, base });
				samples.push(...r.samples);
				sent += r.sent;
			}
			return { routes: summarize(samples), sent };
		},
	};
}

// A probes.yml draft for review: one probe covering the contract's root spans, one request per `api:` criterion
// (`api:GET /memories` → GET /memories, route /memories). A human fills ids, bodies and expectations.
export function draftProbes(contract, criteria = []) {
	const reqs = criteria.filter((c) => c.kind === "api" && c.target).map((c) => {
		const [method, path] = /^[A-Z]+\s/.test(c.target) ? [c.target.split(/\s+/)[0], c.target.split(/\s+/).slice(1).join(" ")] : ["GET", c.target];
		return { id: c.id, method, path };
	});
	const lines = [
		"# Draft from the contract's root_spans and the PR's api: criteria — review before committing (rules/probes.md).",
		"version: 1",
		"defaults:",
		"  identity: probe          # environments.yml → environments.<env>.auth.identities.probe (strategy: bearer)",
		"  tag:",
		"    header: { X-Deployment-Verify: probe }",
		"  warmup: { requests: 3, discard: true }",
		"  budget: { max_rpm: 60 }",
		"  rounds: 20               # per-route n = rounds; keep it >= thresholds.min_test_requests",
		"  # history: issue         # keep results per version on one GitHub issue, for runs that start after the deploy",
		"probes:",
		"  main:",
		`    covers: [${(contract.root_spans || []).map((s) => JSON.stringify(s)).join(", ")}]`,
		"    requests:",
		...(reqs.length
			? reqs.flatMap((r) => [`      - name: ${r.id.toLowerCase()}`, `        http: { method: ${r.method}, path: ${JSON.stringify(r.path)} }`, `        route: ${JSON.stringify(r.path)}   # the http.route its span reports`, "        expect: { status: 200 }"])
			: ["      # no api: criterion on the PR — add one request per route this change serves"]),
	];
	return lines.join("\n") + "\n";
}

// ──────────────────────────── self-test ───────────────────────────

async function selfTest() {
	let failed = 0, total = 0;
	const check = (name, ok, detail = "") => {
		total++;
		if (!ok) failed++;
		console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
	};
	const valid = {
		version: 1,
		defaults: { identity: "probe", tag: { header: { "X-Env": "test" }, span_filter: { "deployment.environment.name": "test" } }, warmup: { requests: 2 }, budget: { max_rpm: 600 }, rounds: 5 },
		probes: { read: { covers: ["api.root"], requests: [{ name: "list", http: { method: "GET", path: "/list" }, route: "/list" }, { name: "get", http: { path: "/x/{fixture.id}" }, route: "/x/:id", expect: { status: 200, json: "$.key" } }] } },
	};
	check("AC-1 a valid probes.yml has no problems", validateProbes(valid).length === 0, validateProbes(valid).join("; "));
	const bad = (mut) => {
		const c = structuredClone(valid);
		mut(c);
		return validateProbes(c);
	};
	const k = bad((c) => (c.probes.read.requests[0] = { name: "list", grpc: { path: "/x" }, route: "/list" }));
	check("AC-1 an unknown request kind is rejected and named", k.some((p) => /requests\[0\]: unknown request kind/.test(p)), k.join("; "));
	const r = bad((c) => delete c.probes.read.requests[1].route);
	check("AC-1 a request with no route is rejected and named", r.some((p) => /requests\[1\]\.route: required/.test(p)), r.join("; "));
	const s = bad((c) => (c.probes.read.requests[0].http.headers = { Authorization: "Bearer lk_ro_abcdefghijklmnop" }));
	check("AC-1 a literal token is rejected and named", s.some((p) => /requests\[0\]\.http\.headers\.Authorization: looks like a credential/.test(p)), s.join("; "));
	const two = bad((c) => (c.probes.read.requests[0].mcp = { tool: "x" }));
	check("AC-1 a request with two kinds is rejected and named", two.some((p) => /requests\[0\]: one request kind only/.test(p)), two.join("; "));
	const pooled = summarize([...[10, 10].map((ms) => ({ route: "/mcp", ok: true, ms })), { route: "/mcp", ok: false, ms: 30 }]);
	check("two probes on one route pool their samples", pooled["/mcp"].n === 3 && pooled["/mcp"].errors === 1, JSON.stringify(pooled));
	let idErr = null;
	try {
		identityFor({ environments: { production: { auth: { identities: { probe: { strategy: "bearer", token: "lk_ro_abcdefghijk" } } } } } }, "production", "probe");
	} catch (e) {
		idErr = e.message;
	}
	check("AC-1 an identity holding a token value instead of a name is rejected", /token/.test(idErr || ""), idErr || "accepted");

	// AC-2: a simulated service — /list 10 ms, /x/:id 50 ms; the first pass is slow (cold) and must be discarded.
	const calls = [];
	let cold = true;
	const send = async ({ spec, headers }) => {
		calls.push({ path: spec.path, headers });
		const slow = cold;
		if (calls.length >= 4) cold = false;
		if (spec.path === "/list") return { status: 200, ms: slow ? 900 : 10, json: {} };
		return { status: 200, ms: slow ? 900 : spec.path === "/x/42" ? 50 : 999, json: { key: "k" } };
	};
	const tokens = { get: async () => "tok_secret_value", canRefresh: false };
	const run = await runProbe({ probe: valid.probes.read, defaults: valid.defaults, identity: { role: "probe", header: "Authorization", check: null }, tokens, send, sleep: async () => {}, vars: { id: 42 } });
	const l = run.routes["/list"], x = run.routes["/x/:id"];
	check("AC-2 per-route n, errors, p50, p95, avg_ms", l?.n === 5 && x?.n === 5 && l.errors === 0 && l.p50 === 10 && l.p95 === 10 && x.avg_ms === 50, JSON.stringify(run.routes));
	check("AC-2 warm-up requests are sent and discarded", run.discarded === 4 && run.sent === 14, `sent ${run.sent}, discarded ${run.discarded}`);
	check("AC-2 fixture placeholders are filled, tag and bearer headers sent", calls.every((c) => c.headers["X-Env"] === "test" && c.headers.Authorization === "Bearer tok_secret_value") && calls.some((c) => c.path === "/x/42"));

	// Auth: a 401 on the preflight is refreshed once, then fails as an auth error — never as samples.
	let mints = 0;
	const refreshing = { get: async ({ fresh } = {}) => (fresh ? `tok_${++mints}` : "tok_0"), canRefresh: true };
	let authErr = null;
	try {
		await runProbe({ probe: valid.probes.read, defaults: valid.defaults, identity: { role: "probe", header: "Authorization", check: { http: { path: "/me" } } }, tokens: refreshing, send: async () => ({ status: 401, ms: 1 }), sleep: async () => {} });
	} catch (e) {
		authErr = e;
	}
	check("a 401 preflight refreshes once, then throws ProbeAuthError with no token in its message", authErr instanceof ProbeAuthError && mints === 1 && !/tok_/.test(authErr.message), authErr?.message);
	check("redact removes every secret it is given", redact("x Bearer tok_abc y tok_abc", ["tok_abc"]) === "x Bearer «redacted» y «redacted»");

	// Token source: env, and a minted token cached until its ttl.
	const ts = makeTokenSource({ role: "r", token: { env: "PROBE_T" } }, { env: { PROBE_T: "v1" }, cache: false });
	let minted = 0;
	let clock = 0;
	const tc = makeTokenSource({ role: "r", token: { command: "mint", ttl_seconds: 10 } }, { exec: () => `m${++minted}\n`, now: () => clock, cache: false });
	const a1 = await tc.get(), a2 = await tc.get();
	clock = 11_000;
	const a3 = await tc.get();
	check("token from env; a minted token is reused until its ttl", (await ts.get()) === "v1" && a1 === "m1" && a2 === "m1" && a3 === "m2");

	const draft = draftProbes({ root_spans: ["lorekit.memories"] }, [{ id: "AC-2", kind: "api", target: "GET /memories" }, { id: "AC-3", kind: "check", target: "" }]);
	const parsedDraft = parseYaml(draft);
	check("setup draft: valid once an identity exists, one request per api: criterion", validateProbes(parsedDraft).length === 0 && parsedDraft.probes.main.requests.length === 1 && parsedDraft.probes.main.requests[0].route === "/memories", validateProbes(parsedDraft).join("; "));

	console.log(failed ? `${failed}/${total} failed` : `${total}/${total} passed`);
	process.exit(failed ? 1 : 0);
}

// ─────────────────────────────── cli ──────────────────────────────

function args(argv) {
	const out = {};
	for (let i = 0; i < argv.length; i++) {
		if (!argv[i].startsWith("--")) continue;
		const next = argv[i + 1];
		out[argv[i].slice(2)] = next === undefined || next.startsWith("--") ? true : argv[++i];
	}
	return out;
}

async function main() {
	const a = args(process.argv.slice(2));
	if (a["self-test"]) return selfTest();
	const env = typeof a.env === "string" ? a.env : "production";
	const cfg = loadProbes();
	if (!cfg) throw new Error("no .agents/aw/probes.yml — see rules/probes.md");
	const problems = validateProbes(cfg);
	if (a.check) {
		const environments = loadEnvironments();
		if (cfg.defaults?.identity) {
			try {
				identityFor(environments, env, cfg.defaults.identity);
			} catch (e) {
				problems.push(e.message);
			}
		}
		if (problems.length) {
			console.log(problems.map((p) => `probes.yml: ${p}`).join("\n"));
			process.exit(1);
		}
		console.log(`probes.yml ok: ${Object.keys(cfg.probes).length} probe(s), environment ${env}`);
		return;
	}
	if (typeof a.run === "string") {
		const p = cfg.probes?.[a.run];
		if (!p) throw new Error(`no probe ${a.run}`);
		const runner = probeRunner({ env, rootSpans: p.covers, only: a.run });
		console.log(JSON.stringify(await runner.run(), null, 2));
		return;
	}
	throw new Error("pass --check, --run <probe>, or --self-test");
}

const self = (() => {
	try {
		return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
	} catch {
		return false;
	}
})();
if (self) main().catch((e) => {
	console.error(`probe.mjs: ${e instanceof ProbeAuthError ? "probe auth failed — " : ""}${e.message}`);
	process.exit(1);
});
