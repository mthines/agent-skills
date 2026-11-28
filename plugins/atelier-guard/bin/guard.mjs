#!/usr/bin/env node
// guard.mjs — Claude Code hooks that keep an /atelier session from moving past unresolved review threads.
//
//   node guard.mjs --event UserPromptSubmit|PreToolUse|Stop   reads the hook input JSON on stdin
//   node guard.mjs --self-test
//
// Every hook is silent in a session that never started /atelier: a marker file per session_id, written when the
// prompt starts with /atelier or the Skill tool runs `atelier`, is what scopes them.
// Threads come from the prepare skill's scripts/threads.mjs (PREPARE_DIR, ~/.claude/skills/prepare, ~/.agents/skills/prepare).
// Every failure (no prepare skill, gh down, a timeout, bad input) is silent: the scripts' own gates stay the hard stop.
//
// Env: ATELIER_GUARD_DIR      marker directory (default ~/.claude/state/atelier-guard)
//      ATELIER_GUARD_THREADS_FIXTURE=open|clear|error   stub the thread lookup (tests)

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const WEEK_MS = 7 * 24 * 3600 * 1000;
export const RULE = "Atelier rule: Ready runs prepare, which applies and resolves review threads; never record Ready proceed with open threads — hold with Needs you: <thread links> for a thread only a human can answer. The merge gate refuses open threads too.";

const markerDir = () => process.env.ATELIER_GUARD_DIR || join(homedir(), ".claude", "state", "atelier-guard");
const safeId = (id) => String(id || "").replace(/[^A-Za-z0-9_.-]/g, "_");
const markerPath = (dir, id) => join(dir, `${safeId(id)}.json`);

export function readMarker(dir, id) {
	if (!id) return null;
	try {
		return JSON.parse(readFileSync(markerPath(dir, id), "utf8"));
	} catch {
		return null;
	}
}

export function writeMarker(dir, id, data) {
	mkdirSync(dir, { recursive: true });
	writeFileSync(markerPath(dir, id), JSON.stringify(data));
	for (const f of readdirSync(dir)) {
		const p = join(dir, f);
		try {
			if (f.endsWith(".json") && Date.now() - statSync(p).mtimeMs > WEEK_MS) rmSync(p, { force: true });
		} catch {}
	}
}

// The PR a text names: a pull URL, a REST `repos/o/r/pulls/n` path, or null.
export function prFrom(text) {
	const s = String(text || "");
	const url = s.match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/);
	if (url) return url[0];
	const rest = s.match(/repos\/([\w.-]+)\/([\w.-]+)\/pulls\/(\d+)/);
	return rest ? `https://github.com/${rest[1]}/${rest[2]}/pull/${rest[3]}` : null;
}

