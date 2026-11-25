#!/usr/bin/env node
// outcomes.mjs — did a merged PR stay merged? (rules/decision-log.md § Outcomes)
//
// For each merged PR, reads the base branch's history after its squash commit:
//   reverted  a later commit reverts it ("This reverts commit <sha>", or a "Revert …(#<pr>)" subject), at any age
//   hotfixed  a later commit within --days touches one of its files and its subject says fix, hotfix, or revert
//   clean     neither
// `final` is true once the outcome is worth recording: reverted or hotfixed, or clean with the window closed.
// Only `reverted` never changes; a recorded clean or hotfixed PR can still be reverted later, so callers re-check it.
//
//   node outcomes.mjs --pr <n> --sha <squash sha> [--base origin/main] [--days 14] [--repo-dir .] [--now <ISO>]
//   node outcomes.mjs --merged '[{"pr":12,"sha":"abc…"}]'   or   --input <file.json>   (same shape)
//   node outcomes.mjs --self-test                           builds its own temp git repo
//
// Prints a JSON array, one { pr, sha, outcome, final, evidence: [{ sha, subject, at, files, why }] } per PR;
// a PR whose sha cannot be read is { outcome: "unknown", final: false, error }, and the others still classify.
// An entry may carry `"stored": "<outcome>|null"`, the outcome LoreKit already holds; each final result that differs
// from it is exported as one `atelier.outcome` span and an `atelier.outcomes` point (telemetry.mjs), so a dashboard
// counts every transition once. Entries without `stored` export nothing.
// Exit: 0 ok, 2 error.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isMain, makeTester, parseArgs } from "./lib.mjs";
import { emitOutcomes, markSweep } from "./telemetry.mjs";

const FIX_RE = /\b(hot-?fix(es|ed)?|fix(es|ed)?|revert(s|ed)?)\b/i;
const DAY = 86400;

