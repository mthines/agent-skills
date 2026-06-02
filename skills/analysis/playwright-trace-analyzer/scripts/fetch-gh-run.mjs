#!/usr/bin/env node
// GitHub Actions run → Playwright trace fetcher.
//
// Given a GitHub Actions run URL, downloads every artifact whose name
// matches a Playwright pattern, recursively unpacks nested ZIPs, and
// writes a manifest of every trace.zip discovered (grouped by failed
// test where possible).
//
// Usage:
//   node fetch-gh-run.mjs <https://github.com/OWNER/REPO/actions/runs/ID> [--out <dir>] [--artifact <name>]
//
// Requirements:
//   - `gh` CLI authenticated (`gh auth status`)
//   - `unzip` (or python3) on PATH
//
// Output:
//   <out>/artifacts/<artifact-name>/<files...>
//   <out>/traces/<artifact>/<test-name>/trace.zip   (when groupable)
//   <out>/gh-run-manifest.json                       ({ run, artifacts, traces[] })

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

const runUrl = args[0];
const outIdx = args.indexOf("--out");
const artifactIdx = args.indexOf("--artifact");
const filterArtifact = artifactIdx >= 0 ? args[artifactIdx + 1] : null;

const parsed = parseRunUrl(runUrl);
if (!parsed) fail(`Not a GitHub Actions run URL: ${runUrl}`);

const outDir = outIdx >= 0
	? resolve(args[outIdx + 1])
	: resolve(`./gh-run-${parsed.runId}`);

if (!which("gh")) {
	fail("`gh` CLI not found. Install: https://cli.github.com/");
}
if (!which("unzip") && !which("python3")) {
	fail("Neither `unzip` nor `python3` available — cannot extract.");
}

mkdirSync(outDir, { recursive: true });
const artifactsDir = join(outDir, "artifacts");
mkdirSync(artifactsDir, { recursive: true });

console.log(
	`Fetching artifacts for ${parsed.owner}/${parsed.repo} run #${parsed.runId} ...`,
);

const artifactList = listArtifacts(parsed);
if (artifactList.length === 0) {
	console.log("No artifacts on this run.");
	writeManifest({ parsed, artifacts: [], traces: [] });
	process.exit(0);
}

const playwrightArtifacts = artifactList.filter((a) =>
	matchesPlaywrightArtifact(a.name, filterArtifact),
);

if (playwrightArtifacts.length === 0) {
	console.log(
		`No Playwright-shaped artifacts found. Available artifacts (${artifactList.length}):`,
	);
	for (const a of artifactList) {
		console.log(`  - ${a.name}  (${a.size_in_bytes ?? "?"} bytes)`);
	}
	console.log(
		"\nIf one of these is the trace bundle, re-run with --artifact <name>.",
	);
	writeManifest({ parsed, artifacts: artifactList, traces: [] });
	process.exit(0);
}

console.log(
	`Selected ${playwrightArtifacts.length} artifact(s): ${playwrightArtifacts.map((a) => a.name).join(", ")}`,
);

const downloaded = [];
for (const art of playwrightArtifacts) {
	const dest = join(artifactsDir, sanitize(art.name));
	mkdirSync(dest, { recursive: true });
	console.log(`  ↓ ${art.name}`);
	try {
		execFileSync(
			"gh",
			[
				"run",
				"download",
				String(parsed.runId),
				"--repo",
				`${parsed.owner}/${parsed.repo}`,
				"--name",
				art.name,
				"--dir",
				dest,
			],
			{ stdio: ["ignore", "inherit", "inherit"] },
		);
		downloaded.push({ name: art.name, dir: dest });
	} catch (err) {
		console.warn(`    failed: ${err.message}`);
	}
}

const tracesDir = join(outDir, "traces");
mkdirSync(tracesDir, { recursive: true });
const traces = [];
for (const dl of downloaded) {
	for (const zip of findTraceZips(dl.dir)) {
		const groupName = inferGroupName(zip, dl.dir);
		const groupDir = join(tracesDir, sanitize(dl.name), sanitize(groupName));
		mkdirSync(groupDir, { recursive: true });
		const target = join(groupDir, basename(zip));
		copyFile(zip, target);
		traces.push({
			artifact: dl.name,
			test: groupName,
			tracePath: target,
		});
	}
	for (const inner of findInnerZips(dl.dir)) {
		// Some runners double-zip artifacts. Unpack once into a sibling
		// dir, then re-scan for trace.zip files.
		const unpackTo = join(dl.dir, `${basename(inner, ".zip")}.unpacked`);
		if (!existsSync(unpackTo)) {
			mkdirSync(unpackTo, { recursive: true });
			unzipInto(inner, unpackTo);
		}
		for (const zip of findTraceZips(unpackTo)) {
			const groupName = inferGroupName(zip, unpackTo);
			const groupDir = join(tracesDir, sanitize(dl.name), sanitize(groupName));
			mkdirSync(groupDir, { recursive: true });
			const target = join(groupDir, basename(zip));
			copyFile(zip, target);
			traces.push({
				artifact: dl.name,
				test: groupName,
				tracePath: target,
			});
		}
	}
}

