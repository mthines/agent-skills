#!/usr/bin/env node
// state.mjs — atelier's stage machine, stored in one sticky PR comment (rules/state.md).
//
// The comment starts with `<!-- atelier:v1 -->`, shows a table a human can read, and
// carries the machine state on one hidden line `<!-- atelier:v1:state {json} -->`.
//
//   node state.mjs --next   --head <sha> [--body-file <f>]   prints the stage to run: build|ready|merge|stop
//   node state.mjs --record --stage <s> --decision <d> --head <sha> [--reason <r>] [--pr <n>] [--body-file <f>]
//                  [--ci-file <f>] [--preflight <line>]    prints the re-rendered comment body; Ready `proceed`
//                                                          needs --ci-file: prepare's ci-ran.mjs output, green at --head;
//                                                          --preflight stores preflight.mjs's `PREFLIGHT:` line once;
//                  [--memory "lorekit=ok,lessons_used=2,bus_failed=0"]   memory counts for the run's trace
// --next, --companions, and --record also mark the run's telemetry (telemetry.mjs): the stage that opens,
// the companions check, and the decision; a decision that ends the run exports it. Telemetry writes go
// to the ledger and stderr only, never to stdout, and never change the exit code.
// A --pr on --next or --companions (a URL, or a number resolved against the run's repo) sets the run's PR facts.
//   node state.mjs --companions --aw-file <f> [--ui-diff yes|no|true|false] [--accept-skip a,b]
//                                                          prints `COMPANIONS: proceed|hold — <reason>` for aw's hand-back
//   node state.mjs --parse  [--body-file <f>]               prints the state JSON, or null
//   node state.mjs --fetch  --pr <url|n>                    prints the existing comment body via gh (empty when none)
//   node state.mjs --upsert --pr <url|n> --body-file <f>    edits the sticky comment in place, or creates it (gh)
// --fetch/--upsert take owner/repo from a PR URL; with a bare number they use cwd's `origin`,
// so run them from the target repo's checkout or pass the URL.
//   node state.mjs --self-test
// --body-file defaults to stdin; an empty body or a missing file means no state yet.
// Exit: 0 ok, 2 error.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import { companionDecision, isMain, makeTester, parseArgs, parseDegraded, requiredCompanions } from "./lib.mjs";
import { markCompanions, markDecision, markNext, parseMemory } from "./telemetry.mjs";

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

// Is a Ready `proceed` backed by CI that ran green on `head`? The evidence is ci-ran.mjs's JSON
// (prepare/scripts), stored on the entry; a proceed recorded without it (a legacy comment, a hand edit) is not.
// Two shas name the same commit when one is a prefix of the other (a 7-char short sha against a full one).
export const sameSha = (a, b) => !!a && !!b && (a === b || (Math.min(a.length, b.length) >= 7 && (a.startsWith(b) || b.startsWith(a))));

export function readyEvidenceOk(entry, head) {
	const ci = entry?.ci;
	if (!ci || ci.state !== "green" || ci.ran !== true || !ci.head) return false;
	return sameSha(ci.head, entry.sha) && (!head || sameSha(ci.head, head));
}

// The first stage that has not completed. Ready counts as done only with green CI evidence on the current head.
export function next(state, head) {
	if (!state) return "build";
	const st = state.stages;
	if (st.merge && DONE.has(st.merge.decision)) return "stop";
	for (const stage of STAGES) {
		const e = st[stage];
		if (!e || !DONE.has(e.decision)) return stage;
		if (stage === "ready" && head && e.sha && !sameSha(e.sha, head)) return "ready";
		if (stage === "ready" && !readyEvidenceOk(e, head)) return "ready";
	}
	return "stop";
}

