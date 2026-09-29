// @ts-check
/**
 * finalize/fix-links.mjs — builds the "Fix with Agent0" deep links mechanically. Pure. No I/O.
 *
 * The buttons are on by default (agents/shared/rules/agent0-fix-links.md § Opt-in), and they
 * used to depend on the agent running build-agent0-link.mjs by hand at two separate steps and
 * threading the results into `judgments[].fix_url` and `context.render.FIX_ALL_URL`. Nothing
 * checked that it happened, so a run that skipped the step posted no buttons and reported nothing
 * wrong (mthines/agent-skills#213 and dash0#20655). finalize.mjs now calls this module on every
 * GitHub-writer run, so a default run gets the buttons without anyone remembering to build them.
 *
 * A link the caller already supplied is never overwritten: `fix_url` / `FIX_ALL_URL` stay an
 * override seam, which is also how the CI-only Fix-all template (not built here — it carries its
 * own inline method and needs the red-check names) still reaches the report.
 */

import { buildLink } from "../build-agent0-link.mjs";
import { CLAIM_PREFIXES } from "./thresholds.mjs";

/**
 * The run's fix-link settings, resolved first-match-wins exactly as § Opt-in orders them:
 * `--no-fix-links`, then `--fix-links`, then the review config's `agent0_fix_links`, then on.
 * `env` and `org` are destination only — they never decide whether the buttons render.
 *
 * @param {{ noFixLinks?: boolean, fixLinks?: boolean, config?: { fixLinks?: boolean|null, environment?: string|null, org?: string|null } | null }} input
 * @returns {{ on: boolean, env: string, org: string|null, reason: string }}
 */
export function resolveFixLinks({ noFixLinks = false, fixLinks = false, config = null } = {}) {
  const env = config?.environment === "development" ? "development" : "production";
  const org = config?.org ? String(config.org).trim() || null : null;
  if (noFixLinks) return { on: false, env, org, reason: "--no-fix-links" };
  if (fixLinks) return { on: true, env, org, reason: "--fix-links" };
  if (config?.fixLinks === false) return { on: false, env, org, reason: "agent0_fix_links: false" };
  return { on: true, env, org, reason: config?.fixLinks === true ? "agent0_fix_links: true" : "default" };
}

