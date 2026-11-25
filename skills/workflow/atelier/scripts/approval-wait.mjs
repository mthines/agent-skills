#!/usr/bin/env node
// approval-wait.mjs — wait for a PR's automatic approval, for at most --max-wait minutes (SKILL.md, "Waiting for approval").
//
// Some repos block the merge on a required review that a bot or an automatic check gives (an auto-approval app, a
// policy check). Which one is the repo's choice: `.agents/aw/merge.yml` names the checks to wait for, and `--check`
// overrides it. The merge stage waits for their verdict instead of ending at a hold: approved → the run merges;
// declined or never started → a person has to review, and the run says so. With none named, a required review is
// a person's job at once: nothing is assumed about the repo.
//
//   node approval-wait.mjs --pr <url> [--head <sha>] [--max-wait <minutes>] [--interval <seconds>]
//                          [--check <regex>]... [--repo-dir <path>]
//   node approval-wait.mjs --self-test
//
//   .agents/aw/merge.yml            (--repo-dir, default cwd; every field optional)
//     approval:
//       wait_for: ["Darkplane auto-approval", "policy-bot"]   # regexes, case-insensitive, on check-run / status names; all must pass
//       max_wait_minutes: 30
//       start_grace_minutes: 5                                # how long a named check may take to show up
//
// approved: the review decision is APPROVED, no review is required, or every named check passed.
// manual:   a named check finished without approving (failure, skipped, cancelled), changes were requested, a named
//           check never showed up within the grace, or a review is required and none is named. A person must act.
// pending:  a named check is still running when --max-wait ends.
// moved:    the head is not --head; an approval of another head proves nothing.
// merged:   the PR is already merged.
//
// Prints one JSON object, then a final line `APPROVAL_WAIT: approved|manual|pending|moved|merged — <reason>`.
// Exit: 0 approved or merged, 1 manual, 2 error, 3 pending after --max-wait, 4 moved.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { isMain, makeTester, parseArgs, skillDir } from "./lib.mjs";

export const DEFAULT_MAX_WAIT_MINUTES = 30;
export const DEFAULT_INTERVAL_SECONDS = 30;
// A named check registers a little after the last required check passes; one that is absent after this is manual.
export const START_GRACE_MINUTES = 5;
const MAX_CONSECUTIVE_ERRORS = 3;

function sameSha(a, b) {
	const n = Math.min(a.length, b.length, 7);
	return n >= 7 && a.slice(0, n) === b.slice(0, n);
}

// One `gh pr view --json state,reviewDecision,headRefOid,statusCheckRollup` object → { state, reason, head }.
// `state` is approved | manual | pending | merged. Pure: no I/O, no clock; `sinceStartMs` feeds the grace only.
export function classify(pr, { checks = [], sinceStartMs = 0, graceMs = START_GRACE_MINUTES * 60_000 } = {}) {
	const head = pr.headRefOid ?? null;
	const out = (state, reason) => ({ state, reason, head });
	if (pr.state === "MERGED") return out("merged", "the PR is merged");
	if (pr.reviewDecision === "APPROVED") return out("approved", "the review decision is APPROVED");
	if (pr.reviewDecision === "CHANGES_REQUESTED") return out("manual", "changes were requested: a person has to review");
	if (!pr.reviewDecision) return out("approved", "no review is required");
	if (checks.length === 0) return out("manual", "a review is required and no automatic approval is configured (.agents/aw/merge.yml approval.wait_for): a person has to review");

	const contexts = pr.statusCheckRollup ?? [];
	const phaseOf = (node) => {
		if (node.__typename === "StatusContext") return { phase: { SUCCESS: "passed", PENDING: "pending", EXPECTED: "pending" }[node.state] ?? "failed", verdict: node.state };
		return { phase: node.status !== "COMPLETED" ? "pending" : node.conclusion === "SUCCESS" ? "passed" : "failed", verdict: node.conclusion };
	};
	// A check can have several runs (one per event): it passed if any run passed, is pending if any still runs, failed only when every run finished without passing.
	const phases = checks.map((re) => {
		const nodes = contexts.filter((c) => re.test(c.name ?? c.context ?? ""));
		if (!nodes.length) return { label: String(re.source), phase: "missing" };
		const runs = nodes.map((n) => ({ label: n.name ?? n.context, ...phaseOf(n) }));
		return runs.find((r) => r.phase === "passed") ?? runs.find((r) => r.phase === "pending") ?? runs[0];
	});
	const failed = phases.find((p) => p.phase === "failed");
	if (failed) return out("manual", `${failed.label} finished ${String(failed.verdict).toLowerCase()}, so it did not approve: a person has to review`);
	const missing = phases.filter((p) => p.phase === "missing");
	if (missing.length && sinceStartMs >= graceMs) return out("manual", `${missing.map((p) => p.label).join(", ")} did not appear: a person has to review`);
	const waiting = phases.filter((p) => p.phase !== "passed");
	if (waiting.length) return out("pending", `${waiting.map((p) => `${p.label} ${p.phase === "missing" ? "has not started" : "is still running"}`).join("; ")}`);
	const names = phases.map((p) => p.label).join(", ");
	// The merge needs the review decision itself: a passed check whose review has not landed yet is still waiting.
	if (sinceStartMs < graceMs) return out("pending", `${names} passed; waiting for the review decision to turn APPROVED`);
	return out("manual", `${names} passed but the review decision is still ${pr.reviewDecision}: a person has to review`);
}

