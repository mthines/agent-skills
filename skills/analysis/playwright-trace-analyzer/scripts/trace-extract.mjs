#!/usr/bin/env node
// Playwright trace.zip extractor.
//
// Unpacks a Playwright trace.zip into a directory and writes a manifest
// summarising actions, network requests, errors, and totals — so later
// passes can read the manifest instead of re-parsing NDJSON.
//
// Usage:
//   node trace-extract.mjs <path/to/trace.zip> [--out <dir>]
//
// Output:
//   <out>/trace.trace        (verbatim NDJSON)
//   <out>/trace.network      (verbatim NDJSON)
//   <out>/trace.stacks       (if present)
//   <out>/resources/         (binary blobs)
//   <out>/manifest.json      ({ totals, actions, requests, errors, ... })
//
// Implementation note: we shell out to `unzip` (or python3 -m zipfile as
// fallback) rather than bundling a ZIP library, to keep the script
// dependency-free.
//
// Reference: Playwright trace format
// https://github.com/microsoft/playwright/blob/main/packages/trace/src/trace.ts

import { execFileSync, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
	usage();
	process.exit(args.length === 0 ? 1 : 0);
}

const inputPath = resolve(args[0]);
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0
	? resolve(args[outIdx + 1])
	: resolve(`${stripExt(inputPath)}.unpacked`);

if (!existsSync(inputPath)) {
	fail(`Input not found: ${inputPath}`);
}

mkdirSync(outDir, { recursive: true });
unzipInto(inputPath, outDir);

const tracePath = join(outDir, "trace.trace");
const networkPath = join(outDir, "trace.network");

if (!existsSync(tracePath) || !existsSync(networkPath)) {
	fail(
		`Not a Playwright trace.zip — missing trace.trace or trace.network in ${outDir}`,
	);
}

const manifest = buildManifest({
	tracePath,
	networkPath,
	stacksPath: join(outDir, "trace.stacks"),
	source: inputPath,
});

writeFileSync(
	join(outDir, "manifest.json"),
	JSON.stringify(manifest, null, 2),
);

console.log(`Unpacked to: ${outDir}`);
console.log(
	`  ${manifest.totals.actionCount} actions, ${manifest.totals.requestCount} requests, ${manifest.totals.errorCount} errors`,
);
console.log(`  Wall clock: ${ms(manifest.totals.wallClockMs)}`);
console.log(`  Manifest:   ${join(outDir, "manifest.json")}`);

function unzipInto(zipPath, dest) {
	if (which("unzip")) {
		execFileSync("unzip", ["-o", "-q", zipPath, "-d", dest], {
			stdio: ["ignore", "inherit", "inherit"],
		});
		return;
	}
	if (which("python3")) {
		execFileSync("python3", ["-m", "zipfile", "-e", zipPath, dest], {
			stdio: ["ignore", "inherit", "inherit"],
		});
		return;
	}
	fail("Neither `unzip` nor `python3` available — cannot extract.");
}

