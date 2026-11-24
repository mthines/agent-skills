// Shared logic for the codebase-knowledge on-touch hooks.
// Contract: agents/shared/rules/codebase-knowledge.md. Every function here is
// pure or fails soft: a hook must never block, throw into, or slow an edit.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const TAG = 'codebase-knowledge';
/** Session budget: at most this many injected lines, and this many tokens (chars / 4). */
export const MAX_LINES = 8;
export const MAX_TOKENS = 1500;
/** Per-file cap on injected lines. */
export const MAX_LINES_PER_FILE = 2;
const LINE_MAX_CHARS = 220;

// ── Connection ────────────────────────────────────────────────────────────

/** Split `https://host/functions/v1/mcp?token=lk_…` into its endpoint and token. */
export function splitEndpoint(raw) {
  try {
    const url = new URL(raw);
    const token = url.searchParams.get('token');
    url.search = '';
    return { endpoint: url.toString().replace(/\/$/, ''), token: token || null };
  } catch {
    return { endpoint: null, token: null };
  }
}

function lorekitUrlFrom(server) {
  if (!server || typeof server !== 'object') return null;
  const candidates = [server.url, ...(Array.isArray(server.args) ? server.args : [])];
  return candidates.find((c) => typeof c === 'string' && /^https?:\/\/.+\/mcp(\?|$)/.test(c)) ?? null;
}

function readServer(file) {
  try {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    return lorekitUrlFrom(json?.mcpServers?.lorekit);
  } catch {
    return null;
  }
}

/**
 * Resolve the LoreKit REST base and token the way the lorekit CLI does:
 * the project `.mcp.json`, then `~/.claude.json`, then the environment.
 * A source that stores a token wins; the token never leaves this process.
 */
export function resolveConnection({ cwd, env = process.env, home = os.homedir() } = {}) {
  let endpointOnly = null;
  for (const file of [path.join(cwd ?? '.', '.mcp.json'), path.join(home, '.claude.json')]) {
    const raw = readServer(file);
    if (!raw) continue;
    const { endpoint, token } = splitEndpoint(raw);
    if (!endpoint) continue;
    if (token) return toRest(endpoint, token);
    endpointOnly ??= endpoint;
  }
  const envEndpoint = env.LOREKIT_MCP_URL || env.LOREKIT_ENDPOINT || endpointOnly;
  const token = env.LOREKIT_TOKEN || null;
  if (!envEndpoint || !token) return null;
  return toRest(splitEndpoint(envEndpoint).endpoint ?? envEndpoint, token);
}

function toRest(endpoint, token) {
  return { restBase: endpoint.replace(/\/mcp\/?$/, '/memories'), token };
}

// ── Repo ──────────────────────────────────────────────────────────────────

function git(cwd, args) {
  return execFileSync('git', args, { cwd, timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
}

/** `repo::owner/name` from an origin URL, or null. */
export function scopeFromRemote(url) {
  const m = /[:/]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url ?? '');
  return m ? `repo::${m[1]}/${m[2]}` : null;
}

/** `{ root, scope }` for the repo containing `cwd`, or null. */
export function resolveRepo(cwd) {
  try {
    const root = git(cwd, ['rev-parse', '--show-toplevel']);
    const scope = scopeFromRemote(git(cwd, ['remote', 'get-url', 'origin']));
    return root && scope ? { root, scope } : null;
  } catch {
    return null;
  }
}

const SKIP_SEGMENT = /(^|\/)(node_modules|\.git|\.agent|dist|build|coverage)\//;
const SKIP_EXT = /\.(png|jpe?g|gif|webp|ico|svg|mp4|mov|woff2?|ttf|lock|map)$/i;

/** `fs.realpathSync`, or the input when the path does not exist (a file about to be created). */
export function realPath(file) {
  try {
    return fs.realpathSync(file);
  } catch {
    return file;
  }
}

/**
 * Repo-relative POSIX path, or null for a file outside the repo or not worth a lookup.
 * Both sides are resolved through symlinks first: git reports the real root, so a file
 * reached through a symlinked directory (macOS `/var` → `/private/var`) would otherwise
 * look like it lies outside the repo.
 */
export function relativePath(root, file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) return null;
  const rel = path.relative(realPath(root), realPath(file)).split(path.sep).join('/');
  if (!rel || rel.startsWith('..') || SKIP_SEGMENT.test(rel) || SKIP_EXT.test(rel)) return null;
  return rel;
}