// The repo's approval settings from .agents/aw/merge.yml, parsed with deployment-verify's YAML reader; absent file → {}.
export async function loadApprovalConfig(repoDir) {
	const path = join(repoDir, ".agents", "aw", "merge.yml");
	if (!existsSync(path)) return {};
	const { parseYaml } = await import(pathToFileURL(join(skillDir("deployment-verify", "testing", "DEPLOYMENT_VERIFY_DIR"), "scripts", "yaml-lite.mjs")).href);
	const a = parseYaml(readFileSync(path, "utf8"))?.approval ?? {};
	const list = Array.isArray(a.wait_for) ? a.wait_for : a.wait_for ? [a.wait_for] : [];
	const number = (v, label) => {
		if (v === undefined || v === null) return undefined;
		const n = Number(v);
		if (!Number.isFinite(n) || n < 0) throw new Error(`.agents/aw/merge.yml approval.${label} must be a non-negative number, got ${v}`);
		return n;
	};
	return { waitFor: list.map(String), maxWaitMinutes: number(a.max_wait_minutes, "max_wait_minutes"), startGraceMinutes: number(a.start_grace_minutes, "start_grace_minutes") };
}

// Every `--check <regex>` on the command line, in order (parseArgs keeps only the last).
export function checkFlags(argv) {
	return argv.flatMap((a, i) => (a === "--check" && argv[i + 1] && !argv[i + 1].startsWith("--") ? [argv[i + 1]] : []));
}

// `check()` returns classify()'s result. All time and I/O is injected.
export async function waitForApproval({ check, expectedHead = null, maxWaitMs, intervalMs, graceMs = START_GRACE_MINUTES * 60_000, now = Date.now, sleep }) {
	const start = now();
	const grace = Math.min(graceMs, maxWaitMs);
	let polls = 0;
	let errors = 0;
	for (;;) {
		let r;
		try {
			r = await check(now() - start, grace);
			errors = 0;
		} catch (e) {
			if (++errors >= MAX_CONSECUTIVE_ERRORS || now() - start >= maxWaitMs) throw e;
			await sleep(intervalMs);
			continue;
		}
		polls++;
		const waitedMs = now() - start;
		const done = (result) => ({ ...result, polls, waited_s: Math.round(waitedMs / 1000) });
		if (r.state === "merged") return done(r);
		if (expectedHead && r.head && !sameSha(expectedHead, r.head)) {
			return done({ ...r, state: "moved", reason: `head moved: expected ${expectedHead.slice(0, 7)}, PR is at ${r.head.slice(0, 7)}` });
		}
		if (r.state === "approved" || r.state === "manual") return done(r);
		if (waitedMs >= maxWaitMs) return done(r);
		await sleep(intervalMs);
	}
}

function minutes(value, fallback, label) {
	const raw = value ?? fallback;
	const n = typeof raw === "boolean" ? NaN : Number(raw);
	if (!Number.isFinite(n) || n < 0) throw new Error(`${label} must be a non-negative number, got ${raw}`);
	return n;
}

