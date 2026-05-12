---
title: Auth — Opt-In Per-Pathname Login Flow
impact: HIGH
tags:
  - storybook
  - auth
  - keychain
  - playwright
  - storage-state
---

# Auth

The skill never reads, writes, or echoes a credential in plain text.
Credentials live in the OS keychain.
The repo holds only the **profile config** — URL match patterns,
selectors, account identifier, keychain service name.
A `storageState.json` is produced once per profile and reused, so
subsequent Playwright runs skip the login form entirely.

Auth is opt-in.
A profile is consulted only when the user passes `--auth <profile>` or
when the sub-commands (`/storybook auth …`) are invoked.

## File layout

```
<repo-root>/
└── .agent/
    └── storybook/
        ├── auth.config.json          # checked in? — see below.
        └── .auth/
            ├── default.storageState.json    # gitignored.
            └── admin.storageState.json      # gitignored.
```

Add this to `.gitignore` once per repo:

```text
.agent/storybook/.auth/
```

The config file (`auth.config.json`) is **safe to commit** because it
holds no secrets — only selectors, URL globs, and keychain service
names.
A team member running the same repo on a different machine adds the
secret via `/storybook auth add <profile>` once and is done.

## Config schema

```jsonc
{
  "$schema": "https://json-schema.org/draft-07/schema",
  "profiles": {
    "<profile-name>": {
      "match": ["http://localhost:6006/**", "https://storybook.example.com/**"],
      "loginUrl": "https://storybook.example.com/login",
      "type": "form",
      "account": "ci-storybook@example.com",
      "keychainService": "agent-skills.storybook.<repo-slug>.<profile-name>",
      "selectors": {
        "username": "input[name='email']",
        "password": "input[name='password']",
        "submit": "button[type='submit']",
        "success": "[data-testid='storybook-sidebar']"
      },
      "storageStatePath": ".agent/storybook/.auth/<profile-name>.storageState.json"
    }
  }
}
```

Field rules:

- `match` is a glob list.
  The first profile whose `match` contains the running Storybook URL
  wins when the user passes no `--auth`.
  Multiple profiles with overlapping globs is allowed (admin overrides
  default, etc.) — leftmost listed wins.
- `type` is one of `form`, `basic`, `oauth-code`, `cookie`.
  `form` covers 90% of cases.
- `account` is the username / email — **not** a secret.
- `keychainService` is the OS keychain identifier — choose a unique,
  per-repo name to avoid colliding with another project's profile.
  Suggested format: `agent-skills.storybook.<repo-slug>.<profile-name>`.
- `selectors` are CSS selectors used by the Playwright login script.
  Keep them stable — prefer `name=`, `id=`, or `data-testid=`.

Example with two profiles (default + admin):
[`templates/auth.config.example.json`](../templates/auth.config.example.json).

## Where the secret lives

| OS         | Backend                | Add command                                                                                       | Read command                                                          |
| ---------- | ---------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| macOS      | Keychain (`security`)  | `security add-generic-password -s <service> -a <account> -w <password> -U`                        | `security find-generic-password -s <service> -a <account> -w`         |
| Linux      | libsecret (`secret-tool`) | `secret-tool store --label='<service>' service <service> account <account>`                       | `secret-tool lookup service <service> account <account>`              |
| Windows    | Credential Manager via DPAPI    | PowerShell: `$secret = Read-Host -AsSecureString; $bytes = [System.Security.Cryptography.ProtectedData]::Protect([System.Text.Encoding]::UTF8.GetBytes((New-Object PSCredential 'x',$secret).GetNetworkCredential().Password), $null, 'CurrentUser'); [IO.File]::WriteAllBytes("$env:LOCALAPPDATA\<service>.dpapi", $bytes)` | PowerShell: `[System.Text.Encoding]::UTF8.GetString([System.Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes("$env:LOCALAPPDATA\<service>.dpapi"), $null, 'CurrentUser'))` |

Replace `<service>` with the `keychainService` field, `<account>` with
`account`, and `<password>` with the actual secret typed by the user.

The skill **never** writes a secret to a file, never prints it to the
terminal, and never embeds it in a generated script.
The read step happens in-process at run time and the value is passed
directly to Playwright's `page.fill` or to a Cookie header — no
intermediate file, no environment variable in a shell that would
linger in shell history.

If the OS keychain is unavailable (sandboxed CI, headless Linux without
`secret-tool`), fall back to a CI-encrypted secret read **only from
`process.env` inside Node**, never from a shell interpolation.
Concrete rules for that fallback:

