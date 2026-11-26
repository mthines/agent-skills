#!/usr/bin/env node
// verify-deploy.mjs — Deliver's verify step, after the pipeline is green (rules/deliver.md § Verify).
//
// Runs deployment-verify's controller for a merged PR whose contract has no flag, in a repo with a hosted
// production service, and turns its status line into a Deliver decision. Owns no verdict: tick.mjs measures
// and decide.mjs judges. A flag contract is never run here: stepping a flag is a human's or /deployment-verify's.
//
//   node verify-deploy.mjs --pr <n|url> [--repo-dir <path>]   tick.mjs --pr <n> --run, until the rollout ends
//                                                            (start it in the background: it waits on telemetry)
//   node verify-deploy.mjs --pr <n|url> --unattended         label the PR, one tick, exit; the scheduled
//                                                            `tick.mjs --all --unattended` finishes the rollout
//   node verify-deploy.mjs --map "<deployment-verify status line>"
//   node verify-deploy.mjs --self-test
//
// A re-run on a finished rollout reads the stored outcome; tick.mjs never ticks it again.
// Prints `REVERT: yes — <reason>` when Deliver's revert lane takes over, then a final line
// `VERIFY: proceed|hold|failed|skipped — <reason>`.
// Exit: 0 proceed or skipped, 1 failed, 3 hold, 2 error.

import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { isMain, makeTester, parseArgs, skillDir } from "./lib.mjs";
import { hostedRepo, optOut } from "./merge-gate.mjs";

const DV_DIR = () => skillDir("deployment-verify", "testing", "DEPLOYMENT_VERIFY_DIR");
const TICK = () => join(DV_DIR(), "scripts", "tick.mjs");
const { parseContract } = await import(pathToFileURL(TICK()).href);