function readPr(pr) {
	const text = execFileSync("gh", ["pr", "view", pr, "--json", "state,reviewDecision,headRefOid,statusCheckRollup"], { encoding: "utf8" });
	return JSON.parse(text);
}

async function selfTest() {
	const { t, done } = makeTester("approval-wait");
	const sha = "a".repeat(40);
	const run = (name, status, conclusion) => ({ __typename: "CheckRun", name, status, conclusion });
	const pr = (over = {}) => ({ state: "OPEN", reviewDecision: "REVIEW_REQUIRED", headRefOid: sha, statusCheckRollup: [], ...over });
	const dp = (status, conclusion) => run("Darkplane auto-approval", status, conclusion);

	const DP = [/darkplane auto-approval/i];
	const cls = (p, o = {}) => classify(p, { checks: DP, ...o });

	t("a merged PR is merged", cls(pr({ state: "MERGED" })).state === "merged");
	t("an APPROVED review decision approves", cls(pr({ reviewDecision: "APPROVED" })).state === "approved");
	t("changes requested is manual", cls(pr({ reviewDecision: "CHANGES_REQUESTED" })).state === "manual");
	t("no review required means approved, with no check named", classify(pr({ reviewDecision: "" })).state === "approved");
	t("a required review with no check named is manual at once", (() => { const r = classify(pr()); return r.state === "manual" && /no automatic approval is configured/.test(r.reason); })());
	t("a passed named check waits for the review decision to turn APPROVED", (() => { const r = cls(pr({ statusCheckRollup: [dp("COMPLETED", "SUCCESS")] })); return r.state === "pending" && /waiting for the review decision/.test(r.reason); })());
	t("a passed named check whose review never lands is manual after the grace", (() => { const r = cls(pr({ statusCheckRollup: [dp("COMPLETED", "SUCCESS")] }), { sinceStartMs: 6 * 60_000 }); return r.state === "manual" && /still REVIEW_REQUIRED/.test(r.reason); })());
	t("a passed named check with the decision APPROVED approves", cls(pr({ reviewDecision: "APPROVED", statusCheckRollup: [dp("COMPLETED", "SUCCESS")] })).state === "approved");
	t("two runs of the named check, one skipped and one passed, count as passed", cls(pr({ statusCheckRollup: [dp("COMPLETED", "SKIPPED"), dp("COMPLETED", "SUCCESS")] })).state === "pending");
	t("two runs, one skipped and one still running, are pending", cls(pr({ statusCheckRollup: [dp("COMPLETED", "SKIPPED"), dp("IN_PROGRESS", null)] })).state === "pending");
	t("two runs that all finished without passing are manual", cls(pr({ statusCheckRollup: [dp("COMPLETED", "SKIPPED"), dp("COMPLETED", "FAILURE")] })).state === "manual");
	t("a running named check is pending", cls(pr({ statusCheckRollup: [dp("IN_PROGRESS", null)] })).state === "pending");
	t("a queued named check is pending", cls(pr({ statusCheckRollup: [dp("QUEUED", null)] })).state === "pending");
	for (const conclusion of ["FAILURE", "NEUTRAL", "SKIPPED", "CANCELLED", "TIMED_OUT"]) {
		const r = cls(pr({ statusCheckRollup: [dp("COMPLETED", conclusion)] }));
		t(`a named check that finished ${conclusion} is manual`, r.state === "manual" && r.reason.includes(conclusion.toLowerCase()), JSON.stringify(r));
	}
	const status = (state) => ({ __typename: "StatusContext", context: "Darkplane auto-approval", state });
	t("a commit status PENDING is pending", cls(pr({ statusCheckRollup: [status("PENDING")] })).state === "pending");
	t("a commit status SUCCESS waits for the review decision", cls(pr({ statusCheckRollup: [status("SUCCESS")] })).state === "pending");
	t("a commit status ERROR is manual", cls(pr({ statusCheckRollup: [status("ERROR")] })).state === "manual");
	t("other checks are not the named one", cls(pr({ statusCheckRollup: [run("Run E2E tests", "COMPLETED", "SUCCESS")] })).state === "pending");
	t("a named check that has not shown up waits through the grace", cls(pr(), { sinceStartMs: 60_000 }).state === "pending");
	t("a named check that never shows up is manual after the grace", (() => { const r = cls(pr(), { sinceStartMs: 6 * 60_000 }); return r.state === "manual" && /did not appear/.test(r.reason); })());
	t("the grace is configurable", cls(pr(), { sinceStartMs: 60_000, graceMs: 30_000 }).state === "manual");

	const two = [/darkplane auto-approval/i, /policy-bot/i];
	const both = [dp("COMPLETED", "SUCCESS"), run("policy-bot", "COMPLETED", "SUCCESS")];
	t("several named checks: all passed, decision APPROVED, approves", classify(pr({ reviewDecision: "APPROVED", statusCheckRollup: both }), { checks: two }).state === "approved");
	t("several named checks: all passed, review not yet APPROVED, waits", classify(pr({ statusCheckRollup: both }), { checks: two }).state === "pending");
	t("several named checks: one failing is manual even while another runs", classify(pr({ statusCheckRollup: [dp("COMPLETED", "FAILURE"), run("policy-bot", "IN_PROGRESS", null)] }), { checks: two }).state === "manual");
	t("several named checks: one still running is pending", classify(pr({ statusCheckRollup: [dp("COMPLETED", "SUCCESS"), run("policy-bot", "IN_PROGRESS", null)] }), { checks: two }).state === "pending");
	t("several named checks: one missing after the grace is manual", classify(pr({ statusCheckRollup: [dp("COMPLETED", "SUCCESS")] }), { checks: two, sinceStartMs: 6 * 60_000 }).state === "manual");
	t("a regex names the check, whatever the repo calls it", classify(pr({ statusCheckRollup: [run("Other bot", "COMPLETED", "SUCCESS")] }), { checks: [/other bot/i] }).reason.startsWith("Other bot passed"));

	t("--check flags are all collected, in order", JSON.stringify(checkFlags(["--pr", "x", "--check", "a", "--max-wait", "1", "--check", "b"])) === '["a","b"]');
	t("a --check with no value is ignored", checkFlags(["--check"]).length === 0 && checkFlags(["--check", "--pr", "x"]).length === 0);

	const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const repo = mkdtempSync(join(tmpdir(), "approval-wait-"));
	t("no merge.yml means no config", Object.keys(await loadApprovalConfig(repo)).length === 0);
	mkdirSync(join(repo, ".agents", "aw"), { recursive: true });
	writeFileSync(join(repo, ".agents", "aw", "merge.yml"), 'version: 1\napproval:\n  wait_for:\n    - "Darkplane auto-approval"\n    - policy-bot\n  max_wait_minutes: 10\n  start_grace_minutes: 2\n');
	const cfg = await loadApprovalConfig(repo);
	t("merge.yml names the checks and the timings", JSON.stringify(cfg) === JSON.stringify({ waitFor: ["Darkplane auto-approval", "policy-bot"], maxWaitMinutes: 10, startGraceMinutes: 2 }), JSON.stringify(cfg));
	writeFileSync(join(repo, ".agents", "aw", "merge.yml"), "approval:\n  wait_for: policy-bot\n");
	t("a single wait_for string is one check", JSON.stringify((await loadApprovalConfig(repo)).waitFor) === '["policy-bot"]');
	writeFileSync(join(repo, ".agents", "aw", "merge.yml"), "approval:\n  max_wait_minutes: soon\n");
	let bad = "";
	try { await loadApprovalConfig(repo); } catch (e) { bad = e.message; }
	t("a bad number in merge.yml is an error, not a silent default", /max_wait_minutes must be a non-negative number/.test(bad), bad);
	rmSync(repo, { recursive: true, force: true });

	const clock = () => {
		let ms = 0;
		return { now: () => ms, sleep: async (d) => { ms += d; } };
	};
	const sequence = (...states) => {
		let i = 0;
		return async () => {
			const s = states[Math.min(i++, states.length - 1)];
			return typeof s === "string" ? { state: s, reason: s, head: sha } : s;
		};
	};
	const wait = (check, opts = {}) => waitForApproval({ check, maxWaitMs: 10 * 60_000, intervalMs: 30_000, ...clock(), ...opts });

	const ok = await wait(sequence("approved"));
	t("approved ends at once", ok.state === "approved" && ok.polls === 1 && ok.waited_s === 0);
	const later = await wait(sequence("pending", "pending", "approved"));
	t("pending keeps waiting until approved", later.state === "approved" && later.polls === 3 && later.waited_s === 60, JSON.stringify(later));
	const declined = await wait(sequence("pending", "manual"));
	t("manual ends the wait", declined.state === "manual" && declined.polls === 2);
	const stuck = await wait(sequence("pending"));
	t("pending past --max-wait ends as pending", stuck.state === "pending" && stuck.waited_s === 600, JSON.stringify(stuck));
	const seen = [];
	await wait(async (_since, g) => { seen.push(g); return { state: "approved", reason: "a", head: sha }; }, { maxWaitMs: 60_000, graceMs: 300_000 });
	t("the grace never exceeds --max-wait", seen[0] === 60_000, JSON.stringify(seen));
	const zero = await wait(sequence("pending", "approved"), { maxWaitMs: 0 });
	t("--max-wait 0 reads once and never sleeps", zero.state === "pending" && zero.polls === 1 && zero.waited_s === 0);
	const merged = await wait(sequence("merged"));
	t("an already merged PR ends as merged", merged.state === "merged");
	const moved = await wait(sequence({ state: "approved", reason: "a", head: "b".repeat(40) }), { expectedHead: sha });
	t("an approval of another head is `moved`, never approved", moved.state === "moved" && /head moved/.test(moved.reason), JSON.stringify(moved));
	const grace = [];
	await wait(async (sinceStart, graceMs) => { grace.push([sinceStart, graceMs]); return sinceStart >= 90_000 ? { state: "approved", reason: "a", head: sha } : { state: "pending", reason: "p", head: sha }; });
	t("the check receives the elapsed time and the grace", grace.length === 4 && grace[3][0] === 90_000 && grace[0][1] === 300_000, JSON.stringify(grace));
	let calls = 0;
	const flaky = async () => { if (++calls < 3) throw new Error("HTTP 502"); return { state: "approved", reason: "a", head: sha }; };
	t("a transient read error is retried", (await wait(flaky)).state === "approved" && calls === 3);
	let threw = "";
	try { await wait(async () => { throw new Error("HTTP 401"); }); } catch (e) { threw = e.message; }
	t("a persistent read error fails after three tries", threw === "HTTP 401");
	return done();
}

