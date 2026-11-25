#!/usr/bin/env node
// pipeline.mjs — atelier's post-merge check (rules/deliver.md).
//
// Reads the default-branch workflow runs GitHub started for the merge commit and says whether the
// pipeline that builds and releases the change went green: no required job failed, none was skipped
// when it had to run, and nothing is still running. Owns no fixer; it names the failing job and step.
//
//   node pipeline.mjs --pr <url|n> [--wait <minutes>] [--repo-dir <path>]   merge commit and branch from the PR (a bare n needs --repo)
//   node pipeline.mjs --repo <owner/name> --sha <sha> --branch <b> [--wait <m>]
//   add --workflow <name> --required <job,job>                              override .agents/aw/release.yml → pipeline
//   node pipeline.mjs --self-test
//
// Prints one JSON object, then a final line `PIPELINE: green|pending|red|none — <reason>`.
// Exit: 0 green, 1 red or none, 2 error, 3 pending after --wait.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { isMain, makeTester, parseArgs, skillDir } from "./lib.mjs";

const BAD = new Set(["failure", "cancelled", "timed_out", "startup_failure", "action_required"]);

// Pure. `runs`: [{ id, workflow, url, status, conclusion, jobs: [{ name, status, conclusion, steps: [{ name, conclusion }] }] }].
// `required`: job names that must conclude `success` (a skipped required job is a failure: the release job
// skipping is how a broken version step looks from outside). `workflow`: only runs of that workflow count.
// A required name matches a job's name exactly, as a matrix job (`test (ubuntu-latest)`), or as a job of a
// called workflow (`ci / test`, `ci / test (node 20)`).
export function jobMatches(jobName, required) {
	const base = String(jobName).split(" / ").pop().replace(/ \(.*\)$/, "");
	return jobName === required || base === required;
}

export function classify(runs, { required = [], workflow = "" } = {}) {
	const mine = runs.filter((r) => !workflow || r.workflow === workflow);
	if (!mine.length) return { state: "none", reason: "no workflow run started for the merge commit", failures: [] };
	const failures = [];
	for (const r of mine) {
		for (const j of r.jobs ?? []) {
			if (j.status === "completed" && BAD.has(j.conclusion)) {
				const step = (j.steps ?? []).find((s) => BAD.has(s.conclusion))?.name ?? null;
				failures.push({ workflow: r.workflow, job: j.name, step, conclusion: j.conclusion, run: r.url });
			}
		}
		if (r.status === "completed" && BAD.has(r.conclusion) && !failures.some((f) => f.run === r.url)) {
			failures.push({ workflow: r.workflow, job: null, step: null, conclusion: r.conclusion, run: r.url });
		}
	}
	const jobs = mine.flatMap((r) => (r.jobs ?? []).map((j) => ({ ...j, run: r.url, workflow: r.workflow })));
	for (const name of required) {
		const j = jobs.find((x) => jobMatches(x.name, name));
		// A job that has not appeared yet is missing only once every run is done: a queued run lists no jobs.
		if (!j) { if (mine.every((r) => r.status === "completed")) failures.push({ workflow: workflow || null, job: name, step: null, conclusion: "missing", run: mine[0].url }); }
		else if (j.status === "completed" && j.conclusion !== "success" && !BAD.has(j.conclusion)) {
			failures.push({ workflow: j.workflow, job: name, step: null, conclusion: j.conclusion, run: j.run });
		}
	}
	const describe = (f) => `${f.workflow ?? "workflow"} › ${f.job ?? "run"}${f.step ? ` › ${f.step}` : ""} ${f.conclusion}`;
	if (failures.length) return { state: "red", reason: failures.map(describe).join("; "), failures };
	if (mine.some((r) => r.status !== "completed")) return { state: "pending", reason: "a run is still in progress", failures: [] };
	return { state: "green", reason: `${mine.length} run(s) passed`, failures: [] };
}