function git(dir, args) {
	return execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

// Commits after `sha` on `base`, oldest first, each with its full message and files.
function laterCommits(dir, sha, base) {
	const out = git(dir, ["log", "--reverse", "--name-only", "--format=%x1e%H%x1f%ct%x1f%B%x1f", `${sha}..${base}`]);
	return out
		.split("\x1e")
		.filter((c) => c.trim())
		.map((c) => {
			const [h, ct, msg, files] = c.split("\x1f");
			return { sha: h, ct: Number(ct), message: msg.trim(), files: files.split("\n").map((f) => f.trim()).filter(Boolean) };
		});
}

export function classify(dir, { pr, sha, base = "origin/main", days = 14, now = Date.now() / 1000 }) {
	const full = git(dir, ["rev-parse", sha]).trim();
	const t0 = Number(git(dir, ["show", "-s", "--format=%ct", full]).trim());
	const own = new Set(git(dir, ["diff-tree", "--no-commit-id", "--name-only", "-r", "--root", full]).split("\n").filter(Boolean));
	const evidence = [];
	let reverted = false;
	for (const c of laterCommits(dir, full, base)) {
		const subject = c.message.split("\n")[0];
		const at = new Date(c.ct * 1000).toISOString();
		const reverts = [...c.message.matchAll(/This reverts commit ([0-9a-f]{7,40})/g)].some((m) => full.startsWith(m[1]));
		const revertSubject = pr != null && /^Revert\b/i.test(subject) && new RegExp(`\\(#${pr}\\)`).test(subject);
		if (reverts || revertSubject) {
			reverted = true;
			evidence.push({ sha: c.sha, subject, at, files: c.files, why: "revert" });
			continue;
		}
		const shared = c.files.filter((f) => own.has(f));
		// The subject only: a feat squash whose body lists "fix typo" is not a hotfix.
		if (c.ct - t0 <= days * DAY && shared.length && FIX_RE.test(subject)) {
			evidence.push({ sha: c.sha, subject, at, files: shared, why: "fix touching the same files" });
		}
	}
	const outcome = reverted ? "reverted" : evidence.length ? "hotfixed" : "clean";
	const final = outcome !== "clean" || now - t0 > days * DAY;
	return { pr, sha: full, outcome, final, evidence };
}

// One PR whose sha cannot be read must not cost the sweep every other PR's outcome.
export function classifyOne(dir, opts) {
	try {
		return classify(dir, opts);
	} catch (e) {
		return { pr: opts.pr, sha: opts.sha, outcome: "unknown", final: false, evidence: [], error: e.message.split("\n")[0] };
	}
}

function selfTest() {
	const { t, done } = makeTester("outcomes");
	const dir = mkdtempSync(join(tmpdir(), "atelier-outcomes-"));
	let crashed = null;
	const T0 = Date.parse("2026-01-01T00:00:00Z") / 1000;
	const commit = (msg, file, dayOffset, content = msg) => {
		writeFileSync(join(dir, file), `${content}\n`);
		git(dir, ["add", file]);
		const d = `${T0 + dayOffset * DAY} +0000`;
		execFileSync("git", ["commit", "-q", "-m", msg], { cwd: dir, env: { ...process.env, GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d } });
		return git(dir, ["rev-parse", "HEAD"]).trim();
	};
	try {
		git(dir, ["init", "-q", "-b", "main"]);
		git(dir, ["config", "user.email", "t@t"]);
		git(dir, ["config", "user.name", "t"]);
		git(dir, ["config", "commit.gpgsign", "false"]); // the user's global signing config must not reach a throwaway repo
		commit("init", "README", 0);
		const p1 = commit("Add a (#1)", "a.txt", 1);
		const p2 = commit("Add b (#2)", "b.txt", 1);
		const p3 = commit("Add c (#3)", "c.txt", 1);
		const p4 = commit("Add d (#4)", "d.txt", 1);
		const p5 = commit("Add e (#5)", "e.txt", 1);
		const d = `${T0 + 3 * DAY} +0000`;
		execFileSync("git", ["revert", "--no-edit", p1], { cwd: dir, env: { ...process.env, GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d }, stdio: "ignore" });
		commit("fix: b edge case (#6)", "b.txt", 4, "b2");
		commit("tidy c", "c.txt", 5, "c2");
		commit("feat: more c (#8)\n\n* fix typo in c", "c.txt", 6, "c3");
		commit("fix: d late (#7)", "d.txt", 30, "d2");
		commit('Revert "Add e (#5)"', "e.txt", 40, "");
		const now = T0 + 60 * DAY;
		const run = (pr, sha, extra = {}) => classify(dir, { pr, sha, base: "main", now, ...extra });
		const r1 = run(1, p1);
		t("a git revert of the squash commit is reverted", r1.outcome === "reverted" && r1.evidence[0].why === "revert", JSON.stringify(r1));
		const r2 = run(2, p2);
		t("a fix touching the same file in the window is hotfixed", r2.outcome === "hotfixed" && r2.evidence[0].files[0] === "b.txt", JSON.stringify(r2));
		t("hotfixed is final", r2.final);
		t("a later non-fix commit on the same file stays clean", run(3, p3).outcome === "clean");
		t("'fix' in a feat commit's body is not a hotfix", run(3, p3).outcome === "clean");
		t("a fix after the window stays clean", run(4, p4).outcome === "clean");
		t("--days widens the window", run(4, p4, { days: 45 }).outcome === "hotfixed");
		t("a 'Revert …(#n)' subject is reverted at any age", run(5, p5).outcome === "reverted");
		t("clean with the window closed is final", run(3, p3).final);
		t("clean inside the window is not final", !run(3, p3, { now: T0 + 2 * DAY }).final);
		t("a short sha resolves to the full sha", run(2, p2.slice(0, 8)).sha === p2);
		const bad = classifyOne(dir, { pr: 9, sha: "deadbeef", base: "main", now });
		t("an unknown sha is 'unknown', not a crash", bad.outcome === "unknown" && !bad.final && bad.error);
	} catch (e) {
		crashed = e.message.split("\n")[0];
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
	t("the temp repo builds", !crashed, crashed);
	const tr = transitions(
		[{ pr: 1, stored: "clean" }, { pr: 2, stored: "reverted" }, { pr: 3 }, { pr: 4, stored: null }, { pr: 5, stored: null }],
		[{ pr: 1, outcome: "reverted", final: true }, { pr: 2, outcome: "reverted", final: true }, { pr: 3, outcome: "clean", final: true }, { pr: 4, outcome: "clean", final: false }, { pr: 5, outcome: "hotfixed", final: true }],
	);
	t("only a final outcome that differs from a given stored one is a transition", tr.map((x) => `${x.pr}:${x.stored}`).join() === "1:clean,5:null", JSON.stringify(tr));
	return done();
}

// Final results whose outcome differs from the stored one: the transitions worth exporting.
export function transitions(list, results) {
	return results.flatMap((r, i) => {
		const entry = list[i];
		return r.final && entry && "stored" in entry && entry.stored !== r.outcome ? [{ ...r, stored: entry.stored ?? null }] : [];
	});
}

async function main() {
	const a = parseArgs(process.argv.slice(2));
	if (a["self-test"]) process.exit(selfTest());
	try {
		let list;
		if (a.input) list = JSON.parse(readFileSync(a.input, "utf8"));
		else if (a.merged) list = JSON.parse(a.merged);
		else if (a.pr && a.sha) list = [{ pr: Number(a.pr), sha: a.sha }];
		else throw new Error("pass --pr <n> --sha <sha>, --merged '<json>', or --input <file>");
		const opts = { base: a.base || "origin/main", days: a.days ? Number(a.days) : 14 };
		if (a.now) opts.now = Date.parse(a.now) / 1000;
		const dir = a["repo-dir"] || process.cwd();
		git(dir, ["rev-parse", "--verify", "--quiet", `${opts.base}^{commit}`]); // a bad base fails the run, never every PR
		const results = list.map((p) => classifyOne(dir, { ...opts, pr: p.pr, sha: p.sha }));
		console.log(JSON.stringify(results, null, 2));
		const changed = transitions(list, results);
		await markSweep({ listed: list.length, final: results.filter((r) => r.final).length, changed: changed.length });
		if (changed.length) await emitOutcomes({ results: changed, repo: originSlug(dir) });
	} catch (e) {
		console.error(`outcomes: ${e.message}`);
		process.exit(2);
	}
}

function originSlug(dir) {
	try {
		return git(dir, ["remote", "get-url", "origin"]).trim().replace(/\.git$/, "").split(/[/:]/).slice(-2).join("/");
	} catch {
		return null;
	}
}

if (isMain(import.meta.url)) await main();
