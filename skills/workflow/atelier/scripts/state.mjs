#!/usr/bin/env node
// state.mjs — atelier's stage machine, stored in one sticky PR comment (rules/state.md).
//
// The comment starts with `<!-- atelier:v1 -->`, shows the status card (card.mjs) and a readable summary,
// and carries the machine state on one hidden line `<!-- atelier:v1:state {json} -->`.
//
//   node state.mjs --next   --head <sha> [--body-file <f>]   prints the stage to run: build|ready|merge|stop
//   node state.mjs --record --stage <s> --decision <d> --head <sha> [--reason <r>] [--pr <n>] [--body-file <f>]
//                  --stage deliver records Deliver's result for the comment only; --next never reads it
//                  [--ci-file <f>] [--preflight <line>]    prints the re-rendered comment body; Ready `proceed`
//                                                          needs --ci-file: prepare's ci-ran.mjs output, green at --head;
//                                                          --preflight stores preflight.mjs's `PREFLIGHT:` line once;
//                  [--memory "lorekit=ok,lessons_used=2,bus_failed=0"]   memory counts for the run's trace
// --next, --companions, and --record also mark the run's telemetry (telemetry.mjs): the stage that opens,
// the companions check, and the decision; a decision that ends the run exports it. Telemetry writes go
// to the ledger and stderr only, never to stdout, and never change the exit code.
// A --pr on --next or --companions (a URL, or a number resolved against the run's repo) sets the run's PR facts.
//   node state.mjs --companions --aw-file <f> [--accept-skip a,b]
//                                                          prints `COMPANIONS: proceed|hold — <reason>` for aw's hand-back
//   node state.mjs --checkpoint --pr <url> --step <companions|sentinel|early-gate> --head <sha> [--aw-file <f>] [--result "<line>"]
//                                                          marks one after-Build checklist step done (companions stores aw's hand-back)
//   node state.mjs --resume-step --pr <url> --head <sha> [--aw-out <f>]
//                                                          prints `RESUME: none|companions|sentinel|early-gate|record`, the first
//                                                          step not done (sentinel and early-gate count only on --head); --aw-out
//                                                          writes the stored hand-back. Checkpoints live beside the telemetry ledger.
//   --record … --no-ci                                     Ready `proceed` on ci-ran's "no checks reported" in a repo with no
//                                                          CI workflow (preflight.mjs repoHasCi on cwd or --repo-dir); refused otherwise
//   node state.mjs --parse  [--body-file <f>]               prints the state JSON, or null
//   node state.mjs --fetch  --pr <url|n>                    prints the existing comment body via gh (empty when none)
//   node state.mjs --upsert --pr <url|n> --body-file <f>    edits the sticky comment in place, or creates it (gh)
// --fetch/--upsert take owner/repo from a PR URL; with a bare number they use cwd's `origin`,
// so run them from the target repo's checkout or pass the URL.
//   node state.mjs --self-test
// --body-file defaults to stdin; an empty body or a missing file means no state yet.
// Exit: 0 ok, 2 error.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ENDINGS, STAGE_TITLE, altText, cardKey, outcomeOf, outcomes, verdict } from "./card.mjs";
import { companionDecision, isMain, makeTester, parseArgs, parseDegraded, requiredCompanions } from "./lib.mjs";
import { isNoCiEvidence } from "./merge-gate.mjs";
import { repoHasCi, repoMatchesPr } from "./preflight.mjs";
import { markCheckpoint, markCompanions, markDecision, markNext, parseMemory, resolveRunDir } from "./telemetry.mjs";

export const MARKER = "<!-- atelier:v1 -->";
const STATE_RE = /<!-- atelier:v1:state (\{.*?\}) -->/s;
export const STAGES = ["build", "ready", "merge"];
// Deliver is recorded for the comment only: the stage machine (`next`) stops at the merge.
export const RECORDABLE = [...STAGES, "deliver"];
// The pre-rendered cards (render-cards.mjs). Pinned to main so an old comment keeps resolving.
export const ASSET_BASE = "https://raw.githubusercontent.com/mthines/agent-skills/main/skills/workflow/atelier/assets";
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
	if (!ci || !ci.head) return false;
	// No CI in the repo: `--record --no-ci` stored ci-ran's "no checks reported" after checking the repo has no CI workflow.
	const green = ci.state === "green" && ci.ran === true;
	const noCi = ci.no_ci === true && isNoCiEvidence(ci);
	if (!green && !noCi) return false;
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

