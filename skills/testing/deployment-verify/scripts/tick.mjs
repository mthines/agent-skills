#!/usr/bin/env node
// deployment-verify controller. Runs the rollout with no model: read state, do the unit that is due,
// write state, exit. An agent is woken (on_exception) only when the outcome needs one.
//
//   node tick.mjs --pr <n> | --all            one tick per PR, state in the PR's report comment (gh)
//   node tick.mjs --local <state.json> --contract <contract.json> [--deployed-at <ISO>]
//                                             one tick, state in a local file (no GitHub)
//   add --run                                 tick until the outcome is terminal, sleeping between ticks
//   add --env <name>                          release.yml environment (default production)
//   node tick.mjs --check-config              validate .agents/aw/release.yml and exit
//   node tick.mjs --self-test                 simulated rollouts, no network
//
// Exit: 0 in progress or PASS/STOPPED, 3 an exception outcome (ROLLED_BACK, ESCALATE, INCONCLUSIVE), 1 error.
// Rules this implements: rules/state.md, rules/loop.md, rules/rollback.md, rules/telemetry.md.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { decide, DEFAULT_THRESHOLDS } from "./decide.mjs";
import { parseYaml } from "./yaml-lite.mjs";

const REPORT_MARKER = "<!-- deployment-verify:v1:report -->";
const STATE_RE = /<!-- deployment-verify:v1:state (\{.*?\}) -->/s;
const CONTRACT_RE = /<!-- deployment-verify:v1 -->\s*```json\s*([\s\S]*?)```\s*<!-- \/deployment-verify:v1 -->/;
const EXCEPTION_OUTCOMES = ["ROLLED_BACK", "ESCALATE", "INCONCLUSIVE"];
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
	return { ...merged, env, environment, policies, thresholds: { ...DEFAULT_THRESHOLDS, ...(merged.thresholds || {}) } };
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
	if (!m) return { error: "no contract — add a <!-- deployment-verify:v1 --> ```json block to the PR body" };
	try {
		return { contract: JSON.parse(m[1]) };
	} catch (e) {
		return { error: `contract is not valid JSON: ${e.message}` };
	}
}

