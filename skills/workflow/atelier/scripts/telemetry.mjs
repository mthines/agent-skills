#!/usr/bin/env node
// telemetry.mjs — one OTLP trace per atelier run, plus a small trace per merged-PR outcome (rules/telemetry.md).
//
// A run is not one process: preflight.mjs, state.mjs, merge-gate.mjs, and outcomes.mjs are short commands
// with hours of `aw`, CI, and human time between them. Each of them appends to one ledger,
// `<run-dir>/telemetry.jsonl`; the record that ends the run reads it back and exports one trace:
//
//   atelier.run                         root: outcome, stage reached, PR, active vs waiting time, memory
//   ├─ atelier.stage preflight          preflight.mjs itself; its gaps
//   ├─ atelier.stage build              aw, from preflight's end to the companions check (or Build's record)
//   ├─ atelier.stage companions         the after-Build checklist: companions, sentinel, early gate
//   ├─ atelier.stage ready              undraft, CI, prepare, CI evidence
//   │  └─ atelier.wait ci               a command run through `telemetry.mjs wait ci -- <cmd>`
//   └─ atelier.stage merge              gate, prepare --merge
//
// The agent marks nothing by hand except a wait: every stage boundary rides on a command atelier already runs.
// Export is opt-in and never fails the command it rides on; the summary file is written either way.
// The OTLP encoder is pr-reviewer's `otlp.mjs`, imported by path (lib.mjs agentScript), never copied.
//
//   node telemetry.mjs wait <ci|review|human|other> [--run-dir d] -- <cmd …>   runs cmd, records the wait, exits with cmd's code
//   node telemetry.mjs finish [--stage s --decision d --reason r | --outcome stopped --reason r] [--pr url] [--run-dir d]
//   node telemetry.mjs summary [--run-dir d]
//   node telemetry.mjs smoke                    exports one synthetic run and outcome marked atelier.smoke=true
//   node telemetry.mjs --self-test
// The run dir is --run-dir, else ATELIER_RUN_DIR, else `<git common dir>/atelier-telemetry` of cwd's repo.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { agentScript, isMain, makeTester, parseArgs } from "./lib.mjs";

export const LEDGER_FILE = "telemetry.jsonl";
export const SUMMARY_FILE = "telemetry-summary.json";
export const SERVICE = "atelier";
export const SCOPE_NAME = "agent-skills/atelier";
export const STAGES = Object.freeze(["preflight", "setup", "build", "companions", "ready", "merge"]);
export const DECISIONS = Object.freeze(["proceed", "skipped", "refuse", "hold", "failed"]);
export const OUTCOMES = Object.freeze(["merged", "held", "refused", "failed", "stopped", "abandoned"]);
export const WAIT_KINDS = Object.freeze(["ci", "review", "human", "other"]);
export const PR_OUTCOMES = Object.freeze(["clean", "reverted", "hotfixed"]);
export const RUN_COUNTER = "atelier.runs";
export const MERGED_COUNTER = "atelier.prs.merged";
export const OUTCOME_COUNTER = "atelier.outcomes";
const RUN_ENDING = new Set(["refuse", "hold", "failed"]);
const NEXT_STAGE = { build: "ready", ready: "merge" };
const COUNTER_STEP_NS = 30n * 1_000_000_000n;
const COUNTER_MAX_POINTS = 480;
const SECONDS_BOUNDS = [10, 30, 60, 120, 300, 600, 1200, 1800, 3600, 7200, 14400, 28800, 86400];
const MEMORY_KEYS = { lorekit: ["ok", "unreachable"], lessons_used: "int", bus_failed: "int" };

const nowNs = () => BigInt(Date.now()) * 1_000_000n;
const warn = (msg) => process.stderr.write(`atelier-telemetry: ${msg}\n`);

// ───────────────────────────── where the ledger lives ─────────────────────────────

