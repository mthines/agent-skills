#!/usr/bin/env node
// @ts-check
// review-telemetry.mjs — per-step telemetry for one pr-reviewer run, exported as an OTLP trace in
// the shape Dash0's AI Coding Insights reads (OpenTelemetry GenAI conventions, plus the
// `dash0.gen_ai.vcs.*` keys the Dash0 agent plugin emits).
//
// WHY A LEDGER. A review is not one process: the model runs a dozen short commands
// (prepare-review.mjs, validate-judgments.mjs, finalize.mjs, …) with its own reasoning in between,
// and that reasoning is where most of the wall clock goes. Each step boundary therefore appends
// one line to `<run-dir>/telemetry.jsonl`; `finish` reads the ledger back and exports ONE trace.
// Gaps nobody marked are exported as `unmarked` steps, so the steps always add up to the run.
//
// THE TRACE (matches https://dash0.com/docs/dash0/darkplane/insights/span-attributes and the
// attribute contract in github.com/dash0hq/dash0-agent-plugin DEVELOPMENT.md):
//
//   invoke_agent pr-reviewer            gen_ai.operation.name=invoke_agent, gen_ai.agent.id=<run id>
//   ├─ pr_review.step prepare           pr_review.step.kind=script
//   ├─ pr_review.step finders           pr_review.step.kind=model
//   ├─ pr_review.step unmarked          a gap between marked steps
//   ├─ pr_review.worker intent          the hybrid intent worker, folded in by `worker intent import`
//   └─ …
//
// Identity and VCS attributes go on EVERY span, as the plugin does: gen_ai.agent.name,
// gen_ai.conversation.id, dash0.gen_ai.vcs.* (repository, owner, PR url, head ref and revision).
//
// THE SCOPE. AI SDLC Insights lists a span as a coding session only under the instrumentation scope
// the Dash0 agent plugin emits (INSIGHTS_SCOPE_NAME). Where no plugin records the session and the
// run IS the session (SESSION_HARNESSES: agent0), the run exports under that scope; everywhere else
// under SCOPE_NAME, because there the plugin already emits `invoke_agent pr-reviewer` and a second
// one under its scope would count every review twice (scopeNameFor).
//
// THE MEMORY. Which LoreKit memories the review used and read rides the root span: counts plus the
// used memories' ids as attributes, and one `pr_review.memory.used` / `pr_review.memory.read` event
// per memory carrying its id, scope, key, LoreKit deep link, and what it did (memoryEvents).
// finalize.mjs records them from judgments.memory as one `memory` ledger record; the last one wins.
//
// THE RUN COUNTER. `pr_review.runs` is what a dashboard counts runs with: a CUMULATIVE sum, one
// series per verdict per run (the resource's service.instance.id is the run's trace id). `finish`
// writes its 0 points backdated across the run and the final 1 in the same export as the trace
// (runCounterPoints), because no process lives for the whole run.
//
// THREE THINGS THIS FILE NEVER EMITS, and why:
//   - no `chat` span and no token counts — the harness owns model usage (the Dash0 agent plugin
//     reads it from the transcript); a script cannot see it, and a guessed number is worse than
//     none. Cost stays where it is measured.
//   - no `execute_tool` span — the plugin already emits one per tool call, so a second copy would
//     double every tool-call count in the Tools & Skills tab.
//   - no `gen_ai.harness.name` inside a harness the plugin covers (claude-code, cursor, codex,
//     github-copilot-cli) unless this run is joined to that harness's session through
//     `gen_ai.conversation.id` (PR_REVIEWER_CONVERSATION_ID) — otherwise every review would appear
//     as a second, zero-cost coding session next to the one the plugin already recorded.
//
// FOUR RULES (inherited from otlp.mjs, self-tested below):
//   1. Export is OPT-IN: PR_REVIEWER_OTLP_ENDPOINT (+ PR_REVIEWER_OTLP_HEADERS), or
//      PR_REVIEWER_TELEMETRY=on to reuse the standard OTEL_EXPORTER_OTLP_ENDPOINT/_HEADERS.
//      A host's own OTEL_* variables are never picked up silently: an Agent0 sandbox sets them for
//      its own process telemetry, and a review trace carries repository names, PR URLs and a git
//      user name that belong in the reviewer's own backend, not the host's.
//      PR_REVIEWER_TELEMETRY=off wins over everything. The ledger and the summary are written
//      either way — the breakdown needs no backend. They are read from the process environment
//      only: on an Agent0 Automation a setup script appends them to $DASH0_AGENT_ENV, and nothing
//      writes them to a file this script reads (rules/run-telemetry.md § On an Agent0 Automation).
//   2. A miss is not an error: a step that finds nothing stays status UNSET.
//   3. An absent attribute is omitted, never a placeholder.
//   4. Telemetry never fails a review: every CLI command exits 0 (a misuse is a stderr warning),
//      and an unreachable backend is `exported: false`, never a throw.
//
// Usage (every command also reads the run dir from PR_REVIEW_RUN_DIR):
//   node review-telemetry.mjs begin  --run-dir <dir> [--repo o/r] [--pr n] [--head sha]
//        [--head-ref branch] [--mode m] [--tier t] [--thoroughness n] [--topology t] [--model id]
//        [--conversation-id id] [--harness name]
//   node review-telemetry.mjs step   <name> --run-dir <dir> [--attr key=value …]
//   node review-telemetry.mjs end    [<name>] --run-dir <dir> [--attr key=value …]
//   node review-telemetry.mjs attr   --run-dir <dir> [--target run|step] --attr key=value …
//   node review-telemetry.mjs worker <unit> start|end --run-dir <dir> [--attr key=value …]
//   node review-telemetry.mjs worker <unit> import --from <worker-dir> [--done <output-file>] --run-dir <dir>
//        [--wait <s>] [--wait-total <s>]   (poll for --done first; see rules/run-telemetry.md § Sub-agents)
//   node review-telemetry.mjs dispatch --run-dir <dir>   (the caller's dispatch time, on a run it prepared)
//   node review-telemetry.mjs finish --run-dir <dir> [--status ok|error] [--message m] [--force]
//   node review-telemetry.mjs summary --run-dir <dir>
//   node review-telemetry.mjs --self-test
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join, resolve as resolvePath } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { OtlpExporter, attrs } from "./otlp.mjs";

export { attrs };

/**
 * A wall-clock timing block builder. Independent of OTLP entirely — this is what every
 * artifact's `timing` field is built from, and it works with NO endpoint configured.
 */
export class Timing {
  constructor() {
    this._start = Date.now();
    /** @type {Record<string, number>} */
    this._phases = {};
    /** @type {string|null} */
    this._openPhase = null;
    /** @type {number|null} */
    this._openAt = null;
    /** @type {Array<{ name: string, startMs: number, endMs: number }>} */
    this._segments = [];
  }

  /** Start timing a named phase. Closes any phase left open by the caller — a forgotten `.end()`
   *  must not corrupt every phase after it.
   *  @param {string} name */
  start(name) {
    if (this._openPhase) this.end();
    this._openPhase = name;
    this._openAt = Date.now();
  }

  /** Close the currently open phase. Repeated calls to one name accumulate (a retry reports its
   *  total time). */
  end() {
    if (!this._openPhase || this._openAt === null) return;
    const now = Date.now();
    const ms = now - this._openAt;
    this._phases[this._openPhase] = (this._phases[this._openPhase] || 0) + ms;
    this._segments.push({ name: this._openPhase, startMs: this._openAt, endMs: now });
    this._openPhase = null;
    this._openAt = null;
  }

  /** Every closed phase with its own start and end, in order — what a step's child spans are
   *  built from. @returns {Array<{ name: string, startMs: number, endMs: number }>} */
  segments() {
    if (this._openPhase) this.end();
    return this._segments.map((g) => ({ ...g }));
  }

  /** The epoch ms this timer was created — a process's own start, for its step span. */
  startedAt() {
    return this._start;
  }

  /** @returns {{phases: Record<string, number>, total_ms: number}} */
  block() {
    if (this._openPhase) this.end();
    return { phases: { ...this._phases }, total_ms: Date.now() - this._start };
  }
}

export const LEDGER_FILE = "telemetry.jsonl";
export const SUMMARY_FILE = "telemetry-summary.json";
export const AGENT_NAME = "pr-reviewer";
export const SCOPE_NAME = "agent-skills/pr-reviewer";

/** The step vocabulary and each step's kind. A name outside it is accepted (kind `model`) as long
 *  as it matches STEP_NAME_RE; the vocabulary keeps two runs' breakdowns comparable. */
export const STEPS = Object.freeze({
  load: "model",
  prepare: "script",
  memory: "model",
  gates: "model",
  finders: "model",
  "intent-wait": "model",
  "intent-verify": "model",
  lenses: "model",
  consolidate: "model",
  verify: "model",
  judgments: "model",
  validate: "script",
  finalize: "script",
  assert: "model",
  post: "script",
});
const STEP_NAME_RE = /^[a-z][a-z0-9-]{0,39}$/;
/** The steps the model marks itself, in order, for one run's tier and topology — what
 *  prepare-review.mjs prints so the marker list is in front of the model when it needs it,
 *  instead of in a rule it read before Step 1. `quick` runs no lenses; only `hybrid` waits
 *  for the intent worker, and does it AFTER verifying its own candidates, so the wait starts as
 *  late as it can (dispatch-topology.md § Running hybrid); `intent-verify` then verifies only the
 *  intent candidates the verified pool did not already hold. `assert` is Step 4a's pre-write
 *  checks between `finalize` and `post`.
 *  `state` is not a step: Step 4c's LoreKit writes happen after `post` has exported the run.
 *  @param {{ tier?: string|null, topology?: string|null }} run @returns {string[]} */
export function modelSteps({ tier, topology }) {
  return [
    "memory", "gates", "finders",
    ...(tier === "quick" ? [] : ["lenses"]),
    "consolidate", "verify",
    ...(topology === "hybrid" ? ["intent-wait", "intent-verify"] : []),
    "judgments", "validate", "assert",
  ];
}

/** The literal marker prefix for one run: absolute paths, because a harness's next tool call
 *  starts a fresh shell and a variable set in this one is gone. `<step>` and `<N>` are the only
 *  blanks. @param {string} runDir @returns {string} */
export function markerCommand(runDir) {
  const self = fileURLToPath(import.meta.url);
  return `node ${JSON.stringify(self)} step <step> --attr tool_calls_so_far=<N> --run-dir ${JSON.stringify(resolvePath(runDir))};`;
}
/** A gap shorter than this between two marked steps is bookkeeping, not an unmarked step. */
const GAP_MIN_NS = 1_000_000_000n;

/** Harnesses the Dash0 agent plugin already records as coding sessions. */
export const PLUGIN_HARNESSES = new Set(["claude-code", "cursor", "codex", "github-copilot-cli"]);

/** The instrumentation scope AI SDLC Insights reads coding sessions from: the one the Dash0 agent
 *  plugin emits under (dash0-agent-plugin internal/otlp/trace.go). A span under any other scope is
 *  never listed as a session there. */
export const INSIGHTS_SCOPE_NAME = "dash0-agent-plugin";

/** Harnesses where this run IS the coding session — no harness plugin records one — so the run
 *  exports under INSIGHTS_SCOPE_NAME. Never a PLUGIN_HARNESSES member, and never a CI or smoke
 *  harness, which would list synthetic runs as sessions. */
export const SESSION_HARNESSES = new Set(["agent0"]);

/** The scope a run exports under, from the harness its spans name (identityAttributes).
 *  @param {string|null|undefined} harness @returns {string} */
export function scopeNameFor(harness) {
  return harness && SESSION_HARNESSES.has(harness) ? INSIGHTS_SCOPE_NAME : SCOPE_NAME;
}

/** The OpenCode tool call a command runs in (OpenCode sets OPENCODE_PARENT_TOOL_CALL_ID per tool
 *  call; an Agent0 sandbox runs OpenCode). Anything else is not an id and is ignored.
 *  @param {NodeJS.ProcessEnv} env @returns {string|null} */
export function detectOpencodeToolCallId(env) {
  const v = String(env.OPENCODE_PARENT_TOOL_CALL_ID || "");
  return /^[A-Za-z0-9_.:-]{1,128}$/.test(v) ? v : null;
}

/** Every attribute key a span may carry. The self-test holds every emitted span to it, so a new
 *  key is a deliberate edit here rather than a drift into Dash0's views. */
export const ALLOWED_SPAN_KEY = (/** @type {string} */ k) =>
  /^pr_review\.[a-z0-9_.]+$/.test(k)
  || /^dash0\.gen_ai\.vcs\.(repository\.url\.full|repository\.name|owner\.name|provider\.name|ref\.head\.name|ref\.head\.revision|ref\.head\.type|pull_request\.url)$/.test(k)
  || [
    "gen_ai.operation.name", "gen_ai.agent.name", "gen_ai.agent.id", "gen_ai.conversation.id", "gen_ai.conversation.name",
    "gen_ai.harness.name", "gen_ai.provider.name", "gen_ai.request.model",
    "dash0.team.name", "user.name", "dash0.gen_ai.user.identity.source", "error.type",
  ].includes(k);

const HIST_BOUNDS = {
  "pr_review.step.duration": [5, 15, 30, 60, 120, 300, 600, 1200],
  "pr_review.run.duration": [60, 180, 300, 600, 900, 1200, 1800, 3600],
  "pr_review.step.tool_calls": [1, 2, 4, 8, 16, 32, 64],
};

/** The dashboard a memory's deep link opens when LOREKIT_APP_URL is unset (LoreKit § Deep links). */
export const LOREKIT_APP_URL = "https://lorekit.io";
/** At most this many memory events on one run: the read budget is ≤ 15 bodies, so 50 is a bound,
 *  not a budget. Used memories are recorded first, so a cap never drops one for a read-only one. */
