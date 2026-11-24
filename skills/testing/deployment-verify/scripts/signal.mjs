#!/usr/bin/env node
// deployment-verify earned-autonomy signal (LoreKit loop 2). One `signal` memory per repo × risk class:
//   scope repo::<owner>/<name>, key deployment-verify-autonomy::<risk class>,
//   value { v: 1, agree_streak, level, model, last_override_at, updated_at }.
// nextSignal is pure; the LoreKit I/O around it is optimistic (expected_version) and never blocks a rollout.
//
//   node signal.mjs --read --repo <owner/name> --risk-class <class> [--model <m>]
//       → evidence JSON for promote.mjs on stdout (`available: false` plus one Degraded: line when LoreKit is absent)
//   node signal.mjs --event <approve|override|rollback|revert> --repo <owner/name> --risk-class <class>
//       [--seconds <time-to-approve>] [--model <m>]     → apply one event (rule from .agents/aw/release.yml → promotion)
//   node signal.mjs --self-test
//
// Exit 0 always outside --self-test: a signal that could not be read or written is a Degraded: line, never a failure.
// Rules this implements: rules/autonomy.md.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseYaml } from "./yaml-lite.mjs";

export const LOREKIT_CLI = "@lorekit/cli@1.78.0"; // the first CLI with --expected-version
export const LOREKIT_DEFAULT_ENDPOINT = "https://pqokxlhvnosogizsjztg.supabase.co/functions/v1/mcp";
export const KEY_PREFIX = "deployment-verify-autonomy::";
export const TAG = "deployment-verify-autonomy";
export const TTL_DAYS = 60;
export const DEFAULT_MIN_REVIEW_SECONDS = 60;
const DEFAULT_MAX_LEVEL = 1;
export const EMPTY = Object.freeze({ v: 1, agree_streak: 0, level: 0, model: null, last_override_at: null });

const demote = (s, at) => ({ ...s, agree_streak: 0, level: Math.max(0, (s.level || 0) - 1), last_override_at: at ?? s.last_override_at });

/**
 * One event applied to the signal. Pure. Returns { signal, counted, note }.
 *   approve  { seconds, model, at } — a human approved the controller's PASS at a hold
 *   override | rollback | revert { model, at } — a human disagreed, decide.mjs said ROLLBACK, or the PR was reverted
 * `rule` is release.yml → promotion; without it the streak still counts but the level never rises.
 */
export function nextSignal(prev, event, rule = null) {
	const s = { ...EMPTY, ...(prev || {}) };
	const at = event?.at ?? null;
	if (event?.model && s.model && event.model !== s.model) {
		return { signal: { ...demote(s, s.last_override_at), model: event.model }, counted: false, note: `model changed ${s.model} → ${event.model}: streak reset, level demoted` };
	}
	if (event?.model && !s.model) s.model = event.model;
	switch (event?.type) {
		case "approve": {
			const min = Number.isFinite(rule?.min_review_seconds) ? rule.min_review_seconds : DEFAULT_MIN_REVIEW_SECONDS;
			if (!Number.isFinite(event.seconds) || event.seconds < min) {
				return { signal: s, counted: false, note: `approved in ${event.seconds ?? "?"} s < ${min} s: rubber stamp, not counted` };
			}
			const next = { ...s, agree_streak: s.agree_streak + 1 };
			const maxLevel = Number.isInteger(rule?.max_level) ? rule.max_level : DEFAULT_MAX_LEVEL;
			const need = Number.isInteger(rule?.min_agree_streak) && rule.min_agree_streak > 0 ? rule.min_agree_streak * (next.level + 1) : Infinity;
			if (next.level < maxLevel && next.agree_streak >= need) {
				next.level += 1;
				return { signal: next, counted: true, note: `streak ${next.agree_streak} ≥ ${need}: promoted to level ${next.level}` };
			}
			return { signal: next, counted: true, note: `streak ${next.agree_streak}` };
		}
		case "override":
		case "rollback":
		case "revert":
			return { signal: demote(s, at), counted: true, note: `${event.type}: streak reset, level ${Math.max(0, s.level - 1)}` };
		default:
			throw new Error(`unknown signal event ${event?.type}`);
	}
}

export function signalKey(repo, risk) {
	return { scope: `repo::${String(repo).toLowerCase()}`, key: `${KEY_PREFIX}${risk}` };
}

