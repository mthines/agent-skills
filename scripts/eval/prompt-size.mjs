#!/usr/bin/env node
// @ts-check
/**
 * prompt-size.mjs — honest prompt-size measurement, invariant to line-wrapping.
 *
 * Why this exists (plan D1): #205's AC-15 line-reduction number rewarded UNWRAPPING
 * `agents/pr-reviewer.md` (fewer, longer lines) rather than removing real content — the file was
 * already 2,990 lines of mostly-unwrapped prose at that point, so a line-count delta measured the
 * wrapping style, not the prompt. `measure()` reports raw bytes, whitespace-NORMALIZED bytes
 * (every run of whitespace — spaces, tabs, newlines — collapsed to one space, matching
 * `tr -s '[:space:]' ' '`), words, and an approximate token count (`normalized_bytes / 4`, the
 * documented rule-of-thumb approximation — never presented as the real tokenizer output, which
 * needs an API key and is not reproducible in CI).
 *
 * Re-wrapping text (splitting or joining lines with no content change) changes `raw_bytes` (the
 * newline count differs) but must change `normalized_bytes` by exactly 0 — that invariant is what
 * makes normalized bytes the honest metric, and `--self-test` proves it directly.
 */

import { readFileSync } from "node:fs";

/**
 * @param {string} text
 * @returns {{ raw_bytes: number, normalized_bytes: number, words: number, approx_tokens: number }}
 */
export function measure(text) {
  const s = String(text);
  const raw_bytes = Buffer.byteLength(s, "utf8");
  const normalized = s.replace(/\s+/g, " ");
  const normalized_bytes = Buffer.byteLength(normalized, "utf8");
  const trimmed = normalized.trim();
  const words = trimmed === "" ? 0 : trimmed.split(" ").length;
  const approx_tokens = Math.round(normalized_bytes / 4);
  return { raw_bytes, normalized_bytes, words, approx_tokens };
}

/**
 * @param {string} base
 * @param {string} next
 */
export function compare(base, next) {
  const b = measure(base);
  const n = measure(next);
  /** @param {number} num @param {number} den */
  const pct = (num, den) => (den === 0 ? 0 : Math.round((num / den) * 1000) / 10);
  return {
    base: b,
    next: n,
    raw_bytes_pct: pct(n.raw_bytes, b.raw_bytes),
    normalized_bytes_pct: pct(n.normalized_bytes, b.normalized_bytes),
    approx_tokens_pct: pct(n.approx_tokens, b.approx_tokens),
  };
}

/** @param {string} path */
function readArg(path) {
  return path === "-" ? readFileSync(0, "utf8") : readFileSync(path, "utf8");
}

function selfTest() {
  /** @type {{name: string, pass: boolean}[]} */
  const cases = [];
  /** @param {string} name @param {unknown} cond */
  const check = (name, cond) => cases.push({ name, pass: !!cond });

  // Re-wrapping (breaking one long line into several, or joining several into one) with no
  // content change must leave normalized_bytes UNCHANGED — that is the whole point of the metric.
  const oneLine = "The quick brown fox jumps over the lazy dog and keeps on running forever.";
  const reWrapped = "The quick brown fox jumps\n  over the lazy dog and keeps\n  on running forever.";
  const mOne = measure(oneLine);
  const mWrapped = measure(reWrapped);
  check(
    "re-wrapping changes normalized_bytes by 0",
    mWrapped.normalized_bytes === mOne.normalized_bytes,
  );
  check("re-wrapping DOES change raw_bytes (newlines added)", mWrapped.raw_bytes !== mOne.raw_bytes);

  // Unwrapping a long paragraph into one line is the exact AC-15 failure mode — must also be a
  // no-op on normalized_bytes.
  const wrapped3 = "one two three\nfour five six\nseven eight nine";
  const unwrapped3 = "one two three four five six seven eight nine";
  check(
    "unwrapping changes normalized_bytes by 0",
    measure(wrapped3).normalized_bytes === measure(unwrapped3).normalized_bytes,
  );

  // Empty input.
  check("empty input measures to zero words", measure("").words === 0);
  check("empty input measures to zero approx_tokens", measure("").approx_tokens === 0);

  // approx_tokens is normalized_bytes / 4, rounded.
  check("approx_tokens = round(normalized_bytes / 4)", measure("abcdefgh").approx_tokens === 2);

  // compare() reports a percentage of base, and real content removal DOES move normalized_bytes.
  const cmp = compare("aaaa bbbb cccc dddd", "aaaa bbbb");
  check("compare() reports next as a % of base", cmp.normalized_bytes_pct < 100 && cmp.normalized_bytes_pct > 0);

  const failed = cases.filter((c) => !c.pass);
  for (const c of cases) process.stdout.write(`${c.pass ? "ok" : "FAIL"} - ${c.name}\n`);
  return failed.length === 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) {
    const ok = selfTest();
    process.stdout.write(ok ? "prompt-size.mjs --self-test: OK\n" : "prompt-size.mjs --self-test: FAILED\n");
    process.exit(ok ? 0 : 1);
  }

  let comparePath = null;
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--compare") comparePath = argv[++i];
    else positional.push(argv[i]);
  }

  if (comparePath) {
    const basePath = comparePath;
    const targetPath = positional[0];
    if (!targetPath) {
      process.stderr.write("usage: prompt-size.mjs <file|-> --compare <base-file|->\n");
      process.exit(2);
    }
    const result = compare(readArg(basePath), readArg(targetPath));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(0);
  }

  const targetPath = positional[0];
  if (!targetPath) {
    process.stderr.write("usage: prompt-size.mjs <file|-> [--compare <base-file|->] | --self-test\n");
    process.exit(2);
  }
  const result = measure(readArg(targetPath));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(0);
}
