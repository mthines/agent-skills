#!/usr/bin/env node
// threads.mjs — are a PR's review threads all resolved on its head? (prepare SKILL.md Step 1)
//
// A thread counts while it is unresolved, outdated or not: GitHub's "require conversation resolution" counts both.
//
//   node threads.mjs --pr <url|n> [--head <sha>]     reads the threads via `gh api graphql`
//   node threads.mjs --threads-file <json>           offline: a saved `gh api graphql` response of the same query
//   node threads.mjs --self-test
//
// --head: the sha the caller expects; a PR whose head moved is `pending` (re-read before deciding).
// Prints one JSON object, then a final line `THREADS: clear|open|pending — <reason>`.
// Exit: 0 clear, 1 open|pending, 2 error.
// atelier's state.mjs and merge-gate.mjs, and the atelier-guard plugin, import classify()/threadStatus(); keep both stable.

import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { prRef, sameSha } from "./ci-ran.mjs";

const QUERY = `query($o:String!,$r:String!,$n:Int!,$after:String){repository(owner:$o,name:$r){pullRequest(number:$n){headRefOid reviewThreads(first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{isResolved isOutdated comments(first:1){nodes{author{login} path line originalLine url}}}}}}}`;

// One review thread → { author, path, line, url, outdated }, or null when it is resolved.
export function normalize(node) {
	if (node?.isResolved) return null;
	const c = node?.comments?.nodes?.[0] ?? {};
	return { author: c.author?.login ?? "?", path: c.path ?? null, line: c.line ?? c.originalLine ?? null, url: c.url ?? null, outdated: !!node?.isOutdated };
}

const where = (u) => `${u.author} ${u.path ? `${u.path.split("/").pop()}${u.line ? `:${u.line}` : ""}` : "(PR)"}`;

export function classify(nodes, { head = null, expectedHead = null } = {}) {
	const unresolved = nodes.map(normalize).filter(Boolean);
	const at = head ? head.slice(0, 7) : "head";
	const base = { head, count: unresolved.length, total: nodes.length, unresolved };
	if (expectedHead && head && !sameSha(expectedHead, head)) return { ...base, state: "pending", reason: `head moved: expected ${expectedHead.slice(0, 7)}, PR is at ${head.slice(0, 7)}` };
	if (!unresolved.length) return { ...base, state: "clear", reason: `every review thread resolved at ${at} (${nodes.length})` };
	const names = unresolved.slice(0, 5).map(where).join(", ") + (unresolved.length > 5 ? ` (+${unresolved.length - 5})` : "");
	return { ...base, state: "open", reason: `${unresolved.length} unresolved at ${at}: ${names}` };
}

// The pages of a `gh api graphql` response → { head, nodes }.
export function fromResponses(pages) {
	const head = pages[0]?.data?.repository?.pullRequest?.headRefOid ?? null;
	const nodes = pages.flatMap((p) => p?.data?.repository?.pullRequest?.reviewThreads?.nodes ?? []);
	return { head, nodes };
}

const ghRun = (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });

export function fetchThreads(pr, { run = ghRun } = {}) {
	const { owner, repo, number } = prRef(pr);
	const pages = [];
	let after = null;
	for (let i = 0; i < 20; i++) {
		const args = ["api", "graphql", "-f", `query=${QUERY}`, "-f", `o=${owner}`, "-f", `r=${repo}`, "-F", `n=${number}`];
		if (after) args.push("-f", `after=${after}`);
		const page = JSON.parse(run(args));
		if (page.errors?.length) throw new Error(`gh graphql: ${page.errors[0].message}`);
		pages.push(page);
		const info = page?.data?.repository?.pullRequest?.reviewThreads?.pageInfo;
		if (!info?.hasNextPage) return fromResponses(pages);
		after = info.endCursor;
	}
	throw new Error("more than 2000 review threads");
}

export function threadStatus(pr, { run = ghRun, expectedHead = null } = {}) {
	const { head, nodes } = fetchThreads(pr, { run });
	return classify(nodes, { head, expectedHead });
}

// The JSON this script prints, with or without its `THREADS:` line: what state.mjs --threads-file reads.
export function parseOutput(text) {
	return JSON.parse(String(text).replace(/\n?THREADS: .*\s*$/, ""));
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
	const th = (resolved, { author = "cursor[bot]", path = "src/card.tsx", line = 45, outdated = false } = {}) => ({ isResolved: resolved, isOutdated: outdated, comments: { nodes: [{ author: { login: author }, path, line, url: "https://x/r1" }] } });
	t("no threads is clear", classify([], { head: "abc1234def" }).state === "clear");
	t("every thread resolved is clear", classify([th(true), th(true)], { head: "abc1234def" }).state === "clear");
	const open = classify([th(false), th(true), th(false, { author: "mads", path: null, line: null })], { head: "abc1234def" });
	t("unresolved threads are open, counted, and named", open.state === "open" && open.count === 2 && /cursor\[bot\] card\.tsx:45/.test(open.reason) && /mads \(PR\)/.test(open.reason), JSON.stringify(open));
	t("an outdated unresolved thread still counts", classify([th(false, { outdated: true })]).count === 1);
	t("a moved head is pending", classify([], { head: "abc1234def", expectedHead: "fff0000" }).state === "pending");
	t("a short --head of the same commit is not a moved head", classify([], { head: "abc1234def", expectedHead: "abc1234" }).state === "clear");
	t("the printed output parses back", parseOutput(`${JSON.stringify(open, null, 2)}\nTHREADS: open — x`).count === 2);
	const calls = [];
	const page = (nodes, next) => JSON.stringify({ data: { repository: { pullRequest: { headRefOid: "h1", reviewThreads: { pageInfo: { hasNextPage: !!next, endCursor: next }, nodes } } } } });
	const run = (args) => { calls.push(args); return calls.length === 1 ? page([th(true)], "C1") : page([th(false)], null); };
	const r = threadStatus("https://github.com/acme/web/pull/41", { run });
	t("the runner is paged and both pages are read", calls.length === 2 && calls[1].includes("after=C1") && r.state === "open" && r.head === "h1" && r.total === 2, JSON.stringify(r));
	t("owner/repo/number come from the URL", calls[0].includes("o=acme") && calls[0].includes("r=web") && calls[0].includes("n=41"));
	let threw = "";
	try {
		threadStatus("https://github.com/a/b/pull/1", { run: () => JSON.stringify({ errors: [{ message: "denied" }] }) });
	} catch (e) {
		threw = e.message;
	}
	t("a GraphQL error throws, never reads as clear", /denied/.test(threw));
	console.log(`threads self-test: ${pass} passed, ${fail} failed`);
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
		if (arg("threads-file")) {
			const { head, nodes } = fromResponses([JSON.parse(readFileSync(arg("threads-file"), "utf8"))]);
			r = classify(nodes, { head, expectedHead: arg("head") });
		} else if (arg("pr")) r = threadStatus(arg("pr"), { expectedHead: arg("head") });
		else throw new Error("pass --pr <url|n> or --threads-file <json>");
		console.log(JSON.stringify(r, null, 2));
		console.log(`THREADS: ${r.state} — ${r.reason}`);
		process.exit(r.state === "clear" ? 0 : 1);
	} catch (e) {
		console.error(`threads: ${e.message}`);
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
