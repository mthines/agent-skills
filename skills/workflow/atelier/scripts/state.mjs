#!/usr/bin/env node
// state.mjs — atelier's stage machine, stored in one sticky PR comment (rules/state.md).
//
// The comment starts with `<!-- atelier:v1 -->`, shows a table a human can read, and
// carries the machine state on one hidden line `<!-- atelier:v1:state {json} -->`.
//
//   node state.mjs --next   --head <sha> [--body-file <f>]   prints the stage to run: build|ready|merge|stop
//   node state.mjs --record --stage <s> --decision <d> --head <sha> [--reason <r>] [--pr <n>] [--body-file <f>]
//                                                          prints the re-rendered comment body
//   node state.mjs --parse  [--body-file <f>]               prints the state JSON, or null
//   node state.mjs --fetch  --pr <n>                        prints the existing comment body via gh (empty when none)
//   node state.mjs --upsert --pr <n> --body-file <f>        edits the sticky comment in place, or creates it (gh)
//   node state.mjs --self-test
// --body-file defaults to stdin; an empty body or a missing file means no state yet.
// Exit: 0 ok, 2 error.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import { isMain, makeTester, parseArgs } from "./lib.mjs";

export const MARKER = "<!-- atelier:v1 -->";
const STATE_RE = /<!-- atelier:v1:state (\{.*?\}) -->/s;
export const STAGES = ["build", "ready", "merge"];
export const DECISIONS = ["proceed", "skipped", "refuse", "hold", "failed"];
const DONE = new Set(["proceed", "skipped"]);

export function parse(body) {
	if (!body || !body.startsWith(MARKER)) return null;
	const m = body.match(STATE_RE);
	if (!m) return null;
	try {
		const s = JSON.parse(m[1]);
		return s?.v === 1 && s.stages ? s : null;
	} catch {
		return null;
	}
}

// The first stage that has not completed; a Ready completed on an older head runs again.
export function next(state, head) {
	if (!state) return "build";
	const st = state.stages;
	if (st.merge && DONE.has(st.merge.decision)) return "stop";
	for (const stage of STAGES) {
		const e = st[stage];
		if (!e || !DONE.has(e.decision)) return stage;
		if (stage === "ready" && head && e.sha && e.sha !== head) return "ready";
	}
	return "stop";
}

export function record(state, { stage, decision, head, reason = "", pr = null, at = new Date().toISOString() }) {
	if (!STAGES.includes(stage)) throw new Error(`unknown stage ${stage} (want ${STAGES.join("|")})`);
	if (!DECISIONS.includes(decision)) throw new Error(`unknown decision ${decision} (want ${DECISIONS.join("|")})`);
	const s = state ? structuredClone(state) : { v: 1, pr: null, stages: {} };
	if (pr) s.pr = pr;
	s.stages[stage] = { decision, at, sha: head || null, reason };
	s.stage = stage;
	s.refusal = decision === "refuse" ? reason : null;
	return s;
}