// What a Bash command does that the guard cares about: "merge", "ready-proceed", or null.
// A Merge proceed record is written after the merge, so it is never classified.
export function classify(command) {
	const c = String(command || "");
	if (/\bgh\s+pr\s+merge\b/.test(c)) return "merge";
	if (/\bgh\s+api\b/.test(c) && /\/pulls\/\d+\/merge\b/.test(c) && /(-X|--method)[\s=]*PUT\b/i.test(c)) return "merge";
	if (/state\.mjs\b/.test(c) && /--record\b/.test(c) && /--stage[\s=]+["']?ready\b/.test(c) && /--decision[\s=]+["']?proceed\b/.test(c)) return "ready-proceed";
	return null;
}

const isAtelierPrompt = (p) => /^\s*\/atelier(?::atelier)?(\s|$)/.test(String(p || "")) && !/^\s*\/atelier\s+setup\s*$/.test(String(p || ""));
const isAtelierSkill = (k) => /^(?:[\w-]+:)?atelier$/.test(String(k || ""));

function prepareScript(file) {
	const dirs = [process.env.PREPARE_DIR, join(homedir(), ".claude", "skills", "prepare"), join(homedir(), ".agents", "skills", "prepare")].filter(Boolean);
	const hit = dirs.map((d) => join(d, "scripts", file)).find((p) => existsSync(p));
	return hit ? pathToFileURL(hit).href : null;
}

const FIXTURES = {
	open: { state: "open", head: "abc1234def5678", count: 1, reason: "1 unresolved at abc1234: cursor[bot] card.tsx:45" },
	clear: { state: "clear", head: "abc1234def5678", count: 0, reason: "every review thread resolved at abc1234 (1)" },
};

// threads.mjs's verdict for the PR, or null when it cannot be read (fail open).
export async function lookupThreads(pr) {
	const fx = process.env.ATELIER_GUARD_THREADS_FIXTURE;
	if (fx) return FIXTURES[fx] ?? null;
	if (!pr) return null;
	try {
		const href = prepareScript("threads.mjs");
		if (!href) return null;
		const { threadStatus } = await import(href);
		return threadStatus(pr);
	} catch {
		return null;
	}
}

async function lookupCi(pr) {
	if (process.env.ATELIER_GUARD_THREADS_FIXTURE || !pr) return null;
	try {
		const href = prepareScript("ci-ran.mjs");
		if (!href) return null;
		const { ciStatus } = await import(href);
		return ciStatus(pr);
	} catch {
		return null;
	}
}

const threadsLine = (th) => `THREADS: ${th.state} — ${th.reason}`;

function startSession(dir, id, pr) {
	const prev = readMarker(dir, id) ?? {};
	const marker = { ...prev, pr: pr ?? prev.pr ?? null, startedAt: prev.startedAt ?? new Date().toISOString(), proceeded: !!prev.proceeded, stopBlocked: false };
	writeMarker(dir, id, marker);
	return marker;
}

// One hook event → the JSON to print, or null for silence.
export async function handle(event, input, { dir = markerDir(), threads = lookupThreads, ci = lookupCi } = {}) {
	const id = input?.session_id;
	if (!id) return null;
	if (event === "UserPromptSubmit") {
		if (!isAtelierPrompt(input.prompt)) return null;
		const marker = startSession(dir, id, prFrom(input.prompt));
		const lines = [RULE];
		if (marker.pr) {
			const [th, c] = await Promise.all([threads(marker.pr), ci(marker.pr)]);
			lines.unshift(`Review state of ${marker.pr} at session start:`, th ? threadsLine(th) : "THREADS: unknown — could not read the review threads", c ? `CI: ${c.state} — ${c.reason}` : "CI: unknown");
		}
		return { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: lines.join("\n") } };
	}
	if (event === "PreToolUse") {
		if (input.tool_name === "Skill") {
			if (isAtelierSkill(input.tool_input?.skill)) startSession(dir, id, prFrom(input.tool_input?.args));
			return null;
		}
		if (input.tool_name !== "Bash") return null;
		const marker = readMarker(dir, id);
		if (!marker) return null;
		const command = input.tool_input?.command;
		const kind = classify(command);
		if (!kind) return null;
		const pr = prFrom(command) ?? marker.pr;
		const th = await threads(pr);
		if (th && th.state === "open") {
			const what = kind === "merge" ? "Merging" : "Recording Ready proceed";
			return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: `${what} is blocked: ${threadsLine(th)}. Record Ready failed and rerun Ready (prepare → implement-suggestion --resolve-all), or record Ready hold with Needs you: <thread links> for a thread only a human can answer.` } };
		}
		writeMarker(dir, id, { ...marker, pr: pr ?? marker.pr, proceeded: true });
		return null;
	}
	if (event === "Stop") {
		if (input.stop_hook_active) return null;
		const marker = readMarker(dir, id);
		if (!marker?.proceeded || marker.stopBlocked) return null;
		const th = await threads(marker.pr);
		if (!th || th.state !== "open") return null;
		writeMarker(dir, id, { ...marker, stopBlocked: true });
		return { decision: "block", reason: `This /atelier session recorded Ready proceed or merged, but ${marker.pr ?? "the PR"} has unresolved review threads now: ${threadsLine(th)}. Record Ready failed and rerun Ready (prepare resolves them), or say under Needs you: which threads need a human.` };
	}
	return null;
}

