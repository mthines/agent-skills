#!/usr/bin/env node
// preflight.mjs — what this repo lets an atelier run prove, checked before Build (SKILL.md Step 0).
//
//   node preflight.mjs [--repo <dir>] [--json] [--pr <url>] [--model <id>] [--ticket <id|url>] [--task "<title>"]
//        prints a capability table, then `PREFLIGHT: ok|limited — <n> gaps (<names>)`; begins the run's telemetry
//        (telemetry.mjs) — `--pr` marks a resumed run, `--model` names the model on the trace, `--ticket` and
//        `--task` name the work; with no `--pr`, the branch's open PR (gh, best effort) is recorded
//   node preflight.mjs --setup [--json] [--repo <dir>]
//        the same table, then one `SETUP: Skill(…) — fixes <gaps>` or `MANUAL: <check> — <fix>` line per step; no trace
//   node preflight.mjs --compare <before.json> [--repo <dir>]
//        `--setup --json`'s checks against a fresh read: a Before/After table, the PREFLIGHT line, `SETUP: <n> fixed, <m> remaining`
//   node preflight.mjs --self-test
// Reads only committed config: .agents/aw/release.yml (through deployment-verify's loadConfig), telemetry.yml,
// environments.yml (through deployment-verify's YAML subset reader, else a line scan for the keys it needs),
// and .github/workflows/*.yml (as text). A file neither can read is `unknown`, never a gap.
// Whether the telemetry MCP tool answers is the agent's check, not this script's: it cannot call a tool.
// It never blocks: exit 0 with any number of gaps, 2 on an error.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { isMain, makeTester, parseArgs, skillDir } from "./lib.mjs";
import { markPreflight } from "./telemetry.mjs";

function deploymentVerifyModule(file) {
	return import(pathToFileURL(join(skillDir("deployment-verify", "testing", "DEPLOYMENT_VERIFY_DIR"), "scripts", file)).href);
}

// Each check returns { name, ok, value, cannot }: `cannot` is what this run cannot prove when the check is a gap.

// `providers: []` is an answer someone gave (the repo has no flag system), not missing setup.
export const DECLARED_NONE = "none (release.yml declares no provider)";
const isDecided = (c) => c?.name === "flag-provider" && c.value === DECLARED_NONE;

export function flagCheck({ present, config = null, error = null }) {
	const name = "flag-provider";
	if (!present) return { name, ok: false, value: "none (no .agents/aw/release.yml)", cannot: "a human flips the flag; post-merge rollout not testable" };
	// A flag contract with no `env` loads `production` (merge-gate.mjs, tick.mjs): without it, the merge gate refuses every flagged change.
	if (/no environment "production"/.test(error ?? "")) {
		return { name, ok: false, value: "release.yml has no production environment", cannot: "the merge gate refuses every flag contract until release.yml has production (deploy: { detect: manual } when nothing is hosted)" };
	}
	if (error) return { name, ok: false, value: `release.yml does not load: ${error}`, cannot: "post-merge rollout not testable until release.yml loads" };
	const providers = (config?.flags?.providers || []).map((p) => p?.name).filter(Boolean);
	// Only an explicit `providers: []` is a decision; a release.yml with no flags block was never asked.
	const declared = Array.isArray(config?.flags?.providers);
	if (!providers.length) return { name, ok: false, value: declared ? DECLARED_NONE : "none (release.yml has no flags.providers)", cannot: "a human flips the flag; post-merge rollout not testable" };
	return { name, ok: true, value: providers.join(", "), cannot: "" };
}

export function telemetryCheck(config) {
	const name = "telemetry";
	if (!config) return { name, ok: false, value: "none (no .agents/aw/telemetry.yml)", cannot: "telemetry: criteria are unprovable" };
	if (config.unknown) return { name, ok: true, value: `unknown (could not parse telemetry.yml: ${config.unknown})`, cannot: "" };
	if (config.error) return { name, ok: false, value: `telemetry.yml does not parse: ${config.error}`, cannot: "telemetry: criteria are unprovable" };
	if (!config.backend || config.backend === "none") return { name, ok: false, backend: "none", value: "backend: none", cannot: "telemetry: criteria are unprovable" };
	const tool = config.mcp_server ? `${config.backend} (${config.mcp_server})` : config.backend;
	return { name, ok: true, backend: config.backend, value: `${tool} — the agent confirms its tool is callable`, cannot: "" };
}