// ── Cache ─────────────────────────────────────────────────────────────────

export function sessionDir(sessionId, env = process.env) {
  const base = env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  const safe = String(sessionId).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
  return path.join(base, 'agent-skills', 'knowledge', safe);
}

export function cacheFile(dir, rel) {
  return path.join(dir, `${createHash('sha1').update(rel).digest('hex').slice(0, 16)}.json`);
}

/** Atomic write: temp file then rename, so a concurrent reader never sees half a file. */
export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Run `fn` while holding a per-session lock (an atomic `mkdir`), so parallel tool
 * calls cannot both read the same budget and both spend it. Returns `undefined`
 * without running `fn` when the lock cannot be had within `waitMs`: a hook that
 * stays silent is safe, one that overspends the budget is not. A lock older than
 * `staleMs` belongs to a crashed hook and is taken over.
 */
export function withLock(lockPath, fn, { waitMs = 400, staleMs = 2000 } = {}) {
  const deadline = Date.now() + waitMs;
  const sleep = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    try {
      fs.mkdirSync(lockPath, { recursive: false });
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') return undefined;
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > staleMs) fs.rmSync(lockPath, { recursive: true, force: true });
      } catch {
        /* released between the stat and the remove */
      }
      if (Date.now() >= deadline) return undefined;
      Atomics.wait(sleep, 0, 0, 5);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lockPath, { recursive: true, force: true });
  }
}

