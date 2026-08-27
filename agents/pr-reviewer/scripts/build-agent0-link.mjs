#!/usr/bin/env node
// Build an Agent0 "Fix with Agent0" deep link from a prompt — the single source of truth for the
// deep-link encoding, so the report renderer and the inline-comment step encode identically.
//
// Encoding is encodeURIComponent THEN ( ) ' → %28 %29 %27. encodeURIComponent leaves those three
// literal, and a literal ')' would terminate a `](url)` markdown link, so they must be escaped for
// the URL to survive inside a linked-image button.
//
// Usage:  node build-agent0-link.mjs "<prompt>"     (or: … < prompt.txt)
// Output: the full https://app.dash0.com/goto/agent0?... URL on stdout. Any problem exits non-zero
//         with a reason on stderr and prints nothing to stdout.

import { readFileSync } from "node:fs";

const BASE = "https://app.dash0.com/goto/agent0";
const MAX_URL = 8000; // browsers/GitHub choke well before this; keep prompts compact

export function encodePrompt(prompt) {
  return encodeURIComponent(prompt)
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/'/g, "%27");
}

export function buildLink(prompt) {
  return `${BASE}?auto_submit=true&initial_prompt=${encodePrompt(prompt)}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2];
  const prompt = arg !== undefined ? arg : readFileSync(0, "utf8");
  if (!prompt || !prompt.trim()) {
    process.stderr.write("build-agent0-link: empty prompt\n");
    process.exit(1);
  }
  const url = buildLink(prompt.trim());
  if (url.includes(")")) {
    process.stderr.write("build-agent0-link: encoded URL still contains a literal ')' — not markdown-safe\n");
    process.exit(1);
  }
  if (url.length > MAX_URL) {
    process.stderr.write(`build-agent0-link: URL is ${url.length} chars, over ${MAX_URL} — shorten the prompt\n`);
    process.exit(1);
  }
  process.stdout.write(url + "\n");
}