// A sign-in strategy per environment; `none` is a valid answer (no login needed), a missing one is not.
export function signInCheck(config, envs = ["local", "preview"]) {
	const name = "sign-in";
	if (!config) return { name, ok: false, value: "none (no .agents/aw/environments.yml)", cannot: "signed-in UI criteria are unprovable — run /aw-verify setup" };
	if (config.unknown) return { name, ok: true, value: `unknown (could not parse environments.yml: ${config.unknown})`, cannot: "" };
	if (config.error) return { name, ok: false, value: `environments.yml does not parse: ${config.error}`, cannot: "signed-in UI criteria are unprovable" };
	const found = envs.map((e) => [e, config.environments?.[e]?.auth?.strategy]);
	const missing = found.filter(([e, s]) => config.environments?.[e] && !s).map(([e]) => e);
	const have = found.filter(([, s]) => s).map(([e, s]) => `${e}: ${s}`);
	if (!have.length) return { name, ok: false, value: "no auth.strategy for local or preview", cannot: "signed-in UI criteria are unprovable" };
	if (missing.length) return { name, ok: false, value: `${have.join(", ")}; ${missing.join(", ")}: no auth.strategy`, cannot: `signed-in UI criteria are unprovable on ${missing.join(", ")}` };
	return { name, ok: true, value: have.join(", "), cannot: "" };
}

// Does CI run on a draft PR? A workflow triggered by pull_request(_target) that guards on the draft flag,
// or that only listens for ready_for_review, skips drafts. Read as text: workflows use YAML block scalars.
export function draftGuarded(text) {
	if (!/^\s*(on:|"on":|'on':)/m.test(text) || !/\bpull_request(_target)?\b/.test(text)) return null;
	const guard = /pull_request\.draft\s*(==\s*false|!=\s*true)|!\s*github\.event\.pull_request\.draft/.test(text);
	const types = text.match(/\bpull_request(?:_target)?\s*:\s*\n?\s*types\s*:\s*\[([^\]]*)\]/);
	const onlyReady = !!types && /ready_for_review/.test(types[1]) && !/\b(opened|synchronize|reopened)\b/.test(types[1]);
	return guard || onlyReady;
}

export function ciDraftCheck(workflows) {
	const name = "ci-on-draft";
	const pr = workflows.map((w) => ({ ...w, guarded: draftGuarded(w.text) })).filter((w) => w.guarded !== null);
	if (!pr.length) return { name, ok: true, value: "unknown (no pull_request workflow)", cannot: "" };
	const skip = pr.filter((w) => w.guarded).map((w) => w.file);
	if (!skip.length) return { name, ok: true, value: `yes (${pr.length} pull_request workflow${pr.length === 1 ? "" : "s"})`, cannot: "" };
	return {
		name,
		ok: false,
		value: `no — ${skip.length} of ${pr.length} skip drafts (${skip.join(", ")})`,
		cannot: "CI evidence on a draft; Ready must undraft (notifies reviewers), or hold under --keep-draft",
	};
}

export function summarize(checks) {
	const gaps = checks.filter((c) => !c.ok).map((c) => c.name);
	const line = gaps.length ? `PREFLIGHT: limited — ${gaps.length} gap${gaps.length === 1 ? "" : "s"} (${gaps.join(", ")})` : "PREFLIGHT: ok — 0 gaps";
	return { gaps, line };
}

export function table(checks) {
	return [
		"| Capability | Status | Value | This run cannot prove |",
		"| --- | --- | --- | --- |",
		...checks.map((c) => `| ${c.name} | ${c.ok ? "ok" : "gap"} | ${c.value.replace(/\|/g, "\\|")} | ${c.cannot || "—"} |`),
	].join("\n");
}