/** Remove session cache dirs untouched for two days. Best effort. */
export function pruneOldSessions(env = process.env, now = Date.now()) {
  try {
    const base = path.join(env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'agent-skills', 'knowledge');
    for (const name of fs.readdirSync(base)) {
      const dir = path.join(base, name);
      if (now - fs.statSync(dir).mtimeMs > 2 * 24 * 3600 * 1000) fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    /* nothing to prune */
  }
}

// ── Fetch ─────────────────────────────────────────────────────────────────

/**
 * Both reads for one file, in parallel: the hotspot by exact key, and the
 * knowledge records by full-text search on the path. The search is a net, so
 * `normalizeRecords` keeps only keys that end `@<path>` exactly.
 * Throws on a network error or non-2xx; the caller records it and moves on.
 */
export async function fetchEntries({ conn, scope, rel, fetchImpl = fetch, timeoutMs = 8000 }) {
  const post = async (route, body) => {
    const res = await fetchImpl(`${conn.restBase}${route}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${conn.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`LoreKit ${route} → HTTP ${res.status}`);
    return (await res.json())?.entries ?? [];
  };
  const [hotspot, knowledge] = await Promise.all([
    post('/read', { refs: [`${scope}::hotspot::${rel}`] }),
    post('/search', { q: rel, scopes: [scope], tags: [TAG], limit: 10 }),
  ]);
  return [...hotspot, ...knowledge];
}

// ── Records ───────────────────────────────────────────────────────────────

const num = (n) => (Number.isFinite(n) ? n : null);
const count = (counter, examples) => num(counter) ?? (Array.isArray(examples) ? examples.length : 0);
const clip = (s, n) => (typeof s === 'string' && s.length > n ? `${s.slice(0, n - 1)}…` : (s ?? ''));
// A real code symbol, not a prose slug: `drainAndWait`, `Foo.bar`, `#baz`.
const SYMBOL = /^[#A-Za-z_$][\w$.#]*$/;

function symbolsOf(value, key) {
  const fromKey = key.slice('knowledge::'.length, key.lastIndexOf('@'));
  const raw = typeof value.symbol === 'string' ? value.symbol : fromKey;
  return raw
    .split(/[\s/,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3 && s.length <= 80 && SYMBOL.test(s));
}

/**
 * Reduce raw LoreKit entries to the compact records the injector needs.
 * Tolerates every shape written to the bucket so far: counters or only
 * `*_examples` on a hotspot, a `symbol` field or only a key on a knowledge
 * record, superseded facts, and prose records (dropped — no structural key).
 */
export function normalizeRecords(entries, rel, now = Date.now()) {
  const out = [];
  const seen = new Set();
  for (const entry of entries ?? []) {
    const key = entry?.key;
    // The exact-key read and the search both return a hotspot: keep one.
    if (typeof key !== 'string' || seen.has(key)) continue;
    seen.add(key);
    let value;
    try {
      value = JSON.parse(entry.value);
    } catch {
      continue;
    }
    if (!value || typeof value !== 'object') continue;
    if (value.expires && Date.parse(value.expires) < now) continue;
    if (key === `hotspot::${rel}`) {
      out.push({
        kind: 'hotspot',
        key,
        confirmed: count(value.confirmed, value.confirmed_examples),
        missed: count(value.missed, value.missed_examples),
        regressed: count(value.regressed, value.regressed_examples),
        classes: Array.isArray(value.classes) ? value.classes.slice(0, 3) : [],
      });
    } else if (key.startsWith('knowledge::') && key.endsWith(`@${rel}`)) {
      const facts = (Array.isArray(value.facts) ? value.facts : [])
        .filter((f) => f && typeof f.claim === 'string' && !f.superseded_at)
        .map((f) => clip(f.claim, LINE_MAX_CHARS));
      const note = clip(value.note, LINE_MAX_CHARS);
      const symbols = symbolsOf(value, key);
      if (symbols.length && (facts.length || note)) out.push({ kind: 'knowledge', key, symbols, text: facts[0] ?? note });
    }
  }
  return out;
}

// ── Selection and rendering ───────────────────────────────────────────────

const earned = (r) => r.missed > 0 || r.regressed > 0 || r.confirmed >= 2;

/** Text the agent is about to write: an `Edit`'s old and new strings, or a `Write`'s whole content. */
export function editText(toolInput) {
  const t = toolInput ?? {};
  const parts = [t.old_string, t.new_string, t.content];
  return parts.filter((p) => typeof p === 'string').join('\n');
}

/**
 * Pick at most `limit` records worth showing for this edit, skipping those already
 * `shown`. A hotspot must have earned it; a knowledge record needs one of its
 * symbols in the edit text.
 */
export function selectRecords(records, text, shown = {}, limit = MAX_LINES_PER_FILE) {
  return records
    .filter((r) => !shown[r.key])
    .filter((r) => (r.kind === 'hotspot' ? earned(r) : r.symbols.some((s) => text.includes(s.replace(/^#/, '')))))
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'hotspot' ? -1 : 1))
    .slice(0, limit);
}

export function renderLine(r, rel) {
  if (r.kind === 'hotspot') {
    const stats = `${r.confirmed} confirmed, ${r.missed} missed, ${r.regressed} regressed`;
    const classes = r.classes.length ? ` (${r.classes.join(', ')})` : '';
    // Counts and classes only: a hotspot's `note` describes one old finding and
    // goes stale (a later knowledge record can contradict it).
    return `⚠ hotspot ${rel}: ${stats}${classes}`;
  }
  return clip(`ℹ ${r.symbols[0]}: ${r.text}`, LINE_MAX_CHARS);
}

/** Tokens a line costs, by the chars / 4 rule of thumb. */
export const tokensOf = (line) => Math.ceil(line.length / 4);
