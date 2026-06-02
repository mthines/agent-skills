#!/usr/bin/env node
// Playwright trace diff.
//
// Compares two unpacked traces (or two manifest.json files) — one
// passing, one failing — and surfaces the fork point: the first action
// where durations diverge significantly, and the requests present in
// one trace but not the other.
//
// Usage:
//   node trace-diff.mjs <pass-dir-or-manifest> <fail-dir-or-manifest> [--threshold-ms 500]

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
if (args.length < 2) {
	console.error(
		"Usage: node trace-diff.mjs <pass> <fail> [--threshold-ms 500]",
	);
	process.exit(1);
}

const passManifest = JSON.parse(readFileSync(resolveManifest(args[0]), "utf-8"));
const failManifest = JSON.parse(readFileSync(resolveManifest(args[1]), "utf-8"));

const tIdx = args.indexOf("--threshold-ms");
const threshold = tIdx >= 0 ? parseInt(args[tIdx + 1], 10) : 500;

diff(passManifest, failManifest, threshold);

function resolveManifest(p) {
	const abs = resolve(p);
	if (!existsSync(abs)) fail(`Path not found: ${abs}`);
	if (statSync(abs).isDirectory()) {
		const m = join(abs, "manifest.json");
		if (!existsSync(m)) fail(`No manifest.json in ${abs}`);
		return m;
	}
	return abs;
}

function diff(a, b, thresholdMs) {
	console.log("# Playwright trace diff");
	console.log(`PASS: ${a.source ?? "(?)"}`);
	console.log(`FAIL: ${b.source ?? "(?)"}`);
	console.log(
		`Wall clock — pass: ${msFmt(a.totals?.wallClockMs)}  |  fail: ${msFmt(b.totals?.wallClockMs)}`,
	);

	const passActs = sortByCallId(allActions(a));
	const failActs = sortByCallId(allActions(b));

	const passByKey = keyByMethodAndLine(passActs);
	const failByKey = keyByMethodAndLine(failActs);

	console.log("\n## Action divergence (matched on method + file:line)");
	console.log(
		"  pass_ms   fail_ms   delta_ms  method                            file:line",
	);
	const allKeys = new Set([...passByKey.keys(), ...failByKey.keys()]);
	const rows = [];
	for (const k of allKeys) {
		const pa = passByKey.get(k);
		const fa = failByKey.get(k);
		const pMs = pa?.durMs ?? null;
		const fMs = fa?.durMs ?? null;
		const delta = pMs != null && fMs != null ? fMs - pMs : null;
		if (delta == null && !(pa && fa)) {
			// missing in one side — record
		}
		rows.push({ k, pa, fa, pMs, fMs, delta });
	}
	const interesting = rows.filter((r) => {
		if (r.delta != null && Math.abs(r.delta) >= thresholdMs) return true;
		if ((r.pa && !r.fa) || (!r.pa && r.fa)) return true;
		if (r.fa?.error || r.pa?.error) return true;
		return false;
	});
	interesting.sort((x, y) => {
		const dx = x.delta ?? Infinity;
		const dy = y.delta ?? Infinity;
		return dy - dx;
	});
	for (const r of interesting.slice(0, 25)) {
		const meta = r.fa ?? r.pa;
		const where = meta?.file ? `${meta.file}:${meta.line ?? "?"}` : "(no location)";
		const tag = !r.pa ? "[ONLY-FAIL]" : !r.fa ? "[ONLY-PASS]" : r.fa?.error ? "[FAIL]    " : "          ";
		console.log(
			`  ${tag} ${msFmt(r.pMs).padStart(7)}  ${msFmt(r.fMs).padStart(7)}  ${msFmt(r.delta).padStart(8)}  ${(meta?.method ?? "?").padEnd(33)} ${where}`,
		);
	}

	const passUrls = new Map(
		(a.topSlowRequests ?? []).map((r) => [`${r.method} ${r.url}`, r]),
	);
	const failUrls = new Map(
		(b.topSlowRequests ?? []).map((r) => [`${r.method} ${r.url}`, r]),
	);
	const onlyInFail = [...failUrls.keys()].filter((k) => !passUrls.has(k));
	const onlyInPass = [...passUrls.keys()].filter((k) => !failUrls.has(k));
	if (onlyInFail.length || onlyInPass.length) {
		console.log("\n## Request set divergence (top 25 by total time)");
		for (const k of onlyInFail.slice(0, 25)) {
			const r = failUrls.get(k);
			console.log(
				`  [ONLY-FAIL] ${msFmt(r.totalMs).padStart(7)}  status=${r.status ?? "—"}  ${truncate(k, 130)}`,
			);
		}
		for (const k of onlyInPass.slice(0, 25)) {
			const r = passUrls.get(k);
			console.log(
				`  [ONLY-PASS] ${msFmt(r.totalMs).padStart(7)}  status=${r.status ?? "—"}  ${truncate(k, 130)}`,
			);
		}
	}

	const passFailed = a.failedRequests ?? [];
	const failFailed = b.failedRequests ?? [];
	if (passFailed.length || failFailed.length) {
		console.log(
			`\n## Failed requests — pass: ${passFailed.length}, fail: ${failFailed.length}`,
		);
		for (const r of failFailed.slice(0, 10)) {
			console.log(
				`  [FAIL]  ${(r.method ?? "?").padEnd(5)} ${truncate(r.url, 130)}  — ${r.errorText ?? ""}`,
			);
		}
	}
}

function allActions(m) {
	// Manifest only stores top-N by duration and failing; for full diff we
	// rely on those. If the manifest needs more, regenerate with a higher
	// `--top` (future flag).
	return [...(m.topSlowActions ?? []), ...(m.failingActions ?? [])];
}

function sortByCallId(actions) {
	return [...actions].sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0));
}

function keyByMethodAndLine(actions) {
	const map = new Map();
	for (const a of actions) {
		const k = `${a.method}@${a.file ?? "?"}:${a.line ?? "?"}`;
		// First wins (action stream is in order)
		if (!map.has(k)) map.set(k, a);
	}
	return map;
}

function msFmt(v) {
	if (v == null) return "n/a";
	if (v < 1000) return `${Math.round(v)}ms`;
	return `${(v / 1000).toFixed(2)}s`;
}

function truncate(s, n) {
	if (!s) return "";
	return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function fail(msg) {
	console.error(msg);
	process.exit(1);
}
