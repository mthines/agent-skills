#!/usr/bin/env node
// auth-bootstrap-credentials.mjs — automated headless login capture for aw-tester.
//
// Logs in headlessly with email + password from environment variables, then
// captures the resulting storage state. Use this flow when:
//   - You have a test user with a stable email + password
//   - You can refresh auth unattended (CI, scheduled runs, mass test execution)
//   - The login form is plain HTML (no SSO redirect, no MFA, no CAPTCHA)
//
// >>> CUSTOMIZE THE LOCATOR LADDER BELOW <<<
// The default locators target a typical Email + Password + Sign-in-button form.
// If your form uses different labels, edit the `getByLabel(...)` / role-name
// strings in the block marked CUSTOMIZE. Prefer accessibility-tree locators
// (getByLabel / getByRole) over CSS selectors — they survive design changes.
//
// Environment variables:
//   AUTH_LOGIN_URL              — required; the page that hosts the login form
//   AUTH_STORAGE_STATE          — required; output path (typically ./.auth/<name>.json)
//   AUTH_POST_LOGIN_URL_PATTERN — required; JS regex source matched against the
//                                 page URL after submit (e.g. '/dashboard')
//   E2E_EMAIL                   — required; the test user's email/username
//   E2E_PASSWORD                — required; the test user's password
//                                 (use a CI secret or a local-dev-only env file
//                                 — NEVER commit this value)
//   AUTH_TIMEOUT_MS             — optional; max wait for the post-login URL
//                                 (default: 30000)
//
// Examples:
//   AUTH_LOGIN_URL=http://localhost:3000/login \
//     AUTH_STORAGE_STATE=./.auth/local.json \
//     AUTH_POST_LOGIN_URL_PATTERN='/dashboard' \
//     E2E_EMAIL=test+aw@example.com \
//     E2E_PASSWORD="$E2E_PASSWORD_LOCAL" \
//     node scripts/auth-bootstrap-credentials.mjs
//
//   # In aw-target.yml (the env vars come from your shell or .env.local):
//   #   auth.refresh.command: node scripts/auth-bootstrap-credentials.mjs

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const LOGIN_URL = process.env.AUTH_LOGIN_URL;
const OUTPUT = process.env.AUTH_STORAGE_STATE;
const POST_LOGIN_PATTERN = process.env.AUTH_POST_LOGIN_URL_PATTERN;
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const TIMEOUT_MS = Number(process.env.AUTH_TIMEOUT_MS ?? 30_000);

const missing = [];
if (!LOGIN_URL) missing.push('AUTH_LOGIN_URL');
if (!OUTPUT) missing.push('AUTH_STORAGE_STATE');
if (!POST_LOGIN_PATTERN) missing.push('AUTH_POST_LOGIN_URL_PATTERN');
if (!EMAIL) missing.push('E2E_EMAIL');
if (!PASSWORD) missing.push('E2E_PASSWORD');
if (missing.length) {
  console.error(`Missing required env vars: ${missing.join(', ')}`);
  console.error('See the header comment of this file for the full list.');
  process.exit(1);
}

await mkdir(path.dirname(OUTPUT), { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

try {
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });

  // >>> CUSTOMIZE START <<<
  // Replace these locators if your form labels / button text differ.
  await page.getByLabel(/email|username/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in|log in|continue/i }).click();
  // >>> CUSTOMIZE END <<<

  await page.waitForURL(new RegExp(POST_LOGIN_PATTERN), { timeout: TIMEOUT_MS });
  await context.storageState({ path: OUTPUT });
  console.error(`✓ Saved storage state to ${OUTPUT}`);
  process.exitCode = 0;
} catch (err) {
  console.error(`✗ Login failed: ${err.message}`);
  console.error('Check the locator block in this script (look for "CUSTOMIZE") and the post-login URL pattern.');
  process.exitCode = 2;
} finally {
  await browser.close();
}
