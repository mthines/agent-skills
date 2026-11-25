#!/usr/bin/env node
// merge-gate.mjs — atelier's deterministic merge gate (rules/merge-gate.md).
//
// Refuses a merge when CI did not run green on the PR's current head, or when the diff is
// user-visible and the PR body has no deployment-verify contract that names a flag.
// Owns no detector of its own:
//   CI ran green  = prepare's scripts/ci-ran.mjs (ciStatus/classify), read at the head right now
//   user-visible  = ui-verify's scripts/is-ui-diff.mjs, run by path
//   flag contract = deployment-verify's parseContract() from scripts/tick.mjs
//
//   node merge-gate.mjs --pr <n|url>                          files, body, and CI via gh
//   node merge-gate.mjs --pr <n|url> --contract-only          skip the CI check (atelier's early gate after Build only)
//   node merge-gate.mjs --files "a.tsx,b.md" --body-file <f> (--rollup-file <json> | --contract-only)   offline
//   add --surface-json '<json>' | --surface-file <path>       forwarded to is-ui-diff; without either,
//                                                             the surface in <repo-dir>/.agents/aw/ui.yml is used
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

import { isMain, makeTester, parseArgs, skillDir } from "./lib.mjs";
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
	if (error) return { has: false, missing: error.startsWith("no contract") ? "contract" : "valid-json", detail: error, providers };
	if (!parsed) return { has: false, missing: "valid-json", detail: "the contract is not a JSON object", providers };
	const key = contract.flag?.key;
	if (typeof key !== "string" || !key.trim()) return { has: false, missing: "flag", detail: "the contract names no flag", providers };
	const steppable = providers.includes(contract.flag.provider);
	// A provider name release.yml does not declare, in a repo that declares some, is a typo, not "no provider":
	// passing it would silently drop the stepped rollout the author asked for.
	if (!steppable && providers.length && contract.flag.provider) {
		return { has: false, missing: "invalid", detail: `unknown provider ${contract.flag.provider} (release.yml declares ${providers.join(", ")})`, providers };
	}
	// No provider to step it: validate the rest against a stand-in provider, and a cohort nobody can split on is not asked for.
	const checked = steppable ? contract : { ...contract, cohort: contract.cohort ?? { unused: "no provider" } };
	const checkedConfig = steppable ? config : { ...config, flags: { ...config.flags, providers: [{ name: contract.flag.provider }] } };
	const invalid = validateContract(checked, checkedConfig);
	if (invalid) return { has: false, missing: "invalid", detail: invalid, providers };
	return { has: true, flag: key, warning: steppable ? null : NO_PROVIDER_WARNING, providers };
}

export function decide({ isUI, contract }) {
	if (!isUI) return { decision: "pass", reason: "not user-visible — no UI file in the diff" };
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
		? `Fill "service" and "root_spans", add "flag": {"key": "<flag>", "provider": "${providers.join('" | "')}"} and "cohort",`
		: 'Fill "service" and "root_spans", add "flag": {"key": "<flag>"} (release.yml declares no flag provider, so a human flips it),';
	return {
		decision: "refuse",
		reason: `user-visible diff, ${what}`,
		how: [
			"Ship the change behind a flag, then add the contract to the PR body before the merge:",
			"node <deployment-verify>/scripts/tick.mjs --draft-contract --pr <n>   # prints a draft from the PR's criteria",
			flagLine,
			`and put the JSON between <!-- deployment-verify:v1 --> and <!-- /deployment-verify:v1 --> (${CONTRACT_DOC}).`,
		].join("\n"),
	};
}

