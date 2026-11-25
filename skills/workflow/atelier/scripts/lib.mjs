// lib.mjs — shared helpers for the atelier scripts: argv parsing, sibling-skill resolution, CLI guard.

import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function parseArgs(argv) {
	const out = { _: [] };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (!a.startsWith("--")) {
			out._.push(a);
			continue;
		}
		const key = a.slice(2);
		const next = argv[i + 1];
		if (next === undefined || next.startsWith("--")) out[key] = true;
		else {
			out[key] = next;
			i++;
		}
	}
	return out;
}

// A sibling skill's directory: an explicit env override, then the same checkout
// (skills/<category>/<name>), then the installed copy under ~/.claude/skills.
// The script's own path is realpath-resolved first, so a symlinked install
// (~/.claude/skills/atelier → repo) still finds the repo sibling.
export function skillDir(name, category, envVar) {
	const here = dirname(realpathSync(fileURLToPath(import.meta.url)));
	const candidates = [
		process.env[envVar],
		join(here, "..", "..", "..", category, name),
		join(homedir(), ".claude", "skills", name),
	].filter(Boolean);
	const hit = candidates.find((d) => existsSync(join(d, "SKILL.md")));
	if (!hit) throw new Error(`cannot find the ${name} skill (set ${envVar}, tried ${candidates.join(", ")})`);
	return hit;
}

// True when `metaUrl` is the module node was asked to run, through any symlink chain.
export function isMain(metaUrl) {
	if (!process.argv[1]) return false;
	try {
		return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(metaUrl));
	} catch {
		return false;
	}
}

export function makeTester(label) {
	let pass = 0;
	let fail = 0;
	return {
		t(name, ok, detail = "") {
			if (ok) pass++;
			else {
				fail++;
				console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
			}
		},
		done() {
			console.log(`${label} self-test: ${pass} passed, ${fail} failed`);
			return fail === 0 ? 0 : 1;
		},
	};
}

// ─────────────── Build hand-back: companions that did not run ───────────────

// Each companion atelier requires of a Build, and the words aw's `Degraded:` line uses for it.
const COMPANION_ALIASES = {
	"review-loop": /\b(review-loop|branch-reviewer|pr-reviewer|local review|review)\b/i,
	"create-pr": /\bcreate-pr\b/i,
	"quality-pass": /\b(quality[ -]pass|fit|reuse|ux|polish)\b/i,
	"aw-verify": /\b(aw-verify|ui-verify|aw-tester)\b/i,
};

// The companions a Build must have run: every tier opens its PR through create-pr, whose local
// review-loop reviews it; Lite and Full add the quality pass, and aw-verify on a user-visible diff.
export function requiredCompanions({ uiDiff = false, tier = "Full" } = {}) {
	const out = ["review-loop", "create-pr"];
	if (tier !== "Micro") out.push("quality-pass");
	if (uiDiff && tier !== "Micro") out.push("aw-verify");
	return out;
}

// aw's hand-back: the tier and the `Degraded:` items, from the block or the one-line Micro/Lite form.
// `skipped` names each required-able companion an item mentions; other items (lorekit, docs) are kept in `items`.
export function parseDegraded(text) {
	const s = String(text ?? "");
	const at = s.lastIndexOf("AW RUN COMPLETE");
	const tail = at >= 0 ? s.slice(at) : s;
	const tier = tail.match(/\b(Micro|Lite|Full)\b/)?.[1] ?? null;
	const m = tail.match(/Degraded:\s*(.*?)(?:,\s*Needs you:|\n|$)/);
	if (!m) return { found: false, tier, none: false, items: [], skipped: [] };
	const value = m[1].trim().replace(/^\[|\]$/g, "");
	if (/^"?none"?\.?$/i.test(value) || value === "") return { found: true, tier, none: true, items: [], skipped: [] };
	// Split on `;` and on commas outside parentheses: `review-loop skipped (budget, time), create-pr skipped`.
	const items = [];
	let depth = 0;
	let cur = "";
	for (const c of value) {
		if (c === "(") depth++;
		if (c === ")") depth = Math.max(0, depth - 1);
		if ((c === ";" || c === ",") && depth === 0) {
			if (cur.trim()) items.push(cur.trim());
			cur = "";
		} else cur += c;
	}
	if (cur.trim()) items.push(cur.trim());
	const skipped = Object.keys(COMPANION_ALIASES).filter((name) => items.some((i) => COMPANION_ALIASES[name].test(i.replace(/\(.*?\)/g, ""))));
	return { found: true, tier, none: false, items, skipped };
}

// The Build decision for companions: `hold` with `skipped: <names>` when a required one did not run
// and the user did not accept that skip (`--accept-skip <name>[,<name>]`); `proceed` otherwise.
// No `Degraded:` line at all is a hold too: a hand-back that hides what ran proves nothing ran.
export function companionDecision(text, { uiDiff = false, accept = [] } = {}) {
	const d = parseDegraded(text);
	const required = requiredCompanions({ uiDiff, tier: d.tier ?? "Full" });
	if (!d.found) return { decision: "hold", reason: "skipped: unknown — no Degraded: line in aw's hand-back", missing: required, accepted: [] };
	const missing = d.skipped.filter((n) => required.includes(n));
	const accepted = missing.filter((n) => accept.includes(n));
	const open = missing.filter((n) => !accept.includes(n));
	if (open.length) return { decision: "hold", reason: `skipped: ${open.join(", ")}`, missing: open, accepted };
	return { decision: "proceed", reason: accepted.length ? `accepted skip: ${accepted.join(", ")} (user)` : "", missing: [], accepted };
}