async function main() {
	const a = parseArgs(process.argv.slice(2));
	if (a["self-test"]) process.exit(await selfTest());
	try {
		if (!a.pr || typeof a.pr !== "string") throw new Error("pass --pr <url>");
		const interval = minutes(a.interval, DEFAULT_INTERVAL_SECONDS, "--interval (seconds)");
		const cfg = await loadApprovalConfig(typeof a["repo-dir"] === "string" ? a["repo-dir"] : process.cwd());
		const named = checkFlags(process.argv.slice(2));
		const checks = (named.length ? named : cfg.waitFor ?? []).map((re) => new RegExp(re, "i"));
		const maxWait = minutes(a["max-wait"], cfg.maxWaitMinutes ?? DEFAULT_MAX_WAIT_MINUTES, "--max-wait (minutes)");
		const graceMs = (cfg.startGraceMinutes ?? START_GRACE_MINUTES) * 60_000;
		const result = await waitForApproval({
			check: async (sinceStartMs, grace) => classify(readPr(a.pr), { checks, sinceStartMs, graceMs: grace }),
			expectedHead: typeof a.head === "string" ? a.head : null,
			maxWaitMs: maxWait * 60_000,
			intervalMs: Math.max(1, interval) * 1000,
			graceMs,
			sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
		});
		console.log(JSON.stringify({ ...result, max_wait_minutes: maxWait }, null, 2));
		console.log(`APPROVAL_WAIT: ${result.state} — ${result.reason}`);
		process.exit({ approved: 0, merged: 0, manual: 1, pending: 3, moved: 4 }[result.state] ?? 2);
	} catch (e) {
		console.error(`approval-wait.mjs: ${e.message}`);
		process.exit(2);
	}
}

if (isMain(import.meta.url)) main();
