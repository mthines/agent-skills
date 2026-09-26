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
 * pathMeasures — bytes actually LOADED per `pr-reviewer` run path, not just the agent file size
 * (plan feat/pr-reviewer-shrink-fanout-ab, Step 9 split — the delta between "the file is smaller"
 * and "a given run reads fewer bytes"). Models exactly what THIS PR's split changed: whether
 * `rules/posting.md` (Step 4's write-only procedure) is loaded. It does not attempt to model the
 * full pre-existing routing graph (workspace.md, impact-graph.md, finders.md, …) that #205 and
 * earlier work already split out — those are unconditionally read on every path today and are
 * out of scope for this measurement, which is scoped to what Step 9 controls.
 *
 * CORRECTED FINDING (this PR, post-review of the router text): an earlier draft of the Step 4
 * router claimed `--dry-run`, `--isolated`, and `--review-sha` never reach Step 4. That was
 * false — `--dry-run` (which `--review-sha` requires) still builds `REPORT_BODY` /
 * `INLINE_COMMENTS_JSON` and runs every assertion in `rules/posting.md`, only skipping the final
 * `POST`/`PATCH`; `--isolated` alone only changes Step 0.7's prior-state read. So paths (a), (b),
 * and (c) below all load IDENTICAL bytes — every orchestrator-side run loads `rules/posting.md`.
 * The only path that genuinely never loads it is (d): a `--fanout` worker, which G81's preamble
 * forbids from reading `agents/pr-reviewer.md` at all. This is the honest result the delta asked
 * for when it said "if ... a write run still loads ~100%, say so plainly": the real per-run-path
 * win from this split is confined to fan-out workers, not to dry-run/isolated/review-sha.
 *
 * Four paths (mirrors the plan's naming, kept even though (a)/(b)/(c) now collapse to one value):
 *   (a) full write run with a prior state   — agent body + posting.md
 *   (b) first-run write                     — agent body + posting.md (identical to (a); Step 0.7's
 *       prior-state vs first-run branching is prose INSIDE the agent body, not a separate file)
 *   (c) dry-run / --isolated / --review-sha — agent body + posting.md (identical to (a)/(b) — see
 *       "CORRECTED FINDING" above; these flags change what Step 4 DOES, not whether it loads)
 *   (d) fan-out worker role                 — does NOT read agents/pr-reviewer.md at all (the
 *       --fanout worker preamble, G81, forbids it); `agent_bytes` is reported as 0 for this path
 *       on that basis, not measured against a worker prompt this tool has no access to
 *
 * @param {string} agentText
 * @param {string} postingText
 */
export function pathMeasures(agentText, postingText) {
  const agent = measure(agentText);
  const posting = measure(postingText);
  /** @param {ReturnType<typeof measure>[]} ms */
  const sum = (...ms) => ({
    raw_bytes: ms.reduce((a, m) => a + m.raw_bytes, 0),
    normalized_bytes: ms.reduce((a, m) => a + m.normalized_bytes, 0),
    words: ms.reduce((a, m) => a + m.words, 0),
    approx_tokens: ms.reduce((a, m) => a + m.approx_tokens, 0),
  });
  const writeRun = { loads: ["pr-reviewer.md", "rules/posting.md"], ...sum(agent, posting) };
  return {
    agent_only: agent,
    posting_only: posting,
    paths: {
      "a_full_write_prior_state": writeRun,
      "b_first_run_write": writeRun,
      "c_dry_run_isolated_review_sha": {
        ...writeRun,
        note: "corrected: these flags skip Step 4's POST/PATCH, not the Step 4 load — identical bytes to (a)/(b)",
      },
      "d_fanout_worker": {
        loads: [],
        note: "worker preamble (G81) forbids reading agents/pr-reviewer.md — not measured here",
        raw_bytes: 0, normalized_bytes: 0, words: 0, approx_tokens: 0,
      },
    },
  };
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

  // pathMeasures (corrected model): (a)/(b)/(c) ALL load agent+posting — --dry-run/--isolated/
  // --review-sha skip Step 4's POST/PATCH, not the Step 4 load itself. Only (d) loads nothing.
  const pm = pathMeasures("agent body text", "posting body text");
  const aBytes = pm.paths.a_full_write_prior_state.raw_bytes;
  const cBytes = pm.paths.c_dry_run_isolated_review_sha.raw_bytes;
  check("pathMeasures: (a) and (b) load identical bytes (Step 0.7 stays inline this PR)",
    aBytes === pm.paths.b_first_run_write.raw_bytes);
  check("pathMeasures: (c) loads identical bytes to (a)/(b) — dry-run/isolated/review-sha still load posting.md",
    cBytes === aBytes);
  check("pathMeasures: (a)/(b)/(c) all load strictly more than agent_only alone (posting.md IS loaded)",
    aBytes > pm.agent_only.raw_bytes && cBytes > pm.agent_only.raw_bytes);
  check("pathMeasures: (d) fan-out worker measures zero agent-body bytes",
    pm.paths.d_fanout_worker.raw_bytes === 0 && pm.paths.d_fanout_worker.loads.length === 0);

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

  if (argv.includes("--paths")) {
    const rest = argv.filter((a) => a !== "--paths");
    const agentPath = rest[0];
    const postingPath = rest[1];
    if (!agentPath || !postingPath) {
      process.stderr.write("usage: prompt-size.mjs --paths <agent-file> <posting-file>\n");
      process.exit(2);
    }
    const result = pathMeasures(readArg(agentPath), readArg(postingPath));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(0);
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
    process.stderr.write("usage: prompt-size.mjs <file|-> [--compare <base-file|->] | --paths <agent-file> <posting-file> | --self-test\n");
    process.exit(2);
  }
  const result = measure(readArg(targetPath));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(0);
}
