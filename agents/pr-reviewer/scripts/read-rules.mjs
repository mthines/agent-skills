#!/usr/bin/env node
/**
 * read-rules.mjs — print several `agents/pr-reviewer/rules/<name>.md` files in one tool call, each
 * under a `===== <name>.md =====` header, so a run that needs six rule files spends one turn on them
 * instead of six. Output is the files verbatim; an unknown name exits 2 and prints nothing.
 *
 * usage: read-rules.mjs <name> [<name> …]      (name without `.md`, e.g. gates inline-pipeline)
 *        read-rules.mjs --self-test
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RULES = join(dirname(fileURLToPath(import.meta.url)), "..", "rules");

/** @param {string[]} names @returns {{ ok: true, text: string } | { ok: false, bad: string[] }} */
export function bundle(names) {
  const bad = names.filter((n) => !/^[a-z0-9][a-z0-9-]*$/.test(n) || !existsSync(join(RULES, `${n}.md`)));
  if (bad.length) return { ok: false, bad };
  return { ok: true, text: names.map((n) => `===== ${n}.md =====\n${readFileSync(join(RULES, `${n}.md`), "utf8")}`).join("\n") };
}

const args = process.argv.slice(2);
if (args[0] === "--self-test") {
  let fail = 0;
  const check = (/** @type {string} */ n, /** @type {boolean} */ ok) => { console.log(`${ok ? "ok  " : "FAIL"} ${n}`); if (!ok) fail++; };
  const r = bundle(["gates", "judgments"]);
  check("two rules bundle in order with headers", r.ok && r.text.indexOf("===== gates.md") === 0 && r.text.includes("===== judgments.md ====="));
  const b = bundle(["gates", "../x", "nope-not-a-rule"]);
  check("path tricks and unknown names are rejected", !b.ok && b.bad.length === 2);
  console.log(fail ? `${fail} FAILED` : "all passed");
  process.exit(fail ? 1 : 0);
} else {
  if (!args.length) { console.error("usage: read-rules.mjs <name> [<name> …]"); process.exit(2); }
  const r = bundle(args);
  if (!r.ok) { console.error(`read-rules: unknown rule(s): ${r.bad.join(", ")}`); process.exit(2); }
  process.stdout.write(r.text);
}
