#!/usr/bin/env node
/**
 * emit-event.js — Claude Code hook script for the Agent Tasks VS Code extension.
 *
 * Reads the hook payload from stdin (Claude Code pipes JSON to this process),
 * extracts privacy-safe fields {event, sessionId, cwd, ts}, and appends them
 * as a NDJSON line to ${CLAUDE_PLUGIN_DATA}/events/<sessionId>.ndjson.
 *
 * Safety guarantees (see plan.md guardrails):
 *   - Always exits 0. UserPromptSubmit and Stop CAN block Claude on non-zero exit.
 *   - Wraps all I/O in try/catch — silently no-ops on any error.
 *   - Hard-caps execution at 40ms. Any elapsed time > 40ms → skip write, exit 0.
 *   - Checks for a sentinel file written by the VS Code extension on activation.
 *     If absent, silently no-ops (orphaned-plugin safety).
 *   - Emits ONLY {event, sessionId, cwd, ts} — never prompt or transcript content.
 *
 * Rotation: if the target file exceeds 512 KB before a write, rewrites it
 * keeping only the last 100 lines, then appends the new event.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const START_MS = Date.now();
const HARD_CAP_MS = 40;
const MAX_FILE_BYTES = 512 * 1024; // 512 KB
const MAX_ROTATION_LINES = 100;

function exitOk() {
  process.exit(0);
}

// ---- Timing guard ----
function elapsed() {
  return Date.now() - START_MS;
}

// ---- Plugin data dir ----
const pluginDataDir = process.env['CLAUDE_PLUGIN_DATA'];
if (!pluginDataDir) {
  exitOk();
}

// ---- Sentinel check ----
// The VS Code extension writes this file on activation when hooks are enabled.
// If the sentinel is absent, the extension isn't installed or has opted out —
// silently no-op so an orphaned plugin doesn't waste cycles.
const sentinelPath = path.join(pluginDataDir, 'sentinel');
try {
  fs.accessSync(sentinelPath, fs.constants.F_OK);
} catch {
  exitOk();
}

// ---- Read stdin ----
// Claude Code pipes the hook payload JSON to this process via stdin.
// Use synchronous read with a try/catch to stay within the hard cap.
let rawInput = '';
try {
  // Read stdin via file descriptor 0 — works on macOS, Linux, and Windows
  // (the '/dev/stdin' path does not exist on Windows). Read up to 64 KB —
  // hook payloads are small JSON objects.
  const fd = fs.openSync(0, 'r');
  const buf = Buffer.alloc(65536);
  let bytesRead = 0;
  let totalRead = 0;
  do {
    bytesRead = fs.readSync(fd, buf, totalRead, buf.length - totalRead, null);
    totalRead += bytesRead;
  } while (bytesRead > 0 && totalRead < buf.length);
  fs.closeSync(fd);
  rawInput = buf.toString('utf8', 0, totalRead);
} catch {
  // stdin not available or unreadable — exit cleanly
  exitOk();
}

// ---- Timing check after read ----
if (elapsed() > HARD_CAP_MS) {
  exitOk();
}

// ---- Parse payload ----
let payload;
try {
  payload = JSON.parse(rawInput);
} catch {
  exitOk();
}

// ---- Extract privacy-safe fields only ----
const eventName = payload['hook_event_name'] ?? payload['event'] ?? payload['type'];
const sessionId = payload['session_id'] ?? payload['sessionId'];
const cwd = payload['cwd'] ?? '';

if (!eventName || !sessionId) {
  exitOk();
}

const event = {
  event: String(eventName),
  sessionId: String(sessionId),
  cwd: String(cwd),
  ts: Date.now(),
};

// ---- Write to per-session NDJSON file ----
try {
  const eventsDir = path.join(pluginDataDir, 'events');

  // Lazy-create the events directory
  fs.mkdirSync(eventsDir, { recursive: true });

  const filePath = path.join(eventsDir, `${event.sessionId}.ndjson`);

  // Timing check before potentially expensive rotation
  if (elapsed() > HARD_CAP_MS) {
    exitOk();
  }

  // Rotation: if file is too large, keep only the last MAX_ROTATION_LINES lines
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_FILE_BYTES) {
      const existing = fs.readFileSync(filePath, 'utf8');
      const lines = existing.split('\n').filter((l) => l.trim().length > 0);
      const kept = lines.slice(-MAX_ROTATION_LINES);
      fs.writeFileSync(filePath, kept.join('\n') + '\n', 'utf8');
    }
  } catch {
    // File doesn't exist yet or stat failed — that's fine, we'll create it below
  }

  // Timing check after rotation
  if (elapsed() > HARD_CAP_MS) {
    exitOk();
  }

  // Append the new event line
  fs.appendFileSync(filePath, JSON.stringify(event) + '\n', 'utf8');
} catch {
  // Any I/O failure — silently exit 0 (never block the user's prompt)
}

exitOk();