export const MEMORY_EVENTS_MAX = 50;
/** Every kind a memory event may name — the report's three plus `lesson` (rules/memory.md). */
export const MEMORY_KINDS = Object.freeze(["rule", "knowledge", "hotspot", "lesson"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The LoreKit deep link that opens one memory: `/lore?memoryId=<uuid>` when the run kept the
 * memory's id, else `/lore?scope=…&lesson={scope,key}` (both forms from LoreKit's deep-link
 * contract), else null — a link is never fabricated from a key alone.
 * @param {{ id?: string, scope?: string, key?: string }} m @param {string} [base]
 * @returns {string|null}
 */
export function memoryUrl(m, base = LOREKIT_APP_URL) {
  const root = String(base || LOREKIT_APP_URL).replace(/\/+$/, "");
  if (typeof m.id === "string" && UUID_RE.test(m.id)) return `${root}/lore?memoryId=${m.id}`;
  if (m.scope && m.key) {
    const enc = (/** @type {unknown} */ v) => encodeURIComponent(JSON.stringify(v));
    return `${root}/lore?scope=${enc(m.scope)}&lesson=${enc({ scope: m.scope, key: m.key })}`;
  }
  return null;
}

/**
 * @typedef {{ used: boolean, read: boolean, kind: string, id?: string, scope?: string, key?: string,
 *   action?: string, note?: string, fingerprint?: string, seen_count?: number, suppressed?: number }} MemoryItem
 * @typedef {{ items: MemoryItem[], readReported: boolean, ns: bigint }} RunMemory
 */

/**
 * A `memory` ledger record's items, sanitized: a malformed entry, one nothing identifies (no id and
 * no key), or one neither used nor read is dropped; strings are trimmed and bounded; at most
 * MEMORY_EVENTS_MAX survive.
 * @param {unknown} list @returns {MemoryItem[]}
 */
export function memoryItems(list) {
  if (!Array.isArray(list)) return [];
  const str = (/** @type {unknown} */ v, /** @type {number} */ max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
  const count = (/** @type {unknown} */ v) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : undefined);
  /** @type {MemoryItem[]} */
  const out = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const m = /** @type {Record<string, any>} */ (raw);
    const kind = MEMORY_KINDS.includes(m.kind) ? m.kind : "lesson";
    /** @type {MemoryItem} */
    const item = {
      used: m.used === true, read: m.read === true, kind,
      id: str(m.id, 64), scope: str(m.scope, 512), key: str(m.key, 512),
      action: str(m.action, 40), note: str(m.note, 300), fingerprint: str(m.fingerprint, 512),
      seen_count: count(m.seen_count), suppressed: count(m.suppressed),
    };
    if ((!item.id && !item.key) || (!item.used && !item.read)) continue;
    out.push(item);
    if (out.length >= MEMORY_EVENTS_MAX) break;
  }
  return out;
}

/** The root span's memory attributes; none at all when finalize recorded no memory (rule 3).
 *  @param {RunMemory|null} memory @returns {Record<string, any>} */
export function memoryRootAttributes(memory) {
  if (!memory) return {};
  const used = memory.items.filter((m) => m.used);
  return {
    "pr_review.memory.used": used.length,
    "pr_review.memory.read": memory.readReported ? memory.items.filter((m) => m.read).length : null,
    "pr_review.memory.used_ids": used.map((m) => m.id).filter(Boolean).join(",") || null,
  };
}

/**
 * One span event per memory: `pr_review.memory.used` for a memory that influenced the review,
 * `pr_review.memory.read` for one whose body was read and that changed nothing. Stamped when
 * finalize recorded them, inside the run.
 * @param {BuiltRun} run @param {string} [base] @returns {import("./otlp.mjs").SpanEvent[]}
 */
export function memoryEvents(run, base) {
  if (!run.memory) return [];
  const at = run.memory.ns < run.startNs ? run.startNs : run.memory.ns > run.endNs ? run.endNs : run.memory.ns;
  return run.memory.items.map((m) => ({
    timeUnixNano: String(at),
    name: m.used ? "pr_review.memory.used" : "pr_review.memory.read",
    attributes: attrs({
      "pr_review.memory.kind": m.kind,
      "pr_review.memory.id": m.id,
      "pr_review.memory.scope": m.scope,
      "pr_review.memory.key": m.key,
      "pr_review.memory.url": memoryUrl(m, base),
      "pr_review.memory.action": m.action,
      "pr_review.memory.note": m.note,
      "pr_review.memory.fingerprint": m.fingerprint,
      "pr_review.memory.seen_count": m.seen_count,
      "pr_review.memory.suppressed": m.suppressed,
    }),
  }));
}

/** The run counter (rules/run-telemetry.md § The run counter): what a dashboard counts runs with. */
export const RUN_COUNTER = "pr_review.runs";
/** Every verdict a run can end with; `none` is a run that finished without one. Each gets a 0
 *  series, so the verdict a run ends on always has a baseline before its 1. */
export const RUN_VERDICTS = Object.freeze(["PASS", "WARN", "FAIL", "none"]);
/** The counter's 0 points are this far apart across a run: a window boundary that falls inside the
 *  run then has a 0 at most this long before it, within any PromQL lookback. */
export const RUN_COUNTER_STEP_NS = 30n * 1_000_000_000n;
/** At most this many points per series (4 hours at 30 s); a longer run keeps its first 0 and the
 *  last ones before its end. */
const RUN_COUNTER_MAX_POINTS = 480;

/**
 * The run counter's points for one run, pure. A 0 on every verdict's series just after the run's
 * start and every RUN_COUNTER_STEP_NS after that, then the final point at the run's end: 1 on the
 * run's own verdict, 0 on the rest. Every point shares the run's start as its start time, and the
 * attributes are only what every point knows, so no series ever lacks its baseline.
 * `finish` writes them all at once, backdated: no process lives for the whole run, and the ledger
 * already holds every time a live exporter would have sampled.
 * @param {BuiltRun} run
 * @returns {{ startNs: bigint, verdict: string, points: Array<{ attributes: Record<string, any>, timeNs: bigint, value: number }> }}
 */
export function runCounterPoints(run) {
  const recorded = run.runAttrs.verdict;
  const verdict = typeof recorded === "string" && recorded !== "" ? recorded : "none";
  const verdicts = RUN_VERDICTS.includes(verdict) ? [...RUN_VERDICTS] : [...RUN_VERDICTS, verdict];
  const labels = (/** @type {string} */ v) => ({
    "pr_review.verdict": v,
    "pr_review.dry_run": typeof run.runAttrs.dry_run === "boolean" ? run.runAttrs.dry_run : null,
    "pr_review.tier": run.facts.tier || null,
  });
  // The first 0 sits 1 ms after the start time, so no point has time == start.
  const first = run.startNs + 1_000_000n;
  const last = run.endNs > first ? run.endNs : first + 1_000_000n;
  const steps = Number((last - 1n - first) / RUN_COUNTER_STEP_NS) + 1;
  const skip = Math.max(0, steps - (RUN_COUNTER_MAX_POINTS - 2));
  /** @type {bigint[]} */
  const zeros = [first];
  for (let k = Math.max(1, skip); k < steps; k++) zeros.push(first + BigInt(k) * RUN_COUNTER_STEP_NS);
  const points = verdicts.flatMap((v) => [
    ...zeros.map((timeNs) => ({ attributes: labels(v), timeNs, value: 0 })),
    { attributes: labels(v), timeNs: last, value: v === verdict ? 1 : 0 },
  ]);
  return { startNs: run.startNs, verdict, points };
}

const nowNs = () => BigInt(Date.now()) * 1_000_000n;

/** The session title for a run that is its own session: what it reviewed, readable in a list.
 *  @param {RunFacts} f @returns {string|null} */
export function conversationName(f) {
  if (!f.repo) return null;
  return `${AGENT_NAME} ${f.repo}${f.number ? `#${f.number}` : ""}`;
}

/** OTel GenAI `gen_ai.provider.name` from a model id — the Dash0 agent plugin's own mapping.
 *  @param {string|null|undefined} model @returns {string|null} */
export function providerForModel(model) {
  const m = String(model || "");
  if (!m) return null;
  if (m.startsWith("claude-")) return "anthropic";
  if (m.startsWith("gpt-") || /^o[134](-|$)/.test(m) || m.startsWith("codex-")) return "openai";
  if (m.startsWith("gemini-")) return "gcp.gemini";
  if (m.startsWith("grok-")) return "x_ai";
  if (m.startsWith("deepseek-")) return "deepseek";
  if (m.startsWith("mistral-")) return "mistral_ai";
  return null;
}

/** Where the reviewer's Agent0 installer writes the run's paths
 *  (agents/pr-reviewer/scripts/agent0-setup.sh § 6). Read for host detection only. */
export const AGENT0_ENV_FILE = "/tmp/workspace/pr-reviewer/env.sh";

/** @param {NodeJS.ProcessEnv} env @param {(p: string) => boolean} [exists] @returns {string|null} */
export function detectHarness(env, exists = existsSync) {
  if (env.PR_REVIEWER_HARNESS) return env.PR_REVIEWER_HARNESS;
  if (env.CLAUDECODE === "1") return "claude-code";
  // Agent0, by file presence, never by a failed call. The repo's host detector is
  // /tmp/workspace/agent-skills/env.sh (agents/shared/rules/agent0-host.md), which only
  // scripts/agent0-setup.sh writes. An automation that installs the reviewer alone runs
  // agents/pr-reviewer/scripts/agent0-setup.sh, which writes AGENT0_ENV_FILE and never the other
  // file, so its runs exported with no harness at all. This is a span label, not the AGENT0
  // behaviour switch agent0-host.md owns, so accepting either file changes no behaviour.
  if (exists("/tmp/workspace/agent-skills/env.sh") || exists(AGENT0_ENV_FILE)) return "agent0";
  return null;
}

/** @param {NodeJS.ProcessEnv} env @returns {string|null} */
export function detectConversationId(env) {
  return env.PR_REVIEWER_CONVERSATION_ID || env.CLAUDE_CODE_SESSION_ID || env.CLAUDE_SESSION_ID || null;
}

/** @param {NodeJS.ProcessEnv} env @returns {{ endpoint: string, headers: Record<string, string> }} */
export function exportTarget(env) {
  const mode = String(env.PR_REVIEWER_TELEMETRY || "").toLowerCase();
  if (mode === "off") return { endpoint: "", headers: {} };
  if (env.PR_REVIEWER_OTLP_ENDPOINT) {
    return { endpoint: env.PR_REVIEWER_OTLP_ENDPOINT, headers: parseHeaders(env.PR_REVIEWER_OTLP_HEADERS) };
  }
  if (mode === "on" && env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    return { endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT, headers: parseHeaders(env.OTEL_EXPORTER_OTLP_HEADERS) };
  }
  return { endpoint: "", headers: {} };
}

/** OTEL_EXPORTER_OTLP_HEADERS: `k=v,k2=v2`, values optionally percent-encoded (the spec's form).
 *  @param {string} [s] @returns {Record<string, string>} */
export function parseHeaders(s) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const pair of (s || "").split(",")) {
    const i = pair.indexOf("=");
    if (i <= 0) continue;
    const key = pair.slice(0, i).trim();
    let value = pair.slice(i + 1).trim();
    try { value = decodeURIComponent(value); } catch { /* not encoded — keep as written */ }
    out[key] = value;
  }
  return out;
}

/** @param {string} runId @returns {string} a 32-hex trace id, stable for a run */
export function traceIdFor(runId) {
  return createHash("sha256").update(`pr-reviewer:${runId}`).digest("hex").slice(0, 32);
}

/** @param {string} runId @param {string} key @returns {string} a 16-hex span id, stable for a run */
function spanIdFor(runId, key) {
  return createHash("sha256").update(`pr-reviewer:${runId}:${key}`).digest("hex").slice(0, 16);
}

/* ------------------------------------ the ledger ------------------------------------ */

/**
 * @typedef {{ t: string, ns: string, [k: string]: any }} LedgerRecord
 * @typedef {{ repo?: string, number?: number, head_sha?: string, head_ref?: string, mode?: string,
 *   tier?: string, thoroughness?: number, topology?: string, model?: string,
 *   conversation_id?: string, harness?: string, user_name?: string, version?: string,
 *   opencode_parent_tool_call_id?: string }} RunFacts
 */

/** @param {string} runDir @returns {string} */
export function ledgerPath(runDir) {
  return join(runDir, LEDGER_FILE);
}

/** Append one record. `ns` defaults to now; pass it to backdate (a process's own start).
 *  @param {string} runDir @param {Record<string, any>} rec */
export function appendRecord(runDir, rec) {
  mkdirSync(runDir, { recursive: true });
  const { ns: at, ...rest } = rec;
  const line = JSON.stringify({ ns: String(at ?? nowNs()), ...rest });
  appendFileSync(ledgerPath(runDir), `${line}\n`, "utf8");
}

/** @param {string} runDir @returns {LedgerRecord[]} */
export function readLedger(runDir) {
  const p = ledgerPath(runDir);
  if (!existsSync(p)) return [];
  /** @type {LedgerRecord[]} */
  const out = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r && typeof r.t === "string" && /^\d+$/.test(String(r.ns))) out.push(r);
    } catch { /* a torn line from a crash is skipped, never fatal */ }
  }
  return out;
}

/**
 * Start a run, or add facts to one already started (idempotent: a second `begin` never starts a
 * second trace). Returns the run id.
 * @param {string} runDir @param {RunFacts} facts @param {{ ns?: bigint|string }} [opts]
 */
