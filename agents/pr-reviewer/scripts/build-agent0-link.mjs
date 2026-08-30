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

// Environment-selectable host: production → app.dash0.com, development → app.dash0-dev.com.
// The reviewer resolves the environment from `.github/review.yaml`'s `agent0_environment`
// (agent0-fix-links.md § Environment) and passes it via --env / AGENT0_ENV; default production.
const HOSTS = { production: "https://app.dash0.com", development: "https://app.dash0-dev.com" };
// Fail-closed bound. Browsers are not the constraint (Chrome processes ~2MB, Firefox 64k+, Safari
// ~80k); the first default-configured proxy is. nginx's default `large_client_header_buffers 4 8k`
// requires the whole request line to fit ONE 8k buffer or it answers 414, and Apache's
// LimitRequestLine defaults to 8190 — so 8000 sat exactly on the cliff rather than short of it.
// 4000 keeps a 2x margin under that. The legacy "2048 everywhere" figure comes from IE's 2083 and
// no longer binds a known modern host. Measured against it: fix-this ~650 chars, fix-all ~2350 at
// its 15-location cap with pathological paths (agent0-fix-links.md § Deep-link format).
const MAX_URL = 4000;

export function resolveEnv(env) {
  return env === "development" || env === "production" ? env : "production";
}

export function encodePrompt(prompt) {
  return encodeURIComponent(prompt)
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/'/g, "%27");
}

export function buildLink(prompt, env = "production") {
  const host = HOSTS[resolveEnv(env)];
  return `${host}/goto/agent0?auto_submit=true&initial_prompt=${encodePrompt(prompt)}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  let env = process.env.AGENT0_ENV;
  const i = args.indexOf("--env");
  if (i >= 0) { env = args[i + 1]; args.splice(i, 2); }
  const prompt = args.length ? args.join(" ") : readFileSync(0, "utf8");
  if (!prompt || !prompt.trim()) {
    process.stderr.write("build-agent0-link: empty prompt\n");
    process.exit(1);
  }
  const url = buildLink(prompt.trim(), resolveEnv(env));
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
