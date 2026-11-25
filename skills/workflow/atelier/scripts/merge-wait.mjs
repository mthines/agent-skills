#!/usr/bin/env node
// merge-wait.mjs — carry a gated merge through GitHub errors, for at most --max-wait minutes (SKILL.md, "Merging through GitHub errors").
//
// `prepare --merge` can come back with the PR still open because GitHub failed the call (5xx, "Something went wrong",
// "Merge already in progress"), or because a merge queue only enqueued it. The gates already passed on this head, so the run
// does not end at a hold: it waits for MERGED, and with --retry-merge repeats the same squash, pinned to the gated head.
// A refusal that is not a GitHub error (a branch rule, a failed check, a conflict) ends the wait at once.
//
//   node merge-wait.mjs --pr <url> [--head <sha>] [--max-wait <minutes>] [--interval <seconds>] [--retry-merge]
//   node merge-wait.mjs --self-test
//
// merged:  the PR is merged.        closed:  closed without a merge.      refused: GitHub refused the merge for a reason a retry cannot fix.
// pending: still open after --max-wait.                                    moved:   the head is not --head; the gates judged another commit.
//
// Prints one JSON object, then a final line `MERGE_WAIT: merged|closed|refused|pending|moved — <reason>`.
// Exit: 0 merged, 1 closed or refused, 2 error, 3 pending after --max-wait, 4 moved.

import { execFileSync } from "node:child_process";

import { isMain, makeTester, parseArgs } from "./lib.mjs";

export const DEFAULT_MAX_WAIT_MINUTES = 30;
export const DEFAULT_INTERVAL_SECONDS = 30;
// What GitHub says when the failure is on its side or the merge is already under way: a retry or a wait can fix it.
export const TRANSIENT = /\b50[0-4]\b|server error|something went wrong|bad gateway|service unavailable|gateway time-?out|timed? ?out|already in progress|already queued|could not resolve|connection (reset|refused)|temporar/i;

function sameSha(a, b) {
	const n = Math.min(a.length, b.length, 7);
	return n >= 7 && a.slice(0, n) === b.slice(0, n);
}

// `step()` returns { kind: merged|closed|refused|moved|open, reason }. All time and I/O is injected.
export async function waitForMerge({ step, maxWaitMs, intervalMs, now = Date.now, sleep }) {
	const start = now();
	let polls = 0;
	for (;;) {
		const r = await step();
		polls++;
		const waitedMs = now() - start;
		const done = (state, reason) => ({ state, reason, polls, waited_s: Math.round(waitedMs / 1000) });
		if (r.kind !== "open") return done(r.kind, r.reason);
		if (waitedMs >= maxWaitMs) return done("pending", r.reason);
		await sleep(intervalMs);
	}
}

function minutes(value, fallback, label) {
	const raw = value ?? fallback;
	const n = typeof raw === "boolean" ? NaN : Number(raw);
	if (!Number.isFinite(n) || n < 0) throw new Error(`${label} must be a non-negative number, got ${raw}`);
	return n;
}

