#!/usr/bin/env node
// preflight.mjs — what this repo lets an atelier run prove, checked before Build (SKILL.md Step 0).
//
//   node preflight.mjs [--repo <dir>] [--json]   prints a capability table, then `PREFLIGHT: ok|limited — <n> gaps (<names>)`
//   node preflight.mjs --self-test
// Reads only committed config: .agents/aw/release.yml (through deployment-verify's loadConfig), telemetry.yml,
// environments.yml (through deployment-verify's YAML reader), and .github/workflows/*.yml (as text).
// Whether the telemetry MCP tool answers is the agent's check, not this script's: it cannot call a tool.
// It never blocks: exit 0 with any number of gaps, 2 on an error.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { isMain, makeTester, parseArgs, skillDir } from "./lib.mjs";

function deploymentVerifyModule(file) {
	return import(pathToFileURL(join(skillDir("deployment-verify", "testing", "DEPLOYMENT_VERIFY_DIR"), "scripts", file)).href);
}

// Each check returns { name, ok, value, cannot }: `cannot` is what this run cannot prove when the check is a gap.

export function flagCheck({ present, config = null, error = null }) {
	const name = "flag-provider";
	if (!present) return { name, ok: false, value: "none (no .agents/aw/release.yml)", cannot: "a human flips the flag; post-merge rollout not testable" };
	if (error) return { name, ok: false, value: `release.yml does not load: ${error}`, cannot: "post-merge rollout not testable until release.yml loads" };
	const providers = (config?.flags?.providers || []).map((p) => p?.name).filter(Boolean);
	if (!providers.length) return { name, ok: false, value: "none (release.yml declares no provider)", cannot: "a human flips the flag; post-merge rollout not testable" };
	return { name, ok: true, value: providers.join(", "), cannot: "" };
}

export function telemetryCheck(config) {
	const name = "telemetry";
	if (!config) return { name, ok: false, value: "none (no .agents/aw/telemetry.yml)", cannot: "telemetry: criteria are unprovable" };
	if (config.error) return { name, ok: false, value: `telemetry.yml does not parse: ${config.error}`, cannot: "telemetry: criteria are unprovable" };
	if (!config.backend || config.backend === "none") return { name, ok: false, value: "backend: none", cannot: "telemetry: criteria are unprovable" };
	const tool = config.mcp_server ? `${config.backend} (${config.mcp_server})` : config.backend;
	return { name, ok: true, value: `${tool} — the agent confirms its tool is callable`, cannot: "" };
}

// A sign-in strategy per environment; `none` is a valid answer (no login needed), a missing one is not.
export function signInCheck(config, envs = ["local", "preview"]) {
	const name = "sign-in";
	if (!config) return { name, ok: false, value: "none (no .agents/aw/environments.yml)", cannot: "signed-in UI criteria are unprovable — run /aw-verify setup" };
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

async function readYaml(path) {
	if (!existsSync(path)) return null;
	const { parseYaml } = await deploymentVerifyModule("yaml-lite.mjs");
	try {
		return parseYaml(readFileSync(path, "utf8")) || {};
	} catch (e) {
		return { error: e.message };
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

function selfTest() {
	const { t, done } = makeTester("preflight");
	t("no release.yml → a gap that says a human flips the flag", !flagCheck({ present: false }).ok && /human flips/.test(flagCheck({ present: false }).cannot));
	t("providers: [] → a gap", !flagCheck({ present: true, config: { flags: { providers: [] } } }).ok);
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
	t("the table escapes pipes", table([{ name: "x", ok: false, value: "a|b", cannot: "c" }]).includes("a\\|b"));
	return done();
}

async function main() {
	const a = parseArgs(process.argv.slice(2));
	if (a["self-test"]) process.exit(selfTest());
	try {
		const checks = await gather(typeof a.repo === "string" ? a.repo : process.cwd());
		const { gaps, line } = summarize(checks);
		if (a.json) console.log(JSON.stringify({ checks, gaps }, null, 2));
		else console.log(table(checks));
		console.log(line);
	} catch (e) {
		console.error(`preflight: ${e.message}`);
		process.exit(2);
	}
}

if (isMain(import.meta.url)) main();