export function record(state, { stage, decision, head, reason = "", pr = null, ci = null, preflight = null, noCi = false, at = new Date().toISOString() }) {
	if (!RECORDABLE.includes(stage)) throw new Error(`unknown stage ${stage} (want ${RECORDABLE.join("|")})`);
	if (!DECISIONS.includes(decision)) throw new Error(`unknown decision ${decision} (want ${DECISIONS.join("|")})`);
	// Every recorded pair has a pre-rendered card (card.mjs ENDINGS); any other would link a missing image.
	if (!ENDINGS[stage].includes(outcomeOf(decision))) throw new Error(`${stage} cannot be ${decision} (want ${DECISIONS.filter((d) => ENDINGS[stage].includes(outcomeOf(d))).join("|")})`);
	if (stage === "deliver" && state?.stages?.merge?.decision !== "proceed") throw new Error("deliver needs a merge recorded proceed first");
	const s = state ? structuredClone(state) : { v: 1, pr: null, stages: {} };
	if (pr) s.pr = pr;
	if (preflight) s.preflight = preflight;
	const entry = { decision, at, sha: head || null, reason };
	if (ci) entry.ci = { state: ci.state, ran: ci.ran, head: ci.head, basis: ci.basis, ran_checks: (ci.ran_checks || []).slice(0, 5), reason: ci.reason, ...(noCi && isNoCiEvidence(ci) ? { no_ci: true } : {}) };
	// Skipped CI proves nothing: Ready `proceed` is written only with ci-ran.mjs evidence that is green on this head.
	if (stage === "ready" && decision === "proceed" && !readyEvidenceOk(entry, head)) {
		const got = ci ? `CI: ${ci.state} at ${String(ci.head || "?").slice(0, 7)} — ${ci.reason}` : "no --ci-file";
		throw new Error(`Ready proceed needs green CI evidence at ${String(head || "?").slice(0, 7)} (prepare's ci-ran.mjs --pr <url> > ci.json; --ci-file ci.json), or --no-ci with "no checks reported" in a repo with no CI workflow; got ${got}`);
	}
	s.stages[stage] = entry;
	s.stage = stage;
	s.refusal = decision === "refuse" ? reason : null;
	return s;
}

const ICON = { proceed: "✅", skipped: "⏭️", hold: "⏸️", failed: "❌", refuse: "⛔" };
const WORD = { proceed: "done", skipped: "skipped", hold: "held", failed: "failed", refuse: "refused" };
const STOPPED = new Set(["hold", "failed", "refuse"]);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const oneLine = (x) => String(x ?? "").replace(/\s*\n\s*/g, " ").trim();
const cell = (x) => oneLine(x).replace(/\|/g, "\\|");
const title = (stage) => STAGE_TITLE[stage] ?? stage[0].toUpperCase() + stage.slice(1);

// GitHub's <relative-time> shows a live "2 minutes ago"; the text inside is the fallback, built from
// UTC getters so the output is deterministic.
function when(iso) {
	const d = new Date(iso);
	if (!iso || Number.isNaN(d.getTime())) return "";
	const h = d.getUTCHours();
	const shown = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} ${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
	return `<relative-time datetime="${d.toISOString()}">${shown}</relative-time>`;
}

// Where the footer's "Atelier" points: the skill's human guide.
export const README_URL = "https://github.com/mthines/agent-skills/blob/main/skills/workflow/atelier/README.md";