// `/atelier setup` (SKILL.md § `setup`): which skill fixes each gap. The agent makes the calls; this only decides them.
// aw-verify runs first: deployment-verify's setup reads the telemetry.yml it writes.
export const PROFILE = join("memory", "observability-profile", "INDEX.md");

// `pipeline: false` = release.yml has no `pipeline:` block (absent file included); Deliver reads that block.
export const TRACKER = join(".agents", "aw", "tracker.yml");

// An observability profile maps traces and metrics; a repo whose telemetry.yml reads process logs (or none) has neither,
// so measurable's setup is not offered until it emits OpenTelemetry. No telemetry.yml yet: aw-verify setup decides first.
const NO_OTEL = new Set(["logs", "none"]);
export const noOtel = (checks) => NO_OTEL.has(checks.find((c) => c.name === "telemetry")?.backend);

export function setupPlan(checks, { profile = true, pipeline = true, tracker = true } = {}) {
	const gap = new Set(checks.filter((c) => !c.ok && !isDecided(c)).map((c) => c.name));
	const steps = checks.filter(isDecided).map(() => ({
		kind: "decided",
		name: "flag-provider",
		note: "release.yml declares providers: [], so a human flips flags; add a provider there to let /deployment-verify step them",
	}));
	const awVerifyFixes = ["sign-in", "telemetry"].filter((n) => gap.has(n));
	if (awVerifyFixes.length) steps.push({ kind: "skill", call: 'Skill("aw-verify", "setup")', fixes: awVerifyFixes });
	const deployFixes = [...(gap.has("flag-provider") ? ["flag-provider"] : []), ...(pipeline ? [] : ["pipeline (no release.yml pipeline:)"])];
	if (deployFixes.length) steps.push({ kind: "skill", call: 'Skill("deployment-verify", "setup")', fixes: deployFixes });
	if (!profile && noOtel(checks)) {
		const backend = checks.find((c) => c.name === "telemetry").backend;
		steps.push({ kind: "decided", name: "observability-profile", note: `telemetry.yml backend: ${backend} — no OpenTelemetry to profile; run /measurable setup once the app emits traces or metrics` });
	} else if (!profile) steps.push({ kind: "skill", call: 'Skill("measurable", "setup")', fixes: [`observability-profile (no ${PROFILE})`] });
	if (!tracker) steps.push({ kind: "skill", call: 'Skill("ticket", "setup")', fixes: [`tracker (no ${TRACKER})`] });
	const ci = checks.find((c) => c.name === "ci-on-draft" && !c.ok);
	if (ci) {
		steps.push({
			kind: "manual",
			name: "ci-on-draft",
			fix: `${ci.value} — remove the draft guard, or list opened, synchronize, reopened in the pull_request types; until then Ready undrafts to get CI`,
		});
	}
	return steps;
}

export function planLines(steps) {
	const line = { skill: (s) => `SETUP: ${s.call} — fixes ${s.fixes.join(", ")}`, manual: (s) => `MANUAL: ${s.name} — ${s.fix}`, decided: (s) => `DECIDED: ${s.name} — ${s.note}` };
	const lines = steps.map((s) => line[s.kind](s));
	return steps.some((s) => s.kind !== "decided") ? lines : ["SETUP: nothing to delegate", ...lines];
}

// A release.yml the reader cannot parse is not judged here: the flag-provider row already reports it.
// release.json wins when present, as in deployment-verify's loadConfig.
async function hasPipeline(repo) {
	const json = join(repo, ".agents", "aw", "release.json");
	if (existsSync(json)) {
		try {
			return !!JSON.parse(readFileSync(json, "utf8")).pipeline;
		} catch {
			return true;
		}
	}
	const release = await readYaml(join(repo, ".agents", "aw", "release.yml"));
	return !!release?.unknown || !!release?.pipeline;
}

export const PIPELINE_MANUAL = "MANUAL: pipeline — release.yml has no pipeline: block, so Deliver cannot read main's CI; re-run /deployment-verify setup and name the workflow";

