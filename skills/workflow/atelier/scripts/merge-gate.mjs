#!/usr/bin/env node
// merge-gate.mjs — atelier's deterministic merge gate (rules/merge-gate.md).
//
// Refuses a merge when CI did not run green on the PR's current head, when the diff is user-visible
// and the PR body has no deployment-verify contract that names a flag (a small change the author
// classed with an `atelier:no-flag` marker is the exception, unless a hard trigger hits), when a repo with a hosted
// production service gets a PR with neither a contract nor a `deployment-verify:none` opt-out, or when
// the PR's verify report does not show every acceptance criterion proven (the proof half).
// Owns no detector of its own:
//   CI ran green  = prepare's scripts/ci-ran.mjs (ciStatus/classify), read at the head right now
//   user-visible  = ui-verify's scripts/is-ui-diff.mjs, run by path
//   flag contract = deployment-verify's parseContract() from scripts/tick.mjs
//   proof         = aw-verify's checkReport() from scripts/verify-comment.mjs (the `--check` gate)
//
//   node merge-gate.mjs --pr <n|url>                          files, body, and CI via gh
//   node merge-gate.mjs --pr <n|url> --early                  the contract, and a verify report in the template shape; no CI read,
//                                                             no --proven (atelier's early gate after Build)
//   node merge-gate.mjs --pr <n|url> --contract-only          the contract half only (decision-log's user_visible fill)
//   node merge-gate.mjs --files "a.tsx,b.md" --body-file <f> (--rollup-file <json> | --early | --contract-only)   offline;
//                                                             add --comments-file <json array of bodies> for a report in a comment
//   add --surface-json '<json>' | --surface-file <path>       forwarded to is-ui-diff; without either,
//                                                             the surface in <repo-dir>/.agents/aw/ui.yml is used
//   add --files-json <path>                                   offline: `gh pr view --json files` (path, additions, deletions, changeType),
//                                                             what the no-flag triggers count; without it a no-flag marker is refused
//   add --repo-dir <path>                                     where .agents/aw/ lives (default: cwd)
//   node merge-gate.mjs --self-test
//
// Prints one JSON object, then a final line `MERGE_GATE: pass|refuse — <reason>`.
// Exit: 0 pass, 1 refuse, 2 error. Adds what it saw to the open atelier run's telemetry (telemetry.mjs).

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { globToRegExp } from "./approval-wait.mjs";
import { isMain, makeTester, parseArgs, skillDir } from "./lib.mjs";
import { repoHasCi, repoMatchesPr } from "./preflight.mjs";
import { markGate } from "./telemetry.mjs";

export const CONTRACT_DOC = "skills/testing/deployment-verify/rules/contract.md";

function uiVerifyScript() {
	return join(skillDir("ui-verify", "testing", "UI_VERIFY_DIR"), "scripts", "is-ui-diff.mjs");
}

function prepareModule(file) {
	return import(pathToFileURL(join(skillDir("prepare", "delivery", "PREPARE_DIR"), "scripts", file)).href);
}

// CI at the PR's current head, through prepare's own definition of "CI ran"; `run` is injectable for tests.
export async function ciCheck(pr, { run } = {}) {
	const { ciStatus } = await prepareModule("ci-ran.mjs");
	return ciStatus(pr, run ? { run } : {});
}

// The same decision from a saved `gh api graphql` response of ci-ran.mjs's query (offline mode).
export async function ciFromRollup(json) {
	const { classify, fromResponses, normalize } = await prepareModule("ci-ran.mjs");
	const { head, nodes } = fromResponses([json]);
	return classify(nodes.map(normalize), { head });
}

// The proof half: aw-verify's own end-of-run gate over the PR body and its comments (newest first).
// Returns the problems `verify-comment.mjs --check --proven` would print; [] means `report complete`.
// --proven: a complete report can still say ❌ Not verified or ⛔ Blocked, which a merge must refuse.
// `proven: false` (the early gate) asks only that the report exists in the template shape: right after Build, before
// Ready's fixes move the head, a verdict tied to a head is not yet the question.
export async function proofCheck({ body, comments = [], ui = false, head = null, proven = true }) {
	const { checkReport, provenProblems } = await import(pathToFileURL(join(skillDir("aw-verify", "testing", "AW_VERIFY_DIR"), "scripts", "verify-comment.mjs")).href);
	return [...checkReport(body, comments, { ui }), ...(proven ? provenProblems(body, comments, { head }) : [])];
}

// A merge needs proof that every acceptance criterion holds: the PR's verify report, ticked, in the template shape.
export function decideProof(problems, { ui = false, early = false } = {}) {
	if (!problems?.length) return null;
	const more = problems.length > 1 ? ` (+${problems.length - 1} more)` : "";
	const run = ui ? "/aw-verify run preview <pr>: a UI diff" : "/aw-verify run checks <pr>: no UI file, so recorded test runs prove each criterion";
	return {
		decision: "refuse",
		reason: `no proof the criteria hold: ${problems[0]}${more}`,
		how: [
			early ? `Still in Build: run ${run.split(":")[0]} now (${run}),` : `Record this on Ready (failed), then run /aw-verify on <pr> (${run}),`,
			early ? `until verify-comment.mjs --pr <pr> --check${ui ? " --ui" : ""} prints \`report complete\`, then run this early gate again. What the report lacks:`
				: `until verify-comment.mjs --pr <pr> --check${ui ? " --ui" : ""} --proven prints \`report complete\`, then re-run /atelier <pr>. What the report lacks:`,
			...problems.map((p) => `  - ${p}`),
		].join("\n"),
		proof: problems,
	};
}

function deploymentVerifyModule(file) {
	return import(pathToFileURL(join(skillDir("deployment-verify", "testing", "DEPLOYMENT_VERIFY_DIR"), "scripts", file)).href);
}

// The repo's learned UI surface, as is-ui-diff takes it; ui.yml is parsed with deployment-verify's YAML reader.
export async function repoSurface(repoDir) {
	const path = join(repoDir, ".agents", "aw", "ui.yml");
	if (!existsSync(path)) return null;
	const { parseYaml } = await deploymentVerifyModule("yaml-lite.mjs");
	const surface = parseYaml(readFileSync(path, "utf8"))?.surface;
	return surface ? JSON.stringify(surface) : null;
}

// Runs is-ui-diff by path; its `UI_DIFF:` line is the answer, never its exit code.
export function userVisible(files, { surfaceJson, surfaceFile } = {}) {
	const args = [uiVerifyScript(), "--files", files.join(",")];
	if (surfaceJson) args.push("--surface-json", surfaceJson);
	if (surfaceFile) args.push("--surface-file", surfaceFile);
	const r = spawnSync(process.execPath, args, { encoding: "utf8" });
	const line = (r.stdout || "").match(/^UI_DIFF: (yes|no)$/m);
	if (!line) throw new Error(`is-ui-diff gave no UI_DIFF line: ${(r.stderr || r.stdout || "").trim().slice(0, 200)}`);
	let matched = [];
	try {
		matched = JSON.parse(r.stdout.slice(0, line.index)).matched?.map((m) => m.path) ?? [];
	} catch {
		/* the JSON is informational; the line decides */
	}
	return { isUI: line[1] === "yes", matched };
}

// deployment-verify's own parse and validation: a contract the gate passes is one /deployment-verify accepts,
// except for the flag's provider. The gate asks "behind a flag a human can turn off", not "can
// /deployment-verify step it": with no matching provider in release.yml (or no release.yml, or
// `providers: []`), or a contract that names no provider, passes with NO_PROVIDER_WARNING and the cohort, which only a provider
// can split on, is not required. Every other validateContract() failure still refuses.
// A release.yml that exists but does not load refuses, because /deployment-verify would stop on it too.
export const NO_PROVIDER_WARNING = "deployment-verify cannot step this flag here: no provider; a human flips it";