// ───────────────────────────── LoreKit ────────────────────────────
// Through the pinned CLI with an argv array and no shell, as scripts/record-comment-relevance.mjs does.

export function lorekitEnv(env = process.env) {
	const token = env.LOREKIT_API_KEY || env.LOREKIT_TOKEN;
	if (!token) return null;
	return { ...env, LOREKIT_TOKEN: token, LOREKIT_MCP_URL: env.LOREKIT_MCP_URL || env.LOREKIT_ENDPOINT || LOREKIT_DEFAULT_ENDPOINT, LOREKIT_TELEMETRY: "0" };
}

function runLorekit(args, env) {
	return execFileSync("npx", ["--yes", LOREKIT_CLI, ...args], { env, encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] });
}

/** `show --json` → found (value + version), absent (version 0), or unavailable. */
export function parseShow(stdout) {
	let j;
	try {
		j = JSON.parse(stdout);
	} catch {
		return { status: "unavailable", reason: "unparseable show output" };
	}
	const remote = j?.remote;
	if (!remote || remote.available !== true) return { status: "unavailable", reason: remote?.reason || "remote store unavailable" };
	if (remote.found === false) return { status: "absent", version: 0 };
	const rec = remote.record;
	if (remote.found !== true || typeof rec?.value !== "string") return { status: "unavailable", reason: "remote record had no value" };
	if (!Number.isInteger(rec.version)) return { status: "unavailable", reason: "remote record had no version" };
	try {
		return { status: "found", value: JSON.parse(rec.value), version: rec.version };
	} catch {
		return { status: "unavailable", reason: "signal value is not JSON" };
	}
}

function read(ref, env, run) {
	let out = "";
	try {
		out = run(["show", "--scope", ref.scope, "--key", ref.key, "--json"], env);
	} catch (err) {
		// `show` exits 1 on a missing key with JSON on stdout; no stdout is a timeout, a missing npx, or a crash.
		out = String(err.stdout || "");
		if (!out.trim()) return { status: "unavailable", reason: `LoreKit CLI failed: ${String(err.code === "ETIMEDOUT" ? "timed out" : err.message || err).split("\n")[0]}` };
	}
	return parseShow(out);
}

function write(ref, value, version, env, run) {
	try {
		run(["write", "--scope", ref.scope, "--key", ref.key, "--value", JSON.stringify(value), "--content-type", "application/json",
			"--tags", TAG, "--kind", "signal", "--host", "deployment-verify", "--ttl-days", String(TTL_DAYS),
			"--expected-version", String(version), "--source-agent", "deployment-verify", "--remote", "--json"], env);
		return { status: "ok" };
	} catch (err) {
		const text = `${err.stdout || ""}${err.stderr || ""}${err.message || ""}`;
		return /version_conflict/.test(text) ? { status: "conflict" } : { status: "failed", reason: text.trim().split("\n").pop() || "write failed" };
	}
}

const degraded = (what, reason) => ({ status: "degraded", line: `Degraded: earned-autonomy signal ${what} — ${reason}; recommendation stays HUMAN` });

/** Evidence for promote.mjs: { available, reason?, risk_class, model, signal }. */
export function readEvidence({ repo, risk, model = null, env = lorekitEnv(), run = runLorekit }) {
	if (!env) return { evidence: { available: false, reason: "LoreKit not configured (LOREKIT_API_KEY unset)", risk_class: risk, model, signal: null }, ...degraded("not read", "LoreKit not configured (LOREKIT_API_KEY unset)") };
	if (!repo) return { evidence: { available: false, reason: "no repository slug", risk_class: risk, model, signal: null }, ...degraded("not read", "no repository slug") };
	const r = read(signalKey(repo, risk), env, run);
	if (r.status === "unavailable") return { evidence: { available: false, reason: r.reason, risk_class: risk, model, signal: null }, ...degraded("not read", r.reason) };
	return { status: "ok", evidence: { available: true, risk_class: risk, model, signal: r.status === "found" ? r.value : null } };
}

/**
 * Read, apply nextSignal, write with expected_version. On a version conflict re-read and retry once;
 * a second conflict, or anything unreadable, is Degraded. Never throws.
 */