// Before/after of the preflight checks only: the profile is reported by measurable's own setup, and a missing
// pipeline: block by the PIPELINE_MANUAL line, so neither is counted here.
// What setup writes that no preflight row reads: shown as rows and named after the count, never counted in it.
const SETUP_FILES = { pipeline: "release.yml pipeline:", profile: "observability profile", tracker: "tracker.yml" };

export async function setupState(repo) {
	return { pipeline: await hasPipeline(repo), profile: existsSync(join(repo, PROFILE)), tracker: existsSync(join(repo, TRACKER)) };
}

export function compareTable(before, after, { was: wasFiles = null, now: nowFiles = null } = {}) {
	const was = Object.fromEntries(before.map((c) => [c.name, c]));
	const now = Object.fromEntries(after.map((c) => [c.name, c]));
	const names = [...new Set([...before.map((c) => c.name), ...after.map((c) => c.name)])];
	const cell = (c) => (!c ? "—" : c.ok ? "ok" : "gap");
	const rows = names.map((n) => `| ${n} | ${cell(was[n])} | ${cell(now[n])} | ${(now[n]?.value ?? "").replace(/\|/g, "\\|")} |`);
	const fixed = names.filter((n) => was[n] && !was[n].ok && now[n]?.ok);
	const remaining = names.filter((n) => now[n] && !now[n].ok).map((n) => (isDecided(now[n]) ? `${n}: declared none` : n));
	let line = `SETUP: ${fixed.length} fixed, ${remaining.length} remaining${remaining.length ? ` (${remaining.join(", ")})` : ""}`;
	if (nowFiles) {
		const has = (v) => (v === undefined || v === null ? "—" : v ? "present" : "missing");
		const moot = noOtel(after) && nowFiles.profile === false;
		const files = Object.entries(SETUP_FILES)
			.filter(([k]) => k in nowFiles && !(k === "profile" && moot))
			.map(([k, label]) => ({ label, was: wasFiles?.[k], now: nowFiles[k] }));
		rows.push(...files.map((f) => `| ${f.label} | ${has(f.was)} | ${has(f.now)} | — |`));
		const notes = files.map((f) => (f.now ? (f.was === false ? `${f.label} added` : null) : `${f.label} missing`)).filter(Boolean);
		if (notes.length) line += `; ${notes.join(", ")}`;
	}
	return { text: ["| Capability | Before | After | Value now |", "| --- | --- | --- | --- |", ...rows].join("\n"), line };
}

