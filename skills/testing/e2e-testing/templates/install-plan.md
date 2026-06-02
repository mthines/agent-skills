# Phase 0 — Install plan

The repo is missing one or more requirements for Playwright Test Agents.
The skill **halts** and asks for permission before running anything.

## What is missing

- [ ] `@playwright/test` in `devDependencies`
- [ ] `@playwright/test` version `>= 1.56`
- [ ] `@playwright/mcp` in `devDependencies`
- [ ] `playwright.config.ts` at the repo root
- [ ] `specs/` directory
- [ ] `tests/seed.spec.ts`

## What I want to run (with your approval)

```bash
# 1. Install Playwright + the MCP server.
npm i -D @playwright/test@latest @playwright/mcp@latest
npx playwright install --with-deps

# 2. Initialise the agent definitions and folder layout.
npx playwright init-agents --loop=claude

# 3. Add the MCP server to .mcp.json (project-scoped) or
#    ~/.claude.json (user-scoped). Choose one — I will not write both.
```

`.mcp.json` (project-scoped, committable):

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest"]
    }
  }
}
```

## What I will not do without explicit permission

- Run `npm install` — large network operation.
- Modify `package.json` outside `devDependencies`.
- Commit anything.
- Create credentials, accounts, or test users.
- Set `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` for `tests/seed.spec.ts`.

Reply with **approve** to proceed, or amend the plan first.
