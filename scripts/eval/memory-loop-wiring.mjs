#!/usr/bin/env node
/**
 * memory-loop-wiring.mjs — is the self-improvement loop actually WIRED?
 *
 * The claim this repo makes about LoreKit is a CHAIN: a reviewer resolves a thread on
 * GitHub, a workflow classifies the outcome, a record lands in LoreKit, and the NEXT
 * review's documented read finds it and is better for it. Every link of that chain is
 * described in prose across five files, and until this runner none of them was tested.
 *
 * That matters more than it sounds, because **every way the chain can break is silent**.
 * A renamed tag, a scope written with different casing, a workflow input the caller
 * template stopped passing, an env var spelled one way in the workflow and another in
 * the script — each one leaves every write succeeding and every read returning nothing.
 * There is no error anywhere. The loop simply stops learning, and the only symptom is
 * an agent that never gets better, which is indistinguishable from an agent that has
 * nothing left to learn.
 *
 * Three parts, all deterministic — no model, no network, no API key, no LoreKit:
 *
 *   Part A — TRANSPORT. Four hops from a replayed webhook payload to a `process.env`
 *            read, each derived from the live file that owns it:
 *              github.event.<path>            (caller template expression)
 *                → inputs.<name>              (reusable workflow input)
 *                → <ENV_NAME>                 (workflow env block)
 *                → process.env.<ENV_NAME>     (recorder script)
 *
 *   Part B — RECORD. The real decision tables and the real record builder, imported
 *            from `scripts/record-comment-relevance.mjs` (never re-implemented), driven
 *            by the fixtures — then the produced record's scope / tag / key / kind /
 *            host / TTL checked against what the READ path asks for, extracted from
 *            `agents/pr-reviewer.md` Step 1.0 and `memory-buckets.md`.
 *
 *   Part C — SELF-TEST (`--self-test`). Mutation probes: each Part B check is fed a
 *            deliberately broken record and must go red. A check that cannot fail is
 *            not a check, and this whole runner exists because of contracts that were
 *            "guarded" in prose alone.
 *
 * ── What this does NOT prove ──────────────────────────────────────────────────────
 *
 * Say it plainly, because a wiring eval that overclaims is worse than none:
 *
 *   - It does not prove GitHub DELIVERS the webhook, that the caller's `if:` conditions
 *     match a real event, or that the runner has the secret. Those need a live repo.
 *   - It does not prove LoreKit STORES what was written or returns it on the next read.
 *     `lorekitWrite` is the IO boundary and is deliberately not crossed here.
 *   - It does not prove the read makes the reviewer BETTER. That is efficacy, measured
 *     by the paired runner, not by this one. Wiring is necessary, never sufficient.
 *   - **The `lorekit-setup` skill is EXTERNAL to this repository** (it ships with the
 *     LoreKit CLI). This runner can only assert agent-skills' half of the contract —
 *     the bucket names, tags, and scopes this repo writes and reads. That the setup
 *     skill scaffolds a matching config is an owed obligation on the LoreKit side, and
 *     is reported below as a NOTE rather than faked as a passing check.
 *
 * Usage:
 *   node scripts/eval/memory-loop-wiring.mjs            # run the chain checks
 *   node scripts/eval/memory-loop-wiring.mjs --self-test # prove the checks bite
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, Suite } from "./lib.mjs";
import {
  decideResolvedThread,
  decideMergeSweep,
  decideDeployRegression,
  buildRelevanceRecord,
  resolveFingerprint,
} from "../record-comment-relevance.mjs";
import { parseFingerprint, isFingerprintV2 } from "../../agents/pr-reviewer/scripts/fingerprint.mjs";

// ── The five live files this runner derives its expectations from ────────────────
//
// Derived, never mirrored. Re-encoding "the tag is loop::reviewer-comment-relevance"
// here would make this runner a second place the string lives, and a rename would then
// have to land in two files to go green — which is the drift it is supposed to catch.

const CALLER_TEMPLATE = "plugins/pr-relevance-memory/templates/pr-relevance-caller.yml";
const REUSABLE_WORKFLOW = ".github/workflows/reviewer-comment-relevance.yml";
const RECORDER = "scripts/record-comment-relevance.mjs";
const READER = "agents/pr-reviewer.md";
const BUCKETS = "agents/shared/rules/memory-buckets.md";
const KEY_FORMAT = "agents/shared/rules/comment-relevance-memory.md";

const FIXTURE_DIR = "scripts/eval/fixtures/memory-loop";

/** A fixed clock so `expires` is a value a fixture can be checked against. */
const FROZEN_NOW = Date.parse("2026-09-08T12:00:00.000Z");