export function render(state) {
	const rows = STAGES.map((stage) => {
		const e = state.stages[stage];
		if (!e) return `| ${stage} | — | — | — | |`;
		return `| ${stage} | ${e.decision} | ${e.sha ? `\`${e.sha.slice(0, 7)}\`` : "—"} | ${e.at} | ${(e.reason || "").replace(/\|/g, "\\|").replace(/\n/g, " ")} |`;
	});
	const lines = [
		MARKER,
		"### 🧑‍🎨 Atelier",
		"",
		`Stage reached: **${state.stage ?? "none"}**${state.refusal ? ` · refused: ${state.refusal}` : ""}`,
		"",
		"| Stage | Decision | Head | At | Reason |",
		"| --- | --- | --- | --- | --- |",
		...rows,
		"",
		"Re-run `/atelier <this PR>` to resume at the first incomplete stage.",
		"",
		// `>` is escaped so no reason can close the HTML comment early; JSON.parse restores it.
		`<!-- atelier:v1:state ${JSON.stringify(state).replace(/>/g, "\\u003e")} -->`,
	];
	return lines.join("\n");
}

function readBody(a) {
	// A missing file is no state yet: a run from a request has no comment to read.
	if (a["body-file"]) return existsSync(a["body-file"]) ? readFileSync(a["body-file"], "utf8") : "";
	if (process.stdin.isTTY) return "";
	try {
		return readFileSync(0, "utf8");
	} catch {
		return "";
	}
}

function repoSlug() {
	return execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" })
		.trim()
		.replace(/\.git$/, "")
		.split(/[/:]/)
		.slice(-2)
		.join("/");
}

function prNumber(pr) {
	const m = String(pr).match(/(\d+)\s*$/);
	if (!m) throw new Error(`cannot read a PR number from ${pr}`);
	return m[1];
}

// Only this user's comment: another author's marked comment must not steer --next, and could not be edited anyway.
function findComment(pr) {
	const me = execFileSync("gh", ["api", "user", "--jq", ".login"], { encoding: "utf8" }).trim();
	const out = execFileSync(
		"gh",
		[
			"api",
			`repos/${repoSlug()}/issues/${prNumber(pr)}/comments`,
			"--paginate",
			"--jq",
			`.[] | select(.user.login == "${me}" and (.body | startswith("${MARKER}"))) | {id, body}`,
		],
		{ encoding: "utf8" },
	);
	const first = out.split("\n").find((l) => l.trim());
	return first ? JSON.parse(first) : null;
}

function upsert(pr, bodyFile) {
	const c = findComment(pr);
	const path = c ? `repos/${repoSlug()}/issues/comments/${c.id}` : `repos/${repoSlug()}/issues/${prNumber(pr)}/comments`;
	execFileSync("gh", ["api", "-X", c ? "PATCH" : "POST", path, "-F", `body=@${bodyFile}`], { stdio: ["ignore", "ignore", "inherit"] });
	console.log(c ? `updated comment ${c.id}` : "created comment");
}

function selfTest() {
	const { t, done } = makeTester("state");
	t("no state starts at build", next(null, "a1") === "build");
	t("a body without the marker has no state", parse("hello") === null);
	t("a marker with a bad version has no state", parse(`${MARKER}\n<!-- atelier:v1:state {"v":2,"stages":{}} -->`) === null);
	let s = record(null, { stage: "build", decision: "proceed", head: "a1", pr: "https://x/pull/7", at: "2026-01-01T00:00:00Z" });
	let body = render(s);
	t("render starts with the marker", body.startsWith(MARKER));
	t("render → parse round-trips", JSON.stringify(parse(body)) === JSON.stringify(s));
	t("after build, ready is next", next(parse(body), "a1") === "ready");
	s = record(s, { stage: "build", decision: "skipped", head: "a1", reason: "existing PR" });
	t("a skipped build counts as done", next(s, "a1") === "ready");
	s = record(s, { stage: "ready", decision: "failed", head: "a1", reason: "CI red" });
	t("a failed ready runs ready again", next(s, "a1") === "ready");
	s = record(s, { stage: "ready", decision: "proceed", head: "a1" });
	t("after ready on the same head, merge is next", next(s, "a1") === "merge");
	t("a moved head re-runs ready", next(s, "b2") === "ready");
	s = record(s, { stage: "merge", decision: "refuse", head: "a1", reason: "user-visible diff | no flag" });
	t("a refused merge resumes at merge", next(s, "a1") === "merge");
	t("a refusal is surfaced", s.refusal === "user-visible diff | no flag");
	body = render(s);
	t("a pipe in a reason is escaped in the table", body.includes("user-visible diff \\| no flag"));
	t("a refused merge round-trips", parse(body).stages.merge.decision === "refuse");
	s = record(s, { stage: "merge", decision: "proceed", head: "a1", reason: "merged abc" });
	t("a merged PR stops", next(s, "c3") === "stop" && s.refusal === null);
	let threw = false;
	try {
		record(s, { stage: "deploy", decision: "proceed" });
	} catch {
		threw = true;
	}
	t("an unknown stage is rejected", threw);
	t("a reason holding '-->' cannot end the state line early", parse(render(record(null, { stage: "build", decision: "failed", reason: "a} --> b" }))).stages.build.reason === "a} --> b");
	return done();
}

function main() {
	const a = parseArgs(process.argv.slice(2));
	if (a["self-test"]) process.exit(selfTest());
	try {
		if (a.fetch) {
			const c = findComment(a.pr);
			process.stdout.write(c ? c.body : "");
		} else if (a.upsert) upsert(a.pr, a["body-file"]);
		else if (a.parse) console.log(JSON.stringify(parse(readBody(a)), null, 2));
		else if (a.next) console.log(next(parse(readBody(a)), a.head));
		else if (a.record) {
			const s = record(parse(readBody(a)), { stage: a.stage, decision: a.decision, head: a.head, reason: a.reason === true ? "" : a.reason || "", pr: a.pr });
			process.stdout.write(`${render(s)}\n`);
		} else throw new Error("pass one of --next, --record, --parse, --fetch, --upsert, --self-test");
	} catch (e) {
		console.error(`state: ${e.message}`);
		process.exit(2);
	}
}

if (isMain(import.meta.url)) main();