// A merge needs CI that ran and passed on this head; a skipped, pending, or red head is refused.
export function decideCi(ci) {
	if (ci.state === "green") return null;
	const at = ci.head ? ci.head.slice(0, 7) : "head";
	const reason = ci.state === "not-run" ? ci.reason : `CI ${ci.state} at ${at}: ${ci.reason}`;
	const how = {
		"not-run": "Record this on Ready (hold), get CI to run on this head (undraft the PR, or push), then re-run /atelier <pr>: --next returns ready until Ready records green CI evidence.",
		pending: "Wait for the checks with ci-wait.mjs (SKILL.md, Waiting for CI) and run the gate again; if the wait ends still pending, record this on Ready (hold), then re-run /atelier <pr>.",
		red: "Record this on Ready (failed), then run /atelier <pr> again: Ready runs prepare, which fixes the failing CI.",
	}[ci.state];
	return { decision: "refuse", reason, how };
}

// `ci` is ci-ran.mjs's result for the head; `null` only for the contract-only early gate.
export async function gate({ files, body, surfaceJson, surfaceFile, repoDir = process.cwd(), ci = null }) {
	if (!surfaceJson && !surfaceFile) surfaceJson = await repoSurface(repoDir);
	const ui = userVisible(files, { surfaceJson, surfaceFile });
	const contract = await flagContract(body, repoDir);
	let d = decide({ isUI: ui.isUI, contract });
	let refusedBy = d.decision === "refuse" ? "contract" : null;
	const ciRefusal = d.decision === "pass" && ci ? decideCi(ci) : null;
	if (ciRefusal) [d, refusedBy] = [ciRefusal, "ci"];
	const ciOut = ci ? { state: ci.state, head: ci.head, reason: ci.reason } : "not checked (--contract-only)";
	return { ...d, refused_by: refusedBy, user_visible: ui.isUI, has_flag_contract: contract.has, flag: contract.flag ?? null, warning: d.warning ?? null, ui_files: ui.matched, ci: ciOut };
}

async function fromGh(pr, { contractOnly }) {
	const gh = (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	const files = gh(["pr", "diff", String(pr), "--name-only"]).split("\n").filter(Boolean);
	const body = gh(["pr", "view", String(pr), "--json", "body", "-q", ".body"]);
	// Read last, so the CI answer is about the head as it is right before the merge.
	const ci = contractOnly ? null : await ciCheck(pr);
	return { files, body, ci };
}

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
	const real = await ciFromRollup(JSON.parse(readFileSync(join(skillDir("prepare", "delivery", "PREPARE_DIR"), "scripts", "fixtures", "skipped-plus-vercel.json"), "utf8")));
	r = await gate({ files: ["src/components/Header.tsx"], body: FLAG_BODY, repoDir: empty, ci: real });
	t("PR #29652's real rollup (16 skipped + Vercel) refuses", r.decision === "refuse" && /CI not run/.test(r.reason), r.reason);
	for (const d of [noProv, withProv]) rmSync(d, { recursive: true, force: true });
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
		const contractOnly = !!a["contract-only"];
		if (a.pr) ({ files, body, ci } = await fromGh(a.pr, { contractOnly }));
		else if (a.files && a["body-file"]) {
			files = String(a.files).split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
			body = readFileSync(a["body-file"], "utf8");
			if (typeof a["rollup-file"] === "string") ci = await ciFromRollup(JSON.parse(readFileSync(a["rollup-file"], "utf8")));
			else if (!contractOnly) throw new Error("offline mode needs --rollup-file <json> (ci-ran.mjs's query) or --contract-only");
		} else throw new Error("pass --pr <n>, or --files <list> --body-file <path>");
		const r = await gate({ files, body, surfaceJson: a["surface-json"], surfaceFile: a["surface-file"], repoDir: a["repo-dir"] || process.cwd(), ci });
		console.log(JSON.stringify(r, null, 2));
		if (r.how) console.log(r.how);
		if (r.warning) console.log(`warning: ${r.warning}`);
		console.log(`MERGE_GATE: ${r.decision} — ${r.reason}`);
		await markGate({ result: r, contractOnly, pr: a.pr ? String(a.pr) : null });
		process.exit(r.decision === "pass" ? 0 : 1);
	} catch (e) {
		console.error(`merge-gate: ${e.message}`);
		process.exit(2);
	}
}

if (isMain(import.meta.url)) main();