async function selfTest() {
	let pass = 0;
	let fail = 0;
	const t = (name, ok, detail = "") => {
		if (ok) pass++;
		else {
			fail++;
			console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
		}
	};
	const dir = join(tmpdir(), `atelier-guard-${process.pid}-${Date.now()}`);
	const U = "https://github.com/acme/web/pull/41";
	let state = FIXTURES.open;
	const opts = { dir, threads: async () => state, ci: async () => ({ state: "green", reason: "1 check ran" }) };
	const bash = (s, command) => handle("PreToolUse", { session_id: s, tool_name: "Bash", tool_input: { command } }, opts);
	const denied = (r) => r?.hookSpecificOutput?.permissionDecision === "deny";

	t("classify: gh pr merge", classify(`gh pr merge ${U} --squash`) === "merge");
	t("classify: the REST merge route", classify("gh api -X PUT repos/acme/web/pulls/41/merge") === "merge");
	t("classify: a Ready proceed record", classify(`node state.mjs --record --stage ready --decision proceed --head abc --pr ${U}`) === "ready-proceed");
	t("classify: quoted Ready proceed values still count", classify(`node state.mjs --record --stage "ready" --decision 'proceed' --head abc`) === "ready-proceed");
	t("classify: a Merge proceed record is not blocked (written after the merge)", classify(`node state.mjs --record --stage merge --decision proceed --head abc --pr ${U}`) === null);
	t("classify: a Ready hold record is not blocked", classify(`node state.mjs --record --stage ready --decision hold --head abc`) === null);
	t("classify: gh pr view is not a merge", classify(`gh pr view ${U}`) === null);
	t("prFrom: REST path → pull URL", prFrom("gh api -X PUT repos/acme/web/pulls/41/merge") === U);

	t("no marker: the Bash hook is silent", (await bash("s0", `gh pr merge ${U}`)) === null);
	t("no marker: Stop is silent", (await handle("Stop", { session_id: "s0", stop_hook_active: false }, opts)) === null);
	t("a prompt that is not /atelier writes no marker and says nothing", (await handle("UserPromptSubmit", { session_id: "s0", prompt: "fix the bug" }, opts)) === null && !readMarker(dir, "s0"));

	const ctx = await handle("UserPromptSubmit", { session_id: "s1", prompt: `/atelier ${U}` }, opts);
	const text = ctx?.hookSpecificOutput?.additionalContext ?? "";
	t("/atelier <pr> injects the THREADS and CI lines and the rule", /THREADS: open/.test(text) && /CI: green/.test(text) && /never record Ready proceed with open threads/.test(text), text);
	t("/atelier <pr> writes the session marker with the PR", readMarker(dir, "s1")?.pr === U);
	t("open threads: gh pr merge is denied", denied(await bash("s1", `gh pr merge ${U} --squash`)));
	t("open threads: the REST merge is denied", denied(await bash("s1", "gh api -X PUT repos/acme/web/pulls/41/merge")));
	t("open threads: a Ready proceed record is denied", denied(await bash("s1", `node state.mjs --record --stage ready --decision proceed --head abc --pr ${U}`)));
	t("open threads: a Merge proceed record is allowed", (await bash("s1", `node state.mjs --record --stage merge --decision proceed --head abc --pr ${U}`)) === null);
	t("the deny reason names the threads and the way back", /THREADS: open/.test((await bash("s1", `gh pr merge ${U}`)).hookSpecificOutput.permissionDecisionReason));
	t("a denied command does not count as proceeded", !readMarker(dir, "s1").proceeded);

	await handle("PreToolUse", { session_id: "s4", tool_name: "Skill", tool_input: { skill: "atelier", args: U } }, opts);
	await handle("PreToolUse", { session_id: "s5", tool_name: "Skill", tool_input: { skill: "aw", args: U } }, opts);
	t("the Skill tool starting atelier marks the session", denied(await bash("s4", `gh pr merge ${U}`)));
	t("another skill does not", (await bash("s5", `gh pr merge ${U}`)) === null);

	state = null;
	t("a lookup error fails open", (await bash("s1", `gh pr merge ${U}`)) === null);
	state = FIXTURES.clear;
	await handle("UserPromptSubmit", { session_id: "s6", prompt: `/atelier ${U}` }, opts);
	t("clear threads: a Ready proceed record is allowed", (await bash("s6", `node state.mjs --record --stage ready --decision proceed --head abc --pr ${U}`)) === null && readMarker(dir, "s6").proceeded === true);
	t("clear threads at Stop: no block", (await handle("Stop", { session_id: "s6", stop_hook_active: false }, opts)) === null);
	state = FIXTURES.open;
	t("stop_hook_active: never blocks", (await handle("Stop", { session_id: "s6", stop_hook_active: true }, opts)) === null);
	const stop = await handle("Stop", { session_id: "s6", stop_hook_active: false }, opts);
	t("threads opened after a Ready proceed: Stop blocks", stop?.decision === "block" && /THREADS: open/.test(stop.reason), JSON.stringify(stop));
	t("Stop blocks once", (await handle("Stop", { session_id: "s6", stop_hook_active: false }, opts)) === null);
	await handle("UserPromptSubmit", { session_id: "s7", prompt: `/atelier ${U}` }, opts);
	t("a session that allowed no proceed: Stop does not block", (await handle("Stop", { session_id: "s7", stop_hook_active: false }, opts)) === null);
	t("/atelier setup is not a run", (await handle("UserPromptSubmit", { session_id: "s8", prompt: "/atelier setup" }, opts)) === null);
	const ctxNoPr = await handle("UserPromptSubmit", { session_id: "s9", prompt: "/atelier add a dark-mode toggle" }, opts);
	t("/atelier <request> injects the rule without a PR", /never record Ready proceed/.test(ctxNoPr?.hookSpecificOutput?.additionalContext ?? "") && !/THREADS:/.test(ctxNoPr.hookSpecificOutput.additionalContext));

	writeFileSync(join(dir, "old.json"), "{}");
	const old = (Date.now() - 8 * 24 * 3600 * 1000) / 1000;
	const { utimesSync } = await import("node:fs");
	utimesSync(join(dir, "old.json"), old, old);
	writeMarker(dir, "s10", {});
	t("markers older than 7 days are pruned on write", !existsSync(join(dir, "old.json")) && existsSync(markerPath(dir, "s10")));
	t("a hostile session id stays inside the marker dir", markerPath(dir, "../../etc/x").startsWith(dir) && !markerPath(dir, "../../etc/x").includes("/../"));

	rmSync(dir, { recursive: true, force: true });
	console.log(`atelier-guard self-test: ${pass} passed, ${fail} failed`);
	return fail === 0 ? 0 : 1;
}

async function main() {
	if (process.argv.includes("--self-test")) process.exit(await selfTest());
	try {
		const i = process.argv.indexOf("--event");
		const event = i > 0 ? process.argv[i + 1] : null;
		let raw = "";
		for await (const chunk of process.stdin) raw += chunk;
		const out = await handle(event, JSON.parse(raw || "{}"));
		if (out) process.stdout.write(JSON.stringify(out));
	} catch {}
	process.exit(0);
}

main();