export function validateContract(contract, config) {
	for (const k of ["service", "root_spans", "cohort"]) if (!contract[k]) return `contract is missing "${k}"`;
	if (contract.flag && !providerFor(contract, config)) return `unknown provider ${contract.flag.provider}`;
	for (const [k, v] of Object.entries(contract.thresholds || {})) {
		const base = config.thresholds[k];
		if (base === undefined) return `unknown threshold ${k}`;
		if ((k.startsWith("max_") && v > base) || (k.startsWith("min_") && v < base)) return `contract loosens ${k} — thresholds may only tighten`;
	}
	return null;
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

// The values of the detect attribute currently serving, most traffic first.
export function deployQuery(contract, detect) {
	const k = q(detect.attribute);
	return `SELECT resource_attributes[${k}] AS live, count() AS n FROM spans WHERE resource_attributes['service.name'] = ${q(contract.service)} AND resource_attributes[${k}] != '' GROUP BY live ORDER BY n DESC LIMIT 5`;
}

// Live when a serving value equals the target, or (merge_sha) a serving commit already contains the merge:
// a busy repo deploys a later commit and never the merge commit itself.
export async function isDeployed(rows, detect, sha, contains) {
	const want = detect.equals === "merge_sha" ? sha : detect.equals;
	if (rows.some((r) => r.live === want)) return true;
	if (detect.equals !== "merge_sha" || !contains) return false;
	for (const r of rows) if (await contains(sha, r.live)) return true;
	return false;
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
 *   io.sleep(ms) · io.platformRollback() bool · io.log(msg)
 * Returns the new state. A terminal state has phase "done" and an `outcome`.
 */
export async function tick(state, { contract, config, sha, mergedAt, deployedAt, io }) {
	const s = structuredClone(state || {});
	const env = config.environment;
	const t = { ...config.thresholds, ...(contract.thresholds || {}) };
	const steps = stepsFor(contract, config);
	const window = (config.step_window_minutes ?? 10) * 60_000;
	const ingest = (env.ingest_wait_seconds ?? 45) * 1000;
	const propagation = (providerFor(contract, config)?.propagation_seconds ?? 0) * 1000;
	const synthetic = env.traffic && env.traffic !== "real";
	const holdCap = (config.max_hold_minutes ?? 30) * 60_000;
	const query = (from, to) => io.sql(cohortQuery(contract), { dataset: env.dataset, from: iso(from), to: iso(to) }).then((r) => toStats(r, contract));
	const end = (outcome, reason) => Object.assign(s, { phase: "done", outcome, reason, ended_at: iso(io.now()) });
	const offValue = providerFor(contract, config)?.rollout === "boolean" ? false : 0;
	const valueFor = (pct) => (providerFor(contract, config)?.rollout === "boolean" ? pct > 0 : pct);
	const trafficFor = (pct) => Math.max(200, Math.ceil((t.min_test_requests / (pct / 100)) * 1.5));

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

	async function measure(from, to) {
		let stats = await query(from, to);
		if (synthetic && s.sent && stats.test.n + stats.control.n < 0.9 * s.sent) {
			await io.sleep(ingest);
			stats = await query(from, to);
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
				if (!(await isDeployed(rows, env.deploy.detect, sha, io.contains))) {
					const minutes = env.deploy.timeout_minutes ?? 60;
					if (mergedAt && now - Date.parse(mergedAt) > minutes * 60_000) return end("STOPPED", `deploy not detected in ${minutes} min — nothing changed`);
					return s;
				}
				s.deploy_live_at = iso(now);
			}
			s.phase = "baseline";
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
				const w = await produceWindow(pct, io.now() + (synthetic ? 0 : propagation));
				s.window = { from: iso(w.from), to: iso(w.to), due: iso(w.due) };
			}
			if (io.now() < Date.parse(s.window.due)) return s;
			const stats = await measure(Date.parse(s.window.from), Date.parse(s.window.to));
			const total = stats.test.n + stats.control.n;
			const share = total ? stats.test.n / total : 0;
			const live = pct === 100 ? stats.test.n > 0 && (stats.control.n === 0 || share >= 0.95) : total < 200 || share >= pct / 200;
			let verdict = live ? decide({ ...stats, baseline: s.baseline }, t) : { verdict: "HOLD", reason: `step not live: test share ${(share * 100).toFixed(1)}% at ${pct}%` };
			if (!live && s.not_live_once) {
				if (contract.flag) await io.setFlag(valueFor(s.last_passed_value));
				return end("INCONCLUSIVE", "flag change not visible in telemetry — check the provider's set command and the cohort attribute");
			}
			if (!live) s.not_live_once = true;
			s.steps = s.steps.filter((x) => x.value !== pct).concat([{ value: pct, ...s.window, test: stats.test, control: stats.control, verdict: verdict.verdict, reason: verdict.reason }]);
			io.log(`step ${pct}%: ${verdict.verdict} — ${verdict.reason}`);
			if (verdict.verdict === "PASS") {
				s.last_passed_value = pct;
				if (s.step_index + 1 >= steps.length) return end("PASS", `${pct}% passed; flag left on`);
				Object.assign(s, { step_index: s.step_index + 1, window: null, hold_since: null, holds: 0, not_live_once: false });
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

		if (s.phase === "rollback") {
			if (!s.recovery_window) {
				if (contract.flag) await io.setFlag(offValue); // repeated on an interrupted tick — set is idempotent
				await io.sleep(synthetic ? propagation : 0);
				const w = await produceWindow(0, io.now() + (synthetic ? 0 : propagation));
				s.recovery_window = { from: iso(w.from), to: iso(w.to), due: iso(w.due) };
			}
			if (io.now() < Date.parse(s.recovery_window.due)) return s;
			const st = await measure(Date.parse(s.recovery_window.from), Date.parse(s.recovery_window.to));
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
		`deploy:   ${s.deploy_live_at ? `live at ${s.deploy_live_at}` : "waiting"}`,
		`baseline: ${s.baseline ? `${s.baseline.n} requests, ${s.baseline.errors} errors, ${s.baseline.avg_ms} ms` : "pending"}`,
		`step   test n/err/ms    control n/err/ms   verdict`,
		...rows,
	];
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
	const comments = JSON.parse(gh(["api", `repos/{owner}/{repo}/issues/${number}/comments`, "--paginate", "--jq", "[.[] | {id, body}]"]).replace(/\]\s*\[/g, ","));
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

function realIo({ config, contract }) {
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
		contains: async (merge, live) => {
			if (!/^[0-9a-f]{7,40}$/.test(String(live))) return false;
			const r = spawnSync("gh", ["api", `repos/{owner}/{repo}/compare/${merge}...${live}`, "--jq", ".status"], { encoding: "utf8" });
			return r.status === 0 && ["ahead", "identical"].includes(r.stdout.trim());
		},
		log: (m) => console.error(`[deployment-verify] ${m}`),
	};
}

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

async function runOne({ store, contract, config, sha, mergedAt, deployedAt, loop }) {
	const io = realIo({ config, contract });
	const holder = `${process.env.GITHUB_RUN_ID || process.pid}-${Date.now()}`;
	for (;;) {
		let state = store.read();
		if (state?.lease && Date.parse(state.lease.until) > Date.now() && state.lease.holder !== holder) {
			io.log(`lease held by ${state.lease.holder}; skipping`);
			return state;
		}
		state = { ...(state || {}), lease: { holder, until: iso(Date.now() + LEASE_MS) } };
		store.write(renderReport(state, contract, store.pr));
		store.reread();
		if (store.read()?.lease?.holder !== holder) return state;
		const next = await tick(state, { contract, config, sha, mergedAt, deployedAt, io });
		next.lease = null;
		store.write(renderReport(next, contract, store.pr));
		if (next.phase === "done") {
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
	const total = 8;
	console.log(failed ? `${failed}/${total} failed` : `${total}/${total} passed`);
	process.exit(failed ? 1 : 0);
}

// ─────────────────────────────── cli ──────────────────────────────

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
	const slug = (() => {
		try {
			return execFileSync("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
		} catch {
			return null;
		}
	})();
	const config = loadConfig(a.env || "production", { slug });
	if (a["check-config"]) {
		console.log(`release.yml ok: environment ${config.env}, ${config.flags?.providers?.length || 0} provider(s), steps ${JSON.stringify(config.steps)}`);
		return;
	}
	let worst = 0;
	if (a.local) {
		const contract = JSON.parse(readFileSync(a.contract, "utf8"));
		const err = validateContract(contract, config);
		if (err) throw new Error(err);
		const s = await runOne({ store: localStore(a.local), contract, config, deployedAt: a["deployed-at"], loop: !!a.run });
		console.log(renderReport(s, contract, null).split("\n").slice(2, -2).join("\n"));
		return process.exit(s.phase === "done" && EXCEPTION_OUTCOMES.includes(s.outcome) ? 3 : 0);
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
			const invalid = error || validateContract(contract, config);
			if (invalid) {
				const s = { phase: "done", outcome: "STOPPED", reason: invalid, env: config.env, steps: [] };
				store.write(renderReport(s, contract || {}, store.pr));
				store.finish();
				continue;
			}
			const s = await runOne({ store, contract, config, sha: store.pr.mergeCommit?.oid, mergedAt: store.pr.mergedAt, deployedAt: a["deployed-at"], loop: !!a.run });
			if (s.phase === "done" && EXCEPTION_OUTCOMES.includes(s.outcome)) worst = 3;
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
