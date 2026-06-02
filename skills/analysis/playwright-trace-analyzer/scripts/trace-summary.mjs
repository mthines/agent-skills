#!/usr/bin/env node
// Playwright trace summariser.
//
// Reads an unpacked trace directory (or a manifest.json produced by
// trace-extract.mjs) and prints:
//   - failure mode (if any)
//   - total wall-clock
//   - top-N slow actions with file:line and error
//   - top-N slow requests with TTFB / total / status
//   - failed requests
//   - console / page errors
//
// Usage:
//   node trace-summary.mjs <path/to/unpacked/trace/dir> [--top N]
//   node trace-summary.mjs <path/to/manifest.json> [--top N]

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
if (args.length === 0) {
	console.error(
		"Usage: node trace-summary.mjs <unpacked-dir-or-manifest.json> [--top N]",
	);
	process.exit(1);
}

const inputArg = resolve(args[0]);
const topIdx = args.indexOf("--top");
const top = topIdx >= 0 ? parseInt(args[topIdx + 1], 10) : 10;

const manifestPath = resolveManifestPath(inputArg);
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

print(manifest);

function resolveManifestPath(p) {
	if (!existsSync(p)) {
		console.error(`Path not found: ${p}`);
		process.exit(1);
	}
	if (statSync(p).isDirectory()) {
		const m = join(p, "manifest.json");
		if (!existsSync(m)) {
			console.error(
				`No manifest.json in ${p}. Run trace-extract.mjs first.`,
			);
			process.exit(1);
		}
		return m;
	}
	return p;
}

function print(m) {
	const failing = m.failingActions ?? [];
	const totals = m.totals ?? {};

	console.log("# Playwright trace summary");
	console.log(`Source: ${m.source ?? "(unknown)"}`);
	console.log(`Generated: ${m.generatedAt ?? "(unknown)"}`);
	console.log(
		`Wall clock: ${msFmt(totals.wallClockMs)}  |  Actions: ${totals.actionCount ?? 0}  |  Requests: ${totals.requestCount ?? 0}  |  Errors: ${totals.errorCount ?? 0}`,
	);
	if (m.contextOptions) {
		const cx = m.contextOptions;
		const vp = cx.viewport ? `${cx.viewport.width}x${cx.viewport.height}` : "?";
		console.log(`Context: ${vp}  baseURL=${cx.baseURL ?? "?"}  locale=${cx.locale ?? "?"}`);
	}

	if (failing.length > 0) {
		console.log("\n## Failing actions");
		for (const a of failing) {
			const where = a.file ? `${a.file}:${a.line ?? "?"}` : "(no location)";
			const err = a.error?.message ?? a.error?.name ?? "(unknown error)";
			console.log(
				`  [FAIL] ${a.method.padEnd(28)} ${msFmt(a.durMs).padStart(8)}  ${where}`,
			);
			for (const line of err.split("\n")) {
				console.log(`         ${line}`);
			}
			if (a.selector) console.log(`         selector: ${a.selector}`);
			if (a.url) console.log(`         url: ${a.url}`);
		}
	} else {
		console.log("\n## Failing actions: none");
	}

	const slowAct = (m.topSlowActions ?? []).slice(0, top);
	if (slowAct.length > 0) {
		console.log(`\n## Top ${slowAct.length} slowest actions`);
		console.log(
			"  durMs    method                            file:line",
		);
		for (const a of slowAct) {
			const where = a.file ? `${a.file}:${a.line ?? "?"}` : "(no location)";
			console.log(
				`  ${msFmt(a.durMs).padStart(7)}  ${a.method.padEnd(33)} ${where}`,
			);
		}
	}

	const slowReq = (m.topSlowRequests ?? []).slice(0, top);
	if (slowReq.length > 0) {
		console.log(`\n## Top ${slowReq.length} slowest requests`);
		console.log(
			"  totalMs  ttfbMs  status  method  url",
		);
		for (const r of slowReq) {
			console.log(
				`  ${msFmt(r.totalMs).padStart(7)}  ${msFmt(r.ttfbMs).padStart(6)}  ${String(r.status ?? "—").padEnd(6)}  ${String(r.method ?? "?").padEnd(6)}  ${truncate(r.url ?? "", 120)}`,
			);
		}
	}

	const failed = m.failedRequests ?? [];
	if (failed.length > 0) {
		console.log(`\n## Failed requests (${failed.length})`);
		for (const r of failed) {
			console.log(
				`  ${String(r.method ?? "?").padEnd(6)}  ${truncate(r.url ?? "", 120)}  — ${r.errorText ?? "(no errorText)"}`,
			);
		}
	}

	const errs = m.errors ?? [];
	if (errs.length > 0) {
		console.log(`\n## Console / page errors (${errs.length})`);
		for (const e of errs.slice(0, top * 2)) {
			console.log(`  [${e.kind}] ${truncate(e.message ?? "", 200)}`);
			if (e.stack) {
				const firstFrame = e.stack.split("\n").find((l) => l.includes(":"));
				if (firstFrame) console.log(`     at ${firstFrame.trim()}`);
			}
		}
	}
}

function msFmt(v) {
	if (v == null) return "n/a";
	if (v < 1000) return `${v.toFixed(0)}ms`;
	return `${(v / 1000).toFixed(2)}s`;
}

function truncate(s, n) {
	if (!s) return "";
	return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