export function beginRun(runDir, facts, opts = {}) {
  const records = readLedger(runDir);
  const existing = records.find((r) => r.t === "run");
  const clean = Object.fromEntries(Object.entries(facts).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  if (existing) {
    // Same run: add facts. A FINISHED run, or one for another PR, is a previous review that shared
    // this directory (prepare-review's default --out is one fixed path) — rotate it aside rather
    // than folding this review into its trace.
    const prev = /** @type {RunFacts} */ (existing.facts || {});
    const otherPr = (clean.repo && prev.repo && clean.repo !== prev.repo) || (clean.number && prev.number && clean.number !== prev.number);
    if (!records.some((r) => r.t === "finish") && !otherPr) {
      // The tool call that STARTED the run stays: a later begin runs in a later tool call.
      if (prev.opencode_parent_tool_call_id) delete clean.opencode_parent_tool_call_id;
      appendRecord(runDir, { t: "facts", facts: clean });
      return String(existing.run_id);
    }
    renameSync(ledgerPath(runDir), join(runDir, `telemetry.${String(existing.run_id)}.jsonl`));
    // Its summary goes with it: a summary left in place says "already exported" to this run's
    // finish, and on dash0#20655 a second review in a reused directory was never exported.
    const summary = join(runDir, SUMMARY_FILE);
    if (existsSync(summary)) renameSync(summary, join(runDir, `telemetry-summary.${String(existing.run_id)}.json`));
  }
  const runId = randomBytes(8).toString("hex");
  appendRecord(runDir, { t: "run", run_id: runId, facts: clean, ...(opts.ns === undefined ? {} : { ns: opts.ns }) });
  return runId;
}

/* ----------------------------------- building spans ----------------------------------- */

/**
 * @typedef {{ name: string, startNs: bigint, endNs: bigint }} SubPhase
 * @typedef {{ name: string, kind: string, marked: boolean, startNs: bigint, endNs: bigint,
 *   attrs: Record<string, any>, status: 0|2, message?: string, sub?: SubPhase[] }} StepSpan
 * @typedef {{ unit: string, startNs: bigint, endNs: bigint, attrs: Record<string, any> }} WorkerSpan
 * @typedef {{ runId: string, facts: RunFacts, startNs: bigint, endNs: bigint, steps: StepSpan[],
 *   workers: WorkerSpan[], runAttrs: Record<string, any>, status: 0|2, message?: string,
 *   finished: boolean, memory: RunMemory|null }} BuiltRun
 */

/** Pure: a ledger → the run's spans. `now` closes whatever is still open when there is no finish.
 *  @param {LedgerRecord[]} records @param {bigint} [now] @returns {BuiltRun|null} */
export function buildRun(records, now = nowNs()) {
  const sorted = records.map((r, i) => ({ r, i, ns: BigInt(r.ns) }))
    .sort((a, b) => (a.ns < b.ns ? -1 : a.ns > b.ns ? 1 : a.i - b.i));
  const runRec = sorted.find((x) => x.r.t === "run");
  if (!runRec) return null;
  /** @type {RunFacts} */
  const facts = {};
  for (const { r } of sorted) if (r.t === "run" || r.t === "facts") Object.assign(facts, r.facts || {});
  const finish = [...sorted].reverse().find((x) => x.r.t === "finish");
  // A `dispatch` record (the caller's dispatch time, folded in by `worker import`) starts the run
  // earlier than `prepare` does: the model reads the agent definition and its rules before it runs
  // any script, and in round 10 on sync-tray#72 that was 94 s no trace showed.
  const dispatch = sorted.filter((x) => x.r.t === "dispatch" && x.ns < runRec.ns).map((x) => x.ns)
    .reduce((/** @type {bigint|null} */ a, b) => (a === null || b < a ? b : a), null);
  const startNs = dispatch ?? runRec.ns;
  // A caller that ran `prepare` itself (pr-review SKILL.md § Step 2) dispatches the reviewer AFTER
  // the run began, so its dispatch record lands inside a gap rather than before the run: the gap
  // holding it is the agent loading its definition, named `load` as well.
  const lateDispatches = sorted.filter((x) => x.r.t === "dispatch" && x.ns >= runRec.ns).map((x) => x.ns);
  const holdsDispatch = (/** @type {bigint} */ a, /** @type {bigint} */ b) => lateDispatches.some((d) => d >= a && d < b);
  const endNs = finish ? finish.ns : now;

  /** @type {StepSpan[]} */
  const steps = [];
  /** @type {StepSpan|null} */
  let open = null;
  /** @type {Record<string, any>} */
  const runAttrs = {};
  /** @type {Map<string, WorkerSpan>} */
  const openWorkers = new Map();
  /** @type {WorkerSpan[]} */
  const workers = [];
  /** @type {RunMemory|null} */
  let memory = null;
  const close = (/** @type {bigint} */ at) => {
    if (open) { open.endNs = at < open.startNs ? open.startNs : at; steps.push(open); open = null; }
  };
  for (const { r, ns } of sorted) {
    if (ns > endNs && r.t !== "finish") continue;
    if (r.t === "step" && r.phase === "start") {
      close(ns);
      const name = String(r.name);
      open = { name, kind: STEPS[/** @type {keyof typeof STEPS} */ (name)] || "model", marked: true, startNs: ns, endNs: ns, attrs: { ...(r.attrs || {}) }, status: 0 };
    } else if (r.t === "step" && r.phase === "end") {
      if (open) {
        Object.assign(open.attrs, r.attrs || {});
        if (Array.isArray(r.sub)) open.sub = subPhases(r.sub);
        if (r.status === "error") { open.status = 2; if (r.message) open.message = String(r.message).slice(0, 300); }
      }
      close(ns);
    } else if (r.t === "attr") {
      if (r.target === "step" && open) Object.assign(open.attrs, r.attrs || {});
      else Object.assign(runAttrs, r.attrs || {});
    } else if (r.t === "memory") {
      // A finalize re-run records the memory again from its own judgments: the last one wins.
      memory = { items: memoryItems(r.items), readReported: r.read_reported === true, ns };
    } else if (r.t === "worker") {
      const unit = String(r.unit);
      if (r.phase === "start") {
        openWorkers.set(unit, { unit, startNs: ns, endNs: ns, attrs: { ...(r.attrs || {}) } });
      } else {
        const w = openWorkers.get(unit) || { unit, startNs: ns, endNs: ns, attrs: {} };
        w.endNs = ns;
        Object.assign(w.attrs, r.attrs || {});
        workers.push(w);
        openWorkers.delete(unit);
      }
    }
  }
  close(endNs);
  for (const w of openWorkers.values()) { w.endNs = endNs; workers.push(w); }
  if (finish) Object.assign(runAttrs, finish.r.attrs || {});

  // Fill every gap longer than GAP_MIN_NS with an `unmarked` step, so the steps add up to the run.
  steps.sort((a, b) => (a.startNs < b.startNs ? -1 : a.startNs > b.startNs ? 1 : 0));
  /** @type {StepSpan[]} */
  const filled = [];
  let cursor = startNs;
  for (const s of steps) {
    // The first gap of a dispatched run is the agent reading its own definition: name it `load`.
    const gapName = (dispatch !== null && cursor === startNs) || holdsDispatch(cursor, s.startNs) ? "load" : "unmarked";
    if (s.startNs - cursor > GAP_MIN_NS) filled.push({ name: gapName, kind: "model", marked: false, startNs: cursor, endNs: s.startNs, attrs: {}, status: 0 });
    filled.push(s);
    if (s.endNs > cursor) cursor = s.endNs;
  }
  if (endNs - cursor > GAP_MIN_NS) filled.push({ name: dispatch !== null && cursor === startNs ? "load" : "unmarked", kind: "model", marked: false, startNs: cursor, endNs, attrs: {}, status: 0 });

  // Per-step tool calls from the model's own running count (`--attr tool_calls_so_far=N` on each
  // marker): a step's calls are the next marked count minus its own. Model-reported, so approximate.
  // Round 10 showed why it matters: `verify` was 2 calls in 205 s — generation-bound, not turn-bound.
  const counted = filled.filter((x) => typeof x.attrs.tool_calls_so_far === "number");
  counted.forEach((x, k) => {
    const next = counted[k + 1];
    if (next && next.attrs.tool_calls_so_far >= x.attrs.tool_calls_so_far) x.attrs.tool_calls = next.attrs.tool_calls_so_far - x.attrs.tool_calls_so_far;
  });
  if (counted.length) runAttrs.tool_calls_reported = Math.max(...counted.map((x) => x.attrs.tool_calls_so_far));

  const failed = finish?.r.status === "error";
  return {
    runId: String(runRec.r.run_id),
    facts,
    startNs,
    endNs,
    steps: filled,
    workers,
    runAttrs,
    status: failed ? 2 : 0,
    ...(failed && finish?.r.message ? { message: String(finish.r.message).slice(0, 300) } : {}),
    finished: Boolean(finish),
    memory,
  };
}

/** A script's internal phases → child spans, clamped to sane values; a malformed entry is dropped.
 *  @param {any[]} list @returns {SubPhase[]} */
function subPhases(list) {
  /** @type {SubPhase[]} */
  const out = [];
  for (const g of list) {
    try {
      const name = String(g?.name || "");
      const startNs = BigInt(g.start_ns);
      const endNs = BigInt(g.end_ns);
      if (STEP_NAME_RE.test(name) && endNs >= startNs) out.push({ name, startNs, endNs });
    } catch { /* not a phase */ }
  }
  return out;
}

/**
 * The identity + VCS attributes every span carries, mirroring the Dash0 agent plugin.
 * @param {BuiltRun} run @param {NodeJS.ProcessEnv} env @returns {Record<string, any>}
 */
export function identityAttributes(run, env) {
  const f = run.facts;
  const [owner, name] = String(f.repo || "").split("/");
  const joined = Boolean(f.conversation_id);
  const harness = f.harness && (!PLUGIN_HARNESSES.has(f.harness) || joined) ? f.harness : null;
  const repoUrl = owner && name ? `https://github.com/${owner}/${name}` : null;
  return {
    "gen_ai.agent.name": AGENT_NAME,
    "gen_ai.conversation.id": f.conversation_id || run.runId,
    "gen_ai.harness.name": harness,
    "gen_ai.provider.name": providerForModel(f.model),
    "gen_ai.request.model": f.model || null,
    "dash0.gen_ai.vcs.repository.url.full": repoUrl,
    "dash0.gen_ai.vcs.repository.name": name || null,
    "dash0.gen_ai.vcs.owner.name": owner || null,
    "dash0.gen_ai.vcs.provider.name": repoUrl ? "github" : null,
    "dash0.gen_ai.vcs.ref.head.name": f.head_ref || null,
    "dash0.gen_ai.vcs.ref.head.type": f.head_ref ? "branch" : null,
    "dash0.gen_ai.vcs.ref.head.revision": f.head_sha || null,
    "dash0.gen_ai.vcs.pull_request.url": repoUrl && f.number ? `${repoUrl}/pull/${f.number}` : null,
    "dash0.team.name": env.PR_REVIEWER_TEAM_NAME || null,
    "user.name": f.user_name || null,
    "dash0.gen_ai.user.identity.source": f.user_name ? "git" : null,
  };
}

/** Prefix a free attribute bag into the pr_review.* namespace, so a marker can never overwrite a
 *  gen_ai.* or VCS key. @param {Record<string, any>} bag @returns {Record<string, any>} */
function ns(bag) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const [k, v] of Object.entries(bag || {})) {
    if (v === undefined || v === null || v === "") continue;
    out[k.startsWith("pr_review.") ? k : `pr_review.${k}`] = v;
  }
  return out;
}

/**
 * The exporter for a built run: the trace (root + steps + workers), the duration histograms, and
 * the run counter. Returns the exporter unflushed.
 * @param {BuiltRun} run @param {NodeJS.ProcessEnv} env
 */
export function toExporter(run, env) {
  const { endpoint, headers } = exportTarget(env);
  const f = run.facts;
  const traceId = traceIdFor(run.runId);
  const identity = identityAttributes(run, env);
  const ex = new OtlpExporter({
    endpoint,
    headers,
    // Insights' scope only where this run is the session (SESSION_HARNESSES); the metrics share it.
    scopeName: scopeNameFor(identity["gen_ai.harness.name"]),
    scopeVersion: f.version || "1",
    histBounds: HIST_BOUNDS,
    resource: {
      "service.name": env.OTEL_SERVICE_NAME || AGENT_NAME,
      "service.namespace": "agent-skills",
      "service.version": f.version || null,
      // One instance per run: without it two runs with the same version and labels share a metric
      // series, and a counter that ends on the same value again reads as no change.
      "service.instance.id": traceId,
      "gen_ai.agent.name": AGENT_NAME,
      "gen_ai.harness.name": identity["gen_ai.harness.name"],
    },
  });
  ex.traceId = traceId;
  const rootId = spanIdFor(run.runId, "root");
  ex.spans.push({
    traceId: ex.traceId,
    spanId: rootId,
    name: `invoke_agent ${AGENT_NAME}`,
    kind: 1,
    startTimeUnixNano: String(run.startNs),
    endTimeUnixNano: String(run.endNs),
    attributes: attrs({
      ...identity,
      "gen_ai.operation.name": "invoke_agent",
      "gen_ai.agent.id": run.runId,
      // The session title AI Coding Insights lists. Only for a run that IS its own session — a run
      // joined to a harness session (PR_REVIEWER_CONVERSATION_ID) must not rename that session.
      "gen_ai.conversation.name": f.conversation_id ? null : conversationName(f),
      ...ns({
        mode: f.mode, tier: f.tier, thoroughness: f.thoroughness, topology: f.topology,
        "pr.number": f.number,
        // The OpenCode tool call that started the run — the handle back to the Agent0 run.
        "opencode.parent_tool_call_id": f.opencode_parent_tool_call_id,
        ...run.runAttrs,
      }),
      ...memoryRootAttributes(run.memory),
      ...(run.status === 2 ? { "error.type": "review_failed" } : {}),
    }),
    status: run.status === 2 ? { code: 2, message: run.message || "review failed" } : { code: 0 },
    ...(run.memory && run.memory.items.length ? { events: memoryEvents(run, env.LOREKIT_APP_URL) } : {}),
  });
  run.steps.forEach((s, i) => {
    const stepId = spanIdFor(run.runId, `step:${i}:${s.name}`);
    ex.spans.push({
      traceId: ex.traceId,
      spanId: stepId,
      parentSpanId: rootId,
      name: `pr_review.step ${s.name}`,
      kind: 1,
      startTimeUnixNano: String(s.startNs),
      endTimeUnixNano: String(s.endNs),
      attributes: attrs({
        ...identity, "pr_review.step.name": s.name, "pr_review.step.kind": s.kind, "pr_review.step.marked": s.marked,
        ...ns(s.attrs), ...(s.status === 2 ? { "error.type": "step_failed" } : {}),
      }),
      status: s.status === 2 ? { code: 2, message: s.message || `${s.name} failed` } : { code: 0 },
    });
    (s.sub || []).forEach((g, j) => {
      ex.spans.push({
        traceId: ex.traceId,
        spanId: spanIdFor(run.runId, `step:${i}:${s.name}:phase:${j}:${g.name}`),
        parentSpanId: stepId,
        name: `pr_review.phase ${g.name}`,
        kind: 1,
        startTimeUnixNano: String(g.startNs),
        endTimeUnixNano: String(g.endNs),
        attributes: attrs({ ...identity, "pr_review.step.name": s.name, "pr_review.phase.name": g.name }),
        status: { code: 0 },
      });
    });
    ex.histogram("pr_review.step.duration", Number(s.endNs - s.startNs) / 1e9,
      { "pr_review.step.name": s.name, "pr_review.step.kind": s.kind, "gen_ai.agent.name": AGENT_NAME }, "s");
    if (typeof s.attrs.tool_calls === "number") {
      ex.histogram("pr_review.step.tool_calls", s.attrs.tool_calls,
        { "pr_review.step.name": s.name, "pr_review.step.kind": s.kind, "gen_ai.agent.name": AGENT_NAME }, "{tool_call}");
    }
  });
  run.workers.forEach((w, i) => {
    ex.spans.push({
      traceId: ex.traceId,
      spanId: spanIdFor(run.runId, `worker:${i}:${w.unit}`),
      parentSpanId: rootId,
      name: `pr_review.worker ${w.unit}`,
      kind: 1,
      startTimeUnixNano: String(w.startNs),
      endTimeUnixNano: String(w.endNs),
      attributes: attrs({ ...identity, "pr_review.worker.unit": w.unit, ...ns(w.attrs) }),
      status: { code: 0 },
    });
  });
  ex.histogram("pr_review.run.duration", Number(run.endNs - run.startNs) / 1e9, {
    "gen_ai.agent.name": AGENT_NAME,
    // finalize.mjs records the topology that actually ran; the begin-time value is the budget's.
    "pr_review.tier": f.tier, "pr_review.topology": run.runAttrs.topology ?? f.topology,
    "pr_review.verdict": run.runAttrs.verdict,
  }, "s");
  const counter = runCounterPoints(run);
  ex.cumulativeSum(RUN_COUNTER, { unit: "{run}", startNs: counter.startNs, points: counter.points });
  return ex;
}

