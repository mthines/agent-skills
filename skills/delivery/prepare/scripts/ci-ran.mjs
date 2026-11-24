#!/usr/bin/env node
// ci-ran.mjs — did CI actually run on a PR's head, and is it green? (prepare SKILL.md Step 1)
//
// "CI ran" means: at least one required check completed with a conclusion other than SKIPPED/STALE, or,
// when the head reports no required check, at least one GitHub Actions check run did. External commit
// statuses and other apps' check runs (Vercel, security scanners) never prove CI ran on their own.
//
//   node ci-ran.mjs --pr <url|n> [--head <sha>]     reads the head's check rollup via `gh api graphql`
//   node ci-ran.mjs --rollup-file <json>             offline: a saved `gh api graphql` response of the same query
//   node ci-ran.mjs --self-test
//
// --head: the sha the caller expects; a PR whose head moved is `pending` (re-read before deciding).
// Prints one JSON object, then a final line `CI: green|pending|red|not-run — <reason>`.
// Exit: 0 green, 1 pending|red|not-run, 2 error.
// Other skills (atelier's merge gate) call this file by path or import classify()/ciStatus(); keep both stable.

import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const QUERY = `query($o:String!,$r:String!,$n:Int!,$after:String){repository(owner:$o,name:$r){pullRequest(number:$n){headRefOid commits(last:1){nodes{commit{oid statusCheckRollup{contexts(first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{__typename ... on CheckRun{name status conclusion isRequired(pullRequestNumber:$n) checkSuite{app{slug}}} ... on StatusContext{context state isRequired(pullRequestNumber:$n)}}}}}}}}}}`;

const NOT_RUN = new Set(["SKIPPED", "STALE"]);
const PASSED = new Set(["SUCCESS", "NEUTRAL"]);

// One rollup context → { name, required, actions, phase: pending|skipped|passed|failed }.
export function normalize(node) {
	if (node.__typename === "StatusContext") {
		const phase = { SUCCESS: "passed", PENDING: "pending", EXPECTED: "pending" }[node.state] ?? "failed";
		return { name: node.context, kind: "status", required: !!node.isRequired, actions: false, phase };
	}
	const actions = node.checkSuite?.app?.slug === "github-actions";
	let phase;
	if (node.status !== "COMPLETED") phase = "pending";
	else if (NOT_RUN.has(node.conclusion)) phase = "skipped";
	else if (PASSED.has(node.conclusion)) phase = "passed";
	else phase = "failed";
	return { name: node.name, kind: "check", required: !!node.isRequired, actions, phase };
}

// The decision, from normalized contexts. When nothing in the basis ran or is still running, the answer is
// not-run whatever an external status says; otherwise red > pending > green.
export function classify(contexts, { head = null, expectedHead = null } = {}) {
	const required = contexts.filter((c) => c.required);
	const basis = required.length ? required : contexts.filter((c) => c.actions);
	const ran = basis.filter((c) => c.phase === "passed" || c.phase === "failed");
	const failed = contexts.filter((c) => c.phase === "failed");
	const pending = contexts.filter((c) => c.phase === "pending");
	const what = required.length ? "required check" : "GitHub Actions check run";
	const names = (xs) => xs.slice(0, 5).map((c) => c.name).join(", ") + (xs.length > 5 ? ` (+${xs.length - 5})` : "");
	const base = { head, ran: ran.length > 0, basis: required.length ? "required" : "actions", ran_checks: ran.map((c) => c.name).slice(0, 10), counts: { total: contexts.length, required: required.length, skipped: contexts.filter((c) => c.phase === "skipped").length } };
	if (expectedHead && head && expectedHead !== head) return { ...base, state: "pending", reason: `head moved: expected ${expectedHead.slice(0, 7)}, PR is at ${head.slice(0, 7)}` };
	const basisPending = basis.some((c) => c.phase === "pending");
	if (!ran.length && !basisPending) {
		const why = !contexts.length ? "no checks reported" : basis.length ? `every ${what} skipped (${basis.length})` : `no ${what} reported; only ${names(contexts)}`;
		return { ...base, state: "not-run", reason: `CI not run at ${head ? head.slice(0, 7) : "head"}: ${why}` };
	}
	if (failed.length) return { ...base, state: "red", reason: `${failed.length} failing: ${names(failed)}` };
	if (pending.length) return { ...base, state: "pending", reason: `${pending.length} still running: ${names(pending)}` };
	return { ...base, state: "green", reason: `${ran.length} ${what}${ran.length === 1 ? "" : "s"} ran and passed at ${head ? head.slice(0, 7) : "head"}` };
}