export function record(state, { stage, decision, head, reason = "", pr = null, ci = null, preflight = null, at = new Date().toISOString() }) {
	if (!STAGES.includes(stage)) throw new Error(`unknown stage ${stage} (want ${STAGES.join("|")})`);
	if (!DECISIONS.includes(decision)) throw new Error(`unknown decision ${decision} (want ${DECISIONS.join("|")})`);
	const s = state ? structuredClone(state) : { v: 1, pr: null, stages: {} };
	if (pr) s.pr = pr;
	if (preflight) s.preflight = preflight;
	const entry = { decision, at, sha: head || null, reason };
	if (ci) entry.ci = { state: ci.state, ran: ci.ran, head: ci.head, basis: ci.basis, ran_checks: (ci.ran_checks || []).slice(0, 5), reason: ci.reason };
	// Skipped CI proves nothing: Ready `proceed` is written only with ci-ran.mjs evidence that is green on this head.
	if (stage === "ready" && decision === "proceed" && !readyEvidenceOk(entry, head)) {
		const got = ci ? `CI: ${ci.state} at ${String(ci.head || "?").slice(0, 7)} — ${ci.reason}` : "no --ci-file";
		throw new Error(`Ready proceed needs green CI evidence at ${String(head || "?").slice(0, 7)} (prepare's ci-ran.mjs --pr <url> > ci.json; --ci-file ci.json); got ${got}`);
	}
	s.stages[stage] = entry;
	s.stage = stage;
	s.refusal = decision === "refuse" ? reason : null;
	return s;
}

const HEADER_VERB = { refuse: "refused", hold: "held", failed: "failed" };

// ` · refused|held|failed: <reason>` for the last recorded stage, so a human sees why the run stopped.
function header(state) {
	const e = state.stages?.[state.stage];
	const verb = e && HEADER_VERB[e.decision];
	if (!verb) return "";
	const reason = (e.reason || state.refusal || "").replace(/\n/g, " ");
	return reason ? ` · ${verb}: ${reason}` : ` · ${verb}`;
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
		`Stage reached: **${state.stage ?? "none"}**${header(state)}`,
		"",
		...(state.preflight ? [`Preflight: \`${state.preflight.replace(/`/g, "'").replace(/\n/g, " ")}\``, ""] : []),
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

// owner/repo of a remote URL: the last two path segments, split on both `/` and `:`.
export function slugFromRemote(url) {
	return url.trim().replace(/\.git$/, "").split(/[/:]/).slice(-2).join("/");
}

// A PR URL names its repo; only a bare number falls back to cwd's origin, which may be another checkout.
export function repoSlug(pr, originUrl = () => execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" })) {
	const m = String(pr ?? "").match(/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/\d+/);
	return m ? `${m[1]}/${m[2]}` : slugFromRemote(originUrl());
}

export function prNumber(pr) {
	const m = String(pr).match(/\/pull\/(\d+)/) || String(pr).match(/(\d+)\s*$/);
	if (!m) throw new Error(`cannot read a PR number from ${pr}`);
	return m[1];
}