/**
 * The per-step breakdown — written to SUMMARY_FILE on every finish, endpoint or not. `memory` is
 * present only when finalize recorded the run's memory.
 * @param {BuiltRun} run @param {NodeJS.ProcessEnv} [env]
 */
export function summarize(run, env = {}) {
  const total = Number(run.endNs - run.startNs) / 1e9;
  const round = (/** @type {number} */ n) => Math.round(n * 10) / 10;
  return {
    run_id: run.runId,
    trace_id: traceIdFor(run.runId),
    total_s: round(total),
    steps: run.steps.map((s) => {
      const d = Number(s.endNs - s.startNs) / 1e9;
      return {
        name: s.name, kind: s.kind, marked: s.marked,
        start_offset_s: round(Number(s.startNs - run.startNs) / 1e9),
        duration_s: round(d),
        share: total > 0 ? Math.round((d / total) * 100) : 0,
        ...(s.status === 2 ? { failed: true } : {}),
        ...(typeof s.attrs.tool_calls === "number" ? { tool_calls: s.attrs.tool_calls } : {}),
        ...(s.sub && s.sub.length ? { phases: s.sub.map((g) => ({ name: g.name, duration_s: round(Number(g.endNs - g.startNs) / 1e9) })) } : {}),
      };
    }),
    workers: run.workers.map((w) => ({
      unit: w.unit,
      start_offset_s: round(Number(w.startNs - run.startNs) / 1e9),
      duration_s: round(Number(w.endNs - w.startNs) / 1e9),
    })),
    ...(run.memory ? {
      memory: {
        used: run.memory.items.filter((m) => m.used).length,
        ...(run.memory.readReported ? { read: run.memory.items.filter((m) => m.read).length } : {}),
        items: run.memory.items.map((m) => ({
          use: m.used ? "used" : "read", kind: m.kind,
          ...(m.id ? { id: m.id } : {}), ...(m.scope ? { scope: m.scope } : {}), ...(m.key ? { key: m.key } : {}),
          ...(memoryUrl(m, env.LOREKIT_APP_URL) ? { url: memoryUrl(m, env.LOREKIT_APP_URL) } : {}),
        })),
      },
    } : {}),
  };
}

/** @param {ReturnType<typeof summarize>} s @returns {string} */
export function renderSummary(s) {
  const rows = s.steps.flatMap((x) => [
    `  ${x.name.padEnd(16)} ${x.kind.padEnd(8)} ${String(x.duration_s).padStart(7)}s ${String(x.share).padStart(4)}%${"tool_calls" in x ? `  ${x.tool_calls} calls` : ""}${x.failed ? "  FAILED" : ""}`,
    ...(x.phases || []).map((g) => `    · ${g.name.padEnd(13)} ${"".padEnd(8)} ${String(g.duration_s).padStart(7)}s`),
  ]);
  const wrows = s.workers.map((w) => `  worker ${w.unit.padEnd(9)} ${"sub-agent".padEnd(8)} ${String(w.duration_s).padStart(7)}s  (from +${w.start_offset_s}s)`);
  const m = s.memory;
  const mrows = m ? [
    `  memory ${m.used} used${"read" in m ? ` · ${m.read} read` : ""}`,
    ...m.items.filter((x) => x.use === "used").map((x) => `    · ${x.kind.padEnd(13)} ${x.url || [x.scope, x.key].filter(Boolean).join(" · ")}`),
  ] : [];
  return [`review ${s.run_id} · ${s.total_s}s · trace ${s.trace_id}`, ...rows, ...wrows, ...mrows].join("\n");
}

/**
 * Close the run and export it. Idempotent: a run already exported is not exported twice unless
 * `force`. Never throws.
 * @param {string} runDir @param {{ status?: string, message?: string, attrs?: Record<string, any>,
 *   force?: boolean }} [opts] @param {NodeJS.ProcessEnv} [env]
 */
export async function finishRun(runDir, opts = {}, env = process.env) {
  try {
    const summaryPath = join(runDir, SUMMARY_FILE);
    if (!opts.force && existsSync(summaryPath)) {
      const prev = JSON.parse(readFileSync(summaryPath, "utf8"));
      const current = readLedger(runDir).find((r) => r.t === "run");
      if (prev && prev.exported === true && (!current || prev.run_id === String(current.run_id))) return { ...prev, skipped: "already exported" };
    }
    const records = readLedger(runDir);
    if (!records.some((r) => r.t === "run")) return { exported: false, reason: `no run in ${ledgerPath(runDir)}` };
    if (!records.some((r) => r.t === "finish")) {
      appendRecord(runDir, { t: "finish", status: opts.status === "error" ? "error" : "ok", ...(opts.message ? { message: opts.message } : {}), attrs: opts.attrs || {} });
    } else if (opts.attrs && Object.keys(opts.attrs).length) {
      appendRecord(runDir, { t: "attr", target: "run", attrs: opts.attrs });
    }
    const run = buildRun(readLedger(runDir));
    if (!run) return { exported: false, reason: "ledger has no run" };
    const summary = summarize(run, env);
    const ex = toExporter(run, env);
    const result = await ex.flush();
    const out = { ...summary, exported: result.exported, ...(result.reason ? { reason: result.reason } : {}) };
    writeFileSync(summaryPath, `${JSON.stringify(out, null, 2)}\n`, "utf8");
    return out;
  } catch (e) {
    return { exported: false, reason: `telemetry error: ${String(/** @type {Error} */ (e).message || e).slice(0, 200)}` };
  }
}

/**
 * The facts a script knows about the reviewer itself: its version and the git identity, the same
 * source the Dash0 agent plugin reads for `user.name`.
 * @param {NodeJS.ProcessEnv} env @returns {{ version?: string, user_name?: string, harness?: string,
 *   conversation_id?: string, opencode_parent_tool_call_id?: string }}
 */
export function hostFacts(env = process.env) {
  /** @type {{ version?: string, user_name?: string, harness?: string, conversation_id?: string,
   *   opencode_parent_tool_call_id?: string }} */
  const out = {};
  const here = dirname(fileURLToPath(import.meta.url));
  // The checkout this script runs from first; AGENT_SKILLS_COMMIT (the Agent0 setup script's pin)
  // only when that is not a git checkout — the two differ whenever a snapshot runs next to the
  // installed pin, and the running code is the one to report.
  const version = gitOut(["-C", here, "rev-parse", "--short", "HEAD"])
    || (env.AGENT_SKILLS_COMMIT ? env.AGENT_SKILLS_COMMIT.slice(0, 7) : "");
  if (version) out.version = version;
  if (String(env.PR_REVIEWER_OMIT_USER_INFO || "").toLowerCase() !== "true") {
    const user = gitOut(["config", "user.name"]);
    if (user) out.user_name = user;
  }
  const harness = detectHarness(env);
  if (harness) out.harness = harness;
  const conv = detectConversationId(env);
  if (conv) out.conversation_id = conv;
  const toolCall = detectOpencodeToolCallId(env);
  if (toolCall) out.opencode_parent_tool_call_id = toolCall;
  return out;
}

/**
 * When the caller dispatched this run, read from the worker's scratch directory: a
 * `dispatched_at` file (epoch milliseconds) first, else the `-<unix seconds>` suffix the
 * `/pr-review` path convention (`intent-<PR>-<unix seconds>`) puts on the directory name. Accepted
 * only when it is before the worker's first own record and at most an hour before it, so a stale
 * or unrelated number is ignored rather than stretching the trace. Exported for the self-test.
 * @param {string} dir @param {bigint} firstSeen @returns {bigint|null}
 */
export function dispatchTime(dir, firstSeen) {
  /** @type {bigint|null} */
  let at = null;
  try {
    const f = join(dir, "dispatched_at");
    if (existsSync(f)) {
      // Epoch seconds (10 digits) or milliseconds (13). BSD `date +%s%3N` — macOS — prints the
      // seconds followed by a literal `3N`, so only the leading 10 digits of such a value count.
      const digits = /^(\d+)/.exec(String(readFileSync(f, "utf8")).trim())?.[1] || "";
      if (digits.length === 13) at = BigInt(digits) * 1_000_000n;
      else if (digits.length >= 10) at = BigInt(digits.slice(0, 10)) * 1_000_000_000n;
    }
    if (at === null) {
      const m = /-(\d{10})\/?$/.exec(dir);
      if (m) at = BigInt(m[1]) * 1_000_000_000n;
    }
  } catch { return null; }
  if (at === null || at > firstSeen || firstSeen - at > 3_600_000_000_000n) return null;
  return at;
}

/** The bound on waiting for a hybrid worker's output, across every `--wait` call of one run. */
export const WAIT_TOTAL_S = 600;
const WAIT_POLL_MS = 2000;

/**
 * Poll for a worker's output file (present and non-empty) for at most `waitS` seconds of this call,
 * and never past `totalS` seconds summed over this run's earlier waits for the same unit.
 * @param {string} runDir @param {string} unit @param {string} donePath @param {number} waitS @param {number} totalS @param {number} [pollMs]
 * @returns {Promise<{ ready: boolean, timedOut: boolean, totalMs: number, totalS: number }>}
 */
export async function waitForOutput(runDir, unit, donePath, waitS, totalS, pollMs = WAIT_POLL_MS) {
  const ready = () => { try { return existsSync(donePath) && statSync(donePath).size > 0; } catch { return false; } };
  const cap = Number.isFinite(totalS) && totalS > 0 ? totalS : WAIT_TOTAL_S;
  const prior = readLedger(runDir).filter((r) => r.t === "wait" && r.unit === unit).reduce((a, r) => a + (Number(r.ms) || 0), 0);
  const budget = Math.max(0, Math.min((Number.isFinite(waitS) && waitS >= 0 ? waitS : cap) * 1000, cap * 1000 - prior));
  const t0 = Date.now();
  while (!ready() && Date.now() - t0 < budget) {
    await new Promise((r) => setTimeout(r, Math.max(1, Math.min(pollMs, budget - (Date.now() - t0)))));
  }
  const ms = Date.now() - t0;
  appendRecord(runDir, { t: "wait", unit, ms });
  const got = ready();
  return { ready: got, timedOut: !got && prior + ms >= cap * 1000, totalMs: prior + ms, totalS: cap };
}

/** @param {string[]} args @returns {string} */
function gitOut(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000 }).trim();
  } catch {
    return "";
  }
}

/* ---------------------------------------- CLI ---------------------------------------- */

/** @param {string} v @returns {string|number|boolean} */
function typed(v) {
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

/** The value-taking flags. `flag(args, "<name>")` below is the one reader, so the flag contract is
 *  visible to L1 G43a (which extracts it from this file) and to a reader alike. */
const VALUE_FLAGS = ["run-dir", "repo", "pr", "head", "head-ref", "mode", "tier", "thoroughness", "topology",
  "model", "conversation-id", "harness", "target", "status", "message", "from", "done", "attr", "wait", "wait-total"];

/** @param {string[]} args @param {string} name @returns {string|undefined} */
function flag(args, name) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
}

/** @param {string[]} args */
function parseCli(args) {
  /** @type {Record<string, string|undefined>} */
  const opts = {
    "run-dir": flag(args, "run-dir"), repo: flag(args, "repo"), pr: flag(args, "pr"), head: flag(args, "head"),
    "head-ref": flag(args, "head-ref"), mode: flag(args, "mode"), tier: flag(args, "tier"),
    thoroughness: flag(args, "thoroughness"), topology: flag(args, "topology"), model: flag(args, "model"),
    "conversation-id": flag(args, "conversation-id"), harness: flag(args, "harness"), target: flag(args, "target"),
    status: flag(args, "status"), message: flag(args, "message"), from: flag(args, "from"), done: flag(args, "done"),
    wait: flag(args, "wait"), "wait-total": flag(args, "wait-total"),
    force: args.includes("--force") ? "true" : undefined,
  };
  /** @type {Record<string, string|number|boolean>} */
  const attrBag = {};
  if (flag(args, "attr") !== undefined) {
    args.forEach((a, i) => {
      if (a !== "--attr") return;
      const kv = args[i + 1] || "";
      const j = kv.indexOf("=");
      if (j > 0 && /^[a-z][a-z0-9_.]*$/.test(kv.slice(0, j))) attrBag[kv.slice(0, j)] = typed(kv.slice(j + 1));
    });
  }
  /** @type {string[]} */
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) { if (VALUE_FLAGS.includes(a.slice(2))) i++; continue; }
    positional.push(a);
  }
  return { positional, opts, attrBag };
}

/** @param {string} msg */
function warn(msg) {
  process.stderr.write(`review-telemetry: ignored — ${msg}\n`);
}