const gh = (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const message = (e) => String(e.stderr || e.message || e).trim().split("\n")[0].slice(0, 200);

// One look at the PR, and when asked one repeat of the gated squash. A failed read is a GitHub error, never a verdict.
export function makeStep({ pr, head, retryMerge, run = gh }) {
	const read = () => {
		try {
			return JSON.parse(run(["pr", "view", pr, "--json", "state,headRefOid,mergeCommit"]));
		} catch (e) {
			return { error: message(e) };
		}
	};
	const judge = (p) => {
		if (p.error) return null;
		if (p.state === "MERGED") return { kind: "merged", reason: `merged${p.mergeCommit?.oid ? ` ${p.mergeCommit.oid.slice(0, 7)}` : ""}` };
		if (p.state === "CLOSED") return { kind: "closed", reason: "the PR was closed without a merge" };
		if (head && p.headRefOid && !sameSha(head, p.headRefOid)) return { kind: "moved", reason: `head moved: gated ${head.slice(0, 7)}, PR is at ${p.headRefOid.slice(0, 7)}` };
		return null;
	};
	return async () => {
		let p = read();
		const first = judge(p);
		if (first) return first;
		if (!retryMerge) return { kind: "open", reason: p.error ? `GitHub read failed: ${p.error}` : "the PR is still open" };
		try {
			run(["pr", "merge", pr, "--squash", ...(head ? ["--match-head-commit", head] : [])]);
		} catch (e) {
			const m = message(e);
			if (!TRANSIENT.test(m)) return { kind: "refused", reason: m };
			return { kind: "open", reason: `GitHub error, will retry: ${m}` };
		}
		p = read();
		return judge(p) ?? { kind: "open", reason: "merge requested; waiting for GitHub to complete it" };
	};
}

async function selfTest() {
	const { t, done } = makeTester("merge-wait");
	const sha = "a".repeat(40);
	const clock = () => {
		let ms = 0;
		return { now: () => ms, sleep: async (d) => { ms += d; } };
	};
	const wait = (step, opts = {}) => waitForMerge({ step, maxWaitMs: 10 * 60_000, intervalMs: 30_000, ...clock(), ...opts });
	const seq = (...kinds) => {
		let i = 0;
		return async () => ({ kind: kinds[Math.min(i++, kinds.length - 1)], reason: "r" });
	};
	t("merged ends at once", (await wait(seq("merged"))).state === "merged");
	const later = await wait(seq("open", "open", "merged"));
	t("open keeps waiting until merged", later.state === "merged" && later.polls === 3 && later.waited_s === 60, JSON.stringify(later));
	t("refused ends the wait", (await wait(seq("open", "refused"))).state === "refused");
	t("closed ends the wait", (await wait(seq("closed"))).state === "closed");
	t("moved ends the wait", (await wait(seq("moved"))).state === "moved");
	const stuck = await wait(seq("open"));
	t("open past --max-wait ends as pending", stuck.state === "pending" && stuck.waited_s === 600, JSON.stringify(stuck));
	const zero = await wait(seq("open", "merged"), { maxWaitMs: 0 });
	t("--max-wait 0 reads once and never sleeps", zero.state === "pending" && zero.polls === 1 && zero.waited_s === 0);

	for (const m of ["HTTP 502 Bad Gateway", "GraphQL: Something went wrong while executing your query", "Merge already in progress (mergePullRequest)", "gh: Server Error", "HTTP 503", "could not resolve host"]) {
		t(`GitHub error is transient: ${m.slice(0, 40)}`, TRANSIENT.test(m));
	}
	for (const m of ["Pull request is not mergeable: the base branch policy prohibits the merge", "Required status check \"l1\" is expected", "Head branch was modified. Review and try the merge again."]) {
		t(`a real refusal is not transient: ${m.slice(0, 40)}`, !TRANSIENT.test(m));
	}

	const view = (o) => JSON.stringify({ state: "OPEN", headRefOid: sha, mergeCommit: null, ...o });
	const script = (handlers) => { const calls = []; const run = (args) => { calls.push(args.slice(0, 2).join(" ")); return handlers(args, calls); }; return { run, calls }; };
	const mk = (handlers, o = {}) => { const s = script(handlers); return { step: makeStep({ pr: "u", head: sha, run: s.run, ...o }), calls: s.calls }; };

	let a = mk(() => view({ state: "MERGED", mergeCommit: { oid: "b".repeat(40) } }), { retryMerge: true });
	const merged = await a.step();
	t("an already merged PR is merged and never merged again", merged.kind === "merged" && /bbbbbbb/.test(merged.reason) && a.calls.length === 1, JSON.stringify(a.calls));
	a = mk(() => view({ headRefOid: "c".repeat(40) }), { retryMerge: true });
	t("a moved head is moved and never merged", (await a.step()).kind === "moved" && a.calls.length === 1);
	a = mk(() => { throw new Error("HTTP 502"); }, { retryMerge: false });
	t("a failed read is open, not an error", (await a.step()).kind === "open");
	a = mk(() => view());
	t("without --retry-merge it only reads", (await a.step()).kind === "open" && a.calls.every((c) => c === "pr view"));
	a = mk((args) => { if (args[1] === "merge") throw Object.assign(new Error("x"), { stderr: "GraphQL: Something went wrong\n" }); return view(); }, { retryMerge: true });
	const transient = await a.step();
	t("a transient merge error stays open", transient.kind === "open" && /will retry/.test(transient.reason), JSON.stringify(transient));
	a = mk((args) => { if (args[1] === "merge") throw Object.assign(new Error("x"), { stderr: "Pull request is not mergeable: the base branch policy prohibits the merge\n" }); return view(); }, { retryMerge: true });
	t("a real refusal ends as refused", (await a.step()).kind === "refused");
	let merges = 0;
	a = mk((args) => { if (args[1] === "merge") { merges++; return ""; } return merges ? view({ state: "MERGED", mergeCommit: { oid: "d".repeat(40) } }) : view(); }, { retryMerge: true });
	t("a merge that goes through is read back as merged", (await a.step()).kind === "merged");
	let seen = [];
	a = mk((args) => { if (args[1] === "merge") { seen = args; return ""; } return view(); }, { retryMerge: true });
	await a.step();
	t("the retry is pinned to the gated head", seen.includes("--match-head-commit") && seen.includes(sha) && seen.includes("--squash"), JSON.stringify(seen));
	return done();
}

async function main() {
	const a = parseArgs(process.argv.slice(2));
	if (a["self-test"]) process.exit(await selfTest());
	try {
		if (!a.pr || typeof a.pr !== "string") throw new Error("pass --pr <url>");
		const maxWait = minutes(a["max-wait"], DEFAULT_MAX_WAIT_MINUTES, "--max-wait (minutes)");
		const interval = minutes(a.interval, DEFAULT_INTERVAL_SECONDS, "--interval (seconds)");
		const head = typeof a.head === "string" ? a.head : null;
		const result = await waitForMerge({
			step: makeStep({ pr: a.pr, head, retryMerge: a["retry-merge"] === true }),
			maxWaitMs: maxWait * 60_000,
			intervalMs: Math.max(1, interval) * 1000,
			sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
		});
		console.log(JSON.stringify({ ...result, max_wait_minutes: maxWait }, null, 2));
		console.log(`MERGE_WAIT: ${result.state} — ${result.reason}`);
		process.exit({ merged: 0, closed: 1, refused: 1, pending: 3, moved: 4 }[result.state] ?? 2);
	} catch (e) {
		console.error(`merge-wait.mjs: ${e.message}`);
		process.exit(2);
	}
}

if (isMain(import.meta.url)) main();