const LABEL = "deployment-verify";
// The one ESCALATE the revert lane owns: no flag to turn off and no platform rollback (deployment-verify rules/rollback.md).
const NEEDS_HUMAN_ROLLBACK = /rollback needs a human/;
const STATUS_RE = /^deployment-verify (?:#\d+|local): (.+?) — (.*)$/;

// What Deliver does with the PR: run the controller, or skip with the reason the terminal `Deliver:` line shows.
export function planVerify({ body, hosted }) {
	if (!hosted) return { action: "skip", reason: "no hosted production service (release.yml deploy detection is manual or absent)" };
	const { contract, error } = parseContract(body || "");
	if (error) {
		const opt = optOut(body);
		return { action: "skip", reason: opt ? `deployment-verify:none — ${opt.reason || "no reason given"}` : "no deployment-verify:v1 contract on the PR" };
	}
	if (contract?.flag) return { action: "skip", reason: `flag ${contract.flag.key ?? "(no key)"}: a human steps it with /deployment-verify` };
	return { action: "run", reason: "before/after contract" };
}

// One deployment-verify status line → a Deliver decision. Anything not judged yet is a hold, never a pass.
export function mapOutcome(line) {
	const m = String(line || "").trim().match(STATUS_RE);
	if (!m) return { decision: "hold", reason: "deployment-verify printed no status line", revert: false };
	const [, status, detail] = m;
	const reason = `deployment-verify ${status} — ${detail}`;
	if (status === "PASS") return { decision: "proceed", reason, revert: false };
	if (status === "ROLLED_BACK") return { decision: "failed", reason, revert: false };
	if (status === "ESCALATE") return { decision: "failed", reason, revert: NEEDS_HUMAN_ROLLBACK.test(detail) };
	// INCONCLUSIVE, STOPPED, OVERRIDDEN, IN PROGRESS (deploy | baseline | step | hold | rollback): nothing to act on yet.
	return { decision: "hold", reason: status.startsWith("IN PROGRESS") ? `verifying — ${reason}` : reason, revert: false };
}

// The last status line tick.mjs printed for this PR.
export function lastStatus(stdout, number) {
	return String(stdout || "").split("\n").filter((l) => l.startsWith(`deployment-verify #${number}:`)).at(-1) || null;
}

const realGh = (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const realTick = (args, cwd) => spawnSync(process.execPath, [TICK(), ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

export async function verify({ pr, unattended = false, repoDir = process.cwd(), gh = realGh, tick = realTick, hosted = null }) {
	const number = String(pr).match(/(\d+)\/?$/)?.[1] ?? String(pr);
	const view = JSON.parse(gh(["pr", "view", number, "--json", "body,mergedAt"]));
	if (!view.mergedAt) return { decision: "skipped", reason: `#${number} is not merged`, revert: false };
	const plan = planVerify({ body: view.body, hosted: hosted ?? (await hostedRepo(repoDir)) });
	if (plan.action === "skip") return { decision: "skipped", reason: plan.reason, revert: false };
	if (unattended) {
		// The label is how the scheduled `tick --all --unattended` finds the rollout after this run exits.
		gh(["label", "create", LABEL, "--color", "fbca04", "--description", "deployment-verify rollout in progress", "--force"]);
		gh(["pr", "edit", number, "--add-label", LABEL]);
	}
	const r = tick(unattended ? ["--pr", number, "--unattended"] : ["--pr", number, "--run"], repoDir);
	const line = lastStatus(r.stdout, number);
	if (!line && r.status !== 0) return { decision: "hold", reason: `tick.mjs exited ${r.status} with no status line`, revert: false };
	const out = mapOutcome(line);
	if (unattended && out.decision === "hold" && /^verifying/.test(out.reason)) out.reason += "; the scheduled tick --all --unattended finishes it";
	return out;
}

function selfTest() {
	const { t, done } = makeTester("verify-deploy");
	const L = (s) => `deployment-verify #5: ${s}`;
	const m = (s) => mapOutcome(L(s));
	t("PASS → proceed", m("PASS — every probed route held").decision === "proceed");
	t("ROLLED_BACK → failed, no revert (already reversed)", m("ROLLED_BACK — RECOVERED in 60 s").decision === "failed" && !m("ROLLED_BACK — x").revert);
	t("ESCALATE rollback needs a human → failed + revert lane", m("ESCALATE — rollback needs a human (reversibility: code)").revert && m("ESCALATE — rollback needs a human").decision === "failed");
	t("other ESCALATE → failed, no revert", m("ESCALATE — errors persist after rollback").decision === "failed" && !m("ESCALATE — errors persist after rollback").revert);
	for (const s of ["INCONCLUSIVE — window too small", "STOPPED — deploy not detected in 60 min", "IN PROGRESS (hold) — step 10%: HOLD", "IN PROGRESS (deploy) — waiting for the deploy", "OVERRIDDEN — by a human"]) t(`${s.split(" — ")[0]} → hold`, m(s).decision === "hold");
	t("an in-progress rollout reads as verifying", /^verifying/.test(m("IN PROGRESS (step) — step 100%: HOLD").reason));
	t("no status line → hold, never proceed", mapOutcome("").decision === "hold" && mapOutcome("tick.mjs: boom").decision === "hold");
	t("lastStatus picks this PR's last line", lastStatus("deployment-verify #4: PASS — a\ndeployment-verify #5: IN PROGRESS (deploy) — w\ndeployment-verify #5: PASS — b\n", 5) === L("PASS — b"));

	const contract = (o) => `x\n<!-- deployment-verify:v1 -->\n\`\`\`json\n${JSON.stringify({ service: "api", root_spans: ["GET /x"], ...o })}\n\`\`\`\n<!-- /deployment-verify:v1 -->\n`;
	t("plan: a no-flag contract in a hosted repo runs", planVerify({ body: contract({}), hosted: true }).action === "run");
	t("plan: a flag contract is skipped, naming the flag", /flag f: a human/.test(planVerify({ body: contract({ flag: { key: "f" } }), hosted: true }).reason));
	t("plan: an opt-out is skipped with its reason", planVerify({ body: "<!-- deployment-verify:none — docs only -->", hosted: true }).reason === "deployment-verify:none — docs only");
	t("plan: no contract is skipped", planVerify({ body: "nothing", hosted: true }).action === "skip");
	t("plan: a repo with no hosted service is skipped", planVerify({ body: contract({}), hosted: false }).action === "skip");

	// The run itself, with gh and tick.mjs stubbed.
	const calls = [];
	const gh = (body, mergedAt = "2026-11-26T08:00:00Z") => (args) => (calls.push(args.join(" ")), args[1] === "view" ? JSON.stringify({ body, mergedAt }) : "");
	const tickWith = (stdout, status = 0) => (args) => (calls.push(`tick ${args.join(" ")}`), { stdout, status });
	return (async () => {
		let r = await verify({ pr: "https://github.com/a/b/pull/5", gh: gh(contract({})), tick: tickWith(L("PASS — held\n")), hosted: true });
		t("interactive: runs tick --run and proceeds on PASS", r.decision === "proceed" && calls.includes("tick --pr 5 --run") && !calls.some((c) => /--add-label/.test(c)), JSON.stringify(calls));
		calls.length = 0;
		r = await verify({ pr: 5, unattended: true, gh: gh(contract({})), tick: tickWith(L("IN PROGRESS (deploy) — waiting for the deploy\n")), hosted: true });
		t("unattended: labels the PR, ticks once, holds as verifying", r.decision === "hold" && /scheduled tick --all/.test(r.reason) && calls.includes("pr edit 5 --add-label deployment-verify") && calls.includes("tick --pr 5 --unattended"), JSON.stringify(calls));
		calls.length = 0;
		r = await verify({ pr: 5, gh: gh(contract({ flag: { key: "f" } })), tick: tickWith(""), hosted: true });
		t("a flag contract never reaches tick.mjs", r.decision === "skipped" && !calls.some((c) => c.startsWith("tick")), JSON.stringify(calls));
		r = await verify({ pr: 5, gh: gh(contract({}), null), tick: tickWith(""), hosted: true });
		t("an unmerged PR is skipped", r.decision === "skipped" && /not merged/.test(r.reason));
		r = await verify({ pr: 5, gh: gh(contract({})), tick: tickWith("", 1), hosted: true });
		t("a tick that dies with no line holds", r.decision === "hold" && /exited 1/.test(r.reason));
		r = await verify({ pr: 5, gh: gh(contract({})), tick: tickWith(L("ESCALATE — rollback needs a human (reversibility: code)\n"), 3), hosted: true });
		t("exit 3 with an ESCALATE line → failed + revert", r.decision === "failed" && r.revert);
		return done();
	})();
}

function print(r) {
	if (r.revert) console.log(`REVERT: yes — ${r.reason}; Deliver's revert lane (policies.rollback) takes over`);
	console.log(`VERIFY: ${r.decision} — ${r.reason}`);
	return { proceed: 0, skipped: 0, failed: 1, hold: 3 }[r.decision];
}

async function main() {
	const a = parseArgs(process.argv.slice(2));
	if (a["self-test"]) process.exit(await selfTest());
	try {
		if (typeof a.map === "string") process.exit(print(mapOutcome(a.map)));
		if (!a.pr) throw new Error("pass --pr <n|url>, --map <line>, or --self-test");
		process.exit(print(await verify({ pr: a.pr, unattended: !!a.unattended, repoDir: a["repo-dir"] || process.cwd() })));
	} catch (e) {
		console.error(`verify-deploy: ${e.message}`);
		process.exit(2);
	}
}

if (isMain(import.meta.url)) main();