function gh(args, run = execFileSync) {
	return run("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

// The runs for `sha` on `branch`, each with its jobs; `run` is injectable for tests.
// `cache` (run id → run) keeps a completed run's jobs across polls: a finished run never changes, so a poll
// costs one list call plus a jobs call per run still in flight.
export function fetchRuns({ repo, sha, branch }, run = execFileSync, cache = new Map()) {
	const list = JSON.parse(
		gh(["run", "list", "-R", repo, "--commit", sha, "--branch", branch, "--event", "push", "--limit", "20",
			"--json", "databaseId,workflowName,status,conclusion,url"], run),
	);
	return list.map((r) => {
		const hit = cache.get(r.databaseId);
		if (hit) return hit;
		const jobs = JSON.parse(gh(["run", "view", String(r.databaseId), "-R", repo, "--json", "jobs"], run)).jobs ?? [];
		const out = { id: r.databaseId, workflow: r.workflowName, url: r.url, status: r.status, conclusion: r.conclusion, jobs };
		if (r.status === "completed") cache.set(r.databaseId, out);
		return out;
	});
}

// `.agents/aw/release.yml` → pipeline: { workflow, required_jobs, timeout_minutes }; {} when absent.
async function loadConfig(repoDir) {
	const file = join(repoDir, ".agents", "aw", "release.yml");
	if (!existsSync(file)) return {};
	const { parseYaml } = await import(pathToFileURL(join(skillDir("deployment-verify", "testing", "DEPLOYMENT_VERIFY_DIR"), "scripts", "yaml-lite.mjs")).href);
	return parseYaml(readFileSync(file, "utf8"))?.pipeline ?? {};
}

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

async function selfTest() {
	const { t, done } = makeTester("pipeline");
	const job = (name, conclusion, steps = [], status = "completed") => ({ name, status, conclusion, steps });
	const run = (workflow, jobs, status = "completed", conclusion = "success") => ({ id: 1, workflow, url: `https://x/${workflow}`, status, conclusion, jobs });
	t("no run → none", classify([]).state === "none");
	t("all green", classify([run("CI", [job("test", "success"), job("release-macos", "skipped")])]).state === "green");
	// The failure this exists for: the version job's tag step failed and the release job skipped.
	const bad = classify([run("CI", [job("test", "success"), job("version", "failure", [{ name: "Create tag", conclusion: "failure" }]), job("release-macos", "skipped")], "completed", "failure")], { required: ["test", "version", "release-macos"] });
	t("a failed job is red and names the step", bad.state === "red" && bad.failures[0].job === "version" && bad.failures[0].step === "Create tag", JSON.stringify(bad));
	t("a skipped required job is red", classify([run("CI", [job("test", "success"), job("release-macos", "skipped")])], { required: ["release-macos"] }).state === "red");
	t("a skipped job that is not required is fine", classify([run("CI", [job("test", "success"), job("release-macos", "skipped")])], { required: ["test"] }).state === "green");
	t("a missing required job is red once every run is done", classify([run("CI", [job("test", "success")])], { required: ["version"] }).failures[0].conclusion === "missing");
	t("a required job not listed yet is pending while its run is in flight", classify([run("CI", [], "in_progress", null)], { required: ["test"] }).state === "pending");
	t("a matrix or called-workflow job matches its base name", classify([run("CI", [job("test (ubuntu-latest)", "success"), job("ci / release", "success")])], { required: ["test", "release"] }).state === "green");
	t("in progress is pending", classify([run("CI", [job("test", "in_progress", [], "in_progress")], "in_progress", null)]).state === "pending");
	t("a failure beats pending", classify([run("CI", [job("a", "failure"), job("b", null, [], "in_progress")], "in_progress", null)]).state === "red");
	t("--workflow ignores other workflows' failures", classify([run("Docs", [job("lint", "failure")], "completed", "failure"), run("CI", [job("test", "success")])], { workflow: "CI" }).state === "green");
	t("a run-level failure with no failed job is still red", classify([run("CI", [], "completed", "failure")]).state === "red");
	const calls = [];
	const fake = (_c, args) => { calls.push(args.join(" ")); return args[1] === "list" ? JSON.stringify([{ databaseId: 7, workflowName: "CI", status: "completed", conclusion: "success", url: "u" }]) : JSON.stringify({ jobs: [job("test", "success")] }); };
	const runs = fetchRuns({ repo: "a/b", sha: "abc", branch: "main" }, fake);
	t("fetchRuns reads the run list then each run's jobs", runs.length === 1 && runs[0].jobs[0].name === "test" && /--commit abc/.test(calls[0]) && /--branch main/.test(calls[0]), calls.join(" | "));
	const cache = new Map();
	calls.length = 0;
	fetchRuns({ repo: "a/b", sha: "abc", branch: "main" }, fake, cache);
	fetchRuns({ repo: "a/b", sha: "abc", branch: "main" }, fake, cache);
	t("a completed run's jobs are fetched once across polls", calls.filter((c) => c.startsWith("run view")).length === 1, calls.join(" | "));
	const pending = (_c, args) => { calls.push(args.join(" ")); return args[1] === "list" ? JSON.stringify([{ databaseId: 8, workflowName: "CI", status: "in_progress", conclusion: "", url: "u" }]) : JSON.stringify({ jobs: [] }); };
	calls.length = 0;
	fetchRuns({ repo: "a/b", sha: "abc", branch: "main" }, pending, cache);
	fetchRuns({ repo: "a/b", sha: "abc", branch: "main" }, pending, cache);
	t("an in-progress run is re-read every poll", calls.filter((c) => c.startsWith("run view")).length === 2, calls.join(" | "));
	return done();
}

async function main() {
	const a = parseArgs(process.argv.slice(2));
	if (a["self-test"]) process.exit(await selfTest());
	try {
		let { repo, sha, branch } = a;
		if (a.pr) {
			const url = String(a.pr);
			const m = url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/\d+/);
			const args = ["pr", "view", url, "--json", "mergeCommit,baseRefName,state"];
			if (m) repo = m[1];
			else if (repo) args.push("-R", repo);
			const pr = JSON.parse(gh(args));
			if (pr.state !== "MERGED" || !pr.mergeCommit?.oid) throw new Error("the PR is not merged yet");
			sha = pr.mergeCommit.oid;
			branch = pr.baseRefName;
		}
		if (!repo || !sha || !branch) throw new Error("pass --pr <url>, or --repo, --sha and --branch");
		const cfg = await loadConfig(a["repo-dir"] ?? process.cwd());
		const workflow = a.workflow ?? cfg.workflow ?? "";
		const required = (typeof a.required === "string" ? a.required.split(",") : cfg.required_jobs ?? []).map((s) => String(s).trim()).filter(Boolean);
		const wait = Number(a.wait ?? cfg.timeout_minutes ?? 20);
		const deadline = Date.now() + wait * 60_000;
		let result;
		const cache = new Map();
		for (;;) {
			result = classify(fetchRuns({ repo, sha, branch }, execFileSync, cache), { required, workflow });
			// `none` right after a merge is GitHub not having registered the run yet, so it waits too.
			if ((result.state !== "pending" && result.state !== "none") || Date.now() >= deadline) break;
			await sleep(30_000);
		}
		console.log(JSON.stringify({ repo, sha, branch, workflow: workflow || null, required, ...result }, null, 2));
		console.log(`PIPELINE: ${result.state} — ${result.reason}`);
		process.exit(result.state === "green" ? 0 : result.state === "pending" ? 3 : 1);
	} catch (e) {
		console.error(`pipeline.mjs: ${e.message}`);
		process.exit(2);
	}
}

if (isMain(import.meta.url)) main();
