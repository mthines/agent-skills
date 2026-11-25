#!/usr/bin/env node
// ci-wait.mjs — wait for a PR's checks to settle, for at most --max-wait minutes (SKILL.md, "Waiting for CI").
//
// Polls prepare's ci-ran.mjs (the same definition of "CI ran" the merge gate uses) until the head's CI is
// settled, so a run can carry on by itself instead of ending at a hold the user has to resume.
//
//   node ci-wait.mjs --pr <url> [--head <sha>] [--max-wait <minutes>] [--interval <seconds>] [--out <file>]
//   node ci-wait.mjs --self-test
//
// green and red end the wait at once. pending waits until --max-wait (default 30). not-run waits only a short
// grace (checks register a little after a push or an undraft), then ends. A head that is not --head ends it as
// `moved`, because evidence for another head proves nothing. A transient read error is retried before it fails.
//
// Prints one JSON object (ci-ran's result plus waited_s, polls, max_wait_minutes), then a final line
// `CI_WAIT: green|red|pending|not-run|moved — <reason>`. --out writes the same JSON followed by ci-ran's own
// `CI: <state> — <reason>` line, which is the shape state.mjs --ci-file reads.
// Exit: 0 green, 1 red or not-run, 2 error, 3 pending after --max-wait, 4 moved.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { isMain, makeTester, parseArgs, skillDir } from "./lib.mjs";

export const DEFAULT_MAX_WAIT_MINUTES = 30;
export const DEFAULT_INTERVAL_SECONDS = 30;
// Checks appear a short time after a push or an undraft; a head that still has none after this has none to wait for.
export const NOT_RUN_GRACE_MINUTES = 5;
const MAX_CONSECUTIVE_ERRORS = 3;

function sameSha(a, b) {
	const n = Math.min(a.length, b.length, 7);
	return n >= 7 && a.slice(0, n) === b.slice(0, n);
}

// `check()` returns ci-ran's result ({ state: green|red|pending|not-run, reason, head }). All time and I/O is injected.
export async function waitForCi({ check, expectedHead = null, maxWaitMs, intervalMs, graceMs = NOT_RUN_GRACE_MINUTES * 60_000, now = Date.now, sleep }) {
	const start = now();
	let polls = 0;
	let errors = 0;
	for (;;) {
		let r;
		try {
			r = await check();
			errors = 0;
		} catch (e) {
			if (++errors >= MAX_CONSECUTIVE_ERRORS || now() - start >= maxWaitMs) throw e;
			await sleep(intervalMs);
			continue;
		}
		polls++;
		const waitedMs = now() - start;
		const done = (result) => ({ ...result, polls, waited_s: Math.round(waitedMs / 1000) });
		if (expectedHead && r.head && !sameSha(expectedHead, r.head)) {
			return done({ ...r, state: "moved", reason: `head moved: expected ${expectedHead.slice(0, 7)}, PR is at ${r.head.slice(0, 7)}` });
		}
		if (r.state === "green" || r.state === "red") return done(r);
		if (r.state === "pending" && waitedMs >= maxWaitMs) return done(r);
		if (r.state === "not-run" && waitedMs >= Math.min(graceMs, maxWaitMs)) return done(r);
		await sleep(intervalMs);
	}
}

function minutes(value, fallback, label) {
	const raw = value ?? fallback;
	const n = typeof raw === "boolean" ? NaN : Number(raw);
	if (!Number.isFinite(n) || n < 0) throw new Error(`${label} must be a non-negative number, got ${raw}`);
	return n;
}

