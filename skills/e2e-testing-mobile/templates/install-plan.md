# Phase 0 — Install plan (mobile E2E)

The repo is missing one or more requirements for Maestro on Expo / RN.
The skill **halts** and asks for permission before running anything.

## What is missing

- [ ] Maestro CLI installed (`maestro --version`)
- [ ] `.maestro/` directory at the repo root
- [ ] `.maestro/shared/sign-in.yaml` (reusable auth flow)
- [ ] `eas.json` `e2e` build profile (Expo projects only)
- [ ] EAS CLI installed (`eas --version`) — Expo projects only
- [ ] Maestro MCP wired in `.mcp.json` (optional but recommended)
- [ ] At least one booted iOS simulator or Android emulator
- [ ] `MAESTRO_API_KEY` set if running Maestro Cloud locally

## What I want to run (with your approval)

```bash
# 1. Install the Maestro CLI.
curl -Ls "https://get.maestro.mobile.dev" | bash
maestro --version

# 2. Install the EAS CLI (Expo projects only).
npm i -g eas-cli
eas --version

# 3. Scaffold the .maestro/ directory.
mkdir -p .maestro/shared
# Copy the starter flow:
#   skills/e2e-testing-mobile/templates/flow.yaml -> .maestro/shared/sign-in.yaml

# 4. Add the EAS E2E build profile (Expo projects only).
# Merge the snippet from:
#   skills/e2e-testing-mobile/templates/eas-build-profile.json
# into your eas.json under "build.e2e".

# 5. Add the EAS Workflow file (Expo projects only).
mkdir -p .eas/workflows
# Copy the starter workflow:
#   skills/e2e-testing-mobile/templates/eas-workflow.yaml -> .eas/workflows/e2e.yml
```

## Maestro MCP (optional, recommended)

`.mcp.json` (project-scoped, committable):

```json
{
  "mcpServers": {
    "maestro": {
      "command": "npx",
      "args": ["-y", "@mobile-dev-inc/maestro-mcp@latest"]
    }
  }
}
```

After config, restart the agent harness so it picks up the MCP server.

## What I will not do without explicit permission

- Run `eas build --profile e2e` — this can take 10–25 minutes and
  burns EAS Build minutes.
- Patch `ios/`, `android/`, or any prebuild output.
- Modify `package.json` outside `devDependencies`.
- Commit anything.
- Boot or shut down simulators / emulators.
- Install or migrate an existing Detox suite — see
  [`../references/detox-legacy.md`](../references/detox-legacy.md).
- Set `MAESTRO_API_KEY` or any other secret.

Reply with **approve** to proceed, or amend the plan first.
