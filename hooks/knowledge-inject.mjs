#!/usr/bin/env node
// PreToolUse hook on `Edit|Write`: tell the agent what earlier reviews
// learned about the file it is about to change.
//
// Reads only the local cache `knowledge-prefetch.mjs` wrote: no network, no git.
// Silent on a miss, a pending fetch, an unearned hotspot, or an exhausted budget.
// Emits at most MAX_LINES_PER_FILE one-line summaries per file and MAX_LINES /
// MAX_TOKENS per session, each record once. Never denies a tool call.

import fs from 'node:fs';
import path from 'node:path';
import {
  MAX_LINES,
  MAX_TOKENS,
  MAX_LINES_PER_FILE,
  cacheFile,
  editText,
  readJson,
  renderLine,
  selectRecords,
  sessionDir,
  tokensOf,
  withLock,
  writeJson,
} from './lib/knowledge.mjs';

const EDIT_TOOLS = new Set(['Edit', 'Write']);

function run() {
  let input;
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    return;
  }
  const file = input?.tool_input?.file_path;
  if (!EDIT_TOOLS.has(input?.tool_name) || typeof file !== 'string' || !input.session_id) return;

  const dir = sessionDir(input.session_id);
  const cached = readJson(cacheFile(dir, file));
  if (cached?.status !== 'ok' || !cached.records?.length) return;

  // The whole read-decide-write is one critical section: parallel tool calls run
  // parallel hooks, and without the lock two of them spend the same budget.
  const statePath = path.join(dir, 'state.json');
  const output = withLock(path.join(dir, 'state.lock'), () => {
    const state = readJson(statePath) ?? { shown: {}, lines: 0, tokens: 0 };
    state.perFile ??= {};
    const room = Math.min(MAX_LINES_PER_FILE - (state.perFile[cached.rel] ?? 0), MAX_LINES - state.lines);
    if (room <= 0 || state.tokens >= MAX_TOKENS) return null;

    const picked = selectRecords(cached.records, editText(input.tool_input), state.shown, room);
    const lines = [];
    for (const record of picked) {
      const line = renderLine(record, cached.rel);
      if (state.tokens + tokensOf(line) > MAX_TOKENS) break;
      lines.push(line);
      state.shown[record.key] = true;
      state.lines += 1;
      state.perFile[cached.rel] = (state.perFile[cached.rel] ?? 0) + 1;
      state.tokens += tokensOf(line);
    }
    if (!lines.length) return null;

    writeJson(statePath, state);
    const header = `codebase-knowledge for ${cached.rel} (earlier reviews; re-verify against the code before relying on it):`;
    return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: [header, ...lines].join('\n') } });
  });
  if (output) process.stdout.write(output);
}

try {
  run();
} catch {
  /* a hook never fails the tool call */
}
process.exit(0);