writeManifest({
	parsed,
	artifacts: artifactList,
	downloaded,
	traces,
});

console.log(
	`\nDone. ${traces.length} trace.zip file(s) ready under ${tracesDir}.`,
);
console.log(`Manifest: ${join(outDir, "gh-run-manifest.json")}`);
if (traces.length > 0) {
	console.log("\nNext step:");
	console.log(
		`  node <skill_dir>/scripts/trace-extract.mjs "${traces[0].tracePath}"`,
	);
}

// ---------- helpers ----------

function parseRunUrl(u) {
	const m = u.match(
		/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/actions\/runs\/(\d+)/,
	);
	if (!m) return null;
	return { owner: m[1], repo: m[2], runId: m[3] };
}

function listArtifacts({ owner, repo, runId }) {
	// gh api auto-paginates with --paginate
	try {
		const out = execFileSync(
			"gh",
			[
				"api",
				"--paginate",
				`/repos/${owner}/${repo}/actions/runs/${runId}/artifacts?per_page=100`,
			],
			{ encoding: "utf-8", stdio: ["ignore", "pipe", "inherit"] },
		);
		// `gh api --paginate` concatenates JSON responses. Each page is a
		// `{ total_count, artifacts: [...] }` object. Split on top-level
		// braces by re-parsing line-prefix; simpler: parse as JSON
		// directly first, fall back to multi-page split.
		try {
			const obj = JSON.parse(out);
			return obj.artifacts ?? [];
		} catch {
			// Multi-page concatenation; split by `}\n{` boundary.
			const objs = out
				.replace(/}\s*{/g, "}\n---\n{")
				.split("\n---\n")
				.map((s) => {
					try {
						return JSON.parse(s);
					} catch {
						return null;
					}
				})
				.filter(Boolean);
			return objs.flatMap((o) => o.artifacts ?? []);
		}
	} catch (err) {
		fail(`Failed to list artifacts: ${err.message}`);
	}
}

function matchesPlaywrightArtifact(name, filter) {
	if (filter) return name === filter;
	const n = name.toLowerCase();
	return (
		n.includes("playwright") ||
		n.includes("trace") ||
		n.startsWith("test-results") ||
		n.includes("e2e")
	);
}

function findTraceZips(root) {
	const out = [];
	walk(root, (p) => {
		if (basename(p) === "trace.zip" || /\.trace\.zip$/.test(p)) out.push(p);
	});
	return out;
}

function findInnerZips(root) {
	const out = [];
	walk(root, (p) => {
		if (extname(p) === ".zip" && basename(p) !== "trace.zip") out.push(p);
	});
	return out;
}

function walk(dir, fn) {
	if (!existsSync(dir)) return;
	for (const entry of readdirSync(dir)) {
		const p = join(dir, entry);
		const s = statSync(p);
		if (s.isDirectory()) walk(p, fn);
		else fn(p);
	}
}

function inferGroupName(tracePath, base) {
	const rel = tracePath.replace(`${base}/`, "");
	const parts = rel.split("/");
	// Playwright default layout: <testfile>-<test-name>/trace.zip
	if (parts.length >= 2) return parts[parts.length - 2];
	return basename(tracePath, ".zip");
}

function copyFile(src, dst) {
	const data = readFileSync(src);
	writeFileSync(dst, data);
}

function unzipInto(zipPath, dest) {
	if (which("unzip")) {
		execFileSync("unzip", ["-o", "-q", zipPath, "-d", dest], {
			stdio: ["ignore", "ignore", "inherit"],
		});
		return;
	}
	execFileSync("python3", ["-m", "zipfile", "-e", zipPath, dest], {
		stdio: ["ignore", "ignore", "inherit"],
	});
}

function which(cmd) {
	const r = spawnSync("sh", ["-c", `command -v ${cmd}`], { encoding: "utf-8" });
	return r.status === 0 && r.stdout.trim().length > 0;
}

function sanitize(s) {
	return s.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function writeManifest(m) {
	const out = {
		run: m.parsed,
		runUrl,
		generatedAt: new Date().toISOString(),
		artifacts: (m.artifacts ?? []).map((a) => ({
			name: a.name,
			size_in_bytes: a.size_in_bytes,
			expired: a.expired,
		})),
		downloaded: m.downloaded ?? [],
		traces: m.traces ?? [],
	};
	writeFileSync(
		join(outDir, "gh-run-manifest.json"),
		JSON.stringify(out, null, 2),
	);
}

function fail(msg) {
	console.error(msg);
	process.exit(1);
}

function usage() {
	console.error(
		"Usage: node fetch-gh-run.mjs <run-url> [--out <dir>] [--artifact <name>]",
	);
}