// owner/repo/number from a PR URL, or a bare number against cwd's origin.
export function prRef(pr, originUrl = () => execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" })) {
	const m = String(pr ?? "").match(/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/);
	if (m) return { owner: m[1], repo: m[2], number: Number(m[3]) };
	const n = String(pr ?? "").match(/(\d+)\s*$/);
	if (!n) throw new Error(`cannot read a PR number from ${pr}`);
	const [owner, repo] = originUrl().trim().replace(/\.git$/, "").split(/[/:]/).slice(-2);
	return { owner, repo, number: Number(n[1]) };
}

// The pages of a `gh api graphql` response → { head, nodes }.
export function fromResponses(pages) {
	const head = pages[0]?.data?.repository?.pullRequest?.headRefOid ?? null;
	const nodes = pages.flatMap((p) => p?.data?.repository?.pullRequest?.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? []);
	return { head, nodes };
}

const ghRun = (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// Reads the rollup at the PR's current head through `run` (gh by default; inject a fake for tests).
export function fetchRollup(pr, { run = ghRun } = {}) {
	const { owner, repo, number } = prRef(pr);
	const pages = [];
	let after = null;
	for (let i = 0; i < 20; i++) {
		const args = ["api", "graphql", "-f", `query=${QUERY}`, "-f", `o=${owner}`, "-f", `r=${repo}`, "-F", `n=${number}`];
		if (after) args.push("-f", `after=${after}`);
		const page = JSON.parse(run(args));
		if (page.errors?.length) throw new Error(`gh graphql: ${page.errors[0].message}`);
		pages.push(page);
		const info = page?.data?.repository?.pullRequest?.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.pageInfo;
		if (!info?.hasNextPage) return fromResponses(pages);
		after = info.endCursor;
	}
	throw new Error("more than 2000 checks on the head");
}

export function ciStatus(pr, { run = ghRun, expectedHead = null } = {}) {
	const { head, nodes } = fetchRollup(pr, { run });
	return classify(nodes.map(normalize), { head, expectedHead });
}

function selfTest() {
	let pass = 0;
	let fail = 0;
	const t = (name, ok, detail = "") => {
		if (ok) pass++;
		else {
			fail++;
			console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
		}
	};
	const cr = (name, conclusion, { required = false, app = "github-actions", status = "COMPLETED" } = {}) => ({ __typename: "CheckRun", name, status, conclusion, isRequired: required, checkSuite: { app: { slug: app } } });
	const sc = (context, state, required = false) => ({ __typename: "StatusContext", context, state, isRequired: required });
	const c = (nodes, opts) => classify(nodes.map(normalize), { head: "abc1234def", ...opts });
	const real = JSON.parse(readFileSync(new URL("./fixtures/skipped-plus-vercel.json", import.meta.url), "utf8"));
	const r0 = classify(fromResponses([real]).nodes.map(normalize), { head: fromResponses([real]).head });
	t("PR #29652 (16 skipped, Vercel status + check pass) is not-run", r0.state === "not-run" && r0.basis === "required", JSON.stringify(r0));
	t("external statuses alone never count", c([cr("lint", "SKIPPED"), sc("Vercel", "SUCCESS"), cr("Vercel Preview Comments", "SUCCESS", { app: "vercel" })]).state === "not-run");
	t("no checks at all is not-run", c([]).state === "not-run" && /no checks reported/.test(c([]).reason));
	t("one Actions run that passed, no required checks → green", c([cr("test", "SUCCESS"), cr("e2e", "SKIPPED")]).state === "green");
	t("a required check that ran and passed → green, skipped required siblings allowed", c([cr("ci", "SUCCESS", { required: true }), cr("e2e", "SKIPPED", { required: true })]).state === "green");
	t("required checks all skipped, a non-required Actions run passed → not-run", c([cr("gate", "SKIPPED", { required: true }), cr("lint", "SUCCESS")]).state === "not-run");
	t("a required external status that passed counts", c([sc("ci/jenkins", "SUCCESS", true)]).state === "green");
	t("a failing check is red", c([cr("test", "FAILURE"), cr("ok", "SUCCESS")]).state === "red");
	t("a failing external status is red", c([cr("test", "SUCCESS"), sc("Vercel", "FAILURE")]).state === "red");
	t("a running check is pending", c([cr("test", null, { status: "IN_PROGRESS" }), cr("ok", "SUCCESS")]).state === "pending");
	t("a pending status is pending", c([cr("ok", "SUCCESS"), sc("Vercel", "PENDING")]).state === "pending");
	t("red wins over pending", c([cr("a", "FAILURE"), cr("b", null, { status: "QUEUED" })]).state === "red");
	t("a moved head is pending", c([cr("ok", "SUCCESS")], { expectedHead: "fff0000" }).state === "pending");
	t("skipped Actions + a pending external status is not-run, not pending", c([cr("test", "SKIPPED"), sc("Vercel", "PENDING")]).state === "not-run");
	t("skipped Actions + a failing external status is not-run, not red", c([cr("test", "SKIPPED"), sc("Vercel", "FAILURE")]).state === "not-run");
	t("a queued Actions run with nothing else ran is pending", c([cr("test", null, { status: "QUEUED" }), cr("e2e", "SKIPPED")]).state === "pending");
	t("a stale run does not count", c([cr("ok", "STALE")]).state === "not-run");
	// fetchRollup with an injected runner: pagination and owner/repo from the URL.
	const calls = [];
	const page = (nodes, next) => JSON.stringify({ data: { repository: { pullRequest: { headRefOid: "h1", commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { pageInfo: { hasNextPage: !!next, endCursor: next }, nodes } } } }] } } } } });
	const run = (args) => { calls.push(args); return calls.length === 1 ? page([cr("a", "SKIPPED")], "C1") : page([cr("b", "SUCCESS")], null); };
	const r1 = ciStatus("https://github.com/acme/web/pull/41", { run });
	t("the runner is paged and both pages are read", calls.length === 2 && calls[1].includes("after=C1") && r1.state === "green" && r1.head === "h1", JSON.stringify(r1));
	t("owner/repo/number come from the URL", calls[0].includes("o=acme") && calls[0].includes("r=web") && calls[0].includes("n=41"));
	t("a bare number uses cwd origin", JSON.stringify(prRef("#7", () => "git@github.com:o/r.git\n")) === '{"owner":"o","repo":"r","number":7}');
	console.log(`ci-ran self-test: ${pass} passed, ${fail} failed`);
	return fail === 0 ? 0 : 1;
}

function arg(name) {
	const i = process.argv.indexOf(`--${name}`);
	return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : null;
}

function main() {
	if (process.argv.includes("--self-test")) process.exit(selfTest());
	try {
		let r;
		if (arg("rollup-file")) {
			const { head, nodes } = fromResponses([JSON.parse(readFileSync(arg("rollup-file"), "utf8"))]);
			r = classify(nodes.map(normalize), { head, expectedHead: arg("head") });
		} else if (arg("pr")) r = ciStatus(arg("pr"), { expectedHead: arg("head") });
		else throw new Error("pass --pr <url|n> or --rollup-file <json>");
		console.log(JSON.stringify(r, null, 2));
		console.log(`CI: ${r.state} — ${r.reason}`);
		process.exit(r.state === "green" ? 0 : 1);
	} catch (e) {
		console.error(`ci-ran: ${e.message}`);
		process.exit(2);
	}
}

const isMain = (() => {
	try {
		return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
	} catch {
		return false;
	}
})();
if (isMain) main();