export function updateSignal({ repo, risk, event, rule, env = lorekitEnv(), run = runLorekit }) {
	if (!env) return degraded("not updated", "LoreKit not configured (LOREKIT_API_KEY unset)");
	if (!repo) return degraded("not updated", "no repository slug");
	const ref = signalKey(repo, risk);
	for (let attempt = 0; attempt < 2; attempt++) {
		const r = read(ref, env, run);
		if (r.status === "unavailable") return degraded("not updated", r.reason);
		const { signal, note } = nextSignal(r.status === "found" ? r.value : null, event, rule);
		const w = write(ref, { ...signal, updated_at: event.at ?? null }, r.version, env, run);
		if (w.status === "ok") return { status: "ok", signal, note, retried: attempt > 0 };
		if (w.status === "failed") return degraded("not updated", w.reason);
	}
	return degraded("not updated", "expected_version conflicted twice");
}

// ──────────────────────────── self-test ───────────────────────────

function selfTest() {
	const rule = { min_agree_streak: 2, min_review_seconds: 60, risk_classes: ["ui"], max_level: 1 };
	const ap = (seconds, model = "m1") => ({ type: "approve", seconds, model, at: "2026-11-24T00:00:00Z" });
	const s1 = nextSignal(null, ap(120), rule);
	const s2 = nextSignal(s1.signal, ap(120), rule);
	const s3 = nextSignal(s2.signal, ap(120), rule);
	const cases = [
		["streak: a counted approve adds one", s1.signal.agree_streak === 1 && s1.counted && s1.signal.level === 0 && s1.signal.model === "m1"],
		["rubber-stamp: a fast approve counts neither way", (() => { const r = nextSignal(s1.signal, ap(5), rule); return !r.counted && r.signal.agree_streak === 1 && r.signal.level === 0; })()],
		["rubber-stamp: without a rule the 60 s default applies", !nextSignal(null, ap(59)).counted && nextSignal(null, ap(60)).counted],
		["promote: level rises when the committed rule's streak is met", s2.signal.level === 1 && s2.signal.agree_streak === 2],
		["promote: never past max_level", s3.signal.level === 1 && s3.signal.agree_streak === 3],
		["promote: never without a rule", nextSignal({ ...EMPTY, model: "m1", agree_streak: 50 }, ap(120)).signal.level === 0],
		["demote: an override resets the streak and drops a level", (() => { const r = nextSignal(s2.signal, { type: "override", model: "m1", at: "T1" }, rule).signal; return r.agree_streak === 0 && r.level === 0 && r.last_override_at === "T1"; })()],
		["demote: a ROLLBACK resets the streak", nextSignal(s2.signal, { type: "rollback", at: "T2" }, rule).signal.agree_streak === 0],
		["demote: a revert resets the streak", nextSignal(s2.signal, { type: "revert", at: "T3" }, rule).signal.level === 0],
		["demote: level never below 0", nextSignal(null, { type: "override", at: "T" }).signal.level === 0],
		["model change: resets, demotes, and does not count the approve", (() => { const r = nextSignal(s2.signal, ap(120, "m2"), rule); return !r.counted && r.signal.agree_streak === 0 && r.signal.level === 0 && r.signal.model === "m2"; })()],
	];

	// A fake LoreKit: show/write by argv; `conflicts` = how many writes answer version_conflict.
	function fakeLorekit({ stored = null, version = 0, conflicts = 0, available = true } = {}) {
		const calls = [];
		const run = (args) => {
			calls.push(args[0]);
			if (args[0] === "show") {
				if (!available) return JSON.stringify({ remote: { available: false, reason: "network down" } });
				return JSON.stringify({ remote: stored ? { available: true, found: true, record: { value: JSON.stringify(stored), version } } : { available: true, found: false } });
			}
			const expected = Number(args[args.indexOf("--expected-version") + 1]);
			if (conflicts > 0) {
				conflicts--;
				version += 1; // someone else wrote in between
				const e = new Error("exit 1");
				e.stdout = `{"error":"version_conflict","current_version":${version}}`;
				throw e;
			}
			if (expected !== version) throw Object.assign(new Error("exit 1"), { stdout: "version_conflict" });
			stored = JSON.parse(args[args.indexOf("--value") + 1]);
			version += 1;
			return "{}";
		};
		return { run, calls, get stored() { return stored; } };
	}
	const env = { LOREKIT_TOKEN: "x" };
	const io = [
		["io: the first write expects version 0", (() => { const f = fakeLorekit(); const r = updateSignal({ repo: "Acme/Web", risk: "ui", event: ap(90), rule, env, run: f.run }); return r.status === "ok" && f.stored.agree_streak === 1; })()],
		["conflict: retries once after re-reading", (() => { const f = fakeLorekit({ stored: { ...EMPTY, model: "m1" }, version: 3, conflicts: 1 }); const r = updateSignal({ repo: "a/b", risk: "ui", event: ap(90), rule, env, run: f.run }); return r.status === "ok" && r.retried && f.calls.join(",") === "show,write,show,write"; })()],
		["conflict: second conflict is Degraded", (() => { const f = fakeLorekit({ stored: { ...EMPTY }, version: 3, conflicts: 2 }); const r = updateSignal({ repo: "a/b", risk: "ui", event: ap(90), rule, env, run: f.run }); return r.status === "degraded" && /conflicted twice/.test(r.line) && f.calls.length === 4; })()],
		["io: unreachable LoreKit reads as available: false", (() => { const f = fakeLorekit({ available: false }); const r = readEvidence({ repo: "a/b", risk: "ui", env, run: f.run }); return r.evidence.available === false && /^Degraded:/.test(r.line); })()],
		["io: no token is Degraded without a call", (() => { const f = fakeLorekit(); const r = updateSignal({ repo: "a/b", risk: "ui", event: ap(90), rule, env: null, run: f.run }); return r.status === "degraded" && f.calls.length === 0; })()],
		["io: a CLI failure with no output names the failure", (() => { const r = readEvidence({ repo: "a/b", risk: "ui", env, run: () => { throw Object.assign(new Error("spawnSync npx ETIMEDOUT"), { code: "ETIMEDOUT" }); } }); return r.evidence.available === false && /timed out/.test(r.line); })()],
		["io: a record without a version is never written blind", parseShow(JSON.stringify({ remote: { available: true, found: true, record: { value: "{}" } } })).status === "unavailable"],
		["io: key is per repo × risk class, lower-cased", JSON.stringify(signalKey("Acme/Web", "data")) === '{"scope":"repo::acme/web","key":"deployment-verify-autonomy::data"}'],
	];
	let failed = 0;
	for (const [name, ok] of [...cases, ...io]) {
		if (!ok) failed++;
		console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
	}
	const total = cases.length + io.length;
	console.log(failed ? `${failed}/${total} failed` : `${total}/${total} passed`);
	process.exit(failed ? 1 : 0);
}

