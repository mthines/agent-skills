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