const scalar = (v) => String(v ?? "").replace(/\s+#.*$/, "").trim().replace(/^(['"])(.*)\1$/, "$2");

// The keys preflight needs, read line by line from valid YAML the subset parser rejects (escaped strings,
// block scalars): top-level `backend:` / `mcp_server:`, and `environments.<env>.auth.strategy`.
export function scanYaml(text) {
	const out = {};
	let envIndent = -1;
	let inEnvs = false;
	let env = null;
	let authIndent = -1;
	let authChild = -1;
	let blockIndent = -1;
	for (const raw of String(text).split("\n")) {
		if (!raw.trim() || /^\s*#/.test(raw)) continue;
		const indent = raw.length - raw.trimStart().length;
		if (blockIndent >= 0 && indent > blockIndent) continue; // inside a `|` or `>` block scalar
		blockIndent = /:\s*[|>][-+0-9]*\s*(#.*)?$/.test(raw) ? indent : -1;
		const m = raw.trim().match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
		if (!m) continue;
		const [, key, rest] = m;
		if (indent === 0) {
			inEnvs = key === "environments";
			env = null;
			if (key === "backend" || key === "mcp_server") out[key] = scalar(rest);
			continue;
		}
		if (!inEnvs) continue;
		if (envIndent < 0) envIndent = indent;
		if (indent === envIndent) {
			env = key;
			authIndent = -1;
			out.environments ??= {};
			out.environments[env] = {};
			continue;
		}
		if (!env) continue;
		if (authIndent >= 0 && indent <= authIndent) authIndent = -1;
		if (key === "auth") {
			const flow = rest.match(/strategy:\s*([^,}\s]+)/);
			out.environments[env].auth = flow ? { strategy: scalar(flow[1]) } : {};
			if (!flow) authIndent = indent;
			authChild = -1;
		} else if (authIndent >= 0 && key === "strategy" && out.environments[env].auth && !("strategy" in out.environments[env].auth)) {
			// Only auth's own first-level strategy: a deeper `strategy:` (e.g. under refresh) is not the sign-in strategy.
			if (indent === authChild || authChild < 0) out.environments[env].auth.strategy = scalar(rest);
		}
		if (authIndent >= 0 && indent > authIndent && authChild < 0) authChild = indent;
	}
	return out;
}

async function readYaml(path) {
	if (!existsSync(path)) return null;
	const text = readFileSync(path, "utf8");
	const { parseYaml } = await deploymentVerifyModule("yaml-lite.mjs");
	try {
		return parseYaml(text) || {};
	} catch (e) {
		// A subset-parser miss on valid YAML is not a gap: scan for the keys, else report unknown.
		const scanned = scanYaml(text);
		return Object.keys(scanned).length ? scanned : { unknown: String(e.message).slice(0, 160) };
	}
}

export async function gather(repo) {
	const aw = join(repo, ".agents", "aw");
	const present = existsSync(join(aw, "release.yml")) || existsSync(join(aw, "release.json"));
	let flag = { present };
	if (present) {
		const { loadConfig } = await deploymentVerifyModule("tick.mjs");
		try {
			flag = { present, config: loadConfig("production", { cwd: repo }) };
		} catch (e) {
			flag = { present, error: e.message };
		}
	}
	const wfDir = join(repo, ".github", "workflows");
	const workflows = existsSync(wfDir)
		? readdirSync(wfDir)
				.filter((f) => /\.ya?ml$/.test(f))
				.map((f) => ({ file: f, text: readFileSync(join(wfDir, f), "utf8") }))
		: [];
	return [flagCheck(flag), telemetryCheck(await readYaml(join(aw, "telemetry.yml"))), signInCheck(await readYaml(join(aw, "environments.yml"))), ciDraftCheck(workflows)];
}

async function selfTest() {
	const { t, done } = makeTester("preflight");
	t("no release.yml → a gap that says a human flips the flag", !flagCheck({ present: false }).ok && /human flips/.test(flagCheck({ present: false }).cannot));
	t("providers: [] → a gap", !flagCheck({ present: true, config: { flags: { providers: [] } } }).ok);
	const noFlags = flagCheck({ present: true, config: { environments: { production: {} } } });
	t("✗ no flags block is not a declared none: setup delegates it", noFlags.value === "none (release.yml has no flags.providers)" && planLines(setupPlan([noFlags])).some((l) => /deployment-verify.*flag-provider/.test(l)), noFlags.value);
	t("a declared provider → ok", flagCheck({ present: true, config: { flags: { providers: [{ name: "launchdarkly" }] } } }).value === "launchdarkly");
	t("a release.yml that does not load → a gap naming the error", /does not load: boom/.test(flagCheck({ present: true, error: "boom" }).value));
	t("no telemetry.yml → a gap", !telemetryCheck(null).ok);
	t("backend none → a gap", !telemetryCheck({ backend: "none" }).ok);
	t("a dash0-mcp backend → ok, the tool check left to the agent", telemetryCheck({ backend: "dash0-mcp" }).ok && /agent confirms/.test(telemetryCheck({ backend: "dash0-mcp" }).value));
	t("no environments.yml → a gap", !signInCheck(null).ok);
	t("auth.strategy none counts as answered", signInCheck({ environments: { local: { auth: { strategy: "none" } } } }).ok);
	t("an environment with no strategy → a gap naming it", /preview: no auth\.strategy/.test(signInCheck({ environments: { local: { auth: { strategy: "storage-state" } }, preview: { url: "x" } } }).value));
	const wf = (body) => `name: ci\non:\n${body}\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: |\n          pnpm test\n`;
	t("✗ a plain pull_request workflow runs on drafts", draftGuarded(wf("  pull_request:")) === false);
	t("✓ an if: draft == false guard skips drafts", draftGuarded(`${wf("  pull_request:")}    if: github.event.pull_request.draft == false\n`) === true);
	t("✓ a !github.event.pull_request.draft guard skips drafts", draftGuarded(`${wf("  pull_request:")}    if: \${{ !github.event.pull_request.draft }}\n`) === true);
	t("a draft == true condition is not a skip-drafts guard", draftGuarded(`${wf("  pull_request:")}    if: github.event.pull_request.draft == true\n`) === false);
	t("✓ types: [ready_for_review] alone skips drafts", draftGuarded(wf("  pull_request:\n    types: [ready_for_review]")) === true);
	t("types with synchronize still runs on drafts", draftGuarded(wf("  pull_request:\n    types: [opened, synchronize, ready_for_review]")) === false);
	t("a push-only workflow is not a PR workflow", draftGuarded("on:\n  push:\n    branches: [main]\n") === null);
	const ci = ciDraftCheck([
		{ file: "ci.yml", text: `${wf("  pull_request:")}    if: github.event.pull_request.draft == false\n` },
		{ file: "lint.yml", text: wf("  pull_request:") },
	]);
	t("one guarded workflow of two → ci-on-draft gap naming it", !ci.ok && /1 of 2 skip drafts \(ci\.yml\)/.test(ci.value) && /undraft/.test(ci.cannot), ci.value);
	t("no workflows → not a gap", ciDraftCheck([]).ok);
	const all = [flagCheck({ present: false }), telemetryCheck({ backend: "dash0-mcp" }), signInCheck({ environments: { local: { auth: { strategy: "none" } } } }), ci];
	t("the summary line counts and names the gaps", summarize(all).line === "PREFLIGHT: limited — 2 gaps (flag-provider, ci-on-draft)", summarize(all).line);
	t("no gaps → ok", summarize([telemetryCheck({ backend: "logs" })]).line === "PREFLIGHT: ok — 0 gaps");
	// Constructs from a real repo's valid .agents/aw files that the yaml-lite subset parser rejects.
	const telemetryYml = [
		"version: 1", "backend: dash0-mcp  # the witness", "environments:", "  local: { namespace: lorekit }", "web:", "  event_patterns:",
		"    - \"track\\\\(\\\\{\\\\s*name:\\\\s*['\\\"]([^'\\\"]+)\"", "ingest_wait_seconds: 45",
	].join("\n");
	t("✓ an escaped regex in double quotes still yields the backend", telemetryCheck(scanYaml(telemetryYml)).ok && scanYaml(telemetryYml).backend === "dash0-mcp", JSON.stringify(scanYaml(telemetryYml)));
	const envYml = [
		"version: 1", "environments:", "  local:", "    url: http://localhost:3000", "    auth:", "      strategy: storage-state", "      refresh:",
		"        command: |", "          set -a", "          strategy: not-this-one", "        timeout_seconds: 120", "  preview:", "    url:", "      from: pr-deployment",
		"    auth:", "      # comment", "      refresh:", "        strategy: nested-not-this", "      strategy: 'storage-state'", "  ci:", "    auth: { strategy: none }",
	].join("\n");
	const sc = scanYaml(envYml);
	t("✓ a command: | block scalar does not hide auth.strategy", signInCheck(sc).ok && sc.environments.local.auth.strategy === "storage-state" && sc.environments.preview.auth.strategy === "storage-state"
		&& sc.environments.ci.auth.strategy === "none", JSON.stringify(sc));
	t("✗ an environment with no auth is still a gap after a scan", !signInCheck(scanYaml("environments:\n  local:\n    url: x\n  preview:\n    url: y")).ok);
	const tmp = mkdtempSync(join(tmpdir(), "atelier-preflight-"));
	try {
		mkdirSync(join(tmp, ".agents", "aw"), { recursive: true });
		writeFileSync(join(tmp, ".agents", "aw", "telemetry.yml"), telemetryYml);
		writeFileSync(join(tmp, ".agents", "aw", "environments.yml"), envYml);
		const got = await gather(tmp);
		const by = Object.fromEntries(got.map((c) => [c.name, c]));
		t("gather: files yaml-lite rejects are read by the scan, not reported as gaps", by.telemetry.ok && by["sign-in"].ok && summarize(got).gaps.join() === "flag-provider", summarize(got).line);
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
	t("a file nothing can read is unknown, not a gap", telemetryCheck({ unknown: "boom" }).ok && /unknown/.test(signInCheck({ unknown: "boom" }).value) && signInCheck({ unknown: "boom" }).ok);
	t("the table escapes pipes", table([{ name: "x", ok: false, value: "a|b", cannot: "c" }]).includes("a\\|b"));
	const bare = [flagCheck({ present: false }), telemetryCheck(null), signInCheck(null), ciDraftCheck([])];
	const plan = planLines(setupPlan(bare, { profile: false }));
	t("setup: sign-in and telemetry go to one aw-verify setup, before deployment-verify", plan[0] === 'SETUP: Skill("aw-verify", "setup") — fixes sign-in, telemetry' && /deployment-verify.*flag-provider/.test(plan[1]), plan.join(" / "));
	t("setup: a missing tracker.yml adds ticket setup, last", planLines(setupPlan(bare, { tracker: false })).at(-1) === 'SETUP: Skill("ticket", "setup") — fixes tracker (no .agents/aw/tracker.yml)');
	t("setup: a missing profile adds measurable setup; a present one does not", plan.some((l) => /measurable/.test(l)) && !planLines(setupPlan(bare)).some((l) => /measurable/.test(l)));
	const logs = [telemetryCheck({ backend: "logs" })];
	t("setup: a logs backend decides the profile instead of calling measurable", planLines(setupPlan(logs, { profile: false })).join() === "SETUP: nothing to delegate,DECIDED: observability-profile — telemetry.yml backend: logs — no OpenTelemetry to profile; run /measurable setup once the app emits traces or metrics" && planLines(setupPlan([telemetryCheck({ backend: "dash0-mcp" })], { profile: false })).some((l) => /measurable/.test(l)));
	t("compare: a logs backend shows no missing profile", !/observability profile/.test(compareTable(logs, logs, { was: { profile: false }, now: { profile: false } }).text + compareTable(logs, logs, { was: { profile: false }, now: { profile: false } }).line));
	const manual = planLines(setupPlan([ci]));
	t("setup: ci-on-draft is one manual line naming the workflow", manual.length === 1 && /^MANUAL: ci-on-draft — no — 1 of 2 skip drafts \(ci\.yml\)/.test(manual[0]), manual.join(" / "));
	t("setup: a provider but no pipeline: block still calls deployment-verify setup", planLines(setupPlan([flagCheck({ present: true, config: { flags: { providers: [{ name: "posthog" }] } } })], { pipeline: false })).join() === 'SETUP: Skill("deployment-verify", "setup") — fixes pipeline (no release.yml pipeline:)');
	const noPipe = mkdtempSync(join(tmpdir(), "atelier-preflight-"));
	try {
		mkdirSync(join(noPipe, ".agents", "aw"), { recursive: true });
		writeFileSync(join(noPipe, ".agents", "aw", "release.yml"), "environments:\n  production:\n    url: x\n");
		const before = await hasPipeline(noPipe);
		writeFileSync(join(noPipe, ".agents", "aw", "release.yml"), "environments:\n  production:\n    url: x\npipeline:\n  workflow: CI\n");
		t("compare: a release.yml without pipeline: is reported, one with it is not", before === false && (await hasPipeline(noPipe)) === true && /^MANUAL: pipeline — /.test(PIPELINE_MANUAL));
		writeFileSync(join(noPipe, ".agents", "aw", "release.json"), JSON.stringify({ environments: {} }));
		t("a release.json wins over release.yml, as loadConfig reads it", (await hasPipeline(noPipe)) === false);
	} finally {
		rmSync(noPipe, { recursive: true, force: true });
	}
	t("setup: no gaps and a profile → nothing to delegate", planLines(setupPlan([telemetryCheck({ backend: "logs" })])).join() === "SETUP: nothing to delegate");
	const declared = flagCheck({ present: true, config: { flags: { providers: [] } } });
	const decidedPlan = planLines(setupPlan([declared]));
	t("✗ providers: [] is not sent back to deployment-verify setup on every run", !decidedPlan.some((l) => /^SETUP: Skill/.test(l)) && decidedPlan[0] === "SETUP: nothing to delegate" && /^DECIDED: flag-provider — /.test(decidedPlan[1]), decidedPlan.join(" / "));
	const withFiles = compareTable([declared], [declared], { was: { pipeline: false, profile: false }, now: { pipeline: true, profile: false } });
	t("compare: setup files are rows and named after the count, not counted", withFiles.line === "SETUP: 0 fixed, 1 remaining (flag-provider: declared none); release.yml pipeline: added, observability profile missing" && withFiles.text.includes("| release.yml pipeline: | missing | present | — |"), withFiles.line);
	t("compare: a declared-none provider is named as such", compareTable([flagCheck({ present: false })], [declared]).line === "SETUP: 0 fixed, 1 remaining (flag-provider: declared none)");
	const noProd = flagCheck({ present: true, error: 'release.yml has no environment "production"' });
	t("✓ a release.yml with no production environment names the merge-gate consequence", noProd.value === "release.yml has no production environment" && /merge gate refuses/.test(noProd.cannot) && planLines(setupPlan([noProd])).some((l) => /deployment-verify.*flag-provider/.test(l)), noProd.value);
	const cmp = compareTable(bare, [flagCheck({ present: false }), telemetryCheck({ backend: "logs" }), signInCheck(null), ciDraftCheck([])]);
	t("compare: counts fixed and names the remaining gaps", cmp.line === "SETUP: 1 fixed, 2 remaining (flag-provider, sign-in)", cmp.line);
	t("compare: one row per capability with before and after", cmp.text.includes("| telemetry | gap | ok |") && cmp.text.startsWith("| Capability | Before | After |"), cmp.text);
	return done();
}

async function main() {
	const a = parseArgs(process.argv.slice(2));
	if (a["self-test"]) process.exit(await selfTest());
	const startNs = BigInt(Date.now()) * 1_000_000n;
	try {
		const repo = typeof a.repo === "string" ? a.repo : process.cwd();
		const checks = await gather(repo);
		const { gaps, line } = summarize(checks);
		// Setup modes start no trace: they are not a run.
		if (a.setup) {
			const files = await setupState(repo);
			const steps = setupPlan(checks, files);
			if (a.json) console.log(JSON.stringify({ checks, gaps, steps, files }, null, 2));
			else console.log([table(checks), line, ...planLines(steps)].join("\n"));
			return;
		}
		if (typeof a.compare === "string") {
			const before = JSON.parse(readFileSync(a.compare, "utf8"));
			const files = await setupState(repo);
			const { text, line: setupLine } = compareTable(before.checks, checks, { was: before.files, now: files });
			console.log([text, line, setupLine, ...(files.pipeline ? [] : [PIPELINE_MANUAL])].join("\n"));
			return;
		}
		if (a.json) console.log(JSON.stringify({ checks, gaps }, null, 2));
		else console.log(table(checks));
		console.log(line);
		await markPreflight({
			startNs, status: gaps.length ? "limited" : "ok", gaps,
			pr: typeof a.pr === "string" ? a.pr : null, model: typeof a.model === "string" ? a.model : null,
			ticket: typeof a.ticket === "string" ? a.ticket : null, task: typeof a.task === "string" ? a.task : null, lookupPr: true, cwd: repo,
		});
	} catch (e) {
		console.error(`preflight: ${e.message}`);
		process.exit(2);
	}
}

if (isMain(import.meta.url)) main();