// Only this user's comment: another author's marked comment must not steer --next, and could not be edited anyway.
function findComment(pr) {
	// GraphQL `viewer`, not REST `/user`: `/user` is 401 under a GitHub App token (github-access.md).
	const me = execFileSync("gh", ["api", "graphql", "-f", "query={viewer{login}}", "--jq", ".data.viewer.login"], { encoding: "utf8" }).trim();
	const out = execFileSync(
		"gh",
		[
			"api",
			`repos/${repoSlug(pr)}/issues/${prNumber(pr)}/comments`,
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
	const path = c ? `repos/${repoSlug(pr)}/issues/comments/${c.id}` : `repos/${repoSlug(pr)}/issues/${prNumber(pr)}/comments`;
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
	const green = (head) => ({ state: "green", ran: true, head, basis: "actions", ran_checks: ["test"], reason: "1 GitHub Actions check run ran and passed" });
	let threwNoCi = "";
	try {
		record(s, { stage: "ready", decision: "proceed", head: "a1" });
	} catch (e) {
		threwNoCi = e.message;
	}
	t("Ready proceed without CI evidence is refused", /needs green CI evidence/.test(threwNoCi), threwNoCi);
	let threwSkipped = "";
	try {
		record(s, { stage: "ready", decision: "proceed", head: "a1", ci: { state: "not-run", ran: false, head: "a1", reason: "every required check skipped (4)" } });
	} catch (e) {
		threwSkipped = e.message;
	}
	t("Ready proceed on skipped CI is refused", /CI: not-run/.test(threwSkipped), threwSkipped);
	let threwOther = false;
	try {
		record(s, { stage: "ready", decision: "proceed", head: "a1", ci: green("z9") });
	} catch {
		threwOther = true;
	}
	t("Ready proceed with evidence from another head is refused", threwOther);
	s = record(s, { stage: "ready", decision: "proceed", head: "a1", ci: green("a1") });
	t("after ready on the same head, merge is next", next(s, "a1") === "merge");
	t("the CI evidence round-trips through the comment", parse(render(s)).stages.ready.ci.state === "green" && next(parse(render(s)), "a1") === "merge");
	t("a moved head re-runs ready", next(s, "b2") === "ready");
	const full = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
	const short = record(s, { stage: "ready", decision: "proceed", head: full.slice(0, 7), ci: green(full) });
	t("a short --head with full-sha evidence records, and --next matches either form", next(short, full) === "merge" && next(short, full.slice(0, 7)) === "merge");
	const legacy = structuredClone(s);
	delete legacy.stages.ready.ci;
	t("a legacy Ready proceed without evidence re-runs ready", next(legacy, "a1") === "ready");
	const forged = structuredClone(s);
	forged.stages.ready.ci = { state: "not-run", ran: false, head: "a1" };
	t("a Ready proceed whose evidence is not green re-runs ready", next(forged, "a1") === "ready");
	const tampered = structuredClone(s);
	tampered.stages.ready.ci.head = "b2";
	t("evidence from a head other than the entry's re-runs ready", next(tampered, "b2") === "ready");
	t("a hold names its reason in the header", render(record(s, { stage: "ready", decision: "hold", head: "a1", reason: "CI not run: draft" })).includes("Stage reached: **ready** · held: CI not run: draft"));
	t("a failure names its reason in the header", render(record(s, { stage: "ready", decision: "failed", head: "a1", reason: "CI red" })).includes("· failed: CI red"));
	t("a proceed shows no reason in the header", /Stage reached: \*\*ready\*\*\n/.test(render(s)));
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
	const origin = () => "git@github.com:other/checkout.git";
	t("a PR URL's owner/repo wins over cwd origin", repoSlug("https://github.com/acme/web/pull/41", origin) === "acme/web");
	t("a PR URL with a trailing path still names its repo", repoSlug("https://github.com/acme/web/pull/41/files", origin) === "acme/web" && prNumber("https://github.com/acme/web/pull/41/files") === "41");
	t("a bare number falls back to cwd origin", repoSlug("41", origin) === "other/checkout" && repoSlug("#41", origin) === "other/checkout");
	t("an https origin parses too", repoSlug(41, () => "https://github.com/a/b.git\n") === "a/b");
	const p = record(null, { stage: "build", decision: "proceed", head: "a1", preflight: "PREFLIGHT: limited — 1 gap (flag-provider)" });
	t("a preflight line renders under the header and survives later records", render(record(p, { stage: "ready", decision: "hold", head: "a1", reason: "x" })).includes("Preflight: `PREFLIGHT: limited — 1 gap (flag-provider)`"));
	t("a state without preflight renders no preflight line", !render(s).includes("Preflight:"));
	// Companions: what aw's `Degraded:` line says did not run.
	const block = (deg, tier = "Full") => `AW RUN COMPLETE\n- Tier: ${tier}\n- Delivered: https://github.com/a/b/pull/1\n- Degraded: ${deg}\n- Needs you: nothing`;
	t("✗ Degraded: none → proceed", companionDecision(block("none")).decision === "proceed");
	const held = companionDecision(block("review-loop skipped (context budget)"));
	t("✓ Degraded: review-loop skipped → hold", held.decision === "hold" && held.reason === "skipped: review-loop", JSON.stringify(held));
	const many = parseDegraded(block("create-pr skipped (opened with gh, to save context); /fit and /ux skipped, lorekit unreachable"));
	t("several skips split on ; and commas outside parentheses", many.skipped.join() === "create-pr,quality-pass" && many.items.length === 3, JSON.stringify(many));
	t("a non-companion degradation does not hold", companionDecision(block("lorekit unreachable — lessons skipped")).decision === "proceed");
	t("the one-line Micro form parses", companionDecision("AW RUN COMPLETE — Micro, PR https://x/pull/2, Degraded: none, Needs you: nothing").decision === "proceed");
	t("Micro requires no quality pass", companionDecision("AW RUN COMPLETE — Micro, PR https://x/pull/2, Degraded: fit skipped, Needs you: nothing").decision === "proceed");
	t("aw-verify is required only on a UI diff", companionDecision(block("aw-verify skipped (no browser)")).decision === "proceed" && companionDecision(block("aw-verify skipped (no browser)"), { uiDiff: true }).decision === "hold");
	t("required companions by tier", requiredCompanions({ tier: "Micro", uiDiff: true }).join() === "review-loop,create-pr" && requiredCompanions({ tier: "Lite", uiDiff: true }).join() === "review-loop,create-pr,quality-pass,aw-verify");
	const acc = companionDecision(block("review-loop skipped (context budget)"), { accept: ["review-loop"] });
	t("--accept-skip from the user proceeds and says so", acc.decision === "proceed" && acc.reason === "accepted skip: review-loop (user)");
	t("no Degraded: line holds", companionDecision("AW RUN COMPLETE\n- Tier: Full").decision === "hold");
	const list = "AW RUN COMPLETE\n- Tier: Full\n- Degraded:\n  - lorekit unreachable\n  - review-loop skipped\n- Needs you: nothing";
	t("a bulleted Degraded: list is read to its end", companionDecision(list).reason === "skipped: review-loop", JSON.stringify(companionDecision(list)));
	t("an empty Degraded: does not swallow Needs you:", parseDegraded("AW RUN COMPLETE\n- Tier: Full\n- Degraded:\n- Needs you: review-loop it").skipped.length === 0);
	t("docs review / ux skipped are not companion skips", companionDecision(block("docs review skipped (no drift), ux skipped (not a UI diff)"), { uiDiff: false }).decision === "proceed");
	return done();
}

async function main() {
	const a = parseArgs(process.argv.slice(2));
	if (a["self-test"]) process.exit(selfTest());
	try {
		if (a.fetch) {
			const c = findComment(a.pr);
			process.stdout.write(c ? c.body : "");
		} else if (a.upsert) upsert(a.pr, a["body-file"]);
		else if (a.parse) console.log(JSON.stringify(parse(readBody(a)), null, 2));
		else if (a.next) {
			const state = parse(readBody(a));
			const stage = next(state, a.head);
			console.log(stage);
			if (state) await markNext({ stage, state, pr: typeof a.pr === "string" ? a.pr : null });
		}
		else if (a.companions) {
			const accept = typeof a["accept-skip"] === "string" ? a["accept-skip"].split(",").map((x) => x.trim()) : [];
			const d = companionDecision(readFileSync(a["aw-file"], "utf8"), { uiDiff: [true, "yes", "true"].includes(a["ui-diff"]), accept });
			console.log(`COMPANIONS: ${d.decision}${d.reason ? ` — ${d.reason}` : ""}`);
			const aw = parseDegraded(readFileSync(a["aw-file"], "utf8"));
			await markCompanions({ decision: d.decision, tier: aw.tier, skipped: d.missing, accepted: d.accepted, pr: typeof a.pr === "string" ? a.pr : null });
		}
		else if (a.record) {
			const ci = typeof a["ci-file"] === "string" ? JSON.parse(readFileSync(a["ci-file"], "utf8").replace(/\n?CI: .*\s*$/, "")) : null;
			const s = record(parse(readBody(a)), { stage: a.stage, decision: a.decision, head: a.head, reason: a.reason === true ? "" : a.reason || "", pr: a.pr, ci, preflight: typeof a.preflight === "string" ? a.preflight : null });
			process.stdout.write(`${render(s)}\n`);
			await markDecision({
				stage: a.stage, decision: a.decision, reason: a.reason === true ? "" : a.reason || "", head: a.head || null,
				pr: typeof a.pr === "string" ? a.pr : s.pr, memory: typeof a.memory === "string" ? parseMemory(a.memory) : null,
			});
		} else throw new Error("pass one of --next, --record, --companions, --parse, --fetch, --upsert, --self-test");
	} catch (e) {
		console.error(`state: ${e.message}`);
		process.exit(2);
	}
}

if (isMain(import.meta.url)) await main();