const read = (p) => readFileSync(join(REPO_ROOT, p), "utf8");

// ── Parsers over the live files ──────────────────────────────────────────────────

/**
 * The caller template's jobs: `{ mode, inputs: { name: expression } }`.
 *
 * A hand-rolled parse rather than a YAML dependency — the harness is dependency-free by
 * construction, and the shape needed here is one `with:` block per job. It is strict on
 * purpose: an unrecognised job shape yields no inputs, so Part A reports a missing hop
 * rather than silently checking nothing.
 */
export function parseCallerJobs(yaml) {
  const jobs = [];
  const lines = yaml.split("\n");
  let cur = null;
  let inWith = false;
  for (const line of lines) {
    const job = /^ {2}([a-z][\w-]*):\s*$/.exec(line);
    if (job) {
      if (cur) jobs.push(cur);
      cur = { job: job[1], mode: null, inputs: {} };
      inWith = false;
      continue;
    }
    if (!cur) continue;
    if (/^ {4}with:\s*$/.test(line)) { inWith = true; continue; }
    if (/^ {4}\S/.test(line)) { inWith = false; }
    if (!inWith) continue;
    const kv = /^ {6}([a-z_][\w]*):\s*(.+?)\s*$/.exec(line);
    if (!kv) continue;
    if (kv[1] === "mode") cur.mode = kv[2];
    else cur.inputs[kv[1]] = kv[2];
  }
  if (cur) jobs.push(cur);
  return jobs.filter((j) => j.mode);
}

/** The reusable workflow's declared inputs: `{ name: { required } }`. */
export function parseWorkflowInputs(yaml) {
  const block = yaml.slice(yaml.indexOf("    inputs:"), yaml.indexOf("    secrets:"));
  const out = {};
  let name = null;
  for (const line of block.split("\n")) {
    const decl = /^ {6}([a-z_][\w]*):\s*$/.exec(line);
    if (decl) { name = decl[1]; out[name] = { required: false }; continue; }
    if (name && /^ {8}required:\s*true\s*$/.test(line)) out[name].required = true;
  }
  return out;
}

/** The workflow's env block: `{ ENV_NAME: inputName }`. */
/**
 * The workflow's env block as `{ENV_NAME: {source, ref}}`.
 *
 * Captures EVERY env key, not only the `inputs.`-derived ones. An earlier version
 * matched `inputs.` alone, which silently exempted `GH_REPO`, `GITHUB_TOKEN` and
 * `LOREKIT_API_KEY` — three of fourteen vars, all read via `process.env` in the
 * recorder — from hop 4, so renaming one on either side left the whole runner green.
 * Hop 3 filters back down to `source === "inputs"`; hop 4 wants all of them.
 */
export function parseWorkflowEnv(yaml) {
  const out = {};
  const re = /^\s+([A-Z][A-Z0-9_]*):\s*\$\{\{\s*([a-z]+)\.([a-zA-Z_][\w]*)\s*\}\}\s*$/gm;
  let m;
  while ((m = re.exec(yaml))) out[m[1]] = { source: m[2], ref: m[3] };
  return out;
}

/** Just the env vars fed from a workflow input: `{ENV_NAME: inputName}`. */
export function inputBackedEnv(workflowEnv) {
  return Object.fromEntries(
    Object.entries(workflowEnv)
      .filter(([, v]) => v.source === "inputs")
      .map(([k, v]) => [k, v.ref]),
  );
}

/** Every `process.env.X` the recorder reads. */
/**
 * Env vars the workflow forwards to the recorder as CLI flags: `{ENV_NAME: "flag"}`.
 *
 * Scoped to lines that invoke the recorder, so an unrelated `echo "$MODE"` elsewhere in
 * the `run:` block cannot be read as the value reaching the script.
 */