// GitHub alert type per outcome: red for a stop that failed or refused, amber for a hold.
const ALERT = { failed: "CAUTION", refuse: "CAUTION", hold: "WARNING" };
const STOP_WORD = { hold: "held", failed: "failed", refuse: "refused" };
const sentence = (x) => {
	const t = oneLine(x).replace(/[.;\s]+$/, "");
	return t && `${t}.`;
};
// A recorded reason holds one clause per problem, separated by `; ` (rules/state.md § Reasons).
// A script's machine line (`APPROVAL_WAIT: …`, `PIPELINE: …`) is one result whose parts also join on `; `: keep it whole.
const problems = (reason) => {
	const r = oneLine(reason);
	return (/^[A-Z][A-Z_]+: /.test(r) ? [r] : r.split(/;\s+/)).map(sentence).filter(Boolean);
};
// The command the reader copies: the PR's own URL when the state has it, so nothing needs filling in.
const rerun = ({ pr }) => {
	const ref = String(pr ?? "");
	if (/^https:\/\//.test(ref)) return `/atelier ${ref}`;
	return `/atelier ${ref ? `#${ref.replace(/^#/, "")}` : "<this PR>"}`;
};
const command = (state) => ["```text", rerun(state), "```"];

// The block under the card, only when a human must act: one GitHub alert whose type is the stop,
// a bold line saying what to do, one problem per line, and the re-run command on its own line.
// A run that is moving on or done shows no box: the card already says so, and Run details holds the rest.
function actionBlock(state) {
	const e = state.stages[state.stage];
	if (!e || !STOPPED.has(e.decision)) return null;
	const head = `${title(state.stage)} ${STOP_WORD[e.decision]}`;
	const list = problems(e.reason || state.refusal);
	const body = list.length > 1
		? [`**${head}: fix ${list.length} things, then re-run.**`, "", ...list.map((p, i) => `${i + 1}. ${p}`), "", ...command(state)]
		: [`**${head}${list.length ? `: ${list[0].slice(0, -1)}` : ""}.**`, "", "Then re-run:", "", ...command(state)];
	return [`> [!${ALERT[e.decision]}]`, ...body.map((l) => (l ? `> ${l}` : ">"))].join("\n");
}

// One line for Run details on a run that is not stopped: what happens next, or that it is done.
function statusLine(state) {
	const e = state.stages[state.stage];
	if (e && STOPPED.has(e.decision)) return null;
	const d = state.stages.deliver;
	if (d) return d.decision === "skipped"
		? `**Done:** merged; Deliver skipped${d.reason ? ` (${cell(d.reason)})` : ""}.`
		: "**Done:** merged, and `main`'s pipeline is green for the merge commit.";
	const NEXT = {
		stop: "Deliver checks `main`'s pipeline for the merge commit.",
		ready: "Verify gets CI green, resolves review threads, and proves every criterion.",
		merge: "Merge runs the merge gate, then squash-merges.",
		build: "Build & review finishes the PR.",
	};
	return `**Next:** ${NEXT[next(state, null)] ?? NEXT.build} Atelier carries on by itself.`;
}

/** The sticky comment: a title line, the status card, the action when one is needed, a footer, and the run details. `assetBase` repoints the images (the gallery). */
export function render(state, { assetBase = ASSET_BASE } = {}) {
	const o = outcomes(state);
	const key = cardKey(o);
	const last = state.stages[state.stage];
	const latest = RECORDABLE.map((s) => state.stages[s]?.at).filter(Boolean).sort().at(-1);
	const preflight = state.preflight ? oneLine(state.preflight).replace(/^PREFLIGHT:\s*/, "").replace(/`/g, "'") : null;
	const rows = RECORDABLE.map((stage) => {
		const e = state.stages[stage];
		if (!e) return `| ⚪ | ${title(stage)} | not reached | | | |`;
		return `| ${ICON[e.decision]} | ${title(stage)} | ${WORD[e.decision]} | ${e.sha ? `\`${e.sha.slice(0, 7)}\`` : ""} | ${when(e.at)} | ${cell(e.reason)} |`;
	});
	const ci = state.stages.ready?.ci;
	const ciLine = ci && `**CI at \`${String(ci.head || "").slice(0, 7)}\`:** ${ci.state === "green" ? "🟢" : ci.no_ci ? "⚪ no CI in this repo —" : "🔴"} ${cell(ci.reason)}${ci.ran_checks?.length ? ` (${ci.ran_checks.map((c) => `\`${cell(c)}\``).join(", ")})` : ""}`;
	const v = verdict(o);
	const meta = [last?.sha && `head <code>${last.sha.slice(0, 7)}</code>`, latest && `updated ${when(latest)}`].filter(Boolean);
	const action = actionBlock(state);
	const status = statusLine(state);
	const lines = [
		MARKER,
		`<img src="${assetBase}/mascot/${v.mood}.png" width="20" height="20" alt=""> **<a href="${README_URL}">Atelier</a>** · ${v.title}`,
		"",
		`<picture><source media="(prefers-color-scheme: dark)" srcset="${assetBase}/cards/${key}-dark.png"><img src="${assetBase}/cards/${key}-light.png" width="100%" alt="${altText(o)}"></picture>`,
		"",
		...(action ? [action, ""] : []),
		...(meta.length ? [`<sub>${meta.join(" · ")}</sub>`, ""] : []),
		"<details>",
		"<summary>Run details</summary>",
		"",
		"| | Stage | Outcome | Head | When | Why |",
		"| :-: | --- | --- | --- | --- | --- |",
		...rows,
		"",
		...(status ? [status, ""] : []),
		...(ciLine ? [ciLine] : []),
		...(preflight ? [`**Preflight:** \`${preflight}\``] : []),
		...(ciLine || preflight ? [""] : []),
		`Re-run \`${rerun(state)}\` to resume at the first incomplete stage.`,
		"",
		"</details>",
		"",
		// `>` is escaped so no reason can close the HTML comment early; JSON.parse restores it.
		`<!-- atelier:v1:state ${JSON.stringify(state).replace(/>/g, "\\u003e")} -->`,
	];
	return lines.join("\n");
}

// The after-Build checklist (SKILL.md § After Build returns), checkpointed per PR so a resumed run starts at the
// first step not done. companions judges aw's hand-back, so it holds across heads; sentinel and early-gate judge a head.
export const CHECKLIST = ["companions", "sentinel", "early-gate"];
const HEAD_BOUND = new Set(["sentinel", "early-gate"]);

export function checklistPath(pr, runDir = resolveRunDir()) {
	const m = String(pr ?? "").match(/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/);
	if (!m) throw new Error(`--pr needs a PR URL for the checklist, got ${pr}`);
	return join(runDir, "checklist", `${m[1]}-${m[2]}-${m[3]}.json`);
}

export function readChecklist(path) {
	try {
		const c = JSON.parse(readFileSync(path, "utf8"));
		return c && typeof c.steps === "object" ? c : null;
	} catch {
		return null;
	}
}

export function checkpoint(list, { step, head, aw = null, result = null, at = new Date().toISOString() }) {
	if (!CHECKLIST.includes(step)) throw new Error(`unknown step ${step} (want ${CHECKLIST.join("|")})`);
	if (!head) throw new Error("--checkpoint needs --head");
	if (step === "companions" && !aw && !list?.steps?.companions?.aw) throw new Error("--step companions needs --aw-file (aw's hand-back)");
	const c = list ? structuredClone(list) : { v: 1, steps: {} };
	c.steps[step] = { head, at, ...(result ? { result } : {}), ...(step === "companions" ? { aw: aw ?? list.steps.companions.aw } : {}) };
	return c;
}

export function resumeStep(list, head) {
	if (!list || !Object.keys(list.steps).length) return "none";
	for (const step of CHECKLIST) {
		const e = list.steps[step];
		if (!e) return step;
		if (HEAD_BOUND.has(step) && head && !sameSha(e.head, head)) return step;
	}
	return "record";
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
	const heldBody = render(record(s, { stage: "ready", decision: "hold", head: "a1", reason: "CI not run: draft" }));
	t("a hold is an amber alert naming its one problem", heldBody.includes("> [!WARNING]\n> **Verify held: CI not run: draft.**") && heldBody.includes("> Then re-run:"));
	const twoBody = render(record({ ...s, pr: "https://github.com/a/b/pull/7" }, { stage: "ready", decision: "failed", head: "a1", reason: "merge gate could not run: GraphQL 403; review-loop cap-reached, last fixes unreviewed" }));
	t("a failure with two problems is a red alert with a count and one problem per line", twoBody.includes("> [!CAUTION]\n> **Verify failed: fix 2 things, then re-run.**") && twoBody.includes("> 1. merge gate could not run: GraphQL 403.\n> 2. review-loop cap-reached, last fixes unreviewed."));
	t("the re-run command is its own fenced line with the PR's URL", twoBody.includes("> ```text\n> /atelier https://github.com/a/b/pull/7\n> ```") && !twoBody.includes("<this PR>"));
	const machine = render(record(s, { stage: "ready", decision: "hold", head: "a1", reason: "CI_WAIT: pending — l1 still running; typecheck queued" }));
	t("a script's machine line stays one problem, never a fix list", machine.includes("**Verify held: CI_WAIT: pending — l1 still running; typecheck queued.**") && !machine.includes("fix 2 things"));
	t("a refusal is a red alert", render(record(s, { stage: "merge", decision: "refuse", head: "a1", reason: "no flag contract" })).includes("> [!CAUTION]\n> **Merge refused: no flag contract.**"));
	t("a hold picks the held card for both themes", heldBody.includes(`${ASSET_BASE}/cards/skipped-hold-pending-pending-dark.png`) && heldBody.includes(`${ASSET_BASE}/cards/skipped-hold-pending-pending-light.png`));
	t("the title line shows the mascot in the state's mood and names the state", heldBody.includes(`<img src="${ASSET_BASE}/mascot/held.png" width="20" height="20" alt=""> **<a href="${README_URL}">Atelier</a>** · Held at Verify`));
	t("the card spans the comment", heldBody.includes('width="100%"'));
	t("a failure names its reason under the card", render(record(s, { stage: "ready", decision: "failed", head: "a1", reason: "CI red" })).includes("**Verify failed: CI red.**"));
	t("a proceed shows no box; Run details names the next stage", !render(s).includes("> [!") && render(s).includes("**Next:** Merge runs the merge gate"));
	t("the title links Atelier to the skill's README and names the next step", render(s).includes(`**<a href="${README_URL}">Atelier</a>** · Verified, merge next`));
	t("the footer carries only the head and the time", /<sub>head <code>a1<\/code> · updated /.test(render(s)));
	t("times render as GitHub relative-time", render(s).includes('<relative-time datetime="'));
	t("the asset base can be pointed elsewhere", render(s, { assetBase: "../assets" }).includes('srcset="../assets/cards/'));
	s = record(s, { stage: "merge", decision: "refuse", head: "a1", reason: "user-visible diff | no flag" });
	t("a refused merge resumes at merge", next(s, "a1") === "merge");
	t("a refusal is surfaced", s.refusal === "user-visible diff | no flag");
	body = render(s);
	t("a pipe in a reason is escaped in the table", body.includes("user-visible diff \\| no flag"));
	t("a refused merge round-trips", parse(body).stages.merge.decision === "refuse");
	s = record(s, { stage: "merge", decision: "proceed", head: "a1", reason: "merged abc" });
	t("a merged PR stops", next(s, "c3") === "stop" && s.refusal === null);
	t("a merge with no Deliver yet says Deliver runs next", render(s).includes("**Next:** Deliver checks"));
	const delivered = record(s, { stage: "deliver", decision: "proceed", head: "m1", reason: "main green" });
	t("Deliver records for the comment and --next still stops", next(delivered, "c3") === "stop" && render(delivered).includes("/skipped-done-done-done-dark.png") && render(delivered).includes("**Done:** merged") && !render(delivered).includes("> [!"));
	t("a red Deliver asks for the human", render(record(s, { stage: "deliver", decision: "failed", head: "m1", reason: "reverted: revert PR #9" })).includes("**Deliver failed: reverted: revert PR #9.**"));
	let threw = false;
	try {
		record(s, { stage: "deploy", decision: "proceed" });
	} catch {
		threw = true;
	}
	t("an unknown stage is rejected", threw);
	const throws = (f) => { try { f(); return false; } catch { return true; } };
	t("a pair with no card is rejected", throws(() => record(null, { stage: "ready", decision: "skipped", head: "a1" })) && !throws(() => record(null, { stage: "build", decision: "refuse", head: "a1" })));
	t("Deliver before a merge is rejected", throws(() => record(record(null, { stage: "merge", decision: "refuse", head: "a1" }), { stage: "deliver", decision: "skipped", head: "a1" })));
	t("a reason holding '-->' cannot end the state line early", parse(render(record(null, { stage: "build", decision: "failed", reason: "a} --> b" }))).stages.build.reason === "a} --> b");
	const origin = () => "git@github.com:other/checkout.git";
	t("a PR URL's owner/repo wins over cwd origin", repoSlug("https://github.com/acme/web/pull/41", origin) === "acme/web");
	t("a PR URL with a trailing path still names its repo", repoSlug("https://github.com/acme/web/pull/41/files", origin) === "acme/web" && prNumber("https://github.com/acme/web/pull/41/files") === "41");
	t("a bare number falls back to cwd origin", repoSlug("41", origin) === "other/checkout" && repoSlug("#41", origin) === "other/checkout");
	t("an https origin parses too", repoSlug(41, () => "https://github.com/a/b.git\n") === "a/b");
	const p = record(null, { stage: "build", decision: "proceed", head: "a1", preflight: "PREFLIGHT: limited — 1 gap (flag-provider)" });
	const pBody = render(record(p, { stage: "ready", decision: "hold", head: "a1", reason: "x" }));
	t("a limited preflight shows only in Run details and survives later records", !pBody.split("<details>")[0].includes("preflight") && pBody.includes("**Preflight:** `limited — 1 gap (flag-provider)`"));
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
	t("aw-verify is required on a UI and a non-UI diff alike", companionDecision(block("aw-verify skipped (no browser)")).decision === "hold" && companionDecision(block("aw-verify skipped (no browser)"), { uiDiff: true }).decision === "hold");
	t("required companions by tier", requiredCompanions({ tier: "Micro", uiDiff: true }).join() === "review-loop,create-pr" && requiredCompanions({ tier: "Lite", uiDiff: true }).join() === "review-loop,create-pr,quality-pass,aw-verify" && requiredCompanions({ tier: "Lite", uiDiff: false }).join() === "review-loop,create-pr,quality-pass,aw-verify");
	const acc = companionDecision(block("review-loop skipped (context budget)"), { accept: ["review-loop"] });
	t("--accept-skip from the user proceeds and says so", acc.decision === "proceed" && acc.reason === "accepted skip: review-loop (user)");
	t("no Degraded: line holds", companionDecision("AW RUN COMPLETE\n- Tier: Full").decision === "hold");
	const list = "AW RUN COMPLETE\n- Tier: Full\n- Degraded:\n  - lorekit unreachable\n  - review-loop skipped\n- Needs you: nothing";
	t("a bulleted Degraded: list is read to its end", companionDecision(list).reason === "skipped: review-loop", JSON.stringify(companionDecision(list)));
	t("an empty Degraded: does not swallow Needs you:", parseDegraded("AW RUN COMPLETE\n- Tier: Full\n- Degraded:\n- Needs you: review-loop it").skipped.length === 0);
	// The after-Build checklist resumes at its first unfinished step.
	t("no checkpoint → none", resumeStep(null, "a1") === "none");
	let cl = checkpoint(null, { step: "companions", head: "a1", aw: block("none") });
	t("after companions → sentinel", resumeStep(cl, "a1") === "sentinel" && cl.steps.companions.aw.startsWith("AW RUN COMPLETE"));
	cl = checkpoint(checkpoint(cl, { step: "sentinel", head: "a1" }), { step: "early-gate", head: "a1", result: "MERGE_GATE: pass — x" });
	t("every step done on this head → record", resumeStep(cl, "a1") === "record");
	t("✓ a moved head re-runs the head-bound steps, never the companions check", resumeStep(cl, "b2") === "sentinel" && resumeStep(checkpoint(cl, { step: "sentinel", head: "b2" }), "b2") === "early-gate");
	t("✗ companions without the hand-back, or an unknown step, is refused", throws(() => checkpoint(null, { step: "companions", head: "a1" })) && throws(() => checkpoint(null, { step: "lunch", head: "a1" })));
	t("the checklist file is keyed by the PR URL", /checklist\/acme-web-41\.json$/.test(checklistPath("https://github.com/acme/web/pull/41", "/r")) && throws(() => checklistPath("41", "/r")));
	// No CI in the repo: ci-ran's "no checks reported", stored with no_ci, counts as Ready evidence; skipped checks never do.
	const none = { state: "not-run", ran: false, head: "a1", reason: "CI not run at a1: no checks reported" };
	const noCiState = record(record(null, { stage: "build", decision: "proceed", head: "a1" }), { stage: "ready", decision: "proceed", head: "a1", ci: none, noCi: true });
	t("✓ Ready proceed --no-ci on no checks reported records and lets merge run", noCiState.stages.ready.ci.no_ci === true && next(noCiState, "a1") === "merge" && render(noCiState).includes("⚪ no CI in this repo"));
	t("✗ Ready proceed on no checks reported without --no-ci is refused", throws(() => record(null, { stage: "ready", decision: "proceed", head: "a1", ci: none })));
	t("✗ --no-ci never turns skipped checks into evidence", throws(() => record(null, { stage: "ready", decision: "proceed", head: "a1", ci: { ...none, reason: "CI not run at a1: every required check skipped (4)" }, noCi: true })));
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
		else if (a.checkpoint) {
			const path = checklistPath(a.pr);
			const aw = typeof a["aw-file"] === "string" ? readFileSync(a["aw-file"], "utf8") : null;
			const c = checkpoint(readChecklist(path), { step: a.step, head: a.head, aw, result: typeof a.result === "string" ? a.result : null });
			mkdirSync(join(path, ".."), { recursive: true });
			writeFileSync(path, `${JSON.stringify(c, null, 2)}\n`, "utf8");
			console.log(`CHECKPOINT: ${a.step} done at ${String(a.head).slice(0, 7)}`);
			await markCheckpoint({ step: a.step, pr: a.pr });
		} else if (a["resume-step"]) {
			if (typeof a.head !== "string" || !a.head) throw new Error("--resume-step needs --head (sentinel and early-gate hold only for the head they ran on)");
			const list = readChecklist(checklistPath(a.pr));
			const step = resumeStep(list, a.head);
			if (typeof a["aw-out"] === "string" && list?.steps?.companions?.aw) writeFileSync(a["aw-out"], list.steps.companions.aw, "utf8");
			console.log(`RESUME: ${step}`);
		}
		else if (a.next) {
			const state = parse(readBody(a));
			const stage = next(state, a.head);
			console.log(stage);
			if (state) await markNext({ stage, state, pr: typeof a.pr === "string" ? a.pr : null });
		}
		else if (a.companions) {
			const accept = typeof a["accept-skip"] === "string" ? a["accept-skip"].split(",").map((x) => x.trim()) : [];
			const d = companionDecision(readFileSync(a["aw-file"], "utf8"), { accept });
			console.log(`COMPANIONS: ${d.decision}${d.reason ? ` — ${d.reason}` : ""}`);
			const aw = parseDegraded(readFileSync(a["aw-file"], "utf8"));
			await markCompanions({ decision: d.decision, tier: aw.tier, skipped: d.missing, accepted: d.accepted, pr: typeof a.pr === "string" ? a.pr : null });
		}
		else if (a.record) {
			const ci = typeof a["ci-file"] === "string" ? JSON.parse(readFileSync(a["ci-file"], "utf8").replace(/\n?CI: .*\s*$/, "")) : null;
			// --no-ci is a claim about the repo, so the script checks it rather than taking the flag's word.
			const ciDir = typeof a["repo-dir"] === "string" ? a["repo-dir"] : process.cwd();
			if (a["no-ci"] && a.pr && !repoMatchesPr(ciDir, String(a.pr))) throw new Error(`--no-ci: ${ciDir} is not a clone of the PR's repository (origin differs), so it cannot say the repo has no CI; run from the clone or pass --repo-dir`);
			if (a["no-ci"] && repoHasCi(ciDir)) throw new Error("--no-ci: this repo has a workflow that runs on pull_request or push, so no checks reported is not \"no CI\"");
			const s = record(parse(readBody(a)), { stage: a.stage, decision: a.decision, head: a.head, reason: a.reason === true ? "" : a.reason || "", pr: a.pr, ci, preflight: typeof a.preflight === "string" ? a.preflight : null, noCi: !!a["no-ci"] });
			process.stdout.write(`${render(s)}\n`);
			// Deliver is display-only in the state; its telemetry is the bus event rules/deliver.md names.
			if (STAGES.includes(a.stage)) await markDecision({
				stage: a.stage, decision: a.decision, reason: a.reason === true ? "" : a.reason || "", head: a.head || null,
				pr: typeof a.pr === "string" ? a.pr : s.pr, memory: typeof a.memory === "string" ? parseMemory(a.memory) : null,
			});
		} else throw new Error("pass one of --next, --record, --companions, --checkpoint, --resume-step, --parse, --fetch, --upsert, --self-test");
	} catch (e) {
		console.error(`state: ${e.message}`);
		process.exit(2);
	}
}

if (isMain(import.meta.url)) await main();