/** @param {string[]} argv */
async function main(argv) {
  const { positional, opts, attrBag } = parseCli(argv);
  const cmd = positional[0];
  const runDir = opts["run-dir"] || process.env.PR_REVIEW_RUN_DIR || "";
  if (!cmd) { warn("no command (begin | step | end | attr | worker | dispatch | finish | summary)"); return; }
  if (!runDir) { warn(`${cmd}: no --run-dir and no PR_REVIEW_RUN_DIR`); return; }
  try {
    if (cmd === "begin") {
      const facts = {
        ...hostFacts(),
        repo: opts.repo, number: opts.pr ? Number(opts.pr) : undefined, head_sha: opts.head, head_ref: opts["head-ref"],
        mode: opts.mode, tier: opts.tier, thoroughness: opts.thoroughness ? Number(opts.thoroughness) : undefined,
        topology: opts.topology, model: opts.model,
        ...(opts["conversation-id"] ? { conversation_id: opts["conversation-id"] } : {}),
        ...(opts.harness ? { harness: opts.harness } : {}),
      };
      const id = beginRun(runDir, facts);
      console.log(id);
      return;
    }
    if (!readLedger(runDir).some((r) => r.t === "run")) { warn(`${cmd}: no run started in ${runDir} (run \`begin\` first)`); return; }
    if (cmd === "step") {
      const name = positional[1] || "";
      if (!STEP_NAME_RE.test(name)) { warn(`step name ${JSON.stringify(name)} must match ${STEP_NAME_RE}`); return; }
      appendRecord(runDir, { t: "step", phase: "start", name, attrs: attrBag });
    } else if (cmd === "end") {
      appendRecord(runDir, { t: "step", phase: "end", ...(positional[1] ? { name: positional[1] } : {}), attrs: attrBag });
    } else if (cmd === "dispatch") {
      // The caller's dispatch time on a run it prepared itself: the gap holding it becomes `load`.
      appendRecord(runDir, { t: "dispatch" });
    } else if (cmd === "attr") {
      appendRecord(runDir, { t: "attr", target: opts.target === "step" ? "step" : "run", attrs: attrBag });
    } else if (cmd === "worker") {
      const unit = positional[1] || "";
      const phase = positional[2];
      if (!/^[a-z][a-z0-9@_-]{0,39}$/.test(unit) || !["start", "end", "import"].includes(String(phase))) { warn("usage: worker <unit> start|end|import"); return; }
      if (phase === "import") {
        // `--wait <s>`: poll for the worker's output first, and record how long this run waited
        // (`<unit>_wait_ms` on the open step and the run), so a trace shows whether the late read
        // (dispatch-topology.md § Running hybrid) brought the wait to ~0. The wait accumulates
        // across calls up to `--wait-total` (default 600 s), so a harness whose shell call times out
        // sooner re-issues the same command instead of losing the bound.
        if (opts.wait !== undefined && opts.done) {
          const waited = await waitForOutput(runDir, unit, opts.done, Number(opts.wait), Number(opts["wait-total"] ?? WAIT_TOTAL_S));
          const bag = { [`${unit}_wait_ms`]: waited.totalMs, [`${unit}_wait_timed_out`]: waited.timedOut };
          appendRecord(runDir, { t: "attr", target: "step", attrs: bag });
          appendRecord(runDir, { t: "attr", target: "run", attrs: bag });
          const secsWaited = Math.round(waited.totalMs / 100) / 10;
          if (!waited.ready) {
            console.log(waited.timedOut
              ? `${unit}: timed out after ${secsWaited}s — run the ${unit} finder in this context`
              : `${unit}: not ready after ${secsWaited}s of ${waited.totalS}s — re-run this command`);
            return;
          }
          console.log(`${unit}: ready after ${secsWaited}s wait`);
          attrBag.wait_ms = waited.totalMs;
        }
        // A worker that prepared its own context (the hybrid intent worker) kept its own ledger;
        // fold its span — first record to last — into this run as one worker span.
        const from = opts.from || "";
        const theirs = readLedger(from).map((r) => BigInt(r.ns));
        // A worker prepared with --no-telemetry keeps no ledger; its context.json still says when
        // it started (generatedAt − elapsedMs) and when its preparation ended.
        const ctxPath = join(from, "context.json");
        if (!theirs.length && existsSync(ctxPath)) {
          const ctx = JSON.parse(readFileSync(ctxPath, "utf8"));
          const doneMs = Date.parse(String(ctx.generatedAt || ""));
          if (Number.isFinite(doneMs)) {
            theirs.push(BigInt(Math.round(doneMs - (Number(ctx.elapsedMs) || 0))) * 1_000_000n, BigInt(doneMs) * 1_000_000n);
          }
        }
        // A worker that wrote its context elsewhere still left its output: the output's mtime ends
        // the worker and the dispatch stamp starts it, which is all the span needs.
        const donePath = opts.done || "";
        if (!theirs.length && donePath && existsSync(donePath)) theirs.push(BigInt(Math.round(statSync(donePath).mtimeMs)) * 1_000_000n);
        if (!theirs.length) { warn(`worker ${unit} import: no ledger, context.json, or --done file in ${JSON.stringify(from)}`); return; }
        const firstSeen = theirs.reduce((a, b) => (b < a ? b : a));
        const last = theirs.reduce((a, b) => (b > a ? b : a));
        const doneAt = donePath && existsSync(donePath) ? BigInt(Math.round(statSync(donePath).mtimeMs)) * 1_000_000n : last;
        // The caller's dispatch time, when it left one: the worker (and the reviewer, sent in the
        // same message) started then, not when the worker's own script began.
        const dispatched = dispatchTime(from, firstSeen);
        const first = dispatched ?? firstSeen;
        if (dispatched !== null) appendRecord(runDir, { t: "dispatch", ns: dispatched });
        const end = doneAt > last ? doneAt : last;
        appendRecord(runDir, { t: "worker", unit, phase: "start", ns: first, attrs: attrBag });
        appendRecord(runDir, { t: "worker", unit, phase: "end", ns: end });
        const runStart = BigInt(readLedger(runDir).find((r) => r.t === "run")?.ns || end);
        const secs = (/** @type {bigint} */ x) => Math.round(Number(x) / 1e8) / 10;
        process.stderr.write(`review-telemetry: worker ${unit} folded in — ${secs(end - first)}s long, done ${secs(end - runStart)}s after prepare began`
          + `${dispatched !== null ? " (run now starts at the dispatch)" : ""}\n`);
        return;
      }
      appendRecord(runDir, { t: "worker", unit, phase, attrs: attrBag });
    } else if (cmd === "finish") {
      const out = await finishRun(runDir, { status: opts.status, message: opts.message, attrs: attrBag, force: opts.force === "true" });
      if ("steps" in out) process.stderr.write(`${renderSummary(/** @type {any} */ (out))}\n`);
      process.stderr.write(`review-telemetry: ${"skipped" in out && out.skipped ? "already exported earlier — nothing sent" : out.exported ? "exported" : `not exported (${out.reason || "?"})`}\n`);
    } else if (cmd === "summary") {
      const run = buildRun(readLedger(runDir));
      if (run) console.log(renderSummary(summarize(run, process.env)));
    } else {
      warn(`unknown command ${JSON.stringify(cmd)}`);
    }
  } catch (e) {
    warn(`${cmd}: ${String(/** @type {Error} */ (e).message || e).slice(0, 200)}`);
  }
}

/* ------------------------------------- self-test ------------------------------------- */

