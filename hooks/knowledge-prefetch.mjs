#!/usr/bin/env node
// PostToolUse hook on `Read`: warm the codebase-knowledge cache for the file just
// read, so the PreToolUse hook on `Edit` finds it locally.
//
// Hook mode (stdin = hook JSON) does only local checks, spawns a detached worker,
// and exits 0 at once. The worker does the git lookups and the two LoreKit calls.
// Nothing here may block or fail a tool call: every path ends in exit 0.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  cacheFile,
  fetchEntries,
  normalizeRecords,
  pruneOldSessions,
  readJson,
  relativePath,
  resolveConnection,
  resolveRepo,
  SKIP_EXT,
  sessionDir,
  writeJson,
} from './lib/knowledge.mjs';

const RETRY_ERROR_MS = 60_000;
const FRESH_MS = 10 * 60_000;

async function worker({ sessionId, cwd, file }) {
  const dir = sessionDir(sessionId);
  const target = cacheFile(dir, file);
  try {
    const repo = resolveRepo(cwd);
    const rel = repo && relativePath(repo.root, file);
    const conn = resolveConnection({ cwd });
    if (!rel || !conn) return writeJson(target, { status: 'none', at: Date.now() });
    const entries = await fetchEntries({ conn, scope: repo.scope, rel });
    writeJson(target, { status: 'ok', rel, records: normalizeRecords(entries, rel), at: Date.now() });
  } catch (error) {
    // Error text can embed the request URL, and so the token: record the class only.
    writeJson(target, { status: 'error', at: Date.now(), kind: String(error?.name ?? 'Error').slice(0, 40) });
  }
}

function hook() {
  let input;
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    return;
  }
  const file = input?.tool_input?.file_path;
  if (input?.tool_name !== 'Read' || typeof file !== 'string' || !input.session_id) return;
  // Cheap skips before any process is spawned: already cached (or in flight), or
  // a path no record could exist for.
  // Extension only: folder-name skips need the repo root, which only the worker has.
  if (SKIP_EXT.test(file)) return;
  const existing = readJson(cacheFile(sessionDir(input.session_id), file));
  if (existing) {
    const age = Date.now() - (existing.at ?? 0);
    if (existing.status === 'ok' || existing.status === 'none' ? age < FRESH_MS : age < RETRY_ERROR_MS) return;
  }
  writeJson(cacheFile(sessionDir(input.session_id), file), { status: 'pending', at: Date.now() });
  pruneOldSessions();
  const payload = JSON.stringify({ sessionId: input.session_id, cwd: input.cwd ?? process.cwd(), file });
  spawn(process.execPath, [fileURLToPath(import.meta.url), '--worker', payload], {
    detached: true,
    stdio: 'ignore',
  }).unref();
}

try {
  if (process.argv[2] === '--worker') await worker(JSON.parse(process.argv[3]));
  else hook();
} catch {
  /* a hook never fails the tool call */
}
process.exit(0);