// The git common dir is shared by every worktree of a clone, so Build's worktree and the main checkout
// write one ledger; ATELIER_RUN_DIR separates two concurrent runs in one clone.
export function resolveRunDir({ dir, cwd = process.cwd(), env = process.env } = {}) {
	if (typeof dir === "string" && dir) return dir;
	if (env.ATELIER_RUN_DIR) return env.ATELIER_RUN_DIR;
	try {
		const common = execFileSync("git", ["-C", cwd, "rev-parse", "--git-common-dir"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
		if (common) return join(isAbsolute(common) ? common : join(cwd, common), "atelier-telemetry");
	} catch {}
	return join(tmpdir(), "atelier-telemetry", createHash("sha256").update(cwd).digest("hex").slice(0, 12));
}

export function readLedger(runDir) {
	const p = join(runDir, LEDGER_FILE);
	if (!existsSync(p)) return [];
	const out = [];
	for (const line of readFileSync(p, "utf8").split("\n")) {
		if (!line.trim()) continue;
		try {
			const r = JSON.parse(line);
			if (r && typeof r.t === "string" && /^\d+$/.test(String(r.ns))) out.push(r);
		} catch {} // a torn line from a crash is skipped
	}
	return out;
}

export function appendRecord(runDir, rec) {
	mkdirSync(runDir, { recursive: true });
	const { ns, ...rest } = rec;
	appendFileSync(join(runDir, LEDGER_FILE), `${JSON.stringify({ ns: String(ns ?? nowNs()), ...rest })}\n`, "utf8");
}

const hasRun = (records) => records.some((r) => r.t === "run");
const isFinished = (records) => records.some((r) => r.t === "finish");

// ───────────────────────────── facts and buckets ─────────────────────────────

export function detectHarness(env = process.env, exists = existsSync) {
	if (env.ATELIER_HARNESS) return env.ATELIER_HARNESS;
	if (env.CLAUDECODE === "1") return "claude-code";
	if (exists("/tmp/workspace/agent-skills/env.sh")) return "agent0";
	return null;
}

export function prFacts(pr) {
	const m = String(pr ?? "").match(/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/);
	return m ? { repo: `${m[1]}/${m[2]}`, pr_number: Number(m[3]), pr_url: `https://github.com/${m[1]}/${m[2]}/pull/${m[3]}` } : {};
}

function originRepo(cwd = process.cwd()) {
	try {
		const url = execFileSync("git", ["-C", cwd, "remote", "get-url", "origin"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
		const slug = url.replace(/\.git$/, "").split(/[/:]/).slice(-2).join("/");
		return /^[^/]+\/[^/]+$/.test(slug) ? slug : null;
	} catch {
		return null;
	}
}

export function hostFacts(env = process.env, cwd = process.cwd()) {
	const out = {};
	const harness = detectHarness(env);
	if (harness) out.harness = harness;
	if (env.ATELIER_MODEL) out.model = env.ATELIER_MODEL;
	const repo = originRepo(cwd);
	if (repo) out.repo = repo;
	try {
		const here = dirname(fileURLToPath(import.meta.url));
		const v = execFileSync("git", ["-C", here, "rev-parse", "--short", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
		if (v) out.version = v;
	} catch {}
	return out;
}

// A stage reason is free text; metrics and dashboards group by this bounded enum instead.
export const REASON_BUCKETS = Object.freeze([
	"none", "merged", "existing_pr", "accepted_skip", "companions_skipped", "ci_not_run_draft", "ci_not_run", "ci_pending",
	"ci_red", "gate_contract", "gate_ci", "checks_failed", "no_handback", "prepare_blocked", "preflight_gap", "other",
]);

export function reasonBucket(reason) {
	const r = String(reason ?? "").trim();
	if (!r) return "none";
	if (/^merged\b/i.test(r)) return "merged";
	if (/existing PR/i.test(r)) return "existing_pr";
	if (/^accepted skip/i.test(r)) return "accepted_skip";
	if (/^skipped:/i.test(r)) return "companions_skipped";
	if (/MERGE_GATE/.test(r)) return /contract|flag|deployment-verify/i.test(r) ? "gate_contract" : "gate_ci";
	if (/CI not run: draft/i.test(r)) return "ci_not_run_draft";
	if (/CI not run|not-run/i.test(r)) return "ci_not_run";
	if (/CI: pending|\bpending\b/i.test(r)) return "ci_pending";
	if (/CI: red|\bred\b/i.test(r)) return "ci_red";
	if (/CHECKS \d+\/\d+ FAIL/.test(r)) return "checks_failed";
	if (/AW RUN COMPLETE/.test(r)) return "no_handback";
	if (/preflight|--accept-gaps|\bgaps?\b/i.test(r)) return "preflight_gap";
	if (/prepare|blocked|conflict/i.test(r)) return "prepare_blocked";
	return "other";
}

// `--memory "lorekit=ok,lessons_used=2,bus_failed=0"`: only these keys, only these value shapes.
export function parseMemory(s) {
	const out = {};
	for (const pair of String(s ?? "").split(",")) {
		const [k, v] = pair.split("=").map((x) => x?.trim());
		const shape = MEMORY_KEYS[k];
		if (!shape || v === undefined) continue;
		if (shape === "int" && /^\d+$/.test(v)) out[k] = Number(v);
		else if (Array.isArray(shape) && shape.includes(v)) out[k] = v;
	}
	return out;
}

export function outcomeOf(decision) {
	if (!decision) return "stopped";
	if (decision.stage === "merge" && decision.decision === "proceed") return "merged";
	return { refuse: "refused", hold: "held", failed: "failed" }[decision.decision] ?? "stopped";
}

// ───────────────────────────── the run ─────────────────────────────

// Pure: a ledger → the run's spans. A run with no finish is closed at `now` (for `summary`).
export function buildRun(records, now = nowNs()) {
	const sorted = records.map((r, i) => ({ r, i, ns: BigInt(r.ns) })).sort((a, b) => (a.ns < b.ns ? -1 : a.ns > b.ns ? 1 : a.i - b.i));
	const runRec = sorted.find((x) => x.r.t === "run");
	if (!runRec) return null;
	const run = {
		runId: String(runRec.r.run_id), facts: { ...(runRec.r.facts || {}) }, startNs: runRec.ns, endNs: now,
		stages: [], waits: [], attrs: {}, memory: {}, decisions: [], finish: null,
	};
	let open = null;
	let boundary = runRec.ns;
	const close = (at, extra = {}) => {
		if (!open) return null;
		open.endNs = at;
		Object.assign(open, extra);
		run.stages.push(open);
		const closed = open;
		open = null;
		boundary = at;
		return closed;
	};
	const start = (name, at, attrs = {}) => {
		close(at);
		open = { name, startNs: at, endNs: null, attrs: { ...attrs }, decision: null, reason: "" };
	};
	for (const { r, ns } of sorted) {
		if (ns < run.startNs || run.finish) continue;
		if (r.t === "facts") Object.assign(run.facts, r.facts || {});
		// A stage already open stays open: `--record build skipped` opens ready, then `--next` names ready again.
		else if (r.t === "stage") {
			if (open?.name !== r.name) start(r.name, ns, r.attrs);
		}
		else if (r.t === "attr") {
			if (r.target === "stage" && open) Object.assign(open.attrs, r.attrs || {});
			else Object.assign(run.attrs, r.attrs || {});
		} else if (r.t === "memory") {
			for (const [k, v] of Object.entries(r.memory || {})) {
				run.memory[k] = typeof v === "number" ? (run.memory[k] ?? 0) + v : v;
			}
		} else if (r.t === "wait") {
			if (r.phase === "start") run.waits.push({ kind: r.kind, startNs: ns, endNs: null, attrs: {}, stage: open?.name ?? null });
			else {
				const w = [...run.waits].reverse().find((x) => x.endNs === null && x.kind === r.kind);
				if (w) Object.assign(w, { endNs: ns, attrs: { ...w.attrs, ...(r.attrs || {}) } });
			}
		} else if (r.t === "decision") {
			// A decision closes the open span; with none open (a resume with no --next) it spans from the last boundary.
			if (!open) open = { name: r.stage, startNs: boundary, endNs: null, attrs: {}, decision: null, reason: "" };
			const extra = { decision: r.decision, reason: r.reason || "", recordedAs: r.stage, sha: r.sha || null };
			if (open.name === "companions" && r.stage === "build") {
				const build = [...run.stages].reverse().find((s) => s.name === "build");
				if (build && !build.decision) Object.assign(build, { decision: r.decision, reason: r.reason || "", recordedAs: "build", sha: r.sha || null });
			}
			close(ns, extra);
			if (r.pr) Object.assign(run.facts, prFacts(r.pr));
			if (r.sha) run.facts.head_sha = r.sha;
			run.decisions.push({ stage: r.stage, decision: r.decision, reason: r.reason || "", ns });
			if (!RUN_ENDING.has(r.decision) && !(r.stage === "merge" && r.decision === "proceed") && NEXT_STAGE[r.stage]) start(NEXT_STAGE[r.stage], ns);
		} else if (r.t === "finish") {
			run.finish = { ...r, ns };
			run.endNs = ns;
		}
	}
	close(run.endNs);
	for (const w of run.waits) if (w.endNs === null) w.endNs = run.endNs;
	const last = run.decisions.at(-1) ?? null;
	run.outcome = run.finish?.outcome && OUTCOMES.includes(run.finish.outcome) ? run.finish.outcome : outcomeOf(last);
	run.stageReached = [...run.stages].reverse().find((s) => s.name !== "setup")?.name ?? "preflight";
	run.lastDecision = last;
	const total = Number(run.endNs - run.startNs) / 1e9;
	const waitS = run.waits.reduce((a, w) => a + Number(w.endNs - w.startNs) / 1e9, 0);
	run.totalS = total;
	run.waitS = Math.min(waitS, total);
	return run;
}

const spanId = (runId, key) => createHash("sha256").update(`atelier:${runId}:${key}`).digest("hex").slice(0, 16);
export const traceIdFor = (runId) => createHash("sha256").update(`atelier:${runId}`).digest("hex").slice(0, 32);

function prefixed(bag) {
	const out = {};
	for (const [k, v] of Object.entries(bag || {})) {
		if (v === undefined || v === null || v === "") continue;
		out[k.startsWith("atelier.") ? k : `atelier.${k}`] = v;
	}
	return out;
}

export function identity(run) {
	const f = run.facts;
	const [owner, name] = String(f.repo || "").split("/");
	return {
		"vcs.repository.name": name || null,
		"vcs.owner.name": owner || null,
		"vcs.repository.url.full": owner && name ? `https://github.com/${owner}/${name}` : null,
		"vcs.change.id": f.pr_number ? String(f.pr_number) : null,
		"vcs.ref.head.revision": f.head_sha || null,
		"atelier.pr.url": f.pr_url || null,
		"atelier.run.id": run.runId,
		"atelier.harness": f.harness || null,
		"gen_ai.request.model": f.model || null,
		"atelier.smoke": f.smoke === true ? true : null,
	};
}

// Points for a CUMULATIVE counter with one series per run: a 0 on every label set from just after the start and
// every 30 s, then the final point (pr-reviewer references/run-counter.md holds why).
export function counterPoints(startNs, endNs, labelSets, finalValue) {
	const first = startNs + 1_000_000n;
	const last = endNs > first ? endNs : first + 1_000_000n;
	const steps = Number((last - 1n - first) / COUNTER_STEP_NS) + 1;
	const skip = Math.max(0, steps - (COUNTER_MAX_POINTS - 2));
	const zeros = [first];
	for (let k = Math.max(1, skip); k < steps; k++) zeros.push(first + BigInt(k) * COUNTER_STEP_NS);
	return labelSets.flatMap((labels) => [
		...zeros.map((timeNs) => ({ attributes: labels, timeNs, value: 0 })),
		{ attributes: labels, timeNs: last, value: finalValue(labels) },
	]);
}

export function exportTarget(env = process.env) {
	const mode = String(env.ATELIER_TELEMETRY || "").toLowerCase();
	if (mode === "off") return { endpoint: "", headers: {}, source: "off" };
	if (env.ATELIER_OTLP_ENDPOINT) return { endpoint: env.ATELIER_OTLP_ENDPOINT, headers: parseHeaders(env.ATELIER_OTLP_HEADERS), source: "ATELIER_OTLP_*" };
	if (env.PR_REVIEWER_OTLP_ENDPOINT && String(env.PR_REVIEWER_TELEMETRY || "").toLowerCase() !== "off") {
		return { endpoint: env.PR_REVIEWER_OTLP_ENDPOINT, headers: parseHeaders(env.PR_REVIEWER_OTLP_HEADERS), source: "PR_REVIEWER_OTLP_*" };
	}
	if (mode === "on" && env.OTEL_EXPORTER_OTLP_ENDPOINT) {
		return { endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT, headers: parseHeaders(env.OTEL_EXPORTER_OTLP_HEADERS), source: "OTEL_EXPORTER_OTLP_*" };
	}
	return { endpoint: "", headers: {}, source: "none" };
}

export function parseHeaders(s) {
	const out = {};
	for (const pair of String(s || "").split(",")) {
		const i = pair.indexOf("=");
		if (i <= 0) continue;
		let v = pair.slice(i + 1).trim();
		try {
			v = decodeURIComponent(v);
		} catch {}
		out[pair.slice(0, i).trim()] = v;
	}
	return out;
}

async function loadOtlp(env = process.env) {
	return import(pathToFileURL(agentScript("pr-reviewer", "otlp.mjs", "ATELIER_OTLP_MJS", env)).href);
}

function resource(f, traceId) {
	return {
		"service.name": SERVICE,
		"service.namespace": "agent-skills",
		"service.version": f.version || null,
		// One instance per run: the counters' series are per run, so a run's 1 always has its own 0 baseline.
		"service.instance.id": traceId,
	};
}

// The exporter for a built run: the trace, the stage and wait histograms, and the two counters. Unflushed.
export function toExporter(run, env, otlp) {
	const { endpoint, headers } = exportTarget(env);
	const traceId = traceIdFor(run.runId);
	const id = identity(run);
	const ex = new otlp.OtlpExporter({
		endpoint, headers, scopeName: SCOPE_NAME, scopeVersion: run.facts.version || "1",
		histBounds: { "atelier.stage.duration": SECONDS_BOUNDS, "atelier.wait.duration": SECONDS_BOUNDS },
		resource: resource(run.facts, traceId),
	});
	ex.traceId = traceId;
	const rootId = spanId(run.runId, "root");
	const failed = run.outcome === "failed";
	const lastReason = run.finish?.reason ?? run.lastDecision?.reason ?? "";
	ex.spans.push({
		traceId, spanId: rootId, name: "atelier.run", kind: 1,
		startTimeUnixNano: String(run.startNs), endTimeUnixNano: String(run.endNs),
		attributes: otlp.attrs({
			...id,
			"atelier.run.outcome": run.outcome,
			"atelier.stage.reached": run.stageReached,
			"atelier.run.reason": String(lastReason).slice(0, 300) || null,
			"atelier.run.reason_bucket": reasonBucket(lastReason),
			"atelier.run.duration_s": Math.round(run.totalS),
			"atelier.run.wait_s": Math.round(run.waitS),
			"atelier.run.active_s": Math.round(run.totalS - run.waitS),
			"atelier.run.decisions": run.decisions.length,
			...prefixed(run.attrs),
			...prefixed(Object.fromEntries(Object.entries(run.memory).map(([k, v]) => [`memory.${k}`, v]))),
			"atelier.memory.decision_events": run.memory.lorekit === "ok" ? run.decisions.filter((d) => d.decision !== "skipped").length : null,
			...(failed ? { "error.type": "atelier_failed" } : {}),
		}),
		status: failed ? { code: 2, message: String(lastReason || "atelier run failed").slice(0, 300) } : { code: 0 },
	});
	run.stages.forEach((s, i) => {
		const sid = spanId(run.runId, `stage:${i}:${s.name}`);
		const err = s.decision === "failed";
		const durS = Number(s.endNs - s.startNs) / 1e9;
		ex.spans.push({
			traceId, spanId: sid, parentSpanId: rootId, name: `atelier.stage ${s.name}`, kind: 1,
			startTimeUnixNano: String(s.startNs), endTimeUnixNano: String(s.endNs),
			attributes: otlp.attrs({
				...id,
				"atelier.stage.name": s.name,
				"atelier.stage.decision": s.decision,
				"atelier.stage.reason": s.reason ? String(s.reason).slice(0, 300) : null,
				"atelier.stage.reason_bucket": s.decision ? reasonBucket(s.reason) : null,
				"atelier.stage.recorded_as": s.recordedAs && s.recordedAs !== s.name ? s.recordedAs : null,
				"vcs.ref.head.revision": s.sha || id["vcs.ref.head.revision"],
				...prefixed(s.attrs),
				...(err ? { "error.type": "stage_failed" } : {}),
			}),
			status: err ? { code: 2, message: String(s.reason || `${s.name} failed`).slice(0, 300) } : { code: 0 },
		});
		ex.histogram("atelier.stage.duration", durS, { "atelier.stage.name": s.name, "atelier.stage.decision": s.decision || "none" }, "s");
		run.waits.forEach((w, j) => {
			if (w.startNs < s.startNs || w.startNs >= s.endNs) return;
			ex.spans.push({
				traceId, spanId: spanId(run.runId, `wait:${j}:${w.kind}`), parentSpanId: sid, name: `atelier.wait ${w.kind}`, kind: 1,
				startTimeUnixNano: String(w.startNs), endTimeUnixNano: String(w.endNs),
				attributes: otlp.attrs({ ...id, "atelier.wait.kind": w.kind, "atelier.stage.name": s.name, ...prefixed(w.attrs) }),
				status: { code: 0 },
			});
		});
	});
	for (const w of run.waits) ex.histogram("atelier.wait.duration", Number(w.endNs - w.startNs) / 1e9, { "atelier.wait.kind": w.kind }, "s");
	if (typeof run.attrs["resume.idle_s"] === "number") ex.histogram("atelier.wait.duration", run.attrs["resume.idle_s"], { "atelier.wait.kind": "human" }, "s");
	const smoke = run.facts.smoke === true ? { "atelier.smoke": true } : {};
	const outcomes = OUTCOMES.includes(run.outcome) ? OUTCOMES : [...OUTCOMES, run.outcome];
	ex.cumulativeSum(RUN_COUNTER, {
		unit: "{run}", startNs: run.startNs,
		points: counterPoints(run.startNs, run.endNs, outcomes.map((o) => ({ "atelier.run.outcome": o, ...smoke })), (l) => (l["atelier.run.outcome"] === run.outcome ? 1 : 0)),
	});
	ex.cumulativeSum(MERGED_COUNTER, {
		unit: "{pr}", startNs: run.startNs,
		points: counterPoints(run.startNs, run.endNs, [{ ...smoke }], () => (run.outcome === "merged" ? 1 : 0)),
	});
	return ex;
}

export function summarize(run) {
	const r1 = (n) => Math.round(n * 10) / 10;
	return {
		run_id: run.runId, trace_id: traceIdFor(run.runId), outcome: run.outcome, stage_reached: run.stageReached,
		pr: run.facts.pr_url ?? null, total_s: r1(run.totalS), wait_s: r1(run.waitS), active_s: r1(run.totalS - run.waitS),
		stages: run.stages.map((s) => ({
			name: s.name, duration_s: r1(Number(s.endNs - s.startNs) / 1e9), ...(s.decision ? { decision: s.decision, reason_bucket: reasonBucket(s.reason) } : {}),
		})),
		waits: run.waits.map((w) => ({ kind: w.kind, duration_s: r1(Number(w.endNs - w.startNs) / 1e9) })),
		memory: run.memory,
	};
}

export function renderSummary(s) {
	return [
		`atelier ${s.run_id} · ${s.outcome} at ${s.stage_reached} · ${s.total_s}s (${s.active_s}s active, ${s.wait_s}s waiting) · trace ${s.trace_id}`,
		...s.stages.map((x) => `  ${x.name.padEnd(11)} ${String(x.duration_s).padStart(9)}s${x.decision ? `  ${x.decision} (${x.reason_bucket})` : ""}`),
		...s.waits.map((w) => `    wait ${w.kind.padEnd(6)} ${String(w.duration_s).padStart(8)}s`),
	].join("\n");
}

// Close the run and export it; idempotent (a run already exported is not sent twice). Never throws.
export async function finishRun(runDir, opts = {}, env = process.env) {
	try {
		const summaryPath = join(runDir, SUMMARY_FILE);
		const records = readLedger(runDir);
		if (!hasRun(records)) return { exported: false, reason: `no run in ${runDir}` };
		const current = String(records.find((r) => r.t === "run").run_id);
		if (existsSync(summaryPath)) {
			const prev = JSON.parse(readFileSync(summaryPath, "utf8"));
			if (prev?.exported === true && prev.run_id === current) return { ...prev, skipped: "already exported" };
		}
		if (!isFinished(records)) {
			appendRecord(runDir, { t: "finish", ...(opts.outcome ? { outcome: opts.outcome } : {}), ...(opts.reason ? { reason: opts.reason } : {}), ...(opts.ns ? { ns: opts.ns } : {}) });
		}
		const run = buildRun(readLedger(runDir));
		const summary = summarize(run);
		let result;
		try {
			const otlp = await loadOtlp(env);
			result = await toExporter(run, env, otlp).flush();
		} catch (e) {
			result = { exported: false, reason: `otlp.mjs not loaded: ${String(e.message).slice(0, 160)}` };
		}
		const out = { ...summary, exported: result.exported, ...(result.reason && exportTarget(env).endpoint ? { reason: result.reason } : {}) };
		writeFileSync(summaryPath, `${JSON.stringify(out, null, 2)}\n`, "utf8");
		return out;
	} catch (e) {
		return { exported: false, reason: `telemetry error: ${String(e?.message || e).slice(0, 200)}` };
	}
}

// Start a run. An unfinished run already in the ledger was abandoned (its session ended without a record that
// ends a run): it is finished as `abandoned` and exported first, so a run that stalled still shows where.
export async function beginRun(runDir, facts = {}, opts = {}, env = process.env) {
	const records = readLedger(runDir);
	if (hasRun(records)) {
		const prev = String(records.find((r) => r.t === "run").run_id);
		if (!isFinished(records)) {
			const lastNs = records.reduce((a, r) => (BigInt(r.ns) > a ? BigInt(r.ns) : a), 0n);
			await finishRun(runDir, { outcome: "abandoned", reason: "a later run began", ns: lastNs }, env);
		}
		renameSync(join(runDir, LEDGER_FILE), join(runDir, `telemetry.${prev}.jsonl`));
		if (existsSync(join(runDir, SUMMARY_FILE))) renameSync(join(runDir, SUMMARY_FILE), join(runDir, `telemetry-summary.${prev}.json`));
	}
	const runId = randomBytes(8).toString("hex");
	const clean = Object.fromEntries(Object.entries(facts).filter(([, v]) => v !== undefined && v !== null && v !== ""));
	appendRecord(runDir, { t: "run", run_id: runId, facts: clean, ...(opts.ns ? { ns: opts.ns } : {}) });
	return runId;
}

// ───────────────────────────── hooks the other scripts call ─────────────────────────────
// Each is a no-op without a started run, and none throws: telemetry never fails the command it rides on.

function guarded(fn) {
	return async (...args) => {
		try {
			if (String(process.env.ATELIER_TELEMETRY || "").toLowerCase() === "off") return null;
			return await fn(...args);
		} catch (e) {
			warn(`not recorded — ${String(e?.message || e).slice(0, 200)}`);
			return null;
		}
	};
}

const activeRunDir = (opts = {}) => {
	const dir = resolveRunDir({ dir: opts.runDir });
	const recs = readLedger(dir);
	return hasRun(recs) && !isFinished(recs) ? dir : null;
};

/** preflight.mjs: begin the run, book preflight itself, open the next stage (`build` for a request, `setup` before --next on a PR). */
export const markPreflight = guarded(async ({ startNs, status, gaps = [], pr = null, model = null, runDir } = {}) => {
	const dir = resolveRunDir({ dir: runDir });
	const facts = { ...hostFacts(), ...(model ? { model } : {}), ...prFacts(pr), ...(pr ? { resumed: true } : {}) };
	await beginRun(dir, facts, { ns: startNs });
	appendRecord(dir, { t: "stage", name: "preflight", ns: startNs });
	const g = [...gaps].sort();
	appendRecord(dir, { t: "attr", target: "stage", attrs: { "preflight.status": status, "preflight.gaps": g.join(",") || null, "preflight.gap_count": g.length } });
	appendRecord(dir, { t: "attr", target: "run", attrs: { "preflight.status": status, "preflight.gaps": g.join(",") || null, "preflight.gap_count": g.length, ...(pr ? { "run.resumed": true } : {}) } });
	appendRecord(dir, { t: "stage", name: pr ? "setup" : "build" });
	return dir;
});

/** state.mjs --next: the resumed run opens the stage it will run; the time since the last recorded decision was a human's. */
export const markNext = guarded(async ({ stage, state, runDir } = {}) => {
	const dir = activeRunDir({ runDir });
	if (!dir) return null;
	const last = state?.stages?.[state.stage];
	const attrs = { "run.resumed": true };
	if (last?.at && RUN_ENDING.has(last.decision)) {
		const idle = Math.max(0, Math.round((Date.now() - Date.parse(last.at)) / 1000));
		if (Number.isFinite(idle)) Object.assign(attrs, { "resume.idle_s": idle, "resume.after": last.decision, "resume.after_bucket": reasonBucket(last.reason) });
	}
	if (state?.pr) appendRecord(dir, { t: "facts", facts: prFacts(state.pr) });
	appendRecord(dir, { t: "attr", target: "run", attrs });
	if (stage && stage !== "stop" && STAGES.includes(stage)) appendRecord(dir, { t: "stage", name: stage });
	return dir;
});

/** state.mjs --companions: Build's aw time ends; the after-Build checklist begins. */
export const markCompanions = guarded(async ({ decision, tier, skipped = [], accepted = [], runDir } = {}) => {
	const dir = activeRunDir({ runDir });
	if (!dir) return null;
	appendRecord(dir, { t: "stage", name: "companions" });
	const bag = { "companions.decision": decision, "companions.skipped": [...skipped].sort().join(",") || null, "companions.accepted": [...accepted].sort().join(",") || null, tier: tier || null };
	appendRecord(dir, { t: "attr", target: "stage", attrs: bag });
	appendRecord(dir, { t: "attr", target: "run", attrs: bag });
	return dir;
});

/** merge-gate.mjs: what the gate saw, on the open stage and the run. */
export const markGate = guarded(async ({ result, contractOnly, runDir } = {}) => {
	const dir = activeRunDir({ runDir });
	if (!dir || !result) return null;
	const bag = {
		"gate.decision": result.decision, "gate.refused_by": result.refused_by || null, "gate.contract_only": !!contractOnly,
		user_visible: typeof result.user_visible === "boolean" ? result.user_visible : null,
		has_flag_contract: typeof result.has_flag_contract === "boolean" ? result.has_flag_contract : null,
		"gate.no_provider_warning": result.warning ? true : null,
	};
	appendRecord(dir, { t: "attr", target: "stage", attrs: bag });
	appendRecord(dir, { t: "attr", target: "run", attrs: bag });
	return dir;
});

/** state.mjs --record: close the open stage with the decision; a decision that ends the run finishes and exports it. */
export const markDecision = guarded(async ({ stage, decision, reason = "", head = null, pr = null, memory = null, runDir } = {}, env = process.env) => {
	let dir = activeRunDir({ runDir });
	if (!dir) {
		// A record with no run (preflight skipped, or ATELIER_RUN_DIR unset in this shell) starts one here.
		dir = resolveRunDir({ dir: runDir });
		await beginRun(dir, { ...hostFacts(), ...prFacts(pr) }, {}, env);
	}
	if (memory && Object.keys(memory).length) appendRecord(dir, { t: "memory", memory });
	appendRecord(dir, { t: "decision", stage, decision, reason, sha: head, pr });
	if (RUN_ENDING.has(decision) || (stage === "merge" && decision === "proceed")) return finishRun(dir, {}, env);
	return null;
});

/** outcomes.mjs: one small trace per PR whose outcome changed, plus the outcomes counter. */
export const emitOutcomes = guarded(async ({ results = [], repo = null } = {}, env = process.env) => {
	if (!results.length || !exportTarget(env).endpoint) return null;
	const otlp = await loadOtlp(env);
	const startNs = nowNs();
	const [owner, name] = String(repo || "").split("/");
	const { endpoint, headers } = exportTarget(env);
	const ex = new otlp.OtlpExporter({ endpoint, headers, scopeName: SCOPE_NAME, resource: resource({}, randomBytes(16).toString("hex")) });
	for (const r of results) {
		const tid = createHash("sha256").update(`atelier-outcome:${repo}:${r.pr}:${r.outcome}`).digest("hex").slice(0, 32);
		ex.spans.push({
			traceId: tid, spanId: tid.slice(0, 16), name: "atelier.outcome", kind: 1,
			startTimeUnixNano: String(startNs), endTimeUnixNano: String(startNs + 1_000_000n),
			attributes: otlp.attrs({
				"atelier.outcome": r.outcome, "atelier.outcome.previous": r.stored || null, "atelier.outcome.evidence_count": (r.evidence || []).length,
				"vcs.repository.name": name || null, "vcs.owner.name": owner || null, "vcs.change.id": String(r.pr),
				"atelier.pr.url": owner && name ? `https://github.com/${owner}/${name}/pull/${r.pr}` : null, "atelier.merge_sha": r.sha || null,
				"atelier.smoke": r.smoke === true ? true : null,
			}),
			status: { code: 0 },
		});
		ex.cumulativeSum(OUTCOME_COUNTER, {
			unit: "{pr}", startNs,
			points: [
				{ attributes: { "atelier.outcome": r.outcome, ...(r.smoke ? { "atelier.smoke": true } : {}) }, timeNs: startNs + 1_000_000n, value: 0 },
				{ attributes: { "atelier.outcome": r.outcome, ...(r.smoke ? { "atelier.smoke": true } : {}) }, timeNs: startNs + 2_000_000n, value: 1 },
			],
		});
	}
	return ex.flush();
});

/** outcomes.mjs: the sweep's memory reads, on the open run. */
export const markSweep = guarded(async ({ listed, final, changed, runDir } = {}) => {
	const dir = activeRunDir({ runDir });
	if (!dir) return null;
	appendRecord(dir, { t: "attr", target: "run", attrs: { "memory.outcomes_listed": listed, "outcomes.final": final, "outcomes.changed": changed } });
	return dir;
});

// ───────────────────────────── CLI ─────────────────────────────

async function runWait(kind, cmd, runDir) {
	const dir = (() => {
		try {
			return activeRunDir({ runDir });
		} catch {
			return null;
		}
	})();
	const k = WAIT_KINDS.includes(kind) ? kind : "other";
	try {
		if (dir) appendRecord(dir, { t: "wait", phase: "start", kind: k });
	} catch {}
	const res = cmd.length ? spawnSync(cmd[0], cmd.slice(1), { stdio: "inherit" }) : { status: 0 };
	const code = res.status ?? (res.error ? 127 : 1);
	try {
		if (dir) appendRecord(dir, { t: "wait", phase: "end", kind: k, attrs: { "wait.exit_code": code } });
	} catch {}
	if (res.error) process.stderr.write(`atelier-telemetry: ${cmd[0]}: ${res.error.message}\n`);
	return code;
}

async function smoke(env = process.env) {
	const dir = mkdtempSync(join(tmpdir(), "atelier-smoke-"));
	const s = BigInt(Date.now() - 600_000) * 1_000_000n;
	const at = (sec) => s + BigInt(sec) * 1_000_000_000n;
	const pr = "https://github.com/mthines/agent-skills/pull/0";
	await beginRun(dir, { ...hostFacts(env), harness: "local-smoke", smoke: true, model: env.ATELIER_MODEL || "smoke" }, { ns: s }, env);
	appendRecord(dir, { t: "stage", name: "preflight", ns: s });
	appendRecord(dir, { t: "attr", target: "run", attrs: { "preflight.status": "limited", "preflight.gaps": "flag-provider", "preflight.gap_count": 1 }, ns: at(2) });
	appendRecord(dir, { t: "stage", name: "build", ns: at(3) });
	appendRecord(dir, { t: "stage", name: "companions", ns: at(300) });
	appendRecord(dir, { t: "attr", target: "run", attrs: { tier: "Lite", "companions.decision": "proceed" }, ns: at(301) });
	appendRecord(dir, { t: "memory", memory: { lorekit: "ok", lessons_used: 2 }, ns: at(320) });
	appendRecord(dir, { t: "decision", stage: "build", decision: "proceed", reason: "", sha: "0000000", pr, ns: at(320) });
	appendRecord(dir, { t: "wait", phase: "start", kind: "ci", ns: at(330) });
	appendRecord(dir, { t: "wait", phase: "end", kind: "ci", ns: at(480) });
	appendRecord(dir, { t: "decision", stage: "ready", decision: "proceed", reason: "", sha: "0000000", pr, ns: at(500) });
	appendRecord(dir, { t: "attr", target: "stage", attrs: { "gate.decision": "pass", user_visible: false, has_flag_contract: false }, ns: at(510) });
	appendRecord(dir, { t: "decision", stage: "merge", decision: "proceed", reason: "merged 0000000", sha: "0000000", pr, ns: at(540) });
	const out = await finishRun(dir, {}, env);
	const outcome = await emitOutcomes({ results: [{ pr: 0, sha: "0000000", outcome: "clean", final: true, smoke: true }], repo: "mthines/agent-skills" }, env);
	rmSync(dir, { recursive: true, force: true });
	return { run: out, outcome };
}

async function main(argv) {
	const dash = argv.indexOf("--");
	const cmd = dash >= 0 ? argv.slice(dash + 1) : [];
	const a = parseArgs(dash >= 0 ? argv.slice(0, dash) : argv);
	if (a["self-test"]) process.exit(await selfTest());
	const verb = a._[0];
	const runDir = typeof a["run-dir"] === "string" ? a["run-dir"] : undefined;
	if (verb === "wait") process.exit(await runWait(a._[1], cmd, runDir));
	try {
		if (verb === "finish") {
			const dir = activeRunDir({ runDir });
			if (!dir) return warn("finish: no open run");
			let out;
			if (typeof a.stage === "string" && typeof a.decision === "string") {
				appendRecord(dir, { t: "decision", stage: a.stage, decision: a.decision, reason: typeof a.reason === "string" ? a.reason : "", pr: typeof a.pr === "string" ? a.pr : null });
				out = await finishRun(dir);
			} else out = await finishRun(dir, { outcome: OUTCOMES.includes(a.outcome) ? a.outcome : "stopped", reason: typeof a.reason === "string" ? a.reason : "" });
			if (out?.stages) process.stderr.write(`${renderSummary(out)}\n`);
			process.stderr.write(`atelier-telemetry: ${out?.skipped ? "already exported" : out?.exported ? "exported" : `not exported (${out?.reason || "no endpoint"})`}\n`);
		} else if (verb === "summary") {
			const run = buildRun(readLedger(resolveRunDir({ dir: runDir })));
			console.log(run ? renderSummary(summarize(run)) : "no run");
		} else if (verb === "smoke") {
			const t = exportTarget();
			if (!t.endpoint) return warn("smoke: no export endpoint set (ATELIER_OTLP_ENDPOINT or PR_REVIEWER_OTLP_ENDPOINT)");
			const r = await smoke();
			console.log(JSON.stringify({ exported: r.run.exported, trace_id: r.run.trace_id, run_id: r.run.run_id, outcome_exported: r.outcome?.exported ?? false, via: t.source }));
			if (!r.run.exported) process.exit(1);
		} else warn("pass one of wait, finish, summary, smoke, --self-test");
	} catch (e) {
		warn(String(e?.message || e).slice(0, 200));
	}
}

// ───────────────────────────── self-test ─────────────────────────────

async function selfTest() {
	const { t, done } = makeTester("telemetry");
	const S = 1_000_000_000_000_000_000n;
	const at = (sec) => S + BigInt(sec) * 1_000_000_000n;
	const rec = (r, sec) => ({ ...r, ns: String(at(sec)) });
	const pr = "https://github.com/acme/web/pull/41";
	const ledger = [
		rec({ t: "run", run_id: "r1", facts: { repo: "acme/web", model: "claude-opus-5-5", harness: "claude-code" } }, 0),
		rec({ t: "stage", name: "preflight" }, 0),
		rec({ t: "attr", target: "stage", attrs: { "preflight.status": "limited", "preflight.gaps": "flag-provider" } }, 1),
		rec({ t: "stage", name: "build" }, 2),
		rec({ t: "stage", name: "companions" }, 1000),
		rec({ t: "attr", target: "stage", attrs: { "companions.skipped": "review-loop" } }, 1001),
		rec({ t: "memory", memory: { lorekit: "ok", lessons_used: 2 } }, 1100),
		rec({ t: "decision", stage: "build", decision: "proceed", reason: "", sha: "abc1234", pr }, 1100),
		rec({ t: "wait", phase: "start", kind: "ci" }, 1200),
		rec({ t: "wait", phase: "end", kind: "ci", attrs: { "wait.exit_code": 0 } }, 1500),
		rec({ t: "decision", stage: "ready", decision: "hold", reason: "CI not run: draft — every required check skipped (4)", sha: "abc1234", pr }, 1600),
		rec({ t: "finish" }, 1600),
	];
	const run = buildRun(ledger);
	t("stages are contiguous: preflight, build, companions, ready", run.stages.map((s) => s.name).join() === "preflight,build,companions,ready", run.stages.map((s) => s.name).join());
	t("Build's decision lands on build and on companions", run.stages[1].decision === "proceed" && run.stages[2].decision === "proceed" && run.stages[2].recordedAs === "build");
	t("a hold ends the run as held at ready", run.outcome === "held" && run.stageReached === "ready");
	t("the wait is booked to ready, and active + wait = total", run.waitS === 300 && run.totalS === 1600);
	t("PR facts come from the decision's URL", run.facts.pr_number === 41 && run.facts.pr_url === pr && run.facts.head_sha === "abc1234");
	t("reason buckets are bounded", ["CI not run: draft — x", "skipped: review-loop", "MERGE_GATE: refuse — user-visible diff without a deployment-verify:v1 contract", "MERGE_GATE: refuse — CI not green", "merged abc", "", "lunch"]
		.map(reasonBucket).join() === "ci_not_run_draft,companions_skipped,gate_contract,gate_ci,merged,none,other");
	t("every bucket is in the enum", ["x", "CHECKS 3/5 FAIL: AC-1", "no AW RUN COMPLETE block", "prepare blocked"].every((r) => REASON_BUCKETS.includes(reasonBucket(r))));
	t("--memory keeps only known keys and shapes", JSON.stringify(parseMemory("lorekit=ok,lessons_used=3,bus_failed=x,secret=1")) === '{"lorekit":"ok","lessons_used":3}');
	t("outcomes: merge proceed → merged, refuse → refused, none → stopped", outcomeOf({ stage: "merge", decision: "proceed" }) === "merged" && outcomeOf({ stage: "merge", decision: "refuse" }) === "refused" && outcomeOf(null) === "stopped");
	const skippedBuild = buildRun([rec({ t: "run", run_id: "r4", facts: {} }, 0), rec({ t: "stage", name: "setup" }, 1), rec({ t: "decision", stage: "build", decision: "skipped", reason: "existing PR" }, 2),
		rec({ t: "stage", name: "ready" }, 3), rec({ t: "decision", stage: "ready", decision: "hold", reason: "CI: pending" }, 9), rec({ t: "finish" }, 9)]);
	t("a stage named again while open stays one span", skippedBuild.stages.map((s) => `${s.name}:${s.decision}`).join() === "setup:skipped,ready:hold", skippedBuild.stages.map((s) => `${s.name}:${s.decision}`).join());
	const resumed = buildRun([rec({ t: "run", run_id: "r2", facts: {} }, 0), rec({ t: "decision", stage: "merge", decision: "proceed", reason: "merged ff", pr }, 50), rec({ t: "finish" }, 50)]);
	t("a decision with no open stage spans from the last boundary", resumed.stages.length === 1 && resumed.stages[0].name === "merge" && resumed.outcome === "merged");
	const failedRun = buildRun([rec({ t: "run", run_id: "r3", facts: {} }, 0), rec({ t: "stage", name: "build" }, 1), rec({ t: "decision", stage: "build", decision: "failed", reason: "CHECKS 3/5 FAIL: AC-1" }, 9), rec({ t: "finish" }, 9)]);
	t("export targets: off wins, ATELIER first, PR_REVIEWER reused, host OTEL only with on", exportTarget({ ATELIER_TELEMETRY: "off", ATELIER_OTLP_ENDPOINT: "x" }).endpoint === ""
		&& exportTarget({ ATELIER_OTLP_ENDPOINT: "a", PR_REVIEWER_OTLP_ENDPOINT: "b" }).endpoint === "a"
		&& exportTarget({ PR_REVIEWER_OTLP_ENDPOINT: "b" }).endpoint === "b"
		&& exportTarget({ PR_REVIEWER_OTLP_ENDPOINT: "b", PR_REVIEWER_TELEMETRY: "off" }).endpoint === ""
		&& exportTarget({ OTEL_EXPORTER_OTLP_ENDPOINT: "h" }).endpoint === ""
		&& exportTarget({ ATELIER_TELEMETRY: "on", OTEL_EXPORTER_OTLP_ENDPOINT: "h" }).endpoint === "h");
	t("headers parse with percent-decoding", parseHeaders("Authorization=Bearer%20tok,Dash0-Dataset=default").Authorization === "Bearer tok");
	let otlp = null;
	try {
		otlp = await loadOtlp({});
	} catch (e) {
		t("pr-reviewer's otlp.mjs resolves from this checkout", false, e.message);
	}
	if (otlp) {
		const env = { ATELIER_OTLP_ENDPOINT: "http://127.0.0.1:1" };
		const ex = toExporter(run, env, otlp);
		const spans = ex.tracePayload().resourceSpans[0].scopeSpans[0].spans;
		const get = (s, k) => {
			const v = s.attributes.find((x) => x.key === k)?.value;
			return v ? (v.stringValue ?? v.boolValue ?? (v.intValue !== undefined ? Number(v.intValue) : v.doubleValue)) : undefined;
		};
		const root = spans[0];
		t("root is atelier.run with outcome, stage reached, and the bounded reason", root.name === "atelier.run" && get(root, "atelier.run.outcome") === "held"
			&& get(root, "atelier.stage.reached") === "ready" && get(root, "atelier.run.reason_bucket") === "ci_not_run_draft");
		t("root splits active and waiting time", get(root, "atelier.run.wait_s") === 300 && get(root, "atelier.run.active_s") === 1300);
		t("root carries VCS semconv and the PR", get(root, "vcs.repository.name") === "web" && get(root, "vcs.owner.name") === "acme" && get(root, "vcs.change.id") === "41" && get(root, "atelier.pr.url") === pr);
		t("root carries memory: lorekit, lessons used, expected decision events", get(root, "atelier.memory.lorekit") === "ok" && get(root, "atelier.memory.lessons_used") === 2 && get(root, "atelier.memory.decision_events") === 2);
		t("a hold is not an error", root.status.code === 0 && spans.every((s) => s.status.code === 0));
		const names = spans.map((s) => s.name);
		t("the tree: four stage spans and one wait span under ready", names.join() === "atelier.run,atelier.stage preflight,atelier.stage build,atelier.stage companions,atelier.stage ready,atelier.wait ci", names.join());
		const ready = spans.find((s) => s.name === "atelier.stage ready");
		const wait = spans.find((s) => s.name === "atelier.wait ci");
		t("the wait is a child of its stage", wait.parentSpanId === ready.spanId && get(ready, "atelier.stage.decision") === "hold");
		t("stage attributes ride through", get(spans[1], "atelier.preflight.gaps") === "flag-provider" && get(spans[3], "atelier.companions.skipped") === "review-loop");
		t("the trace id is stable per run", ex.traceId === traceIdFor("r1"));
		const mp = ex.metricPayload();
		const metrics = mp.resourceMetrics[0].scopeMetrics[0].metrics;
		const byName = (n) => metrics.filter((m) => m.name === n);
		const runs = byName(RUN_COUNTER)[0];
		t("atelier.runs is CUMULATIVE with a 0 baseline on every outcome and a final 1 on held", runs.sum.aggregationTemporality === 2
			&& OUTCOMES.every((o) => runs.sum.dataPoints.some((p) => p.asInt === "0" && p.attributes.some((x) => x.value.stringValue === o)))
			&& runs.sum.dataPoints.filter((p) => p.asInt === "1").length === 1);
		t("atelier.prs.merged stays 0 for a held run", byName(MERGED_COUNTER)[0].sum.dataPoints.every((p) => p.asInt === "0"));
		t("stage and wait histograms are emitted", byName("atelier.stage.duration").length >= 4 && byName("atelier.wait.duration").length === 1);
		t("the resource is per run", mp.resourceMetrics[0].resource.attributes.find((x) => x.key === "service.instance.id").value.stringValue === traceIdFor("r1"));
		t("no metric attribute carries free text", metrics.every((m) => (m.sum?.dataPoints ?? m.histogram?.dataPoints ?? []).every((p) => p.attributes.every((x) => !/reason$|url|run\.id/.test(x.key)))));
		const fx = toExporter(failedRun, env, otlp).tracePayload().resourceSpans[0].scopeSpans[0].spans;
		t("a failed stage is ERROR on the stage and the root", fx[0].status.code === 2 && fx[1].status.code === 2 && get(fx[1], "error.type") === "stage_failed");
		const long = counterPoints(0n, 5n * 3600n * 1_000_000_000n, [{}], () => 1);
		t("a 5 h run keeps at most 480 counter points per series", long.length <= 480 && long.at(-1).value === 1);
	}
	// End to end through the ledger on disk and a real local OTLP receiver.
	const dir = mkdtempSync(join(tmpdir(), "atelier-telemetry-"));
	const received = [];
	const server = createServer((req, res) => {
		let body = "";
		req.on("data", (c) => {
			body += c;
		});
		req.on("end", () => {
			try {
				received.push({ path: String(req.url), body: JSON.parse(body) });
			} catch {
				received.push({ path: String(req.url), body: null });
			}
			res.writeHead(200, { "content-type": "application/json" });
			res.end("{}");
		});
	});
	await new Promise((r) => server.listen(0, "127.0.0.1", () => r(null)));
	const env = { ATELIER_OTLP_ENDPOINT: `http://127.0.0.1:${server.address().port}` };
	const saved = { ...process.env };
	try {
		process.env.ATELIER_RUN_DIR = dir;
		delete process.env.ATELIER_TELEMETRY;
		const first = await markPreflight({ startNs: nowNs(), status: "ok", gaps: [], model: "claude-opus-5-5" });
		t("preflight begins a run in ATELIER_RUN_DIR and opens build", first === dir && readLedger(dir).at(-1).name === "build");
		await markCompanions({ decision: "proceed", tier: "Lite", skipped: [] });
		const none = await markDecision({ stage: "build", decision: "proceed", head: "abc1234", pr }, env);
		t("a proceed does not end the run", none === null && !isFinished(readLedger(dir)));
		const code = await runWait("ci", [process.execPath, "-e", "process.exit(3)"]);
		t("wait runs the command and returns its exit code", code === 3 && readLedger(dir).filter((r) => r.t === "wait").length === 2);
		await markGate({ result: { decision: "pass", user_visible: true, has_flag_contract: true }, contractOnly: false });
		const out = await markDecision({ stage: "merge", decision: "proceed", reason: "merged deadbee", head: "abc1234", pr }, env);
		t("a merge proceed finishes and exports traces then metrics", out?.exported === true && received.map((r) => r.path).join() === "/v1/traces,/v1/metrics", JSON.stringify(out));
		const root = received[0]?.body?.resourceSpans?.[0]?.scopeSpans?.[0];
		t("the received scope is agent-skills/atelier and the root says merged", root?.scope?.name === SCOPE_NAME && root?.spans?.[0]?.attributes?.some((x) => x.key === "atelier.run.outcome" && x.value.stringValue === "merged"));
		t("the summary file is written", JSON.parse(readFileSync(join(dir, SUMMARY_FILE), "utf8")).outcome === "merged");
		const again = await finishRun(dir, {}, env);
		t("a second finish sends nothing", again.skipped === "already exported" && received.length === 2);
		// A run left open is exported as abandoned when the next one begins.
		await markPreflight({ startNs: nowNs(), status: "ok", pr });
		await markNext({ stage: "ready", state: { pr, stage: "ready", stages: { ready: { decision: "hold", at: new Date(Date.now() - 3600_000).toISOString(), reason: "CI not run: draft" } } } });
		const before = received.length;
		process.env.ATELIER_OTLP_ENDPOINT = env.ATELIER_OTLP_ENDPOINT;
		await markPreflight({ startNs: nowNs(), status: "ok" });
		const abandoned = received.slice(before).find((r) => r.path === "/v1/traces")?.body?.resourceSpans?.[0]?.scopeSpans?.[0]?.spans?.[0];
		const attr = (k) => abandoned?.attributes?.find((x) => x.key === k)?.value;
		t("an unfinished run is exported as abandoned when the next begins", attr("atelier.run.outcome")?.stringValue === "abandoned" && attr("atelier.stage.reached")?.stringValue === "ready");
		t("the resumed run recorded the human wait since the hold", Number(attr("atelier.resume.idle_s")?.intValue) >= 3599 && attr("atelier.resume.after_bucket")?.stringValue === "ci_not_run_draft");
		const n = received.length;
		const oc = await emitOutcomes({ results: [{ pr: 41, sha: "deadbee", outcome: "reverted", stored: "clean", evidence: [{}] }], repo: "acme/web" }, env);
		const os = received.slice(n).find((r) => r.path === "/v1/traces")?.body?.resourceSpans?.[0]?.scopeSpans?.[0]?.spans?.[0];
		t("an outcome exports its own atelier.outcome span with the previous outcome", oc?.exported === true && os?.name === "atelier.outcome"
			&& os.attributes.some((x) => x.key === "atelier.outcome.previous" && x.value.stringValue === "clean"));
		process.env.ATELIER_TELEMETRY = "off";
		t("ATELIER_TELEMETRY=off records nothing", (await markCompanions({ decision: "proceed" })) === null);
		delete process.env.ATELIER_OTLP_ENDPOINT;
		delete process.env.ATELIER_TELEMETRY;
		const dead = await finishRun(join(dir, "missing"), {}, {});
		t("finish on an empty dir is a quiet no-op", dead.exported === false);
	} finally {
		for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
		Object.assign(process.env, saved);
		server.close();
		rmSync(dir, { recursive: true, force: true });
	}
	return done();
}

if (isMain(import.meta.url)) await main(process.argv.slice(2));