export function parseArgvForwards(yaml, recorderPath) {
  const out = {};
  for (const line of yaml.split("\n")) {
    if (!line.includes(recorderPath)) continue;
    const re = /--([a-z][\w-]*)=["']?\$\{?([A-Z][A-Z0-9_]*)\}?["']?/g;
    let m;
    while ((m = re.exec(line))) out[m[2]] = m[1];
  }
  return out;
}

/** Long flags the recorder parses off `process.argv`, as a set of bare names. */
export function parseScriptFlagReads(src) {
  const out = new Set();
  const re = /["'`]--([a-z][\w-]*)=?["'`]/g;
  let m;
  while ((m = re.exec(src))) out.add(m[1]);
  return out;
}

export function parseScriptEnvReads(src) {
  const out = new Set();
  const re = /process\.env\.([A-Z][A-Z0-9_]*)/g;
  let m;
  while ((m = re.exec(src))) out.add(m[1]);
  return out;
}

/**
 * Evaluate a GitHub Actions expression of the form `${{ github.event.a.b[0].c }}`
 * against a replayed webhook payload. Returns `undefined` for a path that does not
 * resolve — which is the whole point: a caller expression naming a field the real event
 * shape does not carry passes YAML lint and delivers an empty string at runtime.
 */
export function evalGithubExpr(expr, payload) {
  const m = /^\$\{\{\s*(.+?)\s*\}\}$/.exec(String(expr).trim());
  if (!m) return undefined;
  const path = m[1];
  if (!path.startsWith("github.event.")) return undefined;
  let node = payload;
  for (const tok of path.slice("github.event.".length).split(".")) {
    const idx = /^([\w-]+)((?:\[\d+\])*)$/.exec(tok);
    if (!idx || node == null) return undefined;
    node = node[idx[1]];
    for (const b of idx[2].matchAll(/\[(\d+)\]/g)) {
      if (node == null) return undefined;
      node = node[Number(b[1])];
    }
  }
  return node;
}

/**
 * The scope + tag pairs `pr-reviewer` Step 1.0 actually asks LoreKit for, read off the
 * agent body's own read block. This is the READ side of the seam; everything Part B
 * asserts about a written record is asserted against these.
 */
export function parseReadCalls(agentBody) {
  const out = [];
  const re = /mcp__lorekit__memory_list:\s*scope="([^"]+)"\s*tags=\[([^\]]+)\]/g;
  let m;
  while ((m = re.exec(agentBody))) {
    out.push({
      scope: m[1],
      tags: [...m[2].matchAll(/"([^"]+)"/g)].map((t) => t[1]),
    });
  }
  return out;
}

/** The `kind` / `host` the bucket doc declares for a tag, from its inference table. */
export function parseKindHost(bucketsDoc, tag) {
  const re = new RegExp(`^\\|\\s*\`${tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\`\\s*\\|\\s*\`([^\`]+)\`\\s*\\|\\s*\`([^\`]+)\`\\s*\\|`, "m");
  const m = re.exec(bucketsDoc);
  return m ? { kind: m[1], host: m[2] } : null;
}

/** The declared lifetime in days for a bucket row (`durable 60d`). */
export function parseLifetimeDays(bucketsDoc, bucket) {
  const row = bucketsDoc.split("\n").find((l) => l.startsWith(`| \`${bucket}\` |`));
  const m = row && /\b(?:durable|volatile)\s+(\d+)d\b/.exec(row);
  return m ? Number(m[1]) : null;
}

/**
 * Turn a documented key template into a matcher.
 *
 * `reviewer-comment-relevance::rule::<finder>:<defect-class>:<symbol>@<path>` becomes a
 * regex whose literal parts are pinned and whose `<placeholders>` are one segment each.
 * Deriving the matcher from the template means a template edit re-aims the check rather
 * than leaving it asserting the old shape.
 */