async function selfTest() {
  /** @type {string[]} */
  const fails = [];
  let passed = 0;
  /** @param {string} label @param {boolean} cond @param {string} [detail] */
  const ok = (label, cond, detail = "") => {
    if (cond) { passed++; console.log(`  ✓ ${label}`); } else { fails.push(label); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
  };
  const S = 1_000_000_000n;
  const t0 = 1_790_000_000n * S;
  /** @param {number} sec @param {Record<string, any>} rec */
  const at = (sec, rec) => ({ ns: String(t0 + BigInt(sec) * S), ...rec });
  const facts = { repo: "mthines/sync-tray", number: 72, head_sha: "bfd6662", head_ref: "fix/x", mode: "full", tier: "deep", thoroughness: 0.8, topology: "hybrid" };

  // Timing — unchanged contract.
  const timing = new Timing();
  timing.start("prepare"); timing.end();
  ok("Timing block has phases + total_ms", typeof timing.block().total_ms === "number" && typeof timing.block().phases.prepare === "number");

  // buildRun: marked steps, a gap, a worker, attrs, finish.
  const ledger = [
    at(0, { t: "run", run_id: "r1", facts }),
    at(0, { t: "step", phase: "start", name: "prepare" }),
    at(10, { t: "step", phase: "end", attrs: { "phase.impact_ms": 900 }, sub: [
      { name: "fetch", start_ns: String(t0), end_ns: String(t0 + 2n * S) },
      { name: "workspace", start_ns: String(t0 + 2n * S), end_ns: String(t0 + 8n * S) },
      { name: "Bad Name", start_ns: "1", end_ns: "2" },
    ] }),
    at(12, { t: "worker", unit: "intent", phase: "start" }),
    at(20, { t: "step", phase: "start", name: "finders" }),
    at(80, { t: "step", phase: "start", name: "verify", attrs: { candidates: 0 } }),
    at(95, { t: "worker", unit: "intent", phase: "end", attrs: { candidates: 19 } }),
    at(100, { t: "step", phase: "start", name: "finalize" }),
    at(110, { t: "attr", target: "run", attrs: { verdict: "FAIL", posted_inline: 9 } }),
    at(110, { t: "finish", status: "ok" }),
  ];
  const run = /** @type {BuiltRun} */ (buildRun(/** @type {any} */ (ledger)));
  ok("buildRun reads the run", run !== null && run.runId === "r1" && run.finished);
  const names = run.steps.map((s) => s.name);
  ok("steps in order, the 10–20 s gap filled as `unmarked`",
    JSON.stringify(names) === JSON.stringify(["prepare", "unmarked", "finders", "verify", "finalize"]), names.join(","));
  const sum = run.steps.reduce((n, s) => n + Number(s.endNs - s.startNs), 0) / 1e9;
  ok("the steps add up to the run (110 s)", sum === 110, String(sum));
  ok("a step started while another is open closes the open one at that moment",
    Number(run.steps[2].endNs - run.steps[2].startNs) / 1e9 === 60);
  ok("the worker spans its own start and end", run.workers.length === 1 && Number(run.workers[0].endNs - run.workers[0].startNs) / 1e9 === 83);
  ok("step kinds come from the vocabulary", run.steps[0].kind === "script" && run.steps[2].kind === "model" && run.steps[1].marked === false);

  // The exported trace, against the Dash0 agent plugin's contract.
  const env = { PR_REVIEWER_OTLP_ENDPOINT: "https://ingress.example.com" };
  const ex = toExporter(run, env);
  const payload = /** @type {any} */ (ex.tracePayload());
  const spans = payload.resourceSpans[0].scopeSpans[0].spans;
  const get = (/** @type {any} */ s, /** @type {string} */ k) => {
    const a = s?.attributes?.find((/** @type {any} */ x) => x.key === k);
    return a ? (a.value.stringValue ?? a.value.intValue ?? a.value.doubleValue ?? a.value.boolValue) : undefined;
  };
  const root = spans[0];
  ok("root span is `invoke_agent pr-reviewer`, operation invoke_agent, agent id = run id",
    root.name === "invoke_agent pr-reviewer" && get(root, "gen_ai.operation.name") === "invoke_agent" && get(root, "gen_ai.agent.id") === "r1");
  ok("no span is a `chat` or `execute_tool` span (the plugin owns those; no double counting)",
    spans.every((/** @type {any} */ s) => !/^(chat|execute_tool)\b/.test(s.name) && !["chat", "execute_tool"].includes(get(s, "gen_ai.operation.name"))));
  ok("only the root carries gen_ai.operation.name", spans.filter((/** @type {any} */ s) => get(s, "gen_ai.operation.name") !== undefined).length === 1);
  ok("every span carries the identity and VCS keys the plugin puts on every span",
    spans.every((/** @type {any} */ s) => get(s, "gen_ai.agent.name") === "pr-reviewer" && get(s, "gen_ai.conversation.id") === "r1"
      && get(s, "dash0.gen_ai.vcs.repository.name") === "sync-tray" && get(s, "dash0.gen_ai.vcs.owner.name") === "mthines"
      && get(s, "dash0.gen_ai.vcs.pull_request.url") === "https://github.com/mthines/sync-tray/pull/72"
      && get(s, "dash0.gen_ai.vcs.ref.head.revision") === "bfd6662"));
  {
    // finalize.mjs overrides the budgeted topology with the one that ran (a hybrid budget whose
    // intent worker never delivered ran in-context); both the root span and the run histogram
    // must carry the override, not the begin-time value.
    const ranRun = /** @type {BuiltRun} */ (buildRun(/** @type {any} */ ([...ledger, { t: "attr", target: "run", ns: ledger[ledger.length - 1].ns, attrs: { topology: "in-context" } }])));
    const rex = toExporter(ranRun, env);
    const rroot = /** @type {any} */ (rex.tracePayload()).resourceSpans[0].scopeSpans[0].spans[0];
    const runHist = /** @type {any} */ (rex.metricPayload()).resourceMetrics[0].scopeMetrics[0].metrics.find((/** @type {any} */ m) => m.name === "pr_review.run.duration");
    const histTopology = runHist?.histogram?.dataPoints?.[0]?.attributes?.find((/** @type {any} */ a) => a.key === "pr_review.topology")?.value?.stringValue;
    ok("a finalize-recorded topology overrides the budgeted one on the root span and the run histogram",
      get(rroot, "pr_review.topology") === "in-context" && histTopology === "in-context", `root=${get(rroot, "pr_review.topology")} hist=${histTopology}`);
  }
  const phaseSpans = spans.filter((/** @type {any} */ s) => s.name.startsWith("pr_review.phase "));
  const prepSpan = spans.find((/** @type {any} */ s) => s.name === "pr_review.step prepare");
  ok("every step and worker parents the root, in one deterministic trace",
    spans.slice(1).filter((/** @type {any} */ s) => !phaseSpans.includes(s)).every((/** @type {any} */ s) => s.parentSpanId === root.spanId && s.traceId === root.traceId)
      && root.traceId === traceIdFor("r1"));
  ok("a script's internal phases are child spans of its step, with their own start and end (a malformed one is dropped)",
    phaseSpans.length === 2 && phaseSpans.every((/** @type {any} */ s) => s.parentSpanId === prepSpan?.spanId)
      && phaseSpans.map((/** @type {any} */ s) => get(s, "pr_review.phase.name")).join(",") === "fetch,workspace"
      && Number(BigInt(phaseSpans[1].endTimeUnixNano) - BigInt(phaseSpans[1].startTimeUnixNano)) / 1e9 === 6);
  ok("the root carries a readable session title for AI Coding Insights",
    get(root, "gen_ai.conversation.name") === "pr-reviewer mthines/sync-tray#72"
      && spans.slice(1).every((/** @type {any} */ s) => get(s, "gen_ai.conversation.name") === undefined));
  const joinedRoot = /** @type {any} */ (toExporter({ ...run, facts: { ...facts, conversation_id: "claude-session-1" } }, env).tracePayload()).resourceSpans[0].scopeSpans[0].spans[0];
  ok("a run joined to a harness session never renames that session", get(joinedRoot, "gen_ai.conversation.name") === undefined);
  const sumPrep = summarize(run).steps[0];
  ok("the summary lists a step's internal phases", JSON.stringify((sumPrep.phases || []).map((g) => g.name)) === JSON.stringify(["fetch", "workspace"]));
  const failedStep = /** @type {BuiltRun} */ (buildRun(/** @type {any} */ ([
    at(0, { t: "run", run_id: "r3", facts }),
    at(1, { t: "step", phase: "start", name: "finalize" }),
    at(2, { t: "step", phase: "end", status: "error", message: "render failed" }),
    at(3, { t: "step", phase: "start", name: "finalize" }),
    at(4, { t: "step", phase: "end" }),
    at(4, { t: "finish", status: "ok" }),
  ])));
  const fsSpans = /** @type {any} */ (toExporter(failedStep, env).tracePayload()).resourceSpans[0].scopeSpans[0].spans;
  const counted = /** @type {BuiltRun} */ (buildRun(/** @type {any} */ ([
    at(0, { t: "run", run_id: "r4", facts }),
    at(1, { t: "step", phase: "start", name: "finders", attrs: { tool_calls_so_far: 20 } }),
    at(50, { t: "step", phase: "start", name: "verify", attrs: { tool_calls_so_far: 31 } }),
    at(90, { t: "step", phase: "start", name: "validate", attrs: { tool_calls_so_far: 33 } }),
    at(95, { t: "finish", status: "ok" }),
  ])));
  const cex = toExporter(counted, env);
  const callHist = /** @type {any} */ (cex.metricPayload()).resourceMetrics[0].scopeMetrics[0].metrics.filter((/** @type {any} */ m) => m.name === "pr_review.step.tool_calls");
  ok("per-step tool calls come from consecutive model-reported counts, with a histogram per step",
    counted.steps.find((x) => x.name === "finders")?.attrs.tool_calls === 11 && counted.steps.find((x) => x.name === "verify")?.attrs.tool_calls === 2
      && counted.steps.find((x) => x.name === "validate")?.attrs.tool_calls === undefined && counted.runAttrs.tool_calls_reported === 33
      && callHist.length === 2 && summarize(counted).steps.find((x) => x.name === "verify")?.tool_calls === 2);
  ok("a failed step is an ERROR step span, and the run it recovered from still finishes OK",
    fsSpans[0].status.code === 0 && fsSpans.filter((/** @type {any} */ s) => s.name === "pr_review.step finalize").map((/** @type {any} */ s) => s.status.code).join(",") === "2,0"
      && get(fsSpans.find((/** @type {any} */ s) => s.status.code === 2), "error.type") === "step_failed");
  const badKeys = spans.flatMap((/** @type {any} */ s) => s.attributes.map((/** @type {any} */ a) => a.key)).filter((/** @type {string} */ k) => !ALLOWED_SPAN_KEY(k));
  ok("every attribute key is in the declared contract", badKeys.length === 0, [...new Set(badKeys)].join(","));
  ok("rule 3 — a run with no memory record carries no memory attribute and no event",
    run.memory === null && root.events === undefined && spans.every((/** @type {any} */ s) => s.attributes.every((/** @type {any} */ a) => !a.key.startsWith("pr_review.memory."))));

  // The memory: which LoreKit memories the review used and read, each pointing back at LoreKit.
  {
    const UUID_A = "9b2c1d34-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
    const UUID_B = "1bf3d1ed-7663-479b-be61-a01cfc0073c4";
    const memLedger = [
      ...ledger.slice(0, -1),
      at(105, { t: "memory", read_reported: true, items: [{ used: true, read: false, kind: "rule", key: "stale" }] }),
      at(108, { t: "memory", read_reported: true, items: [
        { used: true, read: true, kind: "rule", id: UUID_A, scope: "repo::mthines/sync-tray", key: "reviewer-comment-relevance::rule::correctness:nil-deref:-@src/a.ts",
          action: "suppress", fingerprint: "correctness:nil-deref:-@src/a.ts", seen_count: 4, suppressed: 1 },
        { used: true, read: false, kind: "hotspot", scope: "repo::mthines/sync-tray", key: "hotspot::src/a.ts", note: "finder pointer (re-verified)" },
        { used: false, read: true, kind: "knowledge", id: UUID_B, scope: "repo::mthines/sync-tray", key: "knowledge::retry@src/b.ts" },
        { used: true, read: false, kind: "lesson", key: "orphan-lesson" },
        { used: false, read: false, kind: "lesson", id: UUID_A, key: "neither" },
        { used: true, read: true, kind: "made-up", note: "no id and no key" },
        "not an object",
      ] }),
      ledger[ledger.length - 1],
    ];
    const memRun = /** @type {BuiltRun} */ (buildRun(/** @type {any} */ (memLedger)));
    ok("the last memory record wins, and an entry nothing identifies or neither used nor read is dropped",
      memRun.memory !== null && memRun.memory.items.length === 4 && memRun.memory.items.every((m) => m.key !== "stale" && m.key !== "neither"));
    const mRoot = /** @type {any} */ (toExporter(memRun, env).tracePayload()).resourceSpans[0].scopeSpans[0].spans[0];
    ok("the root counts used and read memories and lists the used ones' LoreKit ids",
      get(mRoot, "pr_review.memory.used") === "3" && get(mRoot, "pr_review.memory.read") === "2" && get(mRoot, "pr_review.memory.used_ids") === UUID_A);
    const events = mRoot.events || [];
    const ev = (/** @type {string} */ key) => events.find((/** @type {any} */ e) => get(e, "pr_review.memory.key") === key);
    ok("one event per memory on the root: pr_review.memory.used for a used one, pr_review.memory.read for a read-only one",
      events.length === 4 && events.filter((/** @type {any} */ e) => e.name === "pr_review.memory.used").length === 3
        && ev("knowledge::retry@src/b.ts")?.name === "pr_review.memory.read");
    const rule = ev("reviewer-comment-relevance::rule::correctness:nil-deref:-@src/a.ts");
    ok("a memory event carries its LoreKit id, scope, key, kind, and what it did",
      get(rule, "pr_review.memory.id") === UUID_A && get(rule, "pr_review.memory.scope") === "repo::mthines/sync-tray"
        && get(rule, "pr_review.memory.kind") === "rule" && get(rule, "pr_review.memory.action") === "suppress"
        && get(rule, "pr_review.memory.suppressed") === "1" && get(rule, "pr_review.memory.seen_count") === "4"
        && get(ev("hotspot::src/a.ts"), "pr_review.memory.note") === "finder pointer (re-verified)");
    ok("the deep link opens the memory by id, falls back to scope + key, and is omitted when neither is known",
      get(rule, "pr_review.memory.url") === `https://lorekit.io/lore?memoryId=${UUID_A}`
        && get(ev("hotspot::src/a.ts"), "pr_review.memory.url") === "https://lorekit.io/lore?scope=%22repo%3A%3Amthines%2Fsync-tray%22&lesson=%7B%22scope%22%3A%22repo%3A%3Amthines%2Fsync-tray%22%2C%22key%22%3A%22hotspot%3A%3Asrc%2Fa.ts%22%7D"
        && get(ev("orphan-lesson"), "pr_review.memory.url") === undefined);
    ok("memoryUrl matches LoreKit's documented scope + key example, and honours LOREKIT_APP_URL",
      memoryUrl({ scope: "global", key: "prefer-guard-clauses" }) === "https://lorekit.io/lore?scope=%22global%22&lesson=%7B%22scope%22%3A%22global%22%2C%22key%22%3A%22prefer-guard-clauses%22%7D"
        && get((/** @type {any} */ (toExporter(memRun, { ...env, LOREKIT_APP_URL: "https://lore.example.com/" }).tracePayload())).resourceSpans[0].scopeSpans[0].spans[0].events?.[0], "pr_review.memory.url") === `https://lore.example.com/lore?memoryId=${UUID_A}`
        && memoryUrl({ id: "not-a-uuid", key: "k" }) === null);
    ok("every memory event sits inside the run and every event attribute key is in the declared contract",
      events.every((/** @type {any} */ e) => BigInt(e.timeUnixNano) >= memRun.startNs && BigInt(e.timeUnixNano) <= memRun.endNs
        && e.attributes.every((/** @type {any} */ a) => ALLOWED_SPAN_KEY(a.key))));
    ok("memory events ride the root only — no step or worker span carries one",
      /** @type {any} */ (toExporter(memRun, env).tracePayload()).resourceSpans[0].scopeSpans[0].spans.slice(1).every((/** @type {any} */ s) => s.events === undefined));
    const unreported = /** @type {BuiltRun} */ (buildRun(/** @type {any} */ ([...ledger.slice(0, -1), at(108, { t: "memory", items: [] }), ledger[ledger.length - 1]])));
    const uRoot = /** @type {any} */ (toExporter(unreported, env).tracePayload()).resourceSpans[0].scopeSpans[0].spans[0];
    ok("a recorded memory with nothing used is a real 0; a read list the run never reported is omitted, not 0",
      get(uRoot, "pr_review.memory.used") === "0" && get(uRoot, "pr_review.memory.read") === undefined
        && get(uRoot, "pr_review.memory.used_ids") === undefined && uRoot.events === undefined);
    const many = memoryItems(Array.from({ length: 80 }, (_, i) => ({ used: true, key: `k${i}` })));
    ok("at most MEMORY_EVENTS_MAX memories are kept", many.length === MEMORY_EVENTS_MAX && MEMORY_EVENTS_MAX === 50);
    const sumMem = summarize(memRun, {});
    ok("the summary lists the memory: counts, and each memory with its deep link",
      sumMem.memory?.used === 3 && sumMem.memory?.read === 2 && sumMem.memory?.items[0].url === `https://lorekit.io/lore?memoryId=${UUID_A}`
        && /memory 3 used · 2 read/.test(renderSummary(sumMem)) && renderSummary(sumMem).includes(`lore?memoryId=${UUID_A}`)
        && summarize(run).memory === undefined);
  }
  const verifySpan = spans.find((/** @type {any} */ s) => s.name === "pr_review.step verify");
  ok("rule 2 — a step that found nothing stays UNSET", verifySpan?.status.code === 0 && get(verifySpan, "pr_review.candidates") === "0");
  ok("marker attributes are namespaced under pr_review.* on the root",
    get(root, "pr_review.verdict") === "FAIL" && get(root, "pr_review.posted_inline") === "9");
  ok("rule 3 — an unknown model emits no gen_ai.request.model or provider, never a placeholder",
    get(root, "gen_ai.request.model") === undefined && get(root, "gen_ai.provider.name") === undefined);
  const metrics = /** @type {any} */ (ex.metricPayload()).resourceMetrics[0].scopeMetrics[0].metrics;
  const stepHist = metrics.filter((/** @type {any} */ m) => m.name === "pr_review.step.duration");
  ok("one pr_review.step.duration series per step name, keyed by step and kind only (no run id)",
    stepHist.length === 5 && stepHist.every((/** @type {any} */ m) => m.histogram.dataPoints[0].attributes.every((/** @type {any} */ a) => ["pr_review.step.name", "pr_review.step.kind", "gen_ai.agent.name"].includes(a.key))));

  // The run counter: countable with increase() because every series has its own 0 baseline.
  {
    const pointVal = (/** @type {any} */ p, /** @type {string} */ k) => {
      const a = p.attributes.find((/** @type {any} */ x) => x.key === k);
      return a ? (a.value.stringValue ?? a.value.boolValue) : undefined;
    };
    /** @param {any} m @returns {Map<string, any[]>} */
    const byVerdict = (m) => {
      const out = new Map();
      for (const p of m.sum.dataPoints) {
        const v = String(pointVal(p, "pr_review.verdict"));
        out.set(v, [...(out.get(v) || []), p]);
      }
      return out;
    };
    const counter = metrics.find((/** @type {any} */ m) => m.name === RUN_COUNTER);
    ok("pr_review.runs is a monotonic CUMULATIVE sum with unit {run}",
      counter?.unit === "{run}" && counter?.sum?.aggregationTemporality === 2 && counter?.sum?.isMonotonic === true);
    const series = byVerdict(counter);
    ok("one counter series per verdict: PASS, WARN, FAIL, and none",
      [...series.keys()].sort().join() === "FAIL,PASS,WARN,none", [...series.keys()].join());
    ok("every counter point starts at the run's start",
      counter.sum.dataPoints.every((/** @type {any} */ p) => p.startTimeUnixNano === String(run.startNs)));
    const gapsOk = [...series.values()].every((pts) => pts.every((/** @type {any} */ p, /** @type {number} */ i) => {
      const t = BigInt(p.timeUnixNano);
      const prev = i === 0 ? run.startNs : BigInt(pts[i - 1].timeUnixNano);
      return t > prev && t - prev <= 30n * S; // 30 s literally, not the constant: raising the constant must fail here
    }));
    ok("each series has a 0 just after the start and then at most every 30 s, so a window boundary inside the run always has a baseline",
      gapsOk && [...series.values()].every((pts) => pts[0].asInt === "0" && BigInt(pts[pts.length - 1].timeUnixNano) === run.endNs));
    ok("the final point is 1 on the run's verdict and 0 on the others; every earlier point is 0",
      [...series.entries()].every(([v, pts]) => pts.slice(0, -1).every((/** @type {any} */ p) => p.asInt === "0")
        && pts[pts.length - 1].asInt === (v === "FAIL" ? "1" : "0")));
    ok("counter attributes are only verdict, dry run, and tier — nothing that first appears at the end",
      counter.sum.dataPoints.every((/** @type {any} */ p) => p.attributes.every((/** @type {any} */ a) => ["pr_review.verdict", "pr_review.dry_run", "pr_review.tier"].includes(a.key))
        && pointVal(p, "pr_review.tier") === "deep"));
    const res = /** @type {any} */ (ex.metricPayload()).resourceMetrics[0].resource.attributes;
    const instanceOf = (/** @type {any[]} */ r) => r.find((a) => a.key === "service.instance.id")?.value?.stringValue;
    const otherRun = toExporter(/** @type {BuiltRun} */ (failedStep), env);
    ok("the resource's service.instance.id is the run's trace id, so no two runs share a series",
      instanceOf(res) === traceIdFor("r1") && instanceOf(/** @type {any} */ (otherRun.metricPayload()).resourceMetrics[0].resource.attributes) === traceIdFor("r3"));
    const noVerdict = runCounterPoints(/** @type {BuiltRun} */ (failedStep));
    ok("a run that finished without a verdict counts once under `none`",
      noVerdict.verdict === "none" && noVerdict.points.filter((p) => p.value === 1).length === 1
        && noVerdict.points.filter((p) => p.value === 1)[0].attributes["pr_review.verdict"] === "none");
    const dry = runCounterPoints(/** @type {BuiltRun} */ (buildRun(/** @type {any} */ ([...ledger.slice(0, -1), at(110, { t: "attr", target: "run", attrs: { dry_run: true } }), ledger[ledger.length - 1]]))));
    ok("a dry run's points all carry pr_review.dry_run=true; a run with no dry-run fact omits it",
      dry.points.every((p) => p.attributes["pr_review.dry_run"] === true)
        && runCounterPoints(run).points.every((p) => p.attributes["pr_review.dry_run"] === null));
    const odd = runCounterPoints({ ...run, runAttrs: { ...run.runAttrs, verdict: "SKIP" } });
    const oddSeries = odd.points.filter((p) => p.attributes["pr_review.verdict"] === "SKIP");
    ok("a verdict outside the known set still gets its own 0 before its 1",
      oddSeries.length >= 2 && oddSeries[0].value === 0 && oddSeries[oddSeries.length - 1].value === 1);
    const long = runCounterPoints({ ...run, endNs: run.startNs + 10n * 3600n * S });
    const longPass = long.points.filter((p) => p.attributes["pr_review.verdict"] === "PASS");
    ok("a 10-hour run keeps at most 480 points per series: its first 0 and the last ones before its end",
      longPass.length === 480 && longPass[0].timeNs === run.startNs + 1_000_000n
        && longPass[longPass.length - 1].timeNs - longPass[longPass.length - 2].timeNs <= 30n * S);
    const instant = runCounterPoints({ ...run, endNs: run.startNs });
    ok("a run that ends the moment it starts still writes a 0 before its 1",
      instant.points.filter((p) => p.attributes["pr_review.verdict"] === "FAIL").map((p) => `${p.value}`).join() === "0,1"
        && instant.points.every((p) => p.timeNs > run.startNs));
  }

  // The harness rule.
  const withHarness = (/** @type {RunFacts} */ extra) => identityAttributes({ ...run, facts: { ...facts, ...extra } }, {})["gen_ai.harness.name"];
  ok("inside a plugin-covered harness with no joined session, no gen_ai.harness.name (no phantom session)",
    withHarness({ harness: "claude-code" }) === null);
  ok("joined to the harness session through gen_ai.conversation.id, the harness is named",
    withHarness({ harness: "claude-code", conversation_id: "sess-1" }) === "claude-code");
  ok("a harness the plugin does not cover (agent0, CI) is always named", withHarness({ harness: "agent0" }) === "agent0");

  // The scope rule: AI SDLC Insights' scope only where the run IS the session.
  const scopeOf = (/** @type {RunFacts} */ extra) => {
    const e = toExporter({ ...run, facts: { ...facts, ...extra } }, env);
    return [/** @type {any} */ (e.tracePayload()).resourceSpans[0].scopeSpans[0].scope.name,
      /** @type {any} */ (e.metricPayload()).resourceMetrics[0].scopeMetrics[0].scope.name];
  };
  ok("an agent0 run exports its trace and metrics under the AI SDLC Insights scope",
    scopeOf({ harness: "agent0" }).every((n) => n === INSIGHTS_SCOPE_NAME), scopeOf({ harness: "agent0" }).join());
  ok("every other run keeps agent-skills/pr-reviewer: a plugin harness joined or not, CI, smoke, and no harness",
    [{ harness: "claude-code" }, { harness: "claude-code", conversation_id: "sess-1" }, { harness: "cursor", conversation_id: "s" },
      { harness: "github-actions" }, { harness: "local-smoke" }, {}].every((x) => scopeOf(x).every((n) => n === SCOPE_NAME)));
  ok("no harness is both a session harness and a plugin harness (a review is never counted twice)",
    [...SESSION_HARNESSES].every((h) => !PLUGIN_HARNESSES.has(h)));

  // The OpenCode tool call that started the run: the handle back to the Agent0 run.
  ok("hostFacts records OPENCODE_PARENT_TOOL_CALL_ID and ignores a value that is not an id",
    hostFacts({ OPENCODE_PARENT_TOOL_CALL_ID: "toolu_vrtx_01abc" }).opencode_parent_tool_call_id === "toolu_vrtx_01abc"
      && hostFacts({ OPENCODE_PARENT_TOOL_CALL_ID: "x; rm -rf /" }).opencode_parent_tool_call_id === undefined
      && hostFacts({}).opencode_parent_tool_call_id === undefined);
  const tcSpans = /** @type {any} */ (toExporter({ ...run, facts: { ...facts, opencode_parent_tool_call_id: "toolu_1" } }, env).tracePayload()).resourceSpans[0].scopeSpans[0].spans;
  ok("the root carries pr_review.opencode.parent_tool_call_id, no other span does, and a run without one omits it",
    get(tcSpans[0], "pr_review.opencode.parent_tool_call_id") === "toolu_1"
      && tcSpans.slice(1).every((/** @type {any} */ s) => get(s, "pr_review.opencode.parent_tool_call_id") === undefined)
      && get(root, "pr_review.opencode.parent_tool_call_id") === undefined);
  ok("providerForModel follows the plugin's mapping",
    providerForModel("claude-opus-5-5") === "anthropic" && providerForModel("o3") === "openai" && providerForModel("gemini-2") === "gcp.gemini" && providerForModel("x") === null);
  ok("parseHeaders decodes percent-encoded values (the OTel spec form)",
    parseHeaders("Authorization=Bearer%20abc,Dash0-Dataset=default").Authorization === "Bearer abc");
  ok("rule 1 — a host's OTEL_EXPORTER_OTLP_ENDPOINT alone is never used (opt-in only)",
    exportTarget({ OTEL_EXPORTER_OTLP_ENDPOINT: "https://host", OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer x" }).endpoint === "");
  ok("PR_REVIEWER_TELEMETRY=on reuses the standard OTEL_* variables",
    exportTarget({ PR_REVIEWER_TELEMETRY: "on", OTEL_EXPORTER_OTLP_ENDPOINT: "https://host", OTEL_EXPORTER_OTLP_HEADERS: "Dash0-Dataset=d" }).headers["Dash0-Dataset"] === "d");
  ok("PR_REVIEWER_TELEMETRY=off disables export even with an endpoint",
    exportTarget({ PR_REVIEWER_TELEMETRY: "off", PR_REVIEWER_OTLP_ENDPOINT: "https://x" }).endpoint === "");
  ok("PR_REVIEWER_OTLP_ENDPOINT wins over the host's OTEL_EXPORTER_OTLP_ENDPOINT",
    exportTarget({ PR_REVIEWER_TELEMETRY: "on", PR_REVIEWER_OTLP_ENDPOINT: "https://mine", OTEL_EXPORTER_OTLP_ENDPOINT: "https://host" }).endpoint === "https://mine");

  // Agent0 host detection (the reviewer-only installer writes only AGENT0_ENV_FILE).
  ok("detectHarness: the reviewer-only Agent0 install (pr-reviewer/env.sh) is agent0",
    detectHarness({}, (p) => p === AGENT0_ENV_FILE) === "agent0"
      && detectHarness({}, (p) => p === "/tmp/workspace/agent-skills/env.sh") === "agent0"
      && detectHarness({}, () => false) === null);
  // The ledger on disk, end to end through a real OTLP receiver.
  const dir = mkdtempSync(join(tmpdir(), "review-telemetry-"));
  /** @type {Array<{ path: string, body: any }>} */
  const received = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      try { received.push({ path: String(req.url), body: JSON.parse(body) }); } catch { received.push({ path: String(req.url), body: null }); }
      res.writeHead(200, { "content-type": "application/json" }); res.end("{}");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(null)));
  const port = /** @type {import("node:net").AddressInfo} */ (server.address()).port;
  try {
    const runDir = join(dir, "run");
    const id1 = beginRun(runDir, facts);
    const id2 = beginRun(runDir, { model: "claude-opus-5-5" });
    ok("begin is idempotent: a second begin adds facts to the same run", id1 === id2 && readLedger(runDir).filter((r) => r.t === "run").length === 1);
    const tcDir = join(dir, "toolcall");
    beginRun(tcDir, { ...facts, opencode_parent_tool_call_id: "toolu_first" });
    beginRun(tcDir, { opencode_parent_tool_call_id: "toolu_later", model: "claude-opus-5-5" });
    const tcRun = buildRun(readLedger(tcDir));
    ok("a later begin adds facts but keeps the tool call that started the run",
      tcRun?.facts.opencode_parent_tool_call_id === "toolu_first" && tcRun?.facts.model === "claude-opus-5-5");
    appendRecord(runDir, { t: "step", phase: "start", name: "prepare" });
    appendRecord(runDir, { t: "step", phase: "end" });
    const otherDir = join(dir, "shared");
    const a = beginRun(otherDir, facts);
    const b = beginRun(otherDir, { ...facts, number: 73 });
    ok("a begin for another PR in the same directory rotates the old ledger, never merges into it",
      a !== b && existsSync(join(otherDir, `telemetry.${a}.jsonl`)) && readLedger(otherDir).filter((r) => r.t === "run").length === 1);
    appendFileSync(ledgerPath(runDir), "{torn line\n");
    ok("a torn ledger line is skipped, never fatal", readLedger(runDir).length === 4);
    appendRecord(runDir, { t: "memory", read_reported: true, items: [{ used: true, read: true, kind: "knowledge", id: "cb10f4e2-eaf1-48e1-933c-e633a23e2716", scope: "repo::mthines/sync-tray", key: "knowledge::retry@src/b.ts" }] });
    const off = await finishRun(runDir, {}, {});
    ok("rule 1 — no endpoint: nothing exported, but the summary is written", off.exported === false && existsSync(join(runDir, SUMMARY_FILE)));
    const on = await finishRun(runDir, { force: true, attrs: { verdict: "PASS" } }, { PR_REVIEWER_OTLP_ENDPOINT: `http://127.0.0.1:${port}` });
    ok("with an endpoint: exported to /v1/traces and /v1/metrics", on.exported === true
      && received.some((r) => r.path === "/v1/traces") && received.some((r) => r.path === "/v1/metrics"));
    const tr = received.find((r) => r.path === "/v1/traces")?.body;
    const rootSpan = tr?.resourceSpans?.[0]?.scopeSpans?.[0]?.spans?.[0];
    ok("the received trace's root carries the model's provider once `begin` supplied the model",
      rootSpan?.name === "invoke_agent pr-reviewer" && get(rootSpan, "gen_ai.provider.name") === "anthropic" && get(rootSpan, "gen_ai.request.model") === "claude-opus-5-5");
    ok("the received root carries the memory the run used, as an event with its LoreKit id and deep link",
      get(rootSpan, "pr_review.memory.used_ids") === "cb10f4e2-eaf1-48e1-933c-e633a23e2716" && rootSpan?.events?.length === 1
        && rootSpan.events[0].name === "pr_review.memory.used"
        && get(rootSpan.events[0], "pr_review.memory.url") === "https://lorekit.io/lore?memoryId=cb10f4e2-eaf1-48e1-933c-e633a23e2716");
    const rm = received.find((r) => r.path === "/v1/metrics")?.body?.resourceMetrics?.[0];
    const rc = rm?.scopeMetrics?.[0]?.metrics?.find((/** @type {any} */ m) => m.name === RUN_COUNTER);
    const rcFinal = (rc?.sum?.dataPoints || []).filter((/** @type {any} */ p) => p.asInt === "1");
    // This run's first finish carried no verdict, so its root has none: the counter must agree.
    const rootVerdict = get(rootSpan, "pr_review.verdict") ?? "none";
    ok("the received metrics carry pr_review.runs with the run's instance id, and exactly one 1 — on the root span's verdict",
      rm?.resource?.attributes?.some((/** @type {any} */ a) => a.key === "service.instance.id" && a.value.stringValue === on.trace_id)
        && rcFinal.length === 1 && rcFinal[0].attributes.some((/** @type {any} */ a) => a.key === "pr_review.verdict" && a.value.stringValue === rootVerdict),
      `root=${rootVerdict} ones=${JSON.stringify(rcFinal.map((/** @type {any} */ p) => p.attributes))}`);
    const before = received.length;
    const again = await finishRun(runDir, {}, { PR_REVIEWER_OTLP_ENDPOINT: `http://127.0.0.1:${port}` });
    ok("finish is idempotent: an exported run is not exported twice", received.length === before && again.skipped === "already exported");
    const deadDir = join(dir, "dead");
    beginRun(deadDir, facts);
    const dead = await finishRun(deadDir, {}, { PR_REVIEWER_OTLP_ENDPOINT: "http://127.0.0.1:1" });
    ok("rule 4 — an unreachable backend is exported:false, never a throw", dead.exported === false);
    const errDir = join(dir, "err");
    beginRun(errDir, facts);
    await finishRun(errDir, { status: "error", message: "finalize exited 1" }, {});
    const errRun = /** @type {BuiltRun} */ (buildRun(readLedger(errDir)));
    ok("a failed run marks the root ERROR with its message", errRun.status === 2 && errRun.message === "finalize exited 1");

    // CLI: a misuse never fails the command it is chained in front of (rule 4).
    const self = fileURLToPath(import.meta.url);
    const { spawnSync } = await import("node:child_process");
    const cliDir = join(dir, "cli");
    const r1 = spawnSync(process.execPath, [self, "step", "Bad Name", "--run-dir", cliDir], { encoding: "utf8" });
    ok("CLI: a bad step name exits 0 with a warning", r1.status === 0 && /ignored/.test(r1.stderr));
    spawnSync(process.execPath, [self, "begin", "--run-dir", cliDir, "--repo", "o/r", "--pr", "3"], { encoding: "utf8", env: { ...process.env, PR_REVIEWER_TELEMETRY: "off" } });
    spawnSync(process.execPath, [self, "step", "finders", "--run-dir", cliDir, "--attr", "candidates=4"], { encoding: "utf8" });
    const r2 = spawnSync(process.execPath, [self, "finish", "--run-dir", cliDir], { encoding: "utf8", env: { ...process.env, PR_REVIEWER_TELEMETRY: "off" } });
    const cliSummary = JSON.parse(readFileSync(join(cliDir, SUMMARY_FILE), "utf8"));
    ok("CLI: begin → step → finish writes a summary with the marked step", r2.status === 0
      && cliSummary.steps.some((/** @type {any} */ s) => s.name === "finders" && s.marked === true));

    const workerDir = join(dir, "intent");
    mkdirSync(workerDir, { recursive: true });
    const doneAt = Date.now() - 5000;
    writeFileSync(join(workerDir, "context.json"), JSON.stringify({ generatedAt: new Date(doneAt).toISOString(), elapsedMs: 9000 }));
    writeFileSync(join(workerDir, "intent.json"), "[]");
    const impDir = join(dir, "imp");
    beginRun(impDir, facts);
    spawnSync(process.execPath, [self, "worker", "intent", "import", "--from", workerDir, "--done", join(workerDir, "intent.json"), "--run-dir", impDir], { encoding: "utf8" });
    const imported = readLedger(impDir).filter((r) => r.t === "worker");
    ok("CLI: worker import reads a --no-telemetry worker's span from its context.json and output file",
      imported.length === 2 && BigInt(imported[0].ns) === BigInt(doneAt - 9000) * 1_000_000n && BigInt(imported[1].ns) > BigInt(doneAt) * 1_000_000n);

    // Dispatch time: a worker directory with a `dispatched_at` stamp starts the worker AND the run
    // at the dispatch, and the run's first gap is `load` — the agent reading its definition.
    const dispDir = join(dir, "intent-72-1790000000");
    mkdirSync(dispDir, { recursive: true });
    const workerStart = doneAt - 9000;
    writeFileSync(join(dispDir, "context.json"), JSON.stringify({ generatedAt: new Date(doneAt).toISOString(), elapsedMs: 9000 }));
    writeFileSync(join(dispDir, "intent.json"), "[]");
    writeFileSync(join(dispDir, "dispatched_at"), String(workerStart - 40_000));
    const dRun = join(dir, "disp");
    beginRun(dRun, facts);
    const imp2 = spawnSync(process.execPath, [self, "worker", "intent", "import", "--from", dispDir, "--done", join(dispDir, "intent.json"), "--run-dir", dRun], { encoding: "utf8" });
    ok("worker import says what it folded in, on stderr", /worker intent folded in — [\d.]+s long/.test(imp2.stderr) && /starts at the dispatch/.test(imp2.stderr), imp2.stderr);
    const dBuilt = /** @type {BuiltRun} */ (buildRun(readLedger(dRun)));
    ok("a dispatch stamp starts the run and the worker at the dispatch, and the first gap is `load`",
      dBuilt.startNs === BigInt(workerStart - 40_000) * 1_000_000n && dBuilt.workers[0].startNs === dBuilt.startNs
        && dBuilt.steps[0].name === "load" && dBuilt.steps[0].marked === false);
    ok("dispatchTime reads the /pr-review directory suffix, and ignores a stamp after or long before the worker",
      dispatchTime("/x/intent-72-1790000100", 1_790_000_200n * S) === 1_790_000_100n * S
        && dispatchTime("/x/intent-72-1790000300", 1_790_000_200n * S) === null
        && dispatchTime("/x/intent-72-1780000000", 1_790_000_200n * S) === null
        && dispatchTime("/x/intent", 1_790_000_200n * S) === null);
    // The stamp as three shells write it: ms (GNU `date +%s%3N`, node), seconds (`date +%s`), and
    // BSD `date +%s%3N`, which prints the seconds and a literal `3N` (dash0#20655, round 1).
    const stampDir = join(dir, "stamps");
    mkdirSync(stampDir, { recursive: true });
    const readStamp = (/** @type {string} */ v) => { writeFileSync(join(stampDir, "dispatched_at"), v); return dispatchTime(stampDir, 1_790_000_200n * S); };
    ok("dispatchTime reads a ms, a seconds, and a BSD `%3N` stamp, and rejects garbage",
      readStamp("1790000100123\n") === 1_790_000_100_123n * 1_000_000n
        && readStamp("1790000100") === 1_790_000_100n * S
        && readStamp("17900001003N") === 1_790_000_100n * S
        && readStamp("soon") === null);
    // The worker wrote its context somewhere else: the stamp and the output file are enough.
    const bareDir = join(dir, "intent-bare");
    mkdirSync(bareDir, { recursive: true });
    writeFileSync(join(bareDir, "intent.json"), "[]");
    writeFileSync(join(bareDir, "dispatched_at"), String(Date.now() - 60_000));
    const bRun = join(dir, "bare");
    beginRun(bRun, facts);
    const imp3 = spawnSync(process.execPath, [self, "worker", "intent", "import", "--from", bareDir, "--done", join(bareDir, "intent.json"), "--run-dir", bRun], { encoding: "utf8" });
    const bBuilt = /** @type {BuiltRun} */ (buildRun(readLedger(bRun)));
    ok("worker import with only the stamp and the output file still folds the worker in and starts the run at the dispatch",
      bBuilt.workers.length === 1 && bBuilt.steps[0].name === "load" && /starts at the dispatch/.test(imp3.stderr), imp3.stderr);
    // Caller-prepared hybrid run (pr-review SKILL.md § Step 2): the caller's `prepare` begins the
    // run, its `dispatch` marks when it sent the reviewer, and the reviewer waits for the intent
    // file only after verifying its own candidates.
    const lateLedger = [
      at(0, { t: "run", run_id: "late", facts }),
      at(0, { t: "step", phase: "start", name: "prepare" }), at(20, { t: "step", phase: "end" }),
      at(25, { t: "dispatch" }),
      at(60, { t: "step", phase: "start", name: "memory" }),
      at(300, { t: "step", phase: "start", name: "verify" }),
      at(400, { t: "step", phase: "start", name: "intent-wait" }),
      at(402, { t: "step", phase: "start", name: "intent-verify" }),
      at(450, { t: "finish", status: "ok" }),
    ];
    const late = /** @type {BuiltRun} */ (buildRun(/** @type {any} */ (lateLedger), t0 + 500n * S));
    ok("a dispatch after `prepare` names the gap holding it `load`, and the run still starts at prepare",
      late.startNs === t0 && late.steps.map((x) => x.name).join() === "prepare,load,memory,verify,intent-wait,intent-verify"
        && late.steps[1].marked === false);
    const wRun = join(dir, "wait");
    beginRun(wRun, facts);
    const wDir = join(wRun, "intent");
    mkdirSync(wDir, { recursive: true });
    writeFileSync(join(wDir, "intent.json"), "[]");
    spawnSync(process.execPath, [self, "step", "intent-wait", "--run-dir", wRun], { encoding: "utf8" });
    const wNow = spawnSync(process.execPath, [self, "worker", "intent", "import", "--from", wDir, "--done", join(wDir, "intent.json"), "--wait", "30", "--run-dir", wRun], { encoding: "utf8" });
    const wLedger = readLedger(wRun);
    const wAttrs = wLedger.filter((r) => r.t === "attr" && r.target === "run").map((r) => r.attrs || {});
    ok("--wait on an output already there returns at once, prints `ready`, and records intent_wait_ms on the run and the step",
      /^intent: ready after 0(\.\d)?s wait$/m.test(wNow.stdout) && wAttrs.some((a) => a.intent_wait_ms < 1000 && a.intent_wait_timed_out === false)
        && wLedger.some((r) => r.t === "attr" && r.target === "step" && typeof r.attrs?.intent_wait_ms === "number")
        && wLedger.filter((r) => r.t === "worker").length === 2, wNow.stdout + wNow.stderr);
    const wBuilt = /** @type {BuiltRun} */ (buildRun(readLedger(wRun)));
    ok("the wait lands on the `intent-wait` step span and the worker span",
      typeof wBuilt.steps.find((x) => x.name === "intent-wait")?.attrs.intent_wait_ms === "number" && typeof wBuilt.workers[0]?.attrs.wait_ms === "number");
    const midRun = join(dir, "wait-mid");
    beginRun(midRun, facts);
    const midFile = join(midRun, "intent", "intent.json");
    mkdirSync(dirname(midFile), { recursive: true });
    setTimeout(() => writeFileSync(midFile, "[]"), 250);
    const mid = await waitForOutput(midRun, "intent", midFile, 10, 600, 25);
    ok("waitForOutput returns once the worker's file appears mid-wait, and counts the time waited",
      mid.ready && !mid.timedOut && mid.totalMs >= 200 && mid.totalMs < 5000, JSON.stringify(mid));
    const toRun = join(dir, "wait-timeout");
    beginRun(toRun, facts);
    const missing = join(toRun, "intent", "intent.json");
    const firstWait = await waitForOutput(toRun, "intent", missing, 0.2, 0.3, 25);
    const secondWait = await waitForOutput(toRun, "intent", missing, 0.2, 0.3, 25);
    ok("the wait accumulates across calls and times out at --wait-total, never past it",
      !firstWait.ready && !firstWait.timedOut && !secondWait.ready && secondWait.timedOut
        && secondWait.totalMs >= 300 && secondWait.totalMs < 1500, JSON.stringify([firstWait, secondWait]));
    const toCli = spawnSync(process.execPath, [self, "worker", "intent", "import", "--from", join(toRun, "intent"), "--done", missing, "--wait", "1", "--wait-total", "0.3", "--run-dir", toRun], { encoding: "utf8" });
    ok("CLI: a timed-out wait says to run intent in this context, exits 0, and folds no worker in",
      toCli.status === 0 && /^intent: timed out after [\d.]+s — run the intent finder in this context$/m.test(toCli.stdout)
        && !readLedger(toRun).some((r) => r.t === "worker"), toCli.stdout + toCli.stderr);
    const dCli = spawnSync(process.execPath, [self, "dispatch", "--run-dir", toRun], { encoding: "utf8" });
    ok("CLI: `dispatch` appends the caller's dispatch record", dCli.status === 0 && readLedger(toRun).some((r) => r.t === "dispatch"));

    // A second review in a directory whose previous run was exported is exported too.
    const reuse = join(dir, "reuse");
    const firstId = beginRun(reuse, facts);
    await finishRun(reuse, {}, {});
    writeFileSync(join(reuse, SUMMARY_FILE), JSON.stringify({ run_id: firstId, exported: true }));
    const secondId = beginRun(reuse, facts);
    const second = await finishRun(reuse, {}, {});
    ok("a new run in a reused directory rotates the old summary aside and is finished, not skipped",
      !("skipped" in second) && JSON.parse(readFileSync(join(reuse, SUMMARY_FILE), "utf8")).run_id === secondId
        && existsSync(join(reuse, `telemetry-summary.${firstId}.json`)));
    // A summary another run left behind (a directory written before the rotation) never skips this one.
    writeFileSync(join(reuse, SUMMARY_FILE), JSON.stringify({ run_id: "someone-else", exported: true }));
    const notMine = await finishRun(reuse, {}, {});
    writeFileSync(join(reuse, SUMMARY_FILE), JSON.stringify({ run_id: secondId, exported: true }));
    ok("finishRun skips only when the exported summary is this run's own",
      !("skipped" in notMine) && "skipped" in (await finishRun(reuse, {}, {})));
    // The marker prepare-review.mjs prints: filled in and run as written, it records the step.
    ok("modelSteps lists intent-wait only for hybrid, lenses except on quick, and never state",
      modelSteps({ tier: "deep", topology: "hybrid" }).join() === "memory,gates,finders,lenses,consolidate,verify,intent-wait,intent-verify,judgments,validate,assert"
        && !modelSteps({ tier: "standard", topology: "in-context" }).includes("intent-wait")
        && !modelSteps({ tier: "quick", topology: "in-context" }).includes("lenses")
        && modelSteps({ tier: "deep", topology: "hybrid" }).every((n) => n in STEPS));
    const mRun = join(dir, "marker");
    beginRun(mRun, facts);
    const filled = markerCommand(mRun).replace("<step>", "verify").replace("<N>", "7").replace(/;$/, "");
    const ran = spawnSync("sh", ["-c", `${filled}; echo after`], { encoding: "utf8" });
    const mRecs = readLedger(mRun).filter((r) => r.t === "step" && r.name === "verify");
    ok("markerCommand, filled and run in a fresh shell, records the step and lets the next command run",
      ran.stdout.trim() === "after" && mRecs.length === 1 && mRecs[0].attrs?.tool_calls_so_far === 7, ran.stderr);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }

  console.log(`review-telemetry self-test: ${passed}/${passed + fails.length}`);
  return fails;
}

const isEntryPoint = process.argv[1] && process.argv[1].endsWith("review-telemetry.mjs");
if (isEntryPoint) {
  if (process.argv.includes("--self-test")) {
    const fails = await selfTest();
    console.log(`${fails.length === 0 ? "✓" : "✗"} review-telemetry self-test: ${fails.length === 0 ? "all checks passed" : `${fails.length} failed`}`);
    process.exit(fails.length === 0 ? 0 : 1);
  }
  await main(process.argv.slice(2));
}
