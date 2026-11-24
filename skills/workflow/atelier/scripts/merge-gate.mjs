#!/usr/bin/env node
// merge-gate.mjs — atelier's deterministic merge gate (rules/merge-gate.md).
//
// Refuses a merge when the diff is user-visible and the PR body has no
// deployment-verify contract that names a flag. Owns no detector of its own:
//   user-visible  = ui-verify's scripts/is-ui-diff.mjs, run by path
//   flag contract = deployment-verify's parseContract() from scripts/tick.mjs
//
//   node merge-gate.mjs --pr <n|url>                          files + body via gh
//   node merge-gate.mjs --files "a.tsx,b.md" --body-file <f>  offline
//   add --surface-json '<json>' | --surface-file <path>       forwarded to is-ui-diff; without either,
//                                                             the surface in <repo-dir>/.agents/aw/ui.yml is used
//   add --repo-dir <path>                                     where .agents/aw/ lives (default: cwd)
//   node merge-gate.mjs --self-test
//
// Prints one JSON object, then a final line `MERGE_GATE: pass|refuse — <reason>`.
// Exit: 0 pass, 1 refuse, 2 error.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { isMain, makeTester, parseArgs, skillDir } from "./lib.mjs";

export const CONTRACT_DOC = "skills/testing/deployment-verify/rules/contract.md";

function uiVerifyScript() {
	return join(skillDir("ui-verify", "testing", "UI_VERIFY_DIR"), "scripts", "is-ui-diff.mjs");
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

// deployment-verify's own parse and validation: a contract the gate passes is one /deployment-verify accepts.
// Without release.yml the provider name cannot be checked, so any named provider stands in for it.
export async function flagContract(body, repoDir = process.cwd()) {
	const { parseContract, loadConfig, validateContract } = await deploymentVerifyModule("tick.mjs");
	const { contract, error } = parseContract(body || "");
	if (error) return { has: false, missing: error.startsWith("no contract") ? "contract" : "valid-json", detail: error };
	if (!contract || typeof contract !== "object") return { has: false, missing: "valid-json", detail: "the contract is not a JSON object" };
	const key = contract.flag?.key;
	if (typeof key !== "string" || !key.trim()) return { has: false, missing: "flag", detail: "the contract names no flag" };
	let config;
	try {
		config = loadConfig(contract.env || "production", { cwd: repoDir });
	} catch {
		const { DEFAULT_THRESHOLDS } = await deploymentVerifyModule("decide.mjs");
		config = { flags: { providers: contract.flag.provider ? [{ name: contract.flag.provider }] : [] }, thresholds: DEFAULT_THRESHOLDS };
	}
	const invalid = validateContract(contract, config);
	if (invalid) return { has: false, missing: "invalid", detail: invalid };
	return { has: true, flag: key };
}

export function decide({ isUI, contract }) {
	if (!isUI) return { decision: "pass", reason: "not user-visible — no UI file in the diff" };
	if (contract.has) return { decision: "pass", reason: `user-visible, behind flag ${contract.flag}` };
	const what = {
		contract: "no <!-- deployment-verify:v1 --> contract in the PR body",
		"valid-json": `the deployment-verify:v1 contract does not parse (${contract.detail})`,
		flag: "the deployment-verify:v1 contract names no flag",
		invalid: `deployment-verify would refuse the contract (${contract.detail})`,
	}[contract.missing];
	return {
		decision: "refuse",
		reason: `user-visible diff, ${what}`,
		how: [
			"Ship the change behind a flag, then add the contract to the PR body before the merge:",
			"node <deployment-verify>/scripts/tick.mjs --draft-contract --pr <n>   # prints a draft from the PR's criteria",
			'Fill "service" and "root_spans", add "flag": {"key": "<flag>", "provider": "<release.yml provider>"} and "cohort",',
			`and put the JSON between <!-- deployment-verify:v1 --> and <!-- /deployment-verify:v1 --> (${CONTRACT_DOC}).`,
		].join("\n"),
	};
}

export async function gate({ files, body, surfaceJson, surfaceFile, repoDir = process.cwd() }) {
	if (!surfaceJson && !surfaceFile) surfaceJson = await repoSurface(repoDir);
	const ui = userVisible(files, { surfaceJson, surfaceFile });
	const contract = await flagContract(body, repoDir);
	const d = decide({ isUI: ui.isUI, contract });
	return { ...d, user_visible: ui.isUI, has_flag_contract: contract.has, flag: contract.flag ?? null, ui_files: ui.matched };
}

function fromGh(pr) {
	const gh = (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	const files = gh(["pr", "diff", String(pr), "--name-only"]).split("\n").filter(Boolean);
	const body = gh(["pr", "view", String(pr), "--json", "body", "-q", ".body"]);
	return { files, body };
}

const FLAG_BODY = `x
<!-- deployment-verify:v1 -->
<details><summary>🚦 Deployment contract</summary>

\`\`\`json
{ "service": "ui", "root_spans": ["GET /x"], "flag": { "key": "newHeader", "provider": "posthog" }, "cohort": { "attribute": "a", "test": "true", "control": "false", "on": "root" }, "reversibility": "flag" }
\`\`\`

</details>
<!-- /deployment-verify:v1 -->`;
const NOFLAG_BODY = FLAG_BODY.replace(/"flag": \{[^}]*\}, "cohort": \{[^}]*\}, /, "");

async function selfTest() {
	const { t, done } = makeTester("merge-gate");
	const empty = mkdtempSync(join(tmpdir(), "atelier-gate-"));
	const run = (files, body) => gate({ files, body, repoDir: empty });
	let r = await run(["src/components/Header.tsx"], "no contract");
	t("UI diff without a contract refuses", r.decision === "refuse" && !r.has_flag_contract && r.user_visible);
	t("refusal names the marker", /deployment-verify:v1/.test(r.reason));
	t("refusal says how to add it", /--draft-contract/.test(r.how) && /"flag"/.test(r.how));
	r = await run(["src/components/Header.tsx"], NOFLAG_BODY);
	t("UI diff with a no-flag contract refuses on the flag", r.decision === "refuse" && /names no flag/.test(r.reason));
	r = await run(["src/components/Header.tsx"], FLAG_BODY);
	t("UI diff with a flag contract passes", r.decision === "pass" && r.flag === "newHeader" && r.has_flag_contract);
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
		if (a.pr) ({ files, body } = fromGh(a.pr));
		else if (a.files && a["body-file"]) {
			files = String(a.files).split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
			body = readFileSync(a["body-file"], "utf8");
		} else throw new Error("pass --pr <n>, or --files <list> --body-file <path>");
		const r = await gate({ files, body, surfaceJson: a["surface-json"], surfaceFile: a["surface-file"], repoDir: a["repo-dir"] || process.cwd() });
		console.log(JSON.stringify(r, null, 2));
		if (r.how) console.log(r.how);
		console.log(`MERGE_GATE: ${r.decision} — ${r.reason}`);
		process.exit(r.decision === "pass" ? 0 : 1);
	} catch (e) {
		console.error(`merge-gate: ${e.message}`);
		process.exit(2);
	}
}

if (isMain(import.meta.url)) main();