export async function flagContract(body, repoDir = process.cwd()) {
	const { parseContract, loadConfig, validateContract } = await deploymentVerifyModule("tick.mjs");
	const { contract, error } = parseContract(body || "");
	const parsed = !error && contract && typeof contract === "object";
	let config;
	const releaseDir = join(repoDir, ".agents", "aw");
	if (existsSync(join(releaseDir, "release.yml")) || existsSync(join(releaseDir, "release.json"))) {
		try {
			config = loadConfig((parsed && contract.env) || "production", { cwd: repoDir });
		} catch (e) {
			// An unparsed contract has no environment to load: the refusal below names the parse failure instead.
			if (parsed) return { has: false, missing: "invalid", detail: e.message, providers: [] };
		}
	} else {
		const { DEFAULT_THRESHOLDS } = await deploymentVerifyModule("decide.mjs");
		config = { flags: { providers: [] }, thresholds: DEFAULT_THRESHOLDS };
	}
	const providers = (config?.flags?.providers || []).map((p) => p.name).filter(Boolean);
	// A `rollout: pr` provider splits no traffic, so a refusal asks for a cohort only when another provider could.
	const cohort = (config?.flags?.providers || []).some((p) => p?.name && p.rollout !== "pr");
	const out = (r) => ({ ...r, providers, cohort });
	if (error) return out({ has: false, missing: error.startsWith("no contract") ? "contract" : "valid-json", detail: error });
	if (!parsed) return out({ has: false, missing: "valid-json", detail: "the contract is not a JSON object" });
	const key = contract.flag?.key;
	// A contract with no flag is measured before/after the deploy: valid for a non-UI diff in a hosted repo, never for a UI one.
	if (typeof key !== "string" || !key.trim()) return out({ has: false, missing: "flag", detail: "the contract names no flag", noFlag: !contract.flag && config ? !validateContract(contract, config) : false, noFlagDetail: config ? validateContract(contract, config) : null });
	const steppable = providers.includes(contract.flag.provider);
	// A provider name release.yml does not declare, in a repo that declares some, is a typo, not "no provider":
	// passing it would silently drop the stepped rollout the author asked for.
	if (!steppable && providers.length && contract.flag.provider) {
		return out({ has: false, missing: "invalid", detail: `unknown provider ${contract.flag.provider} (release.yml declares ${providers.join(", ")})` });
	}
	// No provider to step it: validate the rest against a stand-in provider, and a cohort nobody can split on is not asked for.
	const checked = steppable ? contract : { ...contract, cohort: contract.cohort ?? { unused: "no provider" } };
	const checkedConfig = steppable ? config : { ...config, flags: { ...config.flags, providers: [{ name: contract.flag.provider }] } };
	const invalid = validateContract(checked, checkedConfig);
	if (invalid) return out({ has: false, missing: "invalid", detail: invalid });
	return out({ has: true, flag: key, warning: steppable ? null : NO_PROVIDER_WARNING });
}

// A repo whose release.yml production environment detects its deploys has a service deployment-verify can watch.
// `detect: manual`, no release.yml, or one that does not load → not hosted: today's rule (a contract only for a UI diff).
export async function hostedRepo(repoDir = process.cwd()) {
	const releaseDir = join(repoDir, ".agents", "aw");
	if (!existsSync(join(releaseDir, "release.yml")) && !existsSync(join(releaseDir, "release.json"))) return false;
	const { loadConfig } = await deploymentVerifyModule("tick.mjs");
	try {
		const detect = loadConfig("production", { cwd: repoDir }).environment?.deploy?.detect;
		return Boolean(detect) && detect !== "manual";
	} catch {
		return false;
	}
}

// `<!-- deployment-verify:none — <reason> -->`: the author's word that the change deploys nothing to watch.
export const OPT_OUT_RE = /<!--\s*deployment-verify:none\b\s*[—–-]*\s*([\s\S]*?)\s*-->/;
export function optOut(body) {
	const m = (body || "").match(OPT_OUT_RE);
	return m ? { reason: m[1].trim() } : null;
}

// A small user-visible change may ship without a flag; a big or structural one may not (rules/flag-policy.md).
// The triggers are the gate's to check and the author cannot override them; the class is the author's word, so it is
// a closed list. A repo overrides any default under `flag_policy` in .agents/aw/merge.yml.
export const NO_FLAG_CLASSES = ["bugfix", "copy", "style", "a11y", "refactor", "internal", "already-flagged"];
export const DEFAULT_FLAG_POLICY = {
	maxUnflaggedLines: 150,
	maxNewUiFiles: 2,
	routeGlobs: ["**/app/**/page.tsx", "**/app/**/page.ts", "**/app/**/page.jsx", "**/app/**/page.js", "**/pages/**"],
	alwaysFlag: [],
	classes: NO_FLAG_CLASSES,
	requireFlag: false,
};
export const NO_DEPLOY_VERIFY_WARNING = "no deploy verify runs here: nothing watches this change after the merge";

// `flag_policy` from .agents/aw/merge.yml over the defaults, parsed with deployment-verify's YAML reader; absent file or block → defaults.
// A value that cannot be read throws: the gate then exits 2 and never merges on a policy it misread.
export async function loadFlagPolicy(repoDir) {
	const path = join(repoDir, ".agents", "aw", "merge.yml");
	if (!existsSync(path)) return DEFAULT_FLAG_POLICY;
	const { parseYaml } = await deploymentVerifyModule("yaml-lite.mjs");
	const p = (parseYaml(readFileSync(path, "utf8")) ?? {}).flag_policy;
	if (!p) return DEFAULT_FLAG_POLICY;
	const list = (v) => (v === undefined || v === null ? undefined : (Array.isArray(v) ? v : [v]).map(String));
	const number = (v, label) => {
		if (v === undefined || v === null) return undefined;
		const n = Number(v);
		if (!Number.isFinite(n) || n < 0) throw new Error(`.agents/aw/merge.yml flag_policy.${label} must be a non-negative number, got ${v}`);
		return n;
	};
	const classes = list(p.classes);
	const unknown = (classes ?? []).filter((c) => !NO_FLAG_CLASSES.includes(c));
	if (unknown.length) throw new Error(`.agents/aw/merge.yml flag_policy.classes has unknown ${unknown.join(", ")} (one of ${NO_FLAG_CLASSES.join(", ")})`);
	if (p.require_flag !== undefined && p.require_flag !== "always") throw new Error(`.agents/aw/merge.yml flag_policy.require_flag must be "always", got ${p.require_flag}`);
	return {
		maxUnflaggedLines: number(p.max_unflagged_lines, "max_unflagged_lines") ?? DEFAULT_FLAG_POLICY.maxUnflaggedLines,
		maxNewUiFiles: number(p.max_new_ui_files, "max_new_ui_files") ?? DEFAULT_FLAG_POLICY.maxNewUiFiles,
		routeGlobs: list(p.route_globs) ?? DEFAULT_FLAG_POLICY.routeGlobs,
		alwaysFlag: list(p.always_flag) ?? DEFAULT_FLAG_POLICY.alwaysFlag,
		classes: classes ?? DEFAULT_FLAG_POLICY.classes,
		requireFlag: p.require_flag === "always",
	};
}

// `gh pr view --json files` ([{ path, additions, deletions, changeType }]) as { [path]: { status, additions, deletions } }.
export function diffStats(files) {
	return Object.fromEntries((files || []).map((f) => [f.path, { status: String(f.changeType || f.status || "").toLowerCase(), additions: Number(f.additions) || 0, deletions: Number(f.deletions) || 0 }]));
}

// The hard triggers: why this user-visible diff needs a flag whatever the author says. [] = none hit.
// `null` = unknown (no stats, a UI file missing from them, or a file with no change type): the caller fails closed.
// `matched` are the diff's UI files (is-ui-diff already leaves tests out); routes and the always-flag list look at every changed file.
// A route that is renamed or copied into a route glob is a new URL, so it counts as new; a rename adds no code, so it is not a new file.
export function flagTriggers({ files, matched, stats, policy = DEFAULT_FLAG_POLICY }) {
	if (!stats || matched.some((p) => !stats[p]) || Object.values(stats).some((f) => !f.status)) return null;
	const any = (p, globs) => globs.map(globToRegExp).some((re) => re.test(p));
	const hits = [];
	const routes = files.filter((p) => ["added", "renamed", "copied"].includes(stats[p]?.status) && any(p, policy.routeGlobs));
	if (routes.length) hits.push(`new route ${routes[0]}${routes.length > 1 ? ` (+${routes.length - 1} more)` : ""}`);
	const always = files.filter((p) => any(p, policy.alwaysFlag));
	if (always.length) hits.push(`${always[0]} is on the repo's always-flag list${always.length > 1 ? ` (+${always.length - 1} more)` : ""}`);
	const lines = matched.reduce((n, p) => n + stats[p].additions + stats[p].deletions, 0);
	if (lines > policy.maxUnflaggedLines) hits.push(`${lines} changed UI lines, over the limit of ${policy.maxUnflaggedLines}`);
	const added = matched.filter((p) => ["added", "copied"].includes(stats[p].status)).length;
	if (added > policy.maxNewUiFiles) hits.push(`${added} new UI files, over the limit of ${policy.maxNewUiFiles}`);
	return hits;
}