// ─────────────────────────────── cli ──────────────────────────────

function promotionRule(cwd = process.cwd()) {
	const yml = join(cwd, ".agents", "aw", "release.yml");
	try {
		return existsSync(yml) ? parseYaml(readFileSync(yml, "utf8")).promotion || null : null;
	} catch {
		return null;
	}
}

function main() {
	const argv = process.argv.slice(2);
	const opt = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--self-test") return selfTest();
		else if (a === "--read") opt.read = true;
		else if (a === "--event") opt.event = argv[++i];
		else if (a === "--repo") opt.repo = argv[++i];
		else if (a === "--risk-class") opt.risk = argv[++i];
		else if (a === "--model") opt.model = argv[++i];
		else if (a === "--seconds") opt.seconds = Number(argv[++i]);
	}
	if (!opt.risk || (!opt.read && !["approve", "override", "rollback", "revert"].includes(opt.event))) {
		console.error("usage: signal.mjs --read|--event <type> --repo <owner/name> --risk-class <class> [--seconds n] [--model m] | --self-test");
		process.exit(2);
	}
	if (opt.read) {
		const r = readEvidence({ repo: opt.repo, risk: opt.risk, model: opt.model || null });
		if (r.line) console.error(r.line);
		console.log(JSON.stringify(r.evidence));
		return;
	}
	const r = updateSignal({ repo: opt.repo, risk: opt.risk, rule: promotionRule(), event: { type: opt.event, seconds: opt.seconds, model: opt.model || null, at: new Date().toISOString() } });
	console.log(r.status === "ok" ? `signal ${opt.risk}: ${r.note}` : r.line);
}

const self = (() => {
	try {
		return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
	} catch {
		return false;
	}
})();
if (self) main();
