#!/usr/bin/env node
// shortcut-ledger.mjs — list every deliberate-shortcut marker comment in a repo as a debt ledger.
//
//   node shortcut-ledger.mjs [--marker <word>] [--json]
//   node shortcut-ledger.mjs --self-test
//
// Convention (agents/shared/rules/shortcut-markers.md): the marker word, a colon, the limit,
// a comma, and the trigger to revisit it. A marker with no trigger is tagged `no-trigger`.
// Scans the working directory with `git grep --no-index --exclude-standard`, so .gitignore is
// honoured inside and outside a git repo. Markdown files are skipped (they document the
// convention), and so are JSON files (they hold no comments, only data). Read-only; never edits.
// Text output: one row per marker sorted by file and line, then one summary line.
// Exit 0 on success (an empty ledger included), 2 on a git or usage error.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const COMMENT = "(#|//|/\\*|\\*|--|<!--|;)";
const SKIP_FILE = /\.(md|mdx|markdown|json|jsonl)$/i;
const WHAT_MAX = 80;
const marker = (word) => `${COMMENT} ?${word}:`;

function grep(word, cwd) {
	const r = spawnSync("git", ["-c", "core.quotePath=false", "grep", "--no-index", "--exclude-standard", "-I", "-n", "-E", marker(word)],
		{ cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
	if (r.status === 1) return "";
	if (r.status !== 0) throw new Error(`git grep: ${(r.stderr || "").trim()}`);
	return r.stdout;
}

const clean = (s) => s.replace(/\s*(\*\/|-->)\s*$/, "").trim().replace(/[.\s]+$/, "");

// One grep hit → { file, line, what, ceiling, upgrade }. `lines` reads a file's lines on demand.
export function parseHit(hit, word, lines) {
	const m = hit.match(/^(.*?):(\d+):(.*)$/);
	if (!m) return null;
	const [, file, n, text] = m;
	if (SKIP_FILE.test(file)) return null;
	const at = text.search(new RegExp(marker(word)));
	const body = text.slice(at).replace(new RegExp(`^${marker(word)}`), "");
	// A comma then whitespace separates ceiling from trigger, so "10,000 rows" stays whole.
	const comma = body.search(/,\s/);
	const ceiling = clean(comma < 0 ? body : body.slice(0, comma));
	const upgrade = comma < 0 ? "" : clean(body.slice(comma + 1));
	let what = text.slice(0, at).trim();
	if (!what) {
		// A marker on its own line describes the next line of code.
		const all = lines(file);
		what = all.slice(Number(n)).map((l) => l.trim()).find((l) => l && !new RegExp(`^${COMMENT}`).test(l)) || "(end of file)";
	}
	if (what.length > WHAT_MAX) what = `${what.slice(0, WHAT_MAX - 1)}…`;
	return { file, line: Number(n), what: what.replace(/[.;\s]+$/, ""), ceiling, upgrade };
}

export function render(rows) {
	if (!rows.length) return "No shortcut debt. Clean ledger.";
	const out = rows.map((r) => r.upgrade
		? `${r.file}:${r.line}, ${r.what}. ceiling: ${r.ceiling}. upgrade: ${r.upgrade}.`
		: `${r.file}:${r.line}, ${r.what}. ceiling: ${r.ceiling}. upgrade: none. [no-trigger]`);
	const missing = rows.filter((r) => !r.upgrade).length;
	out.push(`${rows.length} marker${rows.length === 1 ? "" : "s"}, ${missing} with no trigger.`);
	return out.join("\n");
}

export function ledger(cwd, word = "shortcut") {
	const cache = new Map();
	const lines = (f) => {
		if (!cache.has(f)) cache.set(f, readFileSync(join(cwd, f), "utf8").split("\n"));
		return cache.get(f);
	};
	return grep(word, cwd).split("\n").filter(Boolean)
		.map((h) => parseHit(h, word, lines)).filter(Boolean)
		.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

function selfTest() {
	const dir = mkdtempSync(join(tmpdir(), "shortcut-ledger-"));
	const M = "short" + "cut:"; // split so this file never lists itself
	let failed = 0;
	const t = (name, ok, got) => { if (!ok) failed++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)}`}`); };
	try {
		spawnSync("git", ["init", "-q"], { cwd: dir });
		writeFileSync(join(dir, "a.py"), `rows = load_all()  # ${M} whole file in memory, stream it past 50 MB\nn = 1  # ${M} no retry\n`);
		writeFileSync(join(dir, "b.ts"), `// ${M} single process only, move to Redis at 2 replicas\nconst cache = new Map();\n/* ${M} O(n^2) diff, switch to Myers past 10k lines */\nx();\n`);
		writeFileSync(join(dir, "e.ts"), `/**\n * ${M} 10,000 rows in memory, paginate past that\n */\nload();\n`);
		writeFileSync(join(dir, "c.sql"), `SELECT * FROM t; -- ${M} no index, add one past 1M rows\n`);
		writeFileSync(join(dir, "README.md"), `\`# ${M} an example, never\`\n`);
		writeFileSync(join(dir, "golden.jsonl"), `{"diff":"+  # ${M} data, never"}\n`);
		writeFileSync(join(dir, ".gitignore"), "ignored/\n");
		spawnSync("mkdir", ["ignored"], { cwd: dir });
		writeFileSync(join(dir, "ignored", "x.js"), `// ${M} ignored, never\n`);
		writeFileSync(join(dir, "d.go"), "go run() // HACK: one goroutine, pool at 10k jobs\n");
		writeFileSync(join(dir, "keys.js"), `bind("ctrl+s") // keyboard shortcut for save\n`);

		const rows = ledger(dir);
		const out = render(rows).split("\n");
		t("trailing comment: what is the code before it", out[0] === "a.py:1, rows = load_all(). ceiling: whole file in memory. upgrade: stream it past 50 MB.", out[0]);
		t("no comma is a no-trigger row", out[1] === "a.py:2, n = 1. ceiling: no retry. upgrade: none. [no-trigger]", out[1]);
		t("own-line comment: what is the next code line", out[2] === "b.ts:1, const cache = new Map(). ceiling: single process only. upgrade: move to Redis at 2 replicas.", out[2]);
		t("block-comment closer stripped", out[3]?.endsWith("ceiling: O(n^2) diff. upgrade: switch to Myers past 10k lines."), out[3]);
		t("SQL -- comment found", out[4]?.startsWith("c.sql:1, SELECT * FROM t. ceiling: no index"), out[4]);
		t("markdown, JSON, gitignored files, and prose without the marker are skipped", rows.length === 6, rows.map((r) => r.file));
		t("summary line", out.at(-1) === "6 markers, 1 with no trigger.", out.at(-1));
		t("block-comment body line, and a thousands separator stays in the ceiling", out.includes("e.ts:2, load(). ceiling: 10,000 rows in memory. upgrade: paginate past that."), out);
		t("custom marker word", ledger(dir, "HACK").length === 1 && ledger(dir, "keyboard").length === 0, ledger(dir, "HACK"));
		t("empty ledger line", render([]) === "No shortcut debt. Clean ledger.", render([]));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
	console.log(failed ? `${failed} failed` : "all passed");
	process.exit(failed ? 1 : 0);
}

// realpath both sides: /polish debt runs this through the installed skill symlink.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
	const args = process.argv.slice(2);
	if (args.includes("--self-test")) selfTest();
	const i = args.indexOf("--marker");
	const word = i >= 0 ? args[i + 1] : "shortcut";
	if (!word || word.startsWith("-") || !/^[\w-]+$/.test(word)) { console.error("shortcut-ledger: --marker needs a word"); process.exit(2); }
	try {
		const rows = ledger(process.cwd(), word);
		console.log(args.includes("--json") ? JSON.stringify(rows, null, 2) : render(rows));
	} catch (e) {
		console.error(`shortcut-ledger: ${e.message}`);
		process.exit(2);
	}
}