function buildManifest({ tracePath, networkPath, stacksPath, source }) {
	const actions = [];
	const beforeMap = new Map();
	const errors = [];
	let firstStart = Infinity;
	let lastEnd = -Infinity;
	let contextOptions = null;

	for (const obj of streamJsonl(tracePath)) {
		switch (obj.type) {
			case "context-options":
				contextOptions = obj.options ?? null;
				break;
			case "before":
				beforeMap.set(obj.callId, obj);
				if (typeof obj.startTime === "number") {
					firstStart = Math.min(firstStart, obj.startTime);
				}
				break;
			case "after": {
				const before = beforeMap.get(obj.callId);
				if (!before) break;
				beforeMap.delete(obj.callId);
				const dur = (obj.endTime ?? before.startTime) - before.startTime;
				if (typeof obj.endTime === "number") {
					lastEnd = Math.max(lastEnd, obj.endTime);
				}
				actions.push({
					callId: before.callId,
					method: `${before.class}.${before.method}`,
					params: before.params ?? null,
					selector: before.params?.selector ?? null,
					url: before.params?.url ?? null,
					file: before.location?.file ?? null,
					line: before.location?.line ?? null,
					startTime: before.startTime,
					endTime: obj.endTime,
					durMs: dur,
					error: obj.error ?? null,
				});
				break;
			}
			case "event": {
				if (
					obj.class === "Page" &&
					(obj.method === "pageerror" ||
						(obj.method === "console" &&
							(obj.params?.type === "error" ||
								obj.params?.type === "warning")))
				) {
					errors.push({
						kind: obj.method === "pageerror" ? "pageerror" : `console.${obj.params?.type}`,
						message: obj.params?.text ?? obj.params?.error?.message ?? null,
						stack: obj.params?.error?.stack ?? null,
					});
				}
				break;
			}
			default:
				break;
		}
	}

	const requests = [];
	const reqMap = new Map();
	for (const obj of streamJsonl(networkPath)) {
		switch (obj.type) {
			case "requestEvent":
				reqMap.set(obj.requestId, {
					requestId: obj.requestId,
					url: obj.url,
					method: obj.method,
					startTimestamp: obj.timestamp,
					frameId: obj.frameId ?? null,
				});
				break;
			case "responseEvent": {
				const r = reqMap.get(obj.requestId);
				if (r) {
					r.status = obj.status;
					r.responseTimestamp = obj.timestamp;
				}
				break;
			}
			case "requestFinishedEvent": {
				const r = reqMap.get(obj.requestId);
				if (r) {
					r.endTimestamp = obj.timestamp;
					r.transferSize = obj.transferSize ?? null;
					r.encodedBodySize = obj.encodedBodySize ?? null;
					r.failed = false;
					requests.push(finalizeRequest(r));
					reqMap.delete(obj.requestId);
				}
				break;
			}
			case "requestFailedEvent": {
				const r = reqMap.get(obj.requestId);
				if (r) {
					r.endTimestamp = obj.timestamp;
					r.failed = true;
					r.errorText = obj.errorText ?? null;
					requests.push(finalizeRequest(r));
					reqMap.delete(obj.requestId);
				}
				break;
			}
			default:
				break;
		}
	}
	for (const r of reqMap.values()) {
		// Pending at end of trace
		r.failed = false;
		r.pending = true;
		requests.push(finalizeRequest(r));
	}

	const wallClockMs = isFinite(firstStart) && isFinite(lastEnd)
		? lastEnd - firstStart
		: null;

	return {
		source,
		generatedAt: new Date().toISOString(),
		contextOptions,
		totals: {
			actionCount: actions.length,
			requestCount: requests.length,
			errorCount: errors.length,
			wallClockMs,
			firstStart,
			lastEnd,
		},
		topSlowActions: [...actions]
			.sort((a, b) => b.durMs - a.durMs)
			.slice(0, 25),
		failingActions: actions.filter((a) => a.error),
		topSlowRequests: [...requests]
			.filter((r) => r.totalMs != null)
			.sort((a, b) => b.totalMs - a.totalMs)
			.slice(0, 25),
		failedRequests: requests.filter((r) => r.failed),
		errors,
		hasStacks: existsSync(stacksPath),
	};
}

function finalizeRequest(r) {
	const totalMs = r.endTimestamp != null && r.startTimestamp != null
		? r.endTimestamp - r.startTimestamp
		: null;
	const ttfbMs = r.responseTimestamp != null && r.startTimestamp != null
		? r.responseTimestamp - r.startTimestamp
		: null;
	return { ...r, totalMs, ttfbMs };
}

function* streamJsonl(path) {
	if (!existsSync(path)) return;
	const txt = readFileSync(path, "utf-8");
	const lines = txt.split("\n");
	for (const line of lines) {
		if (!line.trim()) continue;
		try {
			yield JSON.parse(line);
		} catch {
			// tolerate partial lines from interrupted traces
		}
	}
}

function which(cmd) {
	const r = spawnSync("sh", ["-c", `command -v ${cmd}`], { encoding: "utf-8" });
	return r.status === 0 && r.stdout.trim().length > 0;
}

function stripExt(p) {
	const ext = extname(p);
	if (!ext) return p;
	return join(dirname(p), basename(p, ext));
}

function ms(v) {
	if (v == null) return "n/a";
	if (v < 1000) return `${v.toFixed(0)}ms`;
	return `${(v / 1000).toFixed(2)}s`;
}

function fail(msg) {
	console.error(msg);
	process.exit(1);
}

function usage() {
	console.error(
		"Usage: node trace-extract.mjs <path/to/trace.zip> [--out <dir>]",
	);
}