// `<!-- atelier:no-flag — <class>: <why> -->` (`already-flagged <flag>: <why>` names the flag): the author's word that
// this small change needs no rollout. Returns the parts; whether they are acceptable is noFlagProblem()'s call.
export const NO_FLAG_RE = /<!--\s*atelier:no-flag\b\s*[—–-]*\s*([\s\S]*?)\s*-->/;
export function parseNoFlag(body) {
	const m = (body || "").match(NO_FLAG_RE);
	if (!m) return null;
	const p = m[1].trim().match(/^([A-Za-z][A-Za-z-]*)(?:[ \t]+([^\s:]+))?[ \t]*(?::\s*([\s\S]*))?$/);
	return p ? { class: p[1].toLowerCase(), flag: p[2] || "", reason: (p[3] || "").trim() } : { class: "", flag: "", reason: "" };
}

export function noFlagProblem(nf, policy = DEFAULT_FLAG_POLICY) {
	if (!nf.class) return "the atelier:no-flag marker names no class";
	if (!policy.classes.includes(nf.class)) return `the atelier:no-flag class "${nf.class}" is not allowed (one of ${policy.classes.join(", ")})`;
	if (nf.class === "already-flagged" && !nf.flag) return "already-flagged needs the flag key: <!-- atelier:no-flag — already-flagged <flag>: <why> -->";
	if (!nf.reason) return "the atelier:no-flag marker gives no reason";
	return null;
}

// The hosted-repo rule for a non-UI diff: a valid contract (flag or before/after) or an opt-out with a reason.
function decideHosted(contract, opt) {
	if (contract.has) return { decision: "pass", reason: `not user-visible, behind flag ${contract.flag}` };
	if (contract.noFlag) return { decision: "pass", reason: "not user-visible; before/after deployment-verify contract" };
	if (contract.missing === "contract" && opt?.reason) return { decision: "pass", reason: `deploys nothing to verify: ${opt.reason}` };
	const what = contract.missing !== "contract"
		? `the deployment-verify:v1 contract is not valid (${contract.missing === "flag" ? contract.noFlagDetail || "a flag with no key" : contract.detail})`
		: opt ? "the deployment-verify:none marker gives no reason" : "neither a deployment-verify:v1 contract nor a deployment-verify:none marker in the PR body";
	return {
		decision: "refuse",
		reason: `hosted production service, ${what}`,
		how: [
			"Every change to a repo with a hosted service is verified after its deploy. Before the merge, either:",
			"node <deployment-verify>/scripts/tick.mjs --draft-contract --pr <n>   # prints a draft from the PR's criteria",
			'fill "service" and "root_spans" (no "flag": it is measured before/after the deploy) and put the JSON between',
			`<!-- deployment-verify:v1 --> and <!-- /deployment-verify:v1 --> (${CONTRACT_DOC}); or, for a change that deploys nothing,`,
			"add <!-- deployment-verify:none — <why nothing deployed can change> --> to the PR body.",
		].join("\n"),
	};
}

// A user-visible diff with no flag: allowed only for a small change the author classed, with no hard trigger hit,
// and in a hosted repo only with the before/after contract that lets Deliver watch the deploy.
function decideNoFlag({ nf, triggers, contract, hosted, policy, flagRefusal }) {
	const refuse = (why, how) => ({ decision: "refuse", reason: `user-visible diff, ${why}`, how: how ?? flagRefusal.how });
	const problem = noFlagProblem(nf, policy);
	if (problem) return refuse(problem);
	if (triggers === null) return refuse("the diff's size is unknown, so the no-flag marker cannot be checked", "Run the gate with --pr, or offline with --files-json <gh pr view --json files>, so it can count lines and new files.");
	if (triggers.length) return { ...flagRefusal, reason: `user-visible diff, a flag is required: ${triggers.join("; ")}` };
	const label = `no flag (${nf.class}${nf.flag ? ` ${nf.flag}` : ""}): ${nf.reason}`;
	if (!hosted) return { decision: "pass", reason: `user-visible, ${label}; ${NO_DEPLOY_VERIFY_WARNING}`, warning: NO_DEPLOY_VERIFY_WARNING };
	if (contract.noFlag) return { decision: "pass", reason: `user-visible, ${label}; verified on the deploy` };
	const why = contract.missing === "contract" ? "no deployment-verify:v1 contract in the PR body"
		: `the deployment-verify:v1 contract is not valid (${contract.missing === "flag" ? contract.noFlagDetail || "a flag with no key" : contract.detail})`;
	return refuse(`a no-flag change in a hosted repo needs a before/after contract: ${why}`, [
		"Without a flag, Deliver watches the deploy instead. Add the before/after contract to the PR body:",
		"node <deployment-verify>/scripts/tick.mjs --draft-contract --pr <n>   # prints a draft from the PR's criteria",
		'fill "service" and "root_spans" (no "flag": it is measured before/after the deploy) and put the JSON between',
		`<!-- deployment-verify:v1 --> and <!-- /deployment-verify:v1 --> (${CONTRACT_DOC}); or ship the change behind a flag.`,
	].join("\n"));
}

export function decide({ isUI, contract, hosted = false, optOut: opt = null, noFlag = null, triggers = null, policy = DEFAULT_FLAG_POLICY }) {
	if (!isUI) return hosted ? decideHosted(contract, opt) : { decision: "pass", reason: "not user-visible — no UI file in the diff" };
	if (contract.has) {
		const reason = `user-visible, behind flag ${contract.flag}`;
		return contract.warning ? { decision: "pass", reason: `${reason}; ${contract.warning}`, warning: contract.warning } : { decision: "pass", reason };
	}
	const what = {
		contract: "no <!-- deployment-verify:v1 --> contract in the PR body",
		"valid-json": `the deployment-verify:v1 contract does not parse (${contract.detail})`,
		flag: "the deployment-verify:v1 contract names no flag",
		invalid: `deployment-verify would refuse the contract (${contract.detail})`,
	}[contract.missing];
	// Name a provider only when release.yml declares one: never send the author after one that does not exist.
	const providers = contract.providers || [];
	const flagLine = providers.length
		? `Fill "service" and "root_spans", add "flag": {"key": "<flag>", "provider": "${providers.join('" | "')}"}${contract.cohort === false ? "" : ' and "cohort"'},`
		: 'Fill "service" and "root_spans", add "flag": {"key": "<flag>"} (release.yml declares no flag provider, so a human flips it),';
	const flagHow = [
		"Ship the change behind a flag, then add the contract to the PR body before the merge:",
		"node <deployment-verify>/scripts/tick.mjs --draft-contract --pr <n>   # prints a draft from the PR's criteria",
		flagLine,
		`and put the JSON between <!-- deployment-verify:v1 --> and <!-- /deployment-verify:v1 --> (${CONTRACT_DOC}).`,
	];
	const flagRefusal = { decision: "refuse", reason: `user-visible diff, ${what}`, how: flagHow.join("\n") };
	if (policy.requireFlag) return flagRefusal;
	if (noFlag) return decideNoFlag({ nf: noFlag, triggers, contract, hosted, policy, flagRefusal });
	if (triggers?.length) return { ...flagRefusal, reason: `${flagRefusal.reason}; a flag is required: ${triggers.join("; ")}` };
	// A change that needs no rollout has a second way through; a hard trigger (above) never does.
	flagHow.push(
		`Or, for a small change that needs no rollout (${policy.classes.join(", ")}), add <!-- atelier:no-flag — <class>: <why> --> to the PR body${hosted ? " and the same contract with no \"flag\"" : ""} (rules/flag-policy.md).`,
	);
	return { ...flagRefusal, how: flagHow.join("\n") };
}

// A repo with no workflow that runs on a PR reports no checks on every head; with `noCi` (repoHasCi() false)
// that exact evidence passes the CI half. A repo that has CI and reports nothing is still refused.
export const isNoCiEvidence = (ci) => ci?.state === "not-run" && /no checks reported/.test(String(ci.reason ?? ""));
export const NO_CI_NOTE = "no CI in this repo (no workflow runs on pull_request or push)";

// A merge needs CI that ran and passed on this head; a skipped, pending, or red head is refused.
export function decideCi(ci, { noCi = false } = {}) {
	if (ci.state === "green") return null;
	if (noCi && isNoCiEvidence(ci)) return null;
	const at = ci.head ? ci.head.slice(0, 7) : "head";
	const reason = ci.state === "not-run" ? ci.reason : `CI ${ci.state} at ${at}: ${ci.reason}`;
	const how = {
		"not-run": "Record this on Ready (hold), get CI to run on this head (undraft the PR, or push), then re-run /atelier <pr>: --next returns ready until Ready records green CI evidence.",
		pending: "Wait for the checks with ci-wait.mjs (SKILL.md, Waiting for CI) and run the gate again; if the wait ends still pending, record this on Ready (hold), then re-run /atelier <pr>.",
		red: "Record this on Ready (failed), then run /atelier <pr> again: Ready runs prepare, which fixes the failing CI.",
	}[ci.state];
	return { decision: "refuse", reason, how };
}