- Variable name: `STORYBOOK_AUTH_<PROFILE>_PASSWORD`.
- The Playwright login script reads it as `process.env.STORYBOOK_AUTH_<PROFILE>_PASSWORD`.
  Never interpolate the variable into a shell argument
  (`node login.js "$STORYBOOK_AUTH_DEFAULT_PASSWORD"`) — that puts the
  secret on the process command line, where `ps aux` and
  `/proc/<pid>/cmdline` expose it to any user.
- In GitHub Actions / GitLab CI, store the secret as an encrypted
  secret, **not** as a workflow `env:` block at job scope. Inject it
  only into the single step that needs it via that step's `env:` map.
- Never `echo` the variable. Never print it on a "debug log" branch.
  Never include it in a step summary.
- Print a one-line warning before the run: "auth profile `<name>`
  reading from env var — keychain unavailable".

**Never** silently fall back to a `.env` file.
**Never** persist the env-var value to any file the skill creates.

## Sub-commands

### `/storybook auth list`

Reads `.agent/storybook/auth.config.json` and prints one row per
profile: `<name> | <type> | <account> | <keychainService> | <match[0]>`.
Does **not** print the secret.
Marks each row with whether the keychain item exists.

### `/storybook auth add <profile>`

1. Prompt the user for `loginUrl`, `account`, the four selectors, and
   the secret.
2. Add or update the profile in `.agent/storybook/auth.config.json`.
3. Generate the `keychainService` if absent:
   `agent-skills.storybook.<repo-slug>.<profile-name>` where
   `<repo-slug>` is `basename` of the repo root.
4. Run the OS-specific `add` command above.
   The secret is piped through stdin, never echoed.
5. Add `.agent/storybook/.auth/` to `.gitignore` if missing.
6. Run the login flow once to produce `<profile>.storageState.json`.

### `/storybook auth remove <profile>`

1. Delete the profile entry from `auth.config.json`.
2. Delete the keychain item:
   - macOS: `security delete-generic-password -s <service> -a <account>`
   - Linux: `secret-tool clear service <service> account <account>`
   - Windows: `Remove-Item "$env:LOCALAPPDATA\<service>.dpapi"`
3. Delete `.agent/storybook/.auth/<profile>.storageState.json`.

### `/storybook auth test <profile>`

Runs the login script against the configured `loginUrl` and asserts
the `success` selector resolves.
Writes the resulting storage state to a **temp file** under
`$(mktemp -d)/storybook-auth-test.json` so the test does not overwrite
or invalidate the cached `<profile>.storageState.json` that subsequent
`--auth` runs depend on.
Deletes the temp file before exiting.
Returns PASS or FAIL with the failing selector name.

## Login script — Playwright

The login script is short.
Render it from the config at run time; do **not** check it in.

```ts
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";

const profile = /* loaded from auth.config.json */;
const password = /* read from OS keychain */;

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

await page.goto(profile.loginUrl);
await page.fill(profile.selectors.username, profile.account);
await page.fill(profile.selectors.password, password);
await page.click(profile.selectors.submit);
await page.waitForSelector(profile.selectors.success, { timeout: 15_000 });

await context.storageState({ path: profile.storageStatePath });
await browser.close();
```

## Reusing the session

Once `<profile>.storageState.json` exists, every Playwright run that
hits the Storybook URL passes `--storage-state=<path>`:

```bash
npx playwright screenshot \
  --storage-state=.agent/storybook/.auth/default.storageState.json \
  "http://localhost:6006/iframe.html?id=components-button--default" \
  default.png
```

`storageState.json` expires.
If the next run fails on the `success` selector, regenerate it via
`/storybook auth test <profile>` (which re-runs the login flow).

## Picking the profile automatically

When the user does not pass `--auth`, the skill picks a profile by
matching the current Storybook URL against each profile's `match`
globs.
First match wins.
If no profile matches, the skill runs without auth.
Print the picked profile name before any Playwright call so the user
can interrupt.

## Validation checklist

- [ ] `.agent/storybook/auth.config.json` exists and is valid JSON.
- [ ] No secret material in any committed file.
- [ ] `.agent/storybook/.auth/` is in `.gitignore`.
- [ ] Each profile's keychain item exists (verify with `auth list`).
- [ ] `storageState.json` was produced for the requested profile.
- [ ] The skill never echoes the password to stdout, stderr, or logs.
- [ ] Sub-commands `add`, `remove`, `list`, `test` are all wired.