async function selfTest() {
	const { t, done } = makeTester("ci-wait");
	const sequence = (...states) => {
		let i = 0;
		return async () => {
			const s = states[Math.min(i++, states.length - 1)];
			return typeof s === "string" ? { state: s, reason: s, head: "a".repeat(40) } : s;
		};
	};
	const clock = () => {
		let ms = 0;
		return { now: () => ms, sleep: async (d) => { ms += d; } };
	};
	const run = (check, opts = {}) => waitForCi({ check, maxWaitMs: 10 * 60_000, intervalMs: 30_000, ...clock(), ...opts });

	const green = await run(sequence("green"));
	t("green ends at once", green.state === "green" && green.polls === 1 && green.waited_s === 0);
	const red = await run(sequence("pending", "red"));
	t("red ends the wait", red.state === "red" && red.polls === 2 && red.waited_s === 30);
	const later = await run(sequence("pending", "pending", "pending", "green"));
	t("pending keeps waiting until green", later.state === "green" && later.polls === 4 && later.waited_s === 90, JSON.stringify(later));
	const stuck = await run(sequence("pending"));
	t("pending past --max-wait ends as pending", stuck.state === "pending" && stuck.waited_s === 600, JSON.stringify(stuck));
	const none = await run(sequence("not-run"));
	t("not-run ends after the grace, not the full wait", none.state === "not-run" && none.waited_s === 300, JSON.stringify(none));
	const shortWait = await run(sequence("not-run"), { maxWaitMs: 60_000 });
	t("the grace never exceeds --max-wait", shortWait.state === "not-run" && shortWait.waited_s === 60, JSON.stringify(shortWait));
	const registered = await run(sequence("not-run", "not-run", "pending", "green"));
	t("checks that register late are waited for", registered.state === "green" && registered.polls === 4);
	const zero = await run(sequence("pending", "green"), { maxWaitMs: 0 });
	t("--max-wait 0 reads once and never sleeps", zero.state === "pending" && zero.polls === 1 && zero.waited_s === 0);
	const moved = await run(sequence({ state: "green", reason: "g", head: "b".repeat(40) }), { expectedHead: "a".repeat(40) });
	t("a green read of another head is `moved`, never green", moved.state === "moved" && /head moved/.test(moved.reason), JSON.stringify(moved));
	const same = await run(sequence("green"), { expectedHead: "a".repeat(7) });
	t("an abbreviated expected head matches", same.state === "green");
	let calls = 0;
	const flaky = async () => { if (++calls < 3) throw new Error("HTTP 502"); return { state: "green", reason: "g", head: "a".repeat(40) }; };
	t("a transient read error is retried", (await run(flaky)).state === "green" && calls === 3);
	let threw = "";
	try { await run(async () => { throw new Error("HTTP 401"); }); } catch (e) { threw = e.message; }
	t("a persistent read error fails after three tries", threw === "HTTP 401");
	return done();
}

async function main() {
	const a = parseArgs(process.argv.slice(2));
	if (a["self-test"]) process.exit(await selfTest());
	try {
		if (!a.pr || typeof a.pr !== "string") throw new Error("pass --pr <url>");
		const maxWait = minutes(a["max-wait"], DEFAULT_MAX_WAIT_MINUTES, "--max-wait (minutes)");
		const interval = minutes(a.interval, DEFAULT_INTERVAL_SECONDS, "--interval (seconds)");
		const { ciStatus } = await import(pathToFileURL(join(skillDir("prepare", "delivery", "PREPARE_DIR"), "scripts", "ci-ran.mjs")).href);
		const result = await waitForCi({
			check: async () => ciStatus(a.pr),
			expectedHead: typeof a.head === "string" ? a.head : null,
			maxWaitMs: maxWait * 60_000,
			intervalMs: Math.max(1, interval) * 1000,
			sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
		});
		const out = { ...result, max_wait_minutes: maxWait };
		const json = JSON.stringify(out, null, 2);
		if (typeof a.out === "string") writeFileSync(a.out, `${json}\nCI: ${result.state} — ${result.reason}\n`);
		console.log(json);
		console.log(`CI_WAIT: ${result.state} — ${result.reason}`);
		process.exit({ green: 0, red: 1, "not-run": 1, pending: 3, moved: 4 }[result.state] ?? 2);
	} catch (e) {
		console.error(`ci-wait.mjs: ${e.message}`);
		process.exit(2);
	}
}

if (isMain(import.meta.url)) main();