const STATE_RE = /<!-- atelier:v1:state (\{.*?\}) -->/s;
const STATE_HOW = "Record Ready before the merge: node state.mjs --record --stage ready --decision proceed --head <sha> --ci-file ci.json --pr <url> > next.md, then --upsert it (SKILL.md, Stages step 1). A reconstructed (--backfill) entry is for after the merge and does not count here.";

// The atelier comment's Ready entry must be a live `proceed` on `head`. null when it is.
export function readyRecordProblem(comments, head) {
	const m = comments.map((b) => (b.startsWith("<!-- atelier:v1 -->") ? b.match(STATE_RE) : null)).find(Boolean);
	if (!m) return "no atelier state comment on the PR: Build and Ready were never recorded";
	let ready;
	try { ready = JSON.parse(m[1])?.stages?.ready; } catch { return "the atelier state comment is unreadable"; }
	if (!ready || ready.decision !== "proceed") return "Ready is not recorded proceed on the PR's atelier comment";
	if (ready.backfilled) return "Ready was recorded after the fact (backfill), not live";
	const at = String(head || "");
	if (!ready.sha || !at || !(ready.sha === at || (Math.min(ready.sha.length, at.length) >= 7 && (ready.sha.startsWith(at) || at.startsWith(ready.sha))))) return `Ready was recorded on ${String(ready.sha || "?").slice(0, 7)}, not on the current head ${at.slice(0, 7)}`;
	return null;
}

// `ci` is ci-ran.mjs's result for the head and `comments` the PR's comment bodies (newest first) the proof
// half reads with the body; both `null` only for the contract-only early gate. Halves decide in order: contract, CI, proof.
// `early`: the contract and the report's shape after Build; no CI, no --proven.
export async function gate({ files, body, surfaceJson, surfaceFile, repoDir = process.cwd(), ci = null, comments = null, early = false, noCiRepoKnown = true, requireState = false, stats = null }) {
	if (!surfaceJson && !surfaceFile) surfaceJson = await repoSurface(repoDir);
	const ui = userVisible(files, { surfaceJson, surfaceFile });
	const contract = await flagContract(body, repoDir);
	const hosted = await hostedRepo(repoDir);
	const policy = await loadFlagPolicy(repoDir);
	const triggers = ui.isUI ? flagTriggers({ files, matched: ui.matched, stats, policy }) : null;
	const noFlag = parseNoFlag(body);
	let d = decide({ isUI: ui.isUI, contract, hosted, optOut: optOut(body), noFlag, triggers, policy });
	let refusedBy = d.decision === "refuse" ? "contract" : null;
	// noCiRepoKnown: repoDir is the PR's repo (the CLI checks origin under --pr). Unknown → no-CI never passes.
	const noCi = !!ci && noCiRepoKnown && isNoCiEvidence(ci) && !repoHasCi(repoDir);
	const ciRefusal = d.decision === "pass" && ci ? decideCi(ci, { noCi }) : null;
	if (ciRefusal) [d, refusedBy] = [ciRefusal, "ci"];
	else if (noCi && d.decision === "pass") d = { ...d, reason: `${d.reason}; ${NO_CI_NOTE}` };
	// Tied to the head CI was read at: a report recorded before a later push is not proof of this head.
	const proof = comments ? await proofCheck({ body, comments, ui: ui.isUI, head: ci?.head ?? null, proven: !early }) : null;
	const proofRefusal = d.decision === "pass" && proof ? decideProof(proof, { ui: ui.isUI, early }) : null;
	if (proofRefusal) [d, refusedBy] = [proofRefusal, "proof"];
	else if (proof && d.decision === "pass") d = { ...d, reason: `${d.reason}; ${early ? "verify report present (proven at Ready)" : "every criterion proven (verify report complete)"}` };
	// The run's record: Ready `proceed` on this head, written live. A run that merges without one leaves the PR no history.
	const stateProblem = requireState && !early && comments && ci && d.decision === "pass" ? readyRecordProblem(comments, ci.head) : null;
	if (stateProblem) [d, refusedBy] = [{ decision: "refuse", reason: stateProblem, how: STATE_HOW }, "state"];
	const skipped = early ? "not checked (--early)" : "not checked (--contract-only)";
	const ciOut = ci ? { state: ci.state, head: ci.head, reason: noCi ? `${ci.reason}; ${NO_CI_NOTE}` : ci.reason, ...(noCi ? { no_ci: true } : {}) } : skipped;
	const proofOut = proof ? (proof.length ? proof : "report complete") : skipped;
	const { proof: _, ...rest } = d;
	// no_flag_class is set only when the no-flag marker is what let the diff through.
	const passedNoFlag = d.decision === "pass" && ui.isUI && !contract.has && !!noFlag;
	return { ...rest, refused_by: refusedBy, user_visible: ui.isUI, hosted, has_flag_contract: contract.has, flag: contract.flag ?? null, no_flag_class: passedNoFlag ? noFlag.class : null, flag_triggers: triggers, warning: d.warning ?? null, ui_files: ui.matched, ci: ciOut, proof: proofOut };
}

async function fromGh(pr, { contractOnly, early = false }) {
	const gh = (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	const files = gh(["pr", "diff", String(pr), "--name-only"]).split("\n").filter(Boolean);
	const view = JSON.parse(gh(["pr", "view", String(pr), "--json", "body,comments,files"]));
	const body = view.body || "";
	// Newest first, as verify-comment.mjs --check reads them.
	const comments = (view.comments || []).map((c) => c.body || "").reverse();
	// Read last, so the CI answer is about the head as it is right before the merge.
	const ci = contractOnly || early ? null : await ciCheck(pr);
	return { files, body, comments, ci, stats: diffStats(view.files) };
}

// A complete checks-only verify report (aw-verify's checksReport over its fixtures), and a green CI rollup.
const PROOF_BODY = readFileSync(new URL("./fixtures/proof-body.md", import.meta.url), "utf8");
const GREEN_ROLLUP = JSON.parse(readFileSync(new URL("./fixtures/green-rollup.json", import.meta.url), "utf8"));

// A valid flag contract body; the CLI check `--files … --body-file fixtures/flag-body.md` reads the same file.
const FLAG_BODY = readFileSync(new URL("./fixtures/flag-body.md", import.meta.url), "utf8");
const NOFLAG_BODY = FLAG_BODY.replace(/"flag": \{[^}]*\}, "cohort": \{[^}]*\}, /, "");

