#!/usr/bin/env node
// deployment-verify verdict rule. Deterministic: the agent measures, this script decides.
//
//   node decide.mjs <thresholds.json> < stats.json     → one JSON line {verdict, reason, reference}
//   node decide.mjs --self-test                        → runs the built-in cases, exit 1 on any mismatch
//
// stats.json: {"control":{"n","errors","avg_ms"},"test":{...},"baseline":{...}?}
//   control  = flag-off cohort in the same window as test
//   test     = flag-on cohort
//   baseline = the pre-rollout window; the reference only when control.n is 0 (the 100 % step)
// Exit code: 0 PASS, 10 HOLD, 20 ROLLBACK, 2 bad input.

import { readFileSync } from "node:fs";

export const DEFAULT_THRESHOLDS = {
	min_test_requests: 20,
	min_reference_requests: 20,
	max_error_rate_delta_pp: 5,
	max_latency_ratio: 3,
	min_latency_delta_ms: 50,
};

const EXIT = { PASS: 0, HOLD: 10, ROLLBACK: 20 };

export function decide(stats, thresholds = {}) {
	const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
	const rate = (x) => (x.n ? (100 * x.errors) / x.n : 0);
	const useBaseline = stats.control.n === 0 && stats.baseline;
	const ref = useBaseline ? stats.baseline : stats.control;
	const reference = useBaseline ? "baseline" : "control";

	if (stats.test.n < t.min_test_requests) {
		return { verdict: "HOLD", reason: `test ${stats.test.n} < ${t.min_test_requests} requests`, reference };
	}
	if (ref.n < t.min_reference_requests) {
		return { verdict: "HOLD", reason: `${reference} ${ref.n} < ${t.min_reference_requests} requests`, reference };
	}
	const deltaPp = rate(stats.test) - rate(ref);
	const addedMs = stats.test.avg_ms - ref.avg_ms;
	const ratio = stats.test.avg_ms / Math.max(ref.avg_ms, 1);
	if (deltaPp > t.max_error_rate_delta_pp) {
		return { verdict: "ROLLBACK", reason: `error rate +${deltaPp.toFixed(1)}pp vs ${reference} > ${t.max_error_rate_delta_pp}pp`, reference };
	}
	if (ratio > t.max_latency_ratio && addedMs > t.min_latency_delta_ms) {
		return { verdict: "ROLLBACK", reason: `latency x${ratio.toFixed(1)} (+${addedMs.toFixed(0)} ms) vs ${reference}`, reference };
	}
	return { verdict: "PASS", reason: `error ${deltaPp >= 0 ? "+" : ""}${deltaPp.toFixed(1)}pp, latency x${ratio.toFixed(1)} (${addedMs >= 0 ? "+" : ""}${addedMs.toFixed(0)} ms) vs ${reference}`, reference };
}

// Cases measured in the prototype run (Dash0 ui, local stack) plus the two edges it exposed.
const CASES = [
	["error regression at 1 %", { control: { n: 2593, errors: 0, avg_ms: 3.6 }, test: { n: 26, errors: 7, avg_ms: 304.5 } }, "ROLLBACK"],
	["latency-only regression", { control: { n: 476, errors: 0, avg_ms: 4.6 }, test: { n: 63, errors: 0, avg_ms: 405.6 } }, "ROLLBACK"],
	["fast endpoint noise (1 → 4 ms)", { control: { n: 300, errors: 0, avg_ms: 1 }, test: { n: 40, errors: 0, avg_ms: 4 } }, "PASS"],
	["healthy at 50 %", { control: { n: 77, errors: 0, avg_ms: 3.9 }, test: { n: 93, errors: 0, avg_ms: 6.4 } }, "PASS"],
	["thin test cohort", { control: { n: 79, errors: 0, avg_ms: 6.3 }, test: { n: 5, errors: 2, avg_ms: 306 } }, "HOLD"],
	["100 % without baseline", { control: { n: 0, errors: 0, avg_ms: 0 }, test: { n: 150, errors: 0, avg_ms: 4.1 } }, "HOLD"],
	["100 % healthy vs baseline", { control: { n: 0, errors: 0, avg_ms: 0 }, test: { n: 150, errors: 0, avg_ms: 4.1 }, baseline: { n: 575, errors: 0, avg_ms: 5.2 } }, "PASS"],
	["100 % regression vs baseline", { control: { n: 0, errors: 0, avg_ms: 0 }, test: { n: 150, errors: 40, avg_ms: 300 }, baseline: { n: 575, errors: 0, avg_ms: 5.2 } }, "ROLLBACK"],
];

function selfTest() {
	let failed = 0;
	for (const [name, stats, expected] of CASES) {
		const { verdict, reason } = decide(stats);
		const ok = verdict === expected;
		if (!ok) failed++;
		console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${verdict} (${reason})${ok ? "" : ` — expected ${expected}`}`);
	}
	console.log(failed ? `${failed}/${CASES.length} failed` : `${CASES.length}/${CASES.length} passed`);
	process.exit(failed ? 1 : 0);
}

function main() {
	const arg = process.argv[2];
	if (arg === "--self-test") return selfTest();
	try {
		const thresholds = arg ? JSON.parse(readFileSync(arg, "utf8")) : {};
		const stats = JSON.parse(readFileSync(0, "utf8"));
		for (const k of ["control", "test"]) {
			if (!stats[k] || typeof stats[k].n !== "number") throw new Error(`stats.${k}.n missing`);
		}
		const result = decide(stats, thresholds);
		console.log(JSON.stringify(result));
		process.exit(EXIT[result.verdict]);
	} catch (error) {
		console.error(`decide.mjs: ${error.message}`);
		process.exit(2);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) main();