export function keyTemplateToRe(template) {
  const src = template
    .split(/(<[^>]+>)/)
    .map((part) => (part.startsWith("<") ? "[^:@]+" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("");
  return new RegExp(`^${src}$`);
}

/** The two key templates the key-format doc publishes, in fenced `text` blocks. */
export function parseKeyTemplates(doc) {
  const lines = doc.split("\n").map((l) => l.trim());
  const v2 = lines.find((l) => l.startsWith("reviewer-comment-relevance::rule::<"));
  const v1 = lines.find((l) => /^reviewer-comment-relevance::<[a-z-]+>:<[a-z-]+>$/.test(l));
  return { v2, v1 };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────────

export function loadFixtures() {
  const dir = join(REPO_ROOT, FIXTURE_DIR);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({ file: `${FIXTURE_DIR}/${f}`, ...JSON.parse(readFileSync(join(dir, f), "utf8")) }));
}

/**
 * Run one fixture through the REAL decision table for its mode, and — when the decision
 * writes — the REAL record builder. Returns `{ verdict, record }`; `record` is null for
 * a documented refusal and for `deploy-regression` (whose two outcomes are a hotspot and
 * a rule amplification, not a relevance record).
 *
 * The argument assembly below mirrors the mode handlers in the recorder. It is NOT the
 * production path — the production path interleaves the same assembly with the GitHub
 * API calls the `replayed` block stands in for — and this runner would not catch a
 * handler that stopped passing one of these arguments. What it does catch is the
 * decision itself, and everything downstream of it.
 */
export function runFixture(fx, now = FROZEN_NOW) {
  const r = fx.replayed ?? {};
  if (fx.mode === "deploy-regression") {
    return { verdict: decideDeployRegression(r), record: null };
  }

  const comment = fx.mode === "pr-merged"
    ? r.rootComment
    : fx.payload?.thread?.comments?.[0];
  const fpInfo = resolveFingerprint(comment?.body ?? "", comment?.user?.login, comment?.user?.type);

  const verdict = fx.mode === "pr-merged"
    ? decideMergeSweep({
      thread: r.thread, replies: r.replies, thumbsDownBy: r.thumbsDownBy,
      commentPath: comment?.path, commentLine: comment?.line, touch: r.touch,
    })
    : decideResolvedThread({
      thumbsDownBy: r.thumbsDownBy, replies: r.replies, thread: r.thread,
      regionTouched: r.regionTouched, commentPath: comment?.path, commentLine: comment?.line,
    });

  if (verdict.skip) return { verdict, record: null, fpInfo };

  const record = buildRelevanceRecord({
    repo: fx.repo,
    fpInfo,
    relevance: verdict.relevance,
    resolutionMethod: verdict.resolutionMethod,
    reason: verdict.reason,
    commentId: comment?.id,
    prNumber: fx.payload?.pull_request?.number,
    signal: fx.mode === "pr-merged" ? "pr-merged-sweep" : "thread-resolved",
    now,
  });
  return { verdict, record, fpInfo, comment };
}

// ── The contract, read off the live files ────────────────────────────────────────

export function loadContract() {
  const readCalls = parseReadCalls(read(READER));
  const relevanceReads = readCalls.filter((c) => c.tags.includes("loop::reviewer-comment-relevance"));
  const buckets = read(BUCKETS);
  return {
    readCalls,
    relevanceReads,
    readTags: [...new Set(relevanceReads.flatMap((c) => c.tags))],
    readScopes: relevanceReads.map((c) => c.scope),
    kindHost: parseKindHost(buckets, "loop::reviewer-comment-relevance"),
    lifetimeDays: parseLifetimeDays(buckets, "reviewer-comment-relevance"),
    keyTemplates: parseKeyTemplates(read(KEY_FORMAT)),
    callerJobs: parseCallerJobs(read(CALLER_TEMPLATE)),
    workflowInputs: parseWorkflowInputs(read(REUSABLE_WORKFLOW)),
    workflowEnv: parseWorkflowEnv(read(REUSABLE_WORKFLOW)),
    scriptEnvReads: parseScriptEnvReads(read(RECORDER)),
    scriptFlagReads: parseScriptFlagReads(read(RECORDER)),
    argvForwards: parseArgvForwards(read(REUSABLE_WORKFLOW), RECORDER),
  };
}

/**
 * Every Part B assertion about ONE record, as data.
 *
 * A list rather than inline `s.check` calls so `--self-test` can run the same predicates
 * against a mutated record and require each to go red. That is the only way to know a
 * check bites, and this runner would be pointless if its own checks were decorative.
 */
export function recordChecks(record, ctx, c) {
  const keyRe = keyTemplateToRe(record.value.promotable ? c.keyTemplates.v2 : c.keyTemplates.v1);
  const fpFromKey = record.value.promotable
    ? record.key.slice("reviewer-comment-relevance::rule::".length)
    : null;
  const coordinates = [String(ctx.prNumber ?? ""), String(ctx.commentId ?? "")].filter((v) => v.length > 0);
  return [
    ["tag is one the read asks for",
      record.tags.some((t) => c.readTags.includes(t)),
      `wrote ${JSON.stringify(record.tags)}; read asks for ${JSON.stringify(c.readTags)}`],

    ["scope matches a scope template the read asks for",
      c.readScopes.some((tpl) => scopeMatches(tpl, record.scope, ctx.repo)),
      `wrote "${record.scope}"; read asks for ${JSON.stringify(c.readScopes)}`],

    ["scope is lowercased, as the read derives it",
      record.scope === record.scope.toLowerCase(),
      `wrote "${record.scope}"`],

    ["key matches the published key template",
      keyRe.test(record.key),
      `key "${record.key}" vs /${keyRe.source}/`],

    // Matched as a whole numeric TOKEN, never a bare substring, and with no
    // minimum length. A length floor is the tempting guard against `#7` matching
    // any key that happens to contain a 7 — but it silently exempts every PR
    // number below the floor, which is most PRs in most repos, so the check stops
    // being able to fail for the common case. Tokenizing gives the same protection
    // without the exemption: `…@path-pr182` tokenizes to `182` and is caught,
    // `…@scripts/eval/l2.mjs` yields `2` and is not. A path like `src/v182/x.ts`
    // would false-positive — loud and fixable, unlike the silent pass the floor bought.
    ["key encodes no coordinate (pr / comment id)",
      !coordinates.some((v) => keyNumericTokens(record.key).has(v)),
      `key "${record.key}" encodes one of ${JSON.stringify(coordinates)}`],

    ["a promotable key carries a fingerprint that round-trips",
      !record.value.promotable || (isFingerprintV2(fpFromKey) && parseFingerprint(fpFromKey)?.finder === parseFingerprint(record.value.fingerprint)?.finder),
      `key fp "${fpFromKey}" vs record fp "${record.value.fingerprint}"`],

    ["a non-promotable record is v1 and stays out of the rule space",
      record.value.promotable || (record.value.fp_v === 1 && !record.key.includes("::rule::")),
      `fp_v ${record.value.fp_v}, key "${record.key}"`],

    ["kind matches what the bucket doc declares",
      record.kind === c.kindHost?.kind,
      `wrote "${record.kind}"; doc declares "${c.kindHost?.kind}"`],

    ["host matches what the bucket doc declares",
      record.host === c.kindHost?.host,
      `wrote "${record.host}"; doc declares "${c.kindHost?.host}"`],

    ["ttl matches the declared lifetime",
      record.ttlMs === c.lifetimeDays * 24 * 60 * 60 * 1000,
      `wrote ${record.ttlMs}ms; doc declares ${c.lifetimeDays}d`],

    ["expires is now + the declared lifetime",
      Date.parse(record.value.expires) === ctx.now + c.lifetimeDays * 24 * 60 * 60 * 1000,
      `expires ${record.value.expires}`],

    ["direction follows relevance",
      record.value.direction === (record.value.relevance === "relevant" ? "amplify" : "suppress"),
      `${record.value.relevance} → ${record.value.direction}`],

    ["status is written as a candidate, never latched active",
      record.value.status === "candidate",
      `status "${record.value.status}"`],

    ["the coordinates live in examples, where the doc puts them",
      coordinates.every((v) => JSON.stringify(record.value.examples).includes(v)),
      `examples ${JSON.stringify(record.value.examples)}`],
  ];
}

/** The maximal digit runs in a key, as a set — the granularity the coordinate check compares at. */
export function keyNumericTokens(key) {
  return new Set(String(key).match(/\d+/g) ?? []);
}

/** Does a written scope satisfy a read-side scope template (`repo::{owner}/{repo}` | `global`)? */
function scopeMatches(template, scope, repo) {
  if (template === "global") return scope === "global";
  const filled = template.replace("{owner}/{repo}", String(repo).toLowerCase());
  return filled === scope;
}

// ── Part A — transport ───────────────────────────────────────────────────────────

function partA(s, c, fixtures) {
  const byMode = new Map(c.callerJobs.map((j) => [j.mode, j]));

  s.check("A0 the caller template declares at least one job", c.callerJobs.length > 0);
  s.check("A0 the workflow declares an env block", Object.keys(c.workflowEnv).length > 0);

  // Hop 1 — the caller's expression resolves against a real replayed webhook payload.
  for (const fx of fixtures) {
    if (!fx.payload) continue;
    const job = byMode.get(fx.mode);
    if (!job) {
      s.check(`A1 ${fx.id}: caller template has a job for mode "${fx.mode}"`, false,
        `modes present: ${[...byMode.keys()].join(", ")}`);
      continue;
    }
    for (const [input, expr] of Object.entries(job.inputs)) {
      const value = evalGithubExpr(expr, fx.payload);
      s.check(`A1 ${fx.id}: ${input} resolves from the event payload`,
        value !== undefined && value !== null && String(value).length > 0,
        `${expr} → ${JSON.stringify(value)}`);
    }
  }

  // Hop 2 — every input the caller passes is one the workflow declares.
  for (const job of c.callerJobs) {
    for (const input of Object.keys(job.inputs)) {
      s.check(`A2 caller job "${job.job}" passes a declared input: ${input}`,
        Object.hasOwn(c.workflowInputs, input),
        `declared: ${Object.keys(c.workflowInputs).join(", ")}`);
    }
    // …and every REQUIRED input is one the caller passes. `mode` is passed as a literal
    // and parsed out separately, so it is added back here.
    const passed = new Set([...Object.keys(job.inputs), "mode"]);
    for (const [name, spec] of Object.entries(c.workflowInputs)) {
      if (!spec.required) continue;
      s.check(`A2 caller job "${job.job}" passes required input: ${name}`, passed.has(name));
    }
  }

  // Hop 3 — every declared input reaches an env var, and every env var names a
  // declared input. A workflow that declares an input it never forwards is a hop that
  // ends in silence; an env var built from an undeclared input is always empty.
  // Scoped to the input-backed env vars: `GH_REPO`, `GITHUB_TOKEN` and `LOREKIT_API_KEY`
  // come from `github.*` / `secrets.*` and have no input to name, so requiring one of
  // them would be wrong. Hop 4 below covers them.
  const fromInputs = inputBackedEnv(c.workflowEnv);
  const envByInput = new Map(Object.entries(fromInputs).map(([env, input]) => [input, env]));
  for (const name of Object.keys(c.workflowInputs)) {
    s.check(`A3 workflow input "${name}" is forwarded to an env var`, envByInput.has(name));
  }
  for (const [env, input] of Object.entries(fromInputs)) {
    s.check(`A3 env var "${env}" is built from a declared input`, Object.hasOwn(c.workflowInputs, input));
  }

  // Hop 4 — the recorder actually consumes each env var the workflow sets. This is the
  // hop that broke silently in the failure this runner was written for: a rename on
  // either side leaves the value undefined and the mode handler skipping with a benign
  // log.
  //
  // There are TWO legitimate ways a value crosses into the recorder, and demanding only
  // the first would fail a working chain: `process.env.NAME` read inside the script, or
  // the workflow forwarding it on the recorder's own command line (`--flag="$NAME"`),
  // which is how `MODE` travels. The second path is closed to the same standard rather
  // than waived — the flag it forwards to must be one the recorder actually parses, so
  // renaming either half still reds.
  for (const env of Object.keys(c.workflowEnv)) {
    const flag = c.argvForwards[env];
    if (c.scriptEnvReads.has(env)) {
      s.check(`A4 recorder reads env var "${env}"`, true);
    } else if (flag) {
      s.check(`A4 recorder parses "--${flag}", the flag "${env}" is forwarded on`,
        c.scriptFlagReads.has(flag),
        `workflow passes --${flag}="$${env}"; recorder parses ${JSON.stringify([...c.scriptFlagReads])}`);
    } else {
      s.check(`A4 recorder consumes env var "${env}"`, false,
        `neither read as process.env.${env} nor forwarded to the recorder as a flag`);
    }
  }
}

// ── Part B — record ──────────────────────────────────────────────────────────────

function partB(s, c, fixtures) {
  s.check("B0 the reader's Step 1.0 issues a relevance read at all", c.relevanceReads.length > 0,
    `found ${c.readCalls.length} memory_list calls, none tagged loop::reviewer-comment-relevance`);
  s.check("B0 the bucket doc declares a kind/host pair for the tag", !!c.kindHost);
  s.check("B0 the bucket doc declares a lifetime", Number.isFinite(c.lifetimeDays));
  s.check("B0 the key-format doc publishes both key templates",
    !!c.keyTemplates.v2 && !!c.keyTemplates.v1,
    JSON.stringify(c.keyTemplates));

  for (const fx of fixtures) {
    const { verdict, record } = runFixture(fx);

    // The decision itself.
    if (fx.expect.skip) {
      s.check(`B1 ${fx.id}: refuses to write (${fx.expect.skip})`, verdict.skip === fx.expect.skip,
        `got ${JSON.stringify(verdict.skip ?? verdict)}`);
      s.check(`B1 ${fx.id}: a refusal builds no record`, record === null);
      continue;
    }
    if (fx.mode === "deploy-regression") {
      s.check(`B1 ${fx.id}: ${fx.expect.kind}`, verdict.kind === fx.expect.kind && verdict.weight === fx.expect.weight,
        `got ${JSON.stringify(verdict)}`);
      continue;
    }
    s.check(`B1 ${fx.id}: ${fx.expect.relevance}/${fx.expect.resolutionMethod}`,
      verdict.relevance === fx.expect.relevance && verdict.resolutionMethod === fx.expect.resolutionMethod,
      `got ${JSON.stringify({ relevance: verdict.relevance, resolutionMethod: verdict.resolutionMethod })}`);

    if (!record) {
      s.check(`B2 ${fx.id}: a writing decision builds a record`, false);
      continue;
    }
    s.check(`B2 ${fx.id}: promotable === ${fx.expect.promotable}`, record.value.promotable === fx.expect.promotable);
    s.check(`B2 ${fx.id}: direction === ${fx.expect.direction}`, record.value.direction === fx.expect.direction);

    const ctx = {
      repo: fx.repo, now: FROZEN_NOW,
      prNumber: fx.payload?.pull_request?.number,
      commentId: (fx.mode === "pr-merged" ? fx.replayed.rootComment : fx.payload?.thread?.comments?.[0])?.id,
    };
    for (const [label, ok, detail] of recordChecks(record, ctx, c)) {
      s.check(`B3 ${fx.id}: ${label}`, ok, ok ? "" : detail);
    }
  }
}

// ── Part C — the checks must bite ────────────────────────────────────────────────
//
// Each mutation below breaks exactly one thing and names the check that must catch it.
// A mutation that goes unnoticed means the check is decorative — which is precisely the
// state this runner was written to end, so it is a hard failure, not a warning.

const MUTATIONS = [
  ["tag is one the read asks for", (r) => { r.tags = ["loop::reviewer-relevance"]; }],
  ["scope matches a scope template the read asks for", (r) => { r.scope = "project::agent-skills"; }],
  ["scope is lowercased, as the read derives it", (r) => { r.scope = "repo::MThines/Agent-Skills"; }],
  ["key matches the published key template", (r) => { r.key = "relevance::rule::x"; }],
  ["key encodes no coordinate (pr / comment id)", (r, ctx) => { r.key += `-pr${ctx.prNumber}`; }],
  ["a promotable key carries a fingerprint that round-trips", (r) => { r.key = "reviewer-comment-relevance::rule::bogus:thing:sym@path"; }],
  ["kind matches what the bucket doc declares", (r) => { r.kind = "lesson"; }],
  ["host matches what the bucket doc declares", (r) => { r.host = "pr-reviewer"; }],
  ["ttl matches the declared lifetime", (r) => { r.ttlMs = 30 * 24 * 60 * 60 * 1000; }],
  ["expires is now + the declared lifetime", (r) => { r.value.expires = new Date(0).toISOString(); }],
  ["direction follows relevance", (r) => { r.value.direction = "amplify"; r.value.relevance = "not-relevant"; }],
  ["status is written as a candidate, never latched active", (r) => { r.value.status = "active"; }],
  ["the coordinates live in examples, where the doc puts them", (r) => { r.value.examples = []; }],
  ["a non-promotable record is v1 and stays out of the rule space", (r) => { r.value.promotable = false; r.value.fp_v = 2; }],
];

function selfTest() {
  const s = new Suite("memory-loop-wiring --self-test");
  const c = loadContract();
  const fixtures = loadFixtures();

  // A record that passes everything, as the mutation baseline.
  const base = fixtures.find((f) => f.id === "thread-resolved-fixed");
  const { record } = runFixture(base);
  const ctx = {
    repo: base.repo, now: FROZEN_NOW,
    prNumber: base.payload.pull_request.number,
    commentId: base.payload.thread.comments[0].id,
  };
  const clean = recordChecks(record, ctx, c);
  s.check("C0 the baseline record passes every check",
    clean.every(([, ok]) => ok),
    clean.filter(([, ok]) => !ok).map(([l]) => l).join("; "));
  s.check("C0 every check has a mutation probe",
    clean.length === MUTATIONS.length,
    `${clean.length} checks, ${MUTATIONS.length} probes`);

  for (const [target, mutate] of MUTATIONS) {
    const broken = JSON.parse(JSON.stringify(record));
    mutate(broken, ctx);
    const results = recordChecks(broken, ctx, c);
    const hit = results.find(([label]) => label === target);
    s.check(`C1 "${target}" exists as a check`, !!hit);
    s.check(`C1 "${target}" goes red when broken`, hit && hit[1] === false);
  }

  // The parsers are the other place this runner can be silently wrong: a parser that
  // returns nothing makes every loop over it vacuously green.
  s.check("C2 evalGithubExpr resolves an indexed path",
    evalGithubExpr("${{ github.event.thread.comments[0].id }}", { thread: { comments: [{ id: 7 }] } }) === 7);
  s.check("C2 evalGithubExpr returns undefined for a path the event lacks",
    evalGithubExpr("${{ github.event.thread.comments[0].nope }}", { thread: { comments: [{ id: 7 }] } }) === undefined);
  s.check("C2 evalGithubExpr refuses a non-event expression",
    evalGithubExpr("${{ secrets.LOREKIT_API_KEY }}", {}) === undefined);
  s.check("C2 keyTemplateToRe pins the literals",
    keyTemplateToRe("a::<x>:<y>").test("a::one:two") && !keyTemplateToRe("a::<x>:<y>").test("b::one:two"));
  s.check("C2 keyTemplateToRe placeholders do not span segments",
    !keyTemplateToRe("a::<x>").test("a::one:two"));
  // Pins the PREMISE the coordinate mutation probe rests on. That probe appends the
  // baseline fixture's own PR number, so it only rules out a minimum-length floor on
  // the coordinate list while that number is short. Renumber the fixture to four digits
  // and the floor could come back with every probe still green — a guard resting on an
  // unguarded premise, so the premise is asserted here rather than assumed.
  s.check("C2 the baseline PR number is short enough to exercise a length floor",
    String(ctx.prNumber).length <= 3, `pr ${ctx.prNumber}`);

  // Pins TOKENISATION over substring matching, with the one input that tells them
  // apart: a coordinate that is a substring of a longer digit run. `includes("182")`
  // is true here and would flag a clean key; the token set is {"1820"} and does not.
  s.check("C2 keyNumericTokens does not match a coordinate inside a longer digit run",
    !keyNumericTokens("reviewer-comment-relevance::rule::a:b:sym@src/v1820/x.ts").has("182"));
  s.check("C2 keyNumericTokens matches a coordinate that is its own digit run",
    keyNumericTokens("reviewer-comment-relevance::rule::a:b:sym@path-pr182").has("182"));
  s.check("C2 parseCallerJobs finds every job with a mode", c.callerJobs.length >= 3);
  s.check("C2 parseWorkflowInputs finds the required inputs",
    c.workflowInputs.mode?.required === true && c.workflowInputs.pr_number?.required === true);
  s.check("C2 parseScriptEnvReads finds a known read", c.scriptEnvReads.has("GH_REPO"));
  // Pins hop 4's COVERAGE. The parser previously matched `${{ inputs.* }}` alone, so
  // three env vars never reached hop 4 and renaming one left the runner green — a hole
  // no per-var check could reveal, because the vars were absent from the loop entirely.
  s.check("C2 parseWorkflowEnv captures env vars not backed by an input",
    ["GH_REPO", "GITHUB_TOKEN", "LOREKIT_API_KEY"].every((v) => c.workflowEnv[v]?.source !== "inputs" && !!c.workflowEnv[v]),
    `captured: ${JSON.stringify(Object.keys(c.workflowEnv))}`);
  s.check("C2 inputBackedEnv narrows to the input-derived vars for hop 3",
    !!inputBackedEnv(c.workflowEnv).MODE && !("GH_REPO" in inputBackedEnv(c.workflowEnv)));
  s.check("C2 parseArgvForwards finds MODE forwarded as --mode", c.argvForwards.MODE === "mode");
  s.check("C2 parseArgvForwards ignores a forward on a line that is not the recorder's",
    Object.keys(parseArgvForwards('        run: echo --mode="$MODE"\n', RECORDER)).length === 0);
  s.check("C2 parseScriptFlagReads finds the flag the recorder parses", c.scriptFlagReads.has("mode"));
  s.check("C2 parseReadCalls finds the reader's four Step 1.0 calls", c.readCalls.length >= 4);
  s.check("C2 scopeMatches fills the owner/repo placeholder",
    scopeMatches("repo::{owner}/{repo}", "repo::mthines/agent-skills", "MThines/Agent-Skills")
    && !scopeMatches("repo::{owner}/{repo}", "repo::other/repo", "mthines/agent-skills"));

  return s.report();
}

// ── Entry point ──────────────────────────────────────────────────────────────────

function main() {
  if (process.argv.includes("--self-test")) {
    process.exit(selfTest() ? 0 : 1);
  }

  const s = new Suite("memory-loop-wiring");
  const c = loadContract();
  const fixtures = loadFixtures();

  s.check("F0 fixtures are present", fixtures.length > 0, FIXTURE_DIR);
  partA(s, c, fixtures);
  partB(s, c, fixtures);

  const ok = s.report();
  console.log(
    "\nNOTE — scope of this runner. It proves agent-skills' half of the loop: the transport\n" +
    "from a replayed webhook to the recorder's env reads, and that the record the write path\n" +
    "builds is addressed exactly as the read path asks for it. It does NOT prove GitHub\n" +
    "delivers the webhook, that LoreKit stores or returns the record, or that reading it makes\n" +
    "the reviewer better. The `lorekit-setup` skill is external to this repository, so the\n" +
    "claim that it scaffolds a matching config is an owed obligation on the LoreKit side —\n" +
    "not asserted here, and deliberately not faked as a passing check.",
  );
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] && process.argv[1].endsWith("memory-loop-wiring.mjs")) main();