async function selfTest() {
	const { t, done } = makeTester("merge-gate");
	const empty = mkdtempSync(join(tmpdir(), "atelier-gate-"));
	const run = (files, body) => gate({ files, body, repoDir: empty });
	let r = await run(["src/components/Header.tsx"], "no contract");
	t("UI diff without a contract refuses", r.decision === "refuse" && !r.has_flag_contract && r.user_visible);
	t("refusal names the marker", /deployment-verify:v1/.test(r.reason));
	t("refusal says how to add it", /--draft-contract/.test(r.how) && /"flag"/.test(r.how));
	t("with no provider declared, the refusal names none", !/"provider"/.test(r.how) && /declares no flag provider/.test(r.how), r.how);
	r = await run(["src/components/Header.tsx"], NOFLAG_BODY);
	t("UI diff with a no-flag contract refuses on the flag", r.decision === "refuse" && /names no flag/.test(r.reason));
	r = await run(["src/components/Header.tsx"], FLAG_BODY);
	t("UI diff with a flag contract passes", r.decision === "pass" && r.flag === "newHeader" && r.has_flag_contract);
	t("without release.yml the pass carries the no-provider warning", r.warning === NO_PROVIDER_WARNING && r.reason.includes(NO_PROVIDER_WARNING), r.reason);
	r = await run(["src/components/Header.tsx"], FLAG_BODY.replace('"service"', 'service'));
	t("a contract that does not parse refuses", r.decision === "refuse" && /does not parse/.test(r.reason));
	r = await run(["docs/guide.md", "README.md"], "");
	t("docs-only diff passes without a contract", r.decision === "pass" && !r.user_visible);
	r = await run(["scripts/build.mjs", "src/components/Header.test.tsx"], "");
	t("tooling and tests pass without a contract", r.decision === "pass" && !r.user_visible);
	r = await gate({ files: ["server/x.ts"], body: "", surfaceJson: '{"extensions":[".ts"]}', repoDir: empty });
	t("the surface is forwarded to is-ui-diff", r.user_visible && r.decision === "refuse");
	r = await run(["src/components/Header.tsx"], FLAG_BODY.replace(/"service": "ui", "root_spans": \["GET \/x"\], /, ""));
	t("a flag contract deployment-verify would refuse is refused", r.decision === "refuse" && /missing "service"/.test(r.reason), r.reason);
	r = await run(["src/components/Header.tsx"], FLAG_BODY.replace(/\{ "service"[\s\S]*?"flag" \}/, "null"));
	t("a null contract refuses", r.decision === "refuse" && /not a JSON object/.test(r.reason), r.reason);
	const withSurface = mkdtempSync(join(tmpdir(), "atelier-gate-"));
	mkdirSync(join(withSurface, ".agents", "aw"), { recursive: true });
	writeFileSync(join(withSurface, ".agents", "aw", "ui.yml"), "surface:\n  extensions: [\".ts\"]\n");
	r = await gate({ files: ["server/x.ts"], body: "", repoDir: withSurface });
	t("the repo's ui.yml surface is read when no surface flag is given", r.user_visible && r.decision === "refuse", JSON.stringify(r));
	writeFileSync(join(withSurface, ".agents", "aw", "release.yml"), "environments:\n  staging:\n    url: x\n");
	r = await gate({ files: ["src/components/Header.tsx"], body: FLAG_BODY, repoDir: withSurface });
	t("a release.yml that lacks the contract's environment refuses", r.decision === "refuse" && /production/.test(r.reason), r.reason);
	// providers: [] — a repo that declares no flag provider on purpose (no cohort to split on).
	const noProv = mkdtempSync(join(tmpdir(), "atelier-gate-"));
	mkdirSync(join(noProv, ".agents", "aw"), { recursive: true });
	writeFileSync(join(noProv, ".agents", "aw", "release.yml"), "environments:\n  production:\n    url: x\nflags:\n  providers: []\n");
	const NOCOHORT_BODY = FLAG_BODY.replace(/, "cohort": \{[^}]*\}/, "").replace(', "provider": "posthog"', "");
	r = await gate({ files: ["src/components/Header.tsx"], body: NOCOHORT_BODY, repoDir: noProv });
	t("providers: [] passes a flag contract with the warning", r.decision === "pass" && r.has_flag_contract && r.warning === NO_PROVIDER_WARNING, JSON.stringify(r));
	r = await gate({ files: ["src/components/Header.tsx"], body: FLAG_BODY, repoDir: noProv });
	t("providers: [] passes a contract naming an undeclared provider, with the warning", r.decision === "pass" && r.warning === NO_PROVIDER_WARNING, JSON.stringify(r));
	r = await gate({ files: ["src/components/Header.tsx"], body: NOFLAG_BODY, repoDir: noProv });
	t("providers: [] still refuses a contract with no flag, naming no provider", r.decision === "refuse" && /names no flag/.test(r.reason) && !/"provider"/.test(r.how), r.how);
	r = await gate({ files: ["src/components/Header.tsx"], body: NOCOHORT_BODY.replace(/"service": "ui", /, ""), repoDir: noProv });
	t("providers: [] still refuses another validateContract failure", r.decision === "refuse" && /missing "service"/.test(r.reason), r.reason);
	r = await gate({ files: ["src/components/Header.tsx"], body: FLAG_BODY.replace('"reversibility"', '"thresholds": { "max_latency_ratio": 9 }, "reversibility"'), repoDir: noProv });
	t("providers: [] still refuses a loosened threshold", r.decision === "refuse" && /loosens/.test(r.reason), r.reason);
	const withProv = mkdtempSync(join(tmpdir(), "atelier-gate-"));
	mkdirSync(join(withProv, ".agents", "aw"), { recursive: true });
	writeFileSync(join(withProv, ".agents", "aw", "release.yml"), "environments:\n  production:\n    url: x\nflags:\n  providers:\n    - name: posthog\n      rollout: percent\n");
	r = await gate({ files: ["src/components/Header.tsx"], body: FLAG_BODY, repoDir: withProv });
	t("a declared matching provider passes with no warning", r.decision === "pass" && r.warning === null, JSON.stringify(r));
	r = await gate({ files: ["src/components/Header.tsx"], body: NOCOHORT_BODY.replace('"newHeader"', '"newHeader", "provider": "posthog"'), repoDir: withProv });
	t("a steppable flag still needs its cohort", r.decision === "refuse" && /missing "cohort"/.test(r.reason), r.reason);
	r = await gate({ files: ["src/components/Header.tsx"], body: FLAG_BODY.replace('"posthog"', '"postHog"'), repoDir: withProv });
	t("a provider name release.yml does not declare refuses as a typo", r.decision === "refuse" && /unknown provider postHog \(release.yml declares posthog\)/.test(r.reason), r.reason);
	r = await gate({ files: ["src/components/Header.tsx"], body: NOCOHORT_BODY, repoDir: withProv });
	t("a contract naming no provider passes with the warning where providers exist", r.decision === "pass" && r.warning === NO_PROVIDER_WARNING, JSON.stringify(r));
	r = await gate({ files: ["src/components/Header.tsx"], body: "no contract", repoDir: withProv });
	t("with a provider declared, the refusal names it", /"provider": "posthog"/.test(r.how), r.how);
	// rollout: pr — a follow-up PR flips the flag: a declared provider, so no warning, and no cohort to split on.
	const prProv = mkdtempSync(join(tmpdir(), "atelier-gate-"));
	mkdirSync(join(prProv, ".agents", "aw"), { recursive: true });
	writeFileSync(join(prProv, ".agents", "aw", "release.yml"), "environments:\n  production:\n    url: x\nflags:\n  providers:\n    - name: registry\n      rollout: pr\n      flip: src/flags.ts\n");
	r = await gate({ files: ["src/components/Header.tsx"], body: NOCOHORT_BODY.replace('"newHeader"', '"newHeader", "provider": "registry"'), repoDir: prProv });
	t("rollout: pr passes a flag contract with no cohort and no warning", r.decision === "pass" && r.has_flag_contract && r.warning === null, JSON.stringify(r));
	r = await gate({ files: ["src/components/Header.tsx"], body: "no contract", repoDir: prProv });
	t("rollout: pr only: the refusal names the provider and asks for no cohort", /"provider": "registry"\},/.test(r.how) && !/cohort/.test(r.how), r.how);
	// CI at the head (F17/F18): a contract that passes still merges only on CI that ran green.
	const page = (nodes) => JSON.stringify({ data: { repository: { pullRequest: { headRefOid: "h1", commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { pageInfo: { hasNextPage: false }, nodes } } } }] } } } } });
	const cr = (name, conclusion, extra = {}) => ({ __typename: "CheckRun", name, status: "COMPLETED", conclusion, isRequired: false, checkSuite: { app: { slug: "github-actions" } }, ...extra });
	const skippedOnly = page([cr("test", "SKIPPED"), cr("ci", "SKIPPED", { isRequired: true }), { __typename: "StatusContext", context: "Vercel", state: "SUCCESS", isRequired: false }]);
	let calls = 0;
	const ci = await ciCheck("https://github.com/acme/web/pull/41", { run: () => { calls++; return skippedOnly; } });
	r = await gate({ files: ["src/components/Header.tsx"], body: FLAG_BODY, repoDir: empty, ci });
	t("skipped-only CI refuses even with a valid flag contract", calls === 1 && r.decision === "refuse" && /^CI not run at h1/.test(r.reason) && /undraft/.test(r.how), JSON.stringify(r));
	r = await gate({ files: ["docs/guide.md"], body: "", repoDir: empty, ci });
	t("skipped-only CI refuses a docs-only diff too", r.decision === "refuse" && r.ci.state === "not-run", JSON.stringify(r));
	const green = await ciCheck("https://github.com/acme/web/pull/41", { run: () => page([cr("test", "SUCCESS"), cr("e2e", "SKIPPED")]) });
	r = await gate({ files: ["src/components/Header.tsx"], body: FLAG_BODY, repoDir: empty, ci: green });
	t("green CI with a valid contract passes", r.decision === "pass" && r.ci.state === "green", JSON.stringify(r));
	const pending = await ciCheck("https://github.com/a/b/pull/1", { run: () => page([cr("test", null, { status: "IN_PROGRESS" })]) });
	r = await gate({ files: ["docs/guide.md"], body: "", repoDir: empty, ci: pending });
	t("pending CI refuses", r.decision === "refuse" && /^CI pending at h1/.test(r.reason), r.reason);
	const red = await ciCheck("https://github.com/a/b/pull/1", { run: () => page([cr("test", "FAILURE")]) });
	r = await gate({ files: ["docs/guide.md"], body: "", repoDir: empty, ci: red });
	t("red CI refuses", r.decision === "refuse" && /^CI red/.test(r.reason), r.reason);
	r = await gate({ files: ["src/components/Header.tsx"], body: "no contract", repoDir: empty, ci: green });
	t("a contract refusal still wins with green CI", r.decision === "refuse" && /deployment-verify:v1/.test(r.reason) && r.refused_by === "contract");
	r = await gate({ files: ["src/components/Header.tsx"], body: "no contract", repoDir: empty, ci });
	t("a contract refusal on skipped CI is refused_by contract, not ci", r.decision === "refuse" && r.refused_by === "contract" && /deployment-verify:v1/.test(r.reason), JSON.stringify(r));
	r = await gate({ files: ["docs/guide.md"], body: "", repoDir: empty, ci });
	t("a CI refusal is refused_by ci", r.refused_by === "ci");
	t("a pass has no refused_by", (await gate({ files: ["docs/guide.md"], body: "", repoDir: empty, ci: green })).refused_by === null);
	// The proof half (aw-verify's --check): a merge needs every criterion proven in the PR's verify report.
	const greenCi = await ciFromRollup(GREEN_ROLLUP);
	r = await gate({ files: ["docs/guide.md"], body: "no report", repoDir: empty, ci: greenCi, comments: [] });
	t("green CI with no verify report refuses on proof", r.decision === "refuse" && r.refused_by === "proof" && /no intent region/.test(r.reason) && /\/aw-verify run checks/.test(r.how), JSON.stringify(r));
	r = await gate({ files: ["docs/guide.md"], body: PROOF_BODY, repoDir: empty, ci: greenCi, comments: [] });
	t("green CI with a complete checks-only report passes", r.decision === "pass" && r.refused_by === null && r.proof === "report complete" && /every criterion proven/.test(r.reason), JSON.stringify(r));
	const stateOf = (sha, extra = {}) => `<!-- atelier:v1 -->\n<!-- atelier:v1:state ${JSON.stringify({ v: 1, stages: { ready: { decision: "proceed", sha, ...extra } } })} -->`;
	const withState = (c) => gate({ files: ["docs/guide.md"], body: PROOF_BODY, repoDir: empty, ci: greenCi, comments: c, requireState: true });
	r = await withState([]);
	t("a PR with no atelier comment is refused by the state half", r.refused_by === "state" && /never recorded/.test(r.reason), JSON.stringify(r));
	r = await withState([stateOf(greenCi.head, { backfilled: true })]);
	t("a backfilled Ready is not a live record", r.refused_by === "state" && /after the fact/.test(r.reason), JSON.stringify(r));
	r = await withState([stateOf("zzzzzzz")]);
	t("a Ready recorded on another head is refused", r.refused_by === "state" && /not on the current head/.test(r.reason), JSON.stringify(r));
	r = await withState([stateOf(greenCi.head)]);
	t("a live Ready on this head passes the state half", r.decision === "pass", JSON.stringify(r));
	r = await gate({ files: ["docs/guide.md"], body: "see the comment", repoDir: empty, ci: greenCi, comments: ["unrelated", PROOF_BODY.slice(PROOF_BODY.indexOf("<!-- verify:report -->"))] });
	t("a verify report in a comment counts", r.decision === "pass", JSON.stringify(r));
	r = await gate({ files: ["docs/guide.md"], body: PROOF_BODY, repoDir: empty, ci: { ...greenCi, head: "deadbeef00" }, comments: [] });
	t("a report run on an older commit than the CI head refuses on proof", r.refused_by === "proof" && /abc1234/.test(r.reason) && /deadbee/.test(r.reason), JSON.stringify(r));
	const { checksReport, withBlock, splice } = await import(pathToFileURL(join(skillDir("aw-verify", "testing", "AW_VERIFY_DIR"), "scripts", "verify-comment.mjs")).href);
	const fx = (f) => readFileSync(join(skillDir("aw-verify", "testing", "AW_VERIFY_DIR"), "scripts", "fixtures", "checks", f), "utf8");
	const failed = checksReport(fx("plan.md"), JSON.parse(fx("runs-fail.json")));
	r = await gate({ files: ["docs/guide.md"], body: withBlock("t", splice(splice("", "intent", failed.intent), "aggregate", failed.report)), repoDir: empty, ci: greenCi, comments: [] });
	t("a complete but ❌ Not verified report refuses on proof", r.refused_by === "proof" && /AC-2/.test(r.reason) && r.proof.some((p) => /Not verified/.test(p)), JSON.stringify(r));
	r = await gate({ files: ["docs/guide.md"], body: PROOF_BODY.replace(/✅&nbsp;AC‑2/, "⬜&nbsp;AC‑2"), repoDir: empty, ci: greenCi, comments: [] });
	t("a criterion left ⬜ refuses on proof, naming it", r.refused_by === "proof" && /AC-2/.test(r.reason), JSON.stringify(r));
	r = await gate({ files: ["src/components/Header.tsx"], body: FLAG_BODY + PROOF_BODY, repoDir: empty, ci: greenCi, comments: [] });
	t("a UI diff also needs its ui-verify spec block, and the how names run preview", r.refused_by === "proof" && /ui-verify spec/.test(r.how) && /run preview/.test(r.how), JSON.stringify(r));
	r = await gate({ files: ["docs/guide.md"], body: "no report", repoDir: empty, ci: red, comments: [] });
	t("red CI still refuses on ci before proof", r.refused_by === "ci", JSON.stringify(r));
	r = await gate({ files: ["src/components/Header.tsx"], body: "no contract", repoDir: empty, ci: greenCi, comments: [] });
	t("a contract refusal still wins over proof", r.refused_by === "contract");
	r = await gate({ files: ["docs/guide.md"], body: "no report", repoDir: empty, comments: [], early: true });
	t("✓ the early gate refuses a PR with no verify report, while still in Build", r.refused_by === "proof" && /no intent region/.test(r.reason) && /Still in Build/.test(r.how) && r.ci === "not checked (--early)", JSON.stringify(r));
	r = await gate({ files: ["docs/guide.md"], body: withBlock("t", splice(splice("", "intent", failed.intent), "aggregate", failed.report)), repoDir: empty, comments: [], early: true });
	t("the early gate asks for the report's shape, not --proven: a ❌ verdict is Ready's to fix", r.decision === "pass" && /proven at Ready/.test(r.reason), JSON.stringify(r));
	const noChecks = { state: "not-run", ran: false, head: "abc1234", reason: "CI not run at abc1234: no checks reported" };
	r = await gate({ files: ["docs/guide.md"], body: PROOF_BODY, repoDir: empty, ci: noChecks, comments: [] });
	t("✓ no checks reported in a repo with no CI workflow passes the CI half, and says so", r.refused_by === null && r.ci.no_ci === true && /no CI in this repo/.test(r.reason), JSON.stringify(r));
	const withCi = mkdtempSync(join(tmpdir(), "atelier-gate-ci-"));
	mkdirSync(join(withCi, ".github", "workflows"), { recursive: true });
	writeFileSync(join(withCi, ".github", "workflows", "ci.yml"), "on:\n  pull_request:\njobs: {}\n");
	r = await gate({ files: ["docs/guide.md"], body: PROOF_BODY, repoDir: withCi, ci: noChecks, comments: [] });
	t("✗ no checks reported in a repo that has a CI workflow still refuses on ci", r.refused_by === "ci" && !r.ci.no_ci, JSON.stringify(r));
	r = await gate({ files: ["docs/guide.md"], body: PROOF_BODY, repoDir: empty, ci: noChecks, comments: [], noCiRepoKnown: false });
	t("✗ a directory not known to be the PR's repo never passes no CI (fails closed)", r.refused_by === "ci" && !r.ci.no_ci, JSON.stringify(r));
	r = await gate({ files: ["docs/guide.md"], body: PROOF_BODY, repoDir: empty, ci: { ...noChecks, reason: "CI not run at abc1234: every required check skipped (4)" }, comments: [] });
	t("✗ skipped checks are never read as no CI", r.refused_by === "ci", JSON.stringify(r));
	rmSync(withCi, { recursive: true, force: true });
	r = await gate({ files: ["docs/guide.md"], body: "no report", repoDir: empty });
	t("the contract-only gate never checks proof", r.decision === "pass" && r.proof === "not checked (--contract-only)", JSON.stringify(r));
	const real = await ciFromRollup(JSON.parse(readFileSync(join(skillDir("prepare", "delivery", "PREPARE_DIR"), "scripts", "fixtures", "skipped-plus-vercel.json"), "utf8")));
	r = await gate({ files: ["src/components/Header.tsx"], body: FLAG_BODY, repoDir: empty, ci: real });
	t("PR #29652's real rollup (16 skipped + Vercel) refuses", r.decision === "refuse" && /CI not run/.test(r.reason), r.reason);
	// A hosted production service (deploy detection is not manual): every PR needs a contract or an opt-out.
	const hostedDir = mkdtempSync(join(tmpdir(), "atelier-gate-"));
	mkdirSync(join(hostedDir, ".agents", "aw"), { recursive: true });
	writeFileSync(join(hostedDir, ".agents", "aw", "release.yml"), "environments:\n  production:\n    url: x\n    deploy:\n      detect: { attribute: service.version, equals: merge_sha }\nflags:\n  providers: []\n");
	const BEFORE_AFTER = FLAG_BODY.replace(/, "flag": \{[^}]*\}, "cohort": \{[^}]*\}, "reversibility": "flag"/, "");
	t("hostedRepo: detect attribute is hosted, manual and none are not", (await hostedRepo(hostedDir)) && !(await hostedRepo(noProv)) && !(await hostedRepo(empty)));
	r = await gate({ files: ["scripts/worker.mjs"], body: "no contract", repoDir: hostedDir });
	t("hosted: a non-UI diff with neither contract nor marker refuses, naming both fixes", r.decision === "refuse" && r.hosted && /--draft-contract/.test(r.how) && /deployment-verify:none/.test(r.how), JSON.stringify(r));
	r = await gate({ files: ["scripts/worker.mjs"], body: BEFORE_AFTER, repoDir: hostedDir });
	t("hosted: a before/after contract passes a non-UI diff", r.decision === "pass" && /before\/after/.test(r.reason), JSON.stringify(r));
	r = await gate({ files: ["scripts/worker.mjs"], body: FLAG_BODY, repoDir: hostedDir });
	t("hosted: a flag contract passes a non-UI diff", r.decision === "pass" && r.flag === "newHeader", JSON.stringify(r));
	r = await gate({ files: ["docs/guide.md"], body: "x\n<!-- deployment-verify:none — docs only, nothing deploys -->", repoDir: hostedDir });
	t("hosted: an opt-out with a reason passes, quoting it", r.decision === "pass" && /docs only, nothing deploys/.test(r.reason), JSON.stringify(r));
	r = await gate({ files: ["docs/guide.md"], body: "x\n<!-- deployment-verify:none — -->", repoDir: hostedDir });
	t("hosted: an opt-out with no reason refuses", r.decision === "refuse" && /gives no reason/.test(r.reason), JSON.stringify(r));
	r = await gate({ files: ["scripts/worker.mjs"], body: BEFORE_AFTER.replace(/"service": "ui", /, ""), repoDir: hostedDir });
	t("hosted: an invalid before/after contract refuses with deployment-verify's reason", r.decision === "refuse" && /missing "service"/.test(r.reason), JSON.stringify(r));
	r = await gate({ files: ["src/components/Header.tsx"], body: "x\n<!-- deployment-verify:none — trust me -->", repoDir: hostedDir });
	t("hosted: a UI diff still needs a flag contract, the opt-out does not pass it", r.decision === "refuse" && /user-visible/.test(r.reason), JSON.stringify(r));
	r = await gate({ files: ["scripts/worker.mjs"], body: "no contract", repoDir: noProv });
	t("not hosted (no deploy detection): a non-UI diff passes as before", r.decision === "pass" && r.hosted === false, JSON.stringify(r));
	// A small user-visible change may ship without a flag (rules/flag-policy.md): marker + no trigger, and in a hosted repo the before/after contract.
	const st = (o) => Object.fromEntries(Object.entries(o).map(([path, [changeType, additions, deletions]]) => [path, { path, changeType, additions, deletions }]));
	const stats = (o) => diffStats(Object.values(st(o)));
	const HDR = "src/components/Header.tsx";
	const mark = (text) => `x\n<!-- atelier:no-flag — ${text} -->`;
	const small = stats({ [HDR]: ["MODIFIED", 3, 2] });
	t("parseNoFlag: class, flag and reason", JSON.stringify(parseNoFlag(mark("already-flagged newHeader: behind the live flag"))) === JSON.stringify({ class: "already-flagged", flag: "newHeader", reason: "behind the live flag" }) && parseNoFlag(mark("copy: fix a typo")).reason === "fix a typo" && parseNoFlag("no marker") === null);
	t("noFlagProblem: unknown class, missing reason, and already-flagged with no flag", /not allowed/.test(noFlagProblem(parseNoFlag(mark("tweak: x")))) && /no reason/.test(noFlagProblem(parseNoFlag(mark("copy")))) && /needs the flag key/.test(noFlagProblem(parseNoFlag(mark("already-flagged: x")))) && noFlagProblem(parseNoFlag(mark("bugfix: x"))) === null);
	r = await gate({ files: [HDR], body: mark("copy: fix a typo in the header"), repoDir: empty, stats: small });
	t("no flag: a classed small change in a repo that is not hosted passes, saying nothing watches it", r.decision === "pass" && r.no_flag_class === "copy" && r.warning === NO_DEPLOY_VERIFY_WARNING && !r.has_flag_contract && r.flag_triggers.length === 0, JSON.stringify(r));
	r = await gate({ files: [HDR], body: `${BEFORE_AFTER}\n${mark("bugfix: restore the sort order")}`, repoDir: hostedDir, stats: small });
	t("no flag: in a hosted repo the marker plus a before/after contract passes, verified on the deploy", r.decision === "pass" && r.no_flag_class === "bugfix" && /verified on the deploy/.test(r.reason) && r.warning === null, JSON.stringify(r));
	r = await gate({ files: [HDR], body: mark("bugfix: restore the sort order"), repoDir: hostedDir, stats: small });
	t("no flag: in a hosted repo the marker alone refuses and asks for the before/after contract", r.decision === "refuse" && /needs a before\/after contract/.test(r.reason) && /--draft-contract/.test(r.how), JSON.stringify(r));
	r = await gate({ files: [HDR], body: `${BEFORE_AFTER.replace(/"service": "ui", /, "")}\n${mark("bugfix: x")}`, repoDir: hostedDir, stats: small });
	t("no flag: an invalid before/after contract refuses with deployment-verify's reason", r.decision === "refuse" && /missing "service"/.test(r.reason), r.reason);
	r = await gate({ files: [HDR], body: `${FLAG_BODY}\n${mark("copy: x")}`, repoDir: empty, stats: small });
	t("a flag contract wins over a marker: it passes as before, with no no-flag class", r.decision === "pass" && r.flag === "newHeader" && r.no_flag_class === null, JSON.stringify(r));
	const route = stats({ "src/app/billing/page.tsx": ["ADDED", 20, 0] });
	r = await gate({ files: ["src/app/billing/page.tsx"], body: mark("internal: a small page"), repoDir: empty, stats: route });
	t("trigger: a new route needs a flag whatever the marker says", r.decision === "refuse" && /a flag is required: new route src\/app\/billing\/page\.tsx/.test(r.reason) && /"flag"/.test(r.how) && !/atelier:no-flag/.test(r.how), JSON.stringify(r));
	r = await gate({ files: [HDR], body: mark("refactor: split the header"), repoDir: empty, stats: stats({ [HDR]: ["MODIFIED", 120, 60] }) });
	t("trigger: a diff over the line limit needs a flag", r.decision === "refuse" && /180 changed UI lines, over the limit of 150/.test(r.reason), r.reason);
	const three = stats({ "src/components/A.tsx": ["ADDED", 5, 0], "src/components/B.tsx": ["ADDED", 5, 0], "src/components/C.tsx": ["ADDED", 5, 0] });
	r = await gate({ files: Object.keys(three), body: mark("internal: extract"), repoDir: empty, stats: three });
	t("trigger: more than two new UI files needs a flag", r.decision === "refuse" && /3 new UI files, over the limit of 2/.test(r.reason), r.reason);
	const noType = diffStats(Object.keys(three).map((path) => ({ path, additions: 5, deletions: 0 })));
	r = await gate({ files: Object.keys(three), body: mark("internal: extract"), repoDir: empty, stats: noType });
	t("a file with no change type is unknown, so the marker is refused (fails closed)", r.decision === "refuse" && /size is unknown/.test(r.reason) && r.flag_triggers === null, JSON.stringify(r));
	const renamed = stats({ "src/app/billing/page.tsx": ["RENAMED", 0, 0] });
	r = await gate({ files: ["src/app/billing/page.tsx"], body: mark("refactor: move the page"), repoDir: empty, stats: renamed });
	t("trigger: a page renamed into a route glob is a new route", r.decision === "refuse" && /new route src\/app\/billing\/page\.tsx/.test(r.reason), r.reason);
	const copied = stats({ "src/app/billing/page.tsx": ["COPIED", 20, 0] });
	r = await gate({ files: ["src/app/billing/page.tsx"], body: mark("internal: copy"), repoDir: empty, stats: copied });
	t("trigger: a page copied into a route glob is a new route", r.decision === "refuse" && /new route/.test(r.reason), r.reason);
	const moved = stats({ "src/components/A.tsx": ["RENAMED", 0, 0], "src/components/B.tsx": ["RENAMED", 0, 0], "src/components/C.tsx": ["RENAMED", 0, 0] });
	r = await gate({ files: Object.keys(moved), body: mark("refactor: move three components"), repoDir: empty, stats: moved });
	t("renamed components add no code, so they are not counted as new UI files", r.decision === "pass" && r.no_flag_class === "refactor", JSON.stringify(r));
	r = await gate({ files: ["src/app/billing/page.tsx"], body: "no contract", repoDir: empty, stats: route });
	t("a trigger with no marker refuses on the flag, naming the trigger and offering no no-flag way", r.decision === "refuse" && /no <!-- deployment-verify:v1 -->.*a flag is required: new route/.test(r.reason) && !/atelier:no-flag/.test(r.how), r.reason);
	r = await gate({ files: [HDR], body: mark("tweak: x"), repoDir: empty, stats: small });
	t("an unknown class refuses", r.decision === "refuse" && /class "tweak" is not allowed/.test(r.reason), r.reason);
	r = await gate({ files: [HDR], body: mark("copy"), repoDir: empty, stats: small });
	t("a marker with no reason refuses", r.decision === "refuse" && /no reason/.test(r.reason), r.reason);
	r = await gate({ files: [HDR], body: mark("copy: fix a typo"), repoDir: empty });
	t("no stats: the marker is refused (fails closed), saying how to give them", r.decision === "refuse" && /size is unknown/.test(r.reason) && /--files-json/.test(r.how) && r.flag_triggers === null, JSON.stringify(r));
	r = await gate({ files: [HDR], body: mark("copy: fix a typo"), repoDir: empty, stats: stats({}) });
	t("a UI file missing from the stats is unknown too", r.decision === "refuse" && /size is unknown/.test(r.reason), r.reason);
	r = await gate({ files: [HDR], body: mark("already-flagged newHeader: inside the live flag"), repoDir: empty, stats: small });
	t("already-flagged names the flag and passes", r.decision === "pass" && /no flag \(already-flagged newHeader\)/.test(r.reason), r.reason);
	r = await gate({ files: [HDR], body: "no contract", repoDir: empty, stats: small });
	t("without a marker the refusal names both ways through", r.decision === "refuse" && /--draft-contract/.test(r.how) && /atelier:no-flag/.test(r.how) && !/cohort/.test(r.how), r.how);
	r = await gate({ files: ["docs/guide.md"], body: mark("copy: x"), repoDir: empty, stats: stats({ "docs/guide.md": ["MODIFIED", 1, 1] }) });
	t("a marker on a docs-only diff changes nothing", r.decision === "pass" && r.no_flag_class === null && !r.user_visible, JSON.stringify(r));
	// The repo's own policy (.agents/aw/merge.yml flag_policy) over the defaults.
	const policyDir = mkdtempSync(join(tmpdir(), "atelier-gate-"));
	mkdirSync(join(policyDir, ".agents", "aw"), { recursive: true });
	const setPolicy = (yml) => writeFileSync(join(policyDir, ".agents", "aw", "merge.yml"), `version: 1\nflag_policy:\n${yml}`);
	setPolicy("  max_unflagged_lines: 4\n");
	r = await gate({ files: [HDR], body: mark("copy: x"), repoDir: policyDir, stats: small });
	t("policy: a lower max_unflagged_lines refuses a diff the defaults allow", r.decision === "refuse" && /5 changed UI lines, over the limit of 4/.test(r.reason), r.reason);
	setPolicy("  always_flag:\n    - src/components/Header.tsx\n");
	r = await gate({ files: [HDR], body: mark("copy: x"), repoDir: policyDir, stats: small });
	t("policy: an always_flag path needs a flag whatever its size", r.decision === "refuse" && /Header\.tsx is on the repo's always-flag list/.test(r.reason), r.reason);
	setPolicy("  route_globs: [\"src/screens/**\"]\n");
	const screen = stats({ "src/screens/Home.tsx": ["ADDED", 9, 0] });
	r = await gate({ files: ["src/screens/Home.tsx"], body: mark("internal: x"), repoDir: policyDir, stats: screen });
	t("policy: route_globs replace the default routes", r.decision === "refuse" && /new route src\/screens\/Home\.tsx/.test(r.reason), r.reason);
	r = await gate({ files: ["src/app/billing/page.tsx"], body: mark("internal: a small page"), repoDir: policyDir, stats: route });
	t("policy: a default route is no route once route_globs is set", r.decision === "pass", JSON.stringify(r));
	setPolicy("  classes: [bugfix]\n");
	r = await gate({ files: [HDR], body: mark("copy: x"), repoDir: policyDir, stats: small });
	t("policy: a narrowed class list refuses a class the repo dropped", r.decision === "refuse" && /class "copy" is not allowed \(one of bugfix\)/.test(r.reason), r.reason);
	setPolicy("  require_flag: always\n");
	r = await gate({ files: [HDR], body: mark("copy: x"), repoDir: policyDir, stats: small });
	t("policy: require_flag: always keeps the flag rule for every user-visible diff", r.decision === "refuse" && /names no flag|no <!-- deployment-verify:v1/.test(r.reason) && !/atelier:no-flag/.test(r.how), JSON.stringify(r));
	r = await gate({ files: [HDR], body: FLAG_BODY, repoDir: policyDir, stats: small });
	t("policy: require_flag: always still passes a flag contract", r.decision === "pass", JSON.stringify(r));
	for (const [yml, why] of [["  max_unflagged_lines: lots\n", /non-negative number/], ["  classes: [hotfix]\n", /unknown hotfix/], ["  require_flag: never\n", /must be "always"/]]) {
		setPolicy(yml);
		let threw = "";
		try {
			await loadFlagPolicy(policyDir);
		} catch (e) {
			threw = e.message;
		}
		t(`policy: ${yml.trim()} throws, so the gate exits 2 and never merges on a misread policy`, why.test(threw), threw);
	}
	writeFileSync(join(policyDir, ".agents", "aw", "merge.yml"), "version: 1\napproval:\n  wait_for: [x]\n");
	t("policy: a merge.yml with no flag_policy gives the defaults", (await loadFlagPolicy(policyDir)) === DEFAULT_FLAG_POLICY && (await loadFlagPolicy(empty)) === DEFAULT_FLAG_POLICY);
	t("diffStats reads gh's changeType", diffStats([{ path: "a", additions: 1, deletions: 2, changeType: "ADDED" }]).a.status === "added");
	rmSync(policyDir, { recursive: true, force: true });
	for (const d of [noProv, withProv, hostedDir]) rmSync(d, { recursive: true, force: true });
	rmSync(empty, { recursive: true, force: true });
	rmSync(withSurface, { recursive: true, force: true });
	return done();
}