// A github.com pull-request URL, optionally with a trailing slash, query, or fragment.
const GITHUB_PR_URL_RE = /^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)\/pull\/(\d+)(?:[/?#].*)?$/;

/**
 * The PR address a fix prompt carries: `{owner}/{repo}#{n}` — GitHub's own short reference —
 * instead of the full URL (§ Prompt templates). The short form drops `https://github.com/` and
 * `/pull/`, which are the bulk of the percent-escapes in the encoded link (`%3A%2F%2F…%2Fpull%2F`).
 *
 * The short form implies github.com, so any URL that is not a github.com PR URL (a GitHub
 * Enterprise host, an unexpected shape) is returned unchanged: a longer link that resolves beats a
 * shorter one that points `/pr-fix` at the wrong host.
 *
 * @param {string} prUrl
 */
export function prRef(prUrl) {
  const m = GITHUB_PR_URL_RE.exec(String(prUrl || "").trim());
  return m ? `${m[1]}/${m[2]}#${m[3]}` : prUrl;
}

/** @param {string} prUrl @param {string} login @param {string} path @param {number} line */
export function fixThisPrompt(prUrl, login, path, line) {
  return `/pr-fix ${prRef(prUrl)} ${login} — apply only the comment at ${path}:${line}.`;
}

/**
 * The Fix-all prompt, or null when the button must be omitted (§ Prompt templates):
 * - a non-zero count and a login → `/pr-fix <owner>/<repo>#<n> <login>`;
 * - a non-zero count, no login, a prior sticky id → `/pr-fix <report comment permalink>` — the
 *   one prompt that keeps a full URL, because the short reference has no way to name a comment;
 * - otherwise null. A zero count is never a `/pr-fix` call (the CI-only variant is caller-supplied).
 *
 * @param {{ prUrl: string, login: string|null, openCount: number, stickyCommentId: number|string|null }} input
 */
export function fixAllPrompt({ prUrl, login, openCount, stickyCommentId }) {
  if (!(openCount > 0)) return null;
  if (login) return `/pr-fix ${prRef(prUrl)} ${login}`;
  if (stickyCommentId) return `/pr-fix ${prUrl}#issuecomment-${stickyCommentId}`;
  return null;
}

/**
 * One GitHub identity, whichever endpoint spelled it: `app/x`, `x[bot]`, and `X` are the same
 * App. The same semantics as prepare-review.mjs's `normalizeLogin` (asserted equal by the
 * self-test) — kept local so this pure module does not import prepare-review.mjs.
 * @param {unknown} login
 */
export function normalizeLogin(login) {
  return String(login || "").trim().toLowerCase().replace(/^app\//, "").replace(/\[bot\]$/, "");
}

/**
 * Open findings authored by this reviewer: this run's claim findings plus still-open threads
 * whose root author is `login`, deduplicated by `path:line`. A routing input only.
 *
 * @param {Array<any>} inline @param {Array<any>} threads @param {string|null} login
 */
export function openFindingCount(inline, threads, login) {
  const keys = new Set();
  for (const f of inline || []) if (CLAIM_PREFIXES.has(f.prefix)) keys.add(`${f.path}:${f.line}`);
  const me = normalizeLogin(login);
  if (me) {
    for (const t of threads || []) {
      if (!t.is_resolved && normalizeLogin(t.author) === me) keys.add(`${t.path}:${t.line}`);
    }
  }
  return keys.size;
}

/**
 * Sets `fix_url` on each claim finding in `inline` and returns the Fix-all URL (or null).
 * Mutates `inline` in place; a finding that already carries `fix_url` keeps it.
 *
 * @param {{ settings: ReturnType<typeof resolveFixLinks>, prUrl: string|null, login: string|null, inline: Array<any>, threads?: Array<any>, stickyCommentId?: number|string|null, existingFixAll?: string|null }} input
 * @returns {{ fixAllUrl: string|null, fixThis: number, skipped: string|null }}
 */
export function applyFixLinks({ settings, prUrl, login, inline, threads = [], stickyCommentId = null, existingFixAll = null }) {
  if (!settings.on) return { fixAllUrl: null, fixThis: 0, skipped: settings.reason };
  if (!prUrl) return { fixAllUrl: null, fixThis: 0, skipped: "no PR URL on the context" };
  let fixThis = 0;
  // Fix-this needs a login: an inline comment has no permalink to itself to fall back on.
  if (login) {
    for (const f of inline || []) {
      if (!CLAIM_PREFIXES.has(f.prefix) || f.fix_url || !f.path || !(f.line > 0)) continue;
      f.fix_url = buildLink(fixThisPrompt(prUrl, login, f.path, f.line), settings.env, "fix-this", /** @type {any} */ (settings.org));
      fixThis++;
    }
  }
  if (existingFixAll) return { fixAllUrl: existingFixAll, fixThis, skipped: null };
  const prompt = fixAllPrompt({ prUrl, login, openCount: openFindingCount(inline, threads, login), stickyCommentId });
  return {
    fixAllUrl: prompt ? buildLink(prompt, settings.env, "fix-all", /** @type {any} */ (settings.org)) : null,
    fixThis,
    skipped: login ? null : "reviewer login unresolved (Fix this needs it)",
  };
}

async function selfTest() {
  let failed = 0;
  const check = (/** @type {string} */ label, /** @type {boolean} */ cond) => {
    if (!cond) { failed++; console.error(`  ✗ ${label}`); } else console.log(`  ✓ ${label}`);
  };
  const PR = "https://github.com/o/r/pull/7";

  check("default is on at production with no org", JSON.stringify(resolveFixLinks({})) === JSON.stringify({ on: true, env: "production", org: null, reason: "default" }));
  check("agent0_fix_links: false turns them off", resolveFixLinks({ config: { fixLinks: false } }).on === false);
  check("--fix-links beats agent0_fix_links: false", resolveFixLinks({ fixLinks: true, config: { fixLinks: false } }).on === true);
  check("--no-fix-links beats --fix-links", resolveFixLinks({ noFixLinks: true, fixLinks: true }).on === false);
  check("agent0_environment picks the host only", resolveFixLinks({ config: { environment: "development" } }).env === "development"
    && resolveFixLinks({ config: { environment: "development" } }).on === true);

  const inline = /** @type {any[]} */ ([
    { prefix: "issue", path: "a.ts", line: 3 },
    { prefix: "suggestion", path: "b.ts", line: 9 },
    { prefix: "nitpick", path: "c.ts", line: 1 },
    { prefix: "issue", path: "d.ts", line: 4, fix_url: "https://app.dash0.com/goto/agent0?keep" },
  ]);
  const r = applyFixLinks({ settings: resolveFixLinks({}), prUrl: PR, login: "bot", inline });
  check("Fix this is built for issue and suggestion", String(inline[0].fix_url).includes("utm_source=pr-reviewer-fix-this")
    && String(inline[1].fix_url).includes(encodeURIComponent("b.ts:9")));
  check("Fix this is never built for a nitpick", inline[2].fix_url === undefined);
  check("a caller-supplied fix_url is kept", inline[3].fix_url === "https://app.dash0.com/goto/agent0?keep" && r.fixThis === 2);
  check("Fix all names the PR by its short reference and the login", r.fixAllUrl !== null && r.fixAllUrl.includes("utm_source=pr-reviewer-fix-all")
    && r.fixAllUrl.includes(encodeURIComponent("/pr-fix o/r#7 bot")) && r.fixAllUrl.startsWith("https://app.dash0.com/"));
  check("neither prompt carries the full PR URL", !String(r.fixAllUrl).includes(encodeURIComponent("https://github.com"))
    && !String(inline[0].fix_url).includes(encodeURIComponent("https://github.com")));
  check("Fix this names the PR by its short reference", String(inline[0].fix_url).includes(encodeURIComponent("/pr-fix o/r#7 bot — apply only the comment at a.ts:3.")));

  check("prRef shortens a github.com PR URL to owner/repo#n", prRef("https://github.com/mthines/agent-skills/pull/215") === "mthines/agent-skills#215");
  check("prRef ignores a trailing slash, query, or fragment", prRef("https://github.com/o/r.js/pull/7/") === "o/r.js#7"
    && prRef("https://github.com/o/r/pull/7#issuecomment-1") === "o/r#7" && prRef("https://github.com/o/r/pull/7?x=1") === "o/r#7");
  check("prRef keeps a non-github.com URL unchanged (the short form would imply the wrong host)",
    prRef("https://ghe.example.com/o/r/pull/7") === "https://ghe.example.com/o/r/pull/7");
  check("prRef keeps a non-PR github.com URL unchanged", prRef("https://github.com/o/r/issues/7") === "https://github.com/o/r/issues/7");

  const dev = applyFixLinks({ settings: resolveFixLinks({ config: { environment: "development", org: "acme" } }), prUrl: PR, login: "bot", inline: [{ prefix: "issue", path: "a.ts", line: 1 }] });
  check("development host and org reach the Fix-all link", String(dev.fixAllUrl).startsWith("https://app.dash0-dev.com/") && String(dev.fixAllUrl).endsWith("&org=acme"));

  const off = /** @type {any[]} */ ([{ prefix: "issue", path: "a.ts", line: 1 }]);
  const offR = applyFixLinks({ settings: resolveFixLinks({ noFixLinks: true }), prUrl: PR, login: "bot", inline: off });
  check("off builds neither placement", offR.fixAllUrl === null && off[0].fix_url === undefined);

  const noLogin = /** @type {any[]} */ ([{ prefix: "issue", path: "a.ts", line: 1 }]);
  const nl = applyFixLinks({ settings: resolveFixLinks({}), prUrl: PR, login: null, inline: noLogin, stickyCommentId: 55 });
  check("no login: no Fix this, Fix all falls back to the sticky permalink", noLogin[0].fix_url === undefined
    && String(nl.fixAllUrl).includes(encodeURIComponent(`${PR}#issuecomment-55`)));
  check("no login and no sticky: Fix all omitted", applyFixLinks({ settings: resolveFixLinks({}), prUrl: PR, login: null, inline: [{ prefix: "issue", path: "a.ts", line: 1 }] }).fixAllUrl === null);

  check("zero open findings: Fix all omitted", applyFixLinks({ settings: resolveFixLinks({}), prUrl: PR, login: "bot", inline: [{ prefix: "nitpick", path: "a.ts", line: 1 }] }).fixAllUrl === null);
  check("an open thread by this reviewer counts toward Fix all", applyFixLinks({ settings: resolveFixLinks({}), prUrl: PR, login: "bot", inline: [],
    threads: [{ is_resolved: false, author: "bot", path: "x.ts", line: 2 }, { is_resolved: false, author: "human", path: "y.ts", line: 2 }] }).fixAllUrl !== null);
  check("a human's open thread alone does not", applyFixLinks({ settings: resolveFixLinks({}), prUrl: PR, login: "bot", inline: [],
    threads: [{ is_resolved: false, author: "human", path: "y.ts", line: 2 }] }).fixAllUrl === null);
  const botThread = [{ is_resolved: false, author: "dash0-dev", path: "a", line: 1 }];
  check("a thread by `x` counts for login `x[bot]`", openFindingCount([], botThread, "dash0-dev[bot]") === 1);
  check("a thread by `x[bot]` counts for login `x`", openFindingCount([], [{ ...botThread[0], author: "dash0-dev[bot]" }], "dash0-dev") === 1);
  check("normalization does not merge distinct logins", openFindingCount([], botThread, "mthines") === 0);
  const { normalizeLogin: canonical } = await import("../prepare-review.mjs");
  check("normalizeLogin matches prepare-review.mjs's", ["app/dash0-dev", "dash0-dev[bot]", " Dash0-Dev ", "mthines", "", null]
    .every((v) => normalizeLogin(v) === canonical(v)));
  check("a caller-supplied FIX_ALL_URL is kept", applyFixLinks({ settings: resolveFixLinks({}), prUrl: PR, login: "bot", inline: [], existingFixAll: "https://app.dash0.com/x" }).fixAllUrl === "https://app.dash0.com/x");

  if (failed > 0) {
    console.error(`\nfix-links self-test: ${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("\n✓ fix-links self-test: all checks passed");
}

import { pathToFileURL } from "node:url";
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain && process.argv.includes("--self-test")) {
  selfTest();
}