async function main() {
	const a = parseArgs(process.argv.slice(2));
	if (a["self-test"]) process.exit(await selfTest());
	try {
		let files;
		let body;
		let ci = null;
		let comments = [];
		let stats = null;
		const contractOnly = !!a["contract-only"];
		const early = !!a.early && !contractOnly;
		if (a.pr) ({ files, body, comments, ci, stats } = await fromGh(a.pr, { contractOnly, early }));
		else if (a.files && a["body-file"]) {
			files = String(a.files).split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
			body = readFileSync(a["body-file"], "utf8");
			if (typeof a["rollup-file"] === "string") ci = await ciFromRollup(JSON.parse(readFileSync(a["rollup-file"], "utf8")));
			else if (!contractOnly && !early) throw new Error("offline mode needs --rollup-file <json> (ci-ran.mjs's query), --early, or --contract-only");
			if (typeof a["comments-file"] === "string") comments = JSON.parse(readFileSync(a["comments-file"], "utf8"));
			if (typeof a["files-json"] === "string") stats = diffStats(JSON.parse(readFileSync(a["files-json"], "utf8")));
		} else throw new Error("pass --pr <n>, or --files <list> --body-file <path>");
		const repoDir = a["repo-dir"] || process.cwd();
		// No CI is read from the repo, so the repo must be the PR's: under --pr its origin must match; offline, only a named --repo-dir counts.
		const noCiRepoKnown = a.pr ? repoMatchesPr(repoDir, String(a.pr)) : typeof a["repo-dir"] === "string";
		const r = await gate({ files, body, surfaceJson: a["surface-json"], surfaceFile: a["surface-file"], repoDir, ci: early ? null : ci, comments: contractOnly ? null : comments, early, noCiRepoKnown, requireState: !!a.pr, stats });
		console.log(JSON.stringify(r, null, 2));
		if (r.how) console.log(r.how);
		if (r.warning) console.log(`warning: ${r.warning}`);
		console.log(`MERGE_GATE: ${r.decision} — ${r.reason}`);
		await markGate({ result: r, contractOnly: contractOnly || early, early, pr: a.pr ? String(a.pr) : null });
		process.exit(r.decision === "pass" ? 0 : 1);
	} catch (e) {
		console.error(`merge-gate: ${e.message}`);
		process.exit(2);
	}
}

if (isMain(import.meta.url)) main();
