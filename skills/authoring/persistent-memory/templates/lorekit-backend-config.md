# LoreKit backend — activation

LoreKit is **explicit opt-in**: activate it with **path 1** (env) **or**
**path 3** (config file). Path 2 (`.mcp.json`, written by the CLI) only supplies
the endpoint + token — a `lorekit` server merely present in `.mcp.json` does
**not** switch the backend. Whichever path activates it, `persistent-memory`
routes its four operations to LoreKit's MCP tools and the call contract does not
change.

## 1. Environment (machine-wide, incl. CI) — makes LoreKit the default

```bash
export LOREKIT_MCP_URL="https://<project-ref>.supabase.co/functions/v1/mcp"
export LOREKIT_TOKEN="lk_rw_<token>"   # lk_ro_* is read-only
```

## 2. Project `.mcp.json` (per repo) — supplies the endpoint + token (not an activation on its own)

```bash
npx @lorekit/cli install \
  --endpoint https://<project-ref>.supabase.co/functions/v1/mcp \
  --token    lk_rw_<token>
npx @lorekit/cli doctor
```

## 3. Config file (explicit opt-in) — `~/.agent-memory/config.json`

```json
{ "backend": "lorekit" }
```

(Path 3 selects the backend; the endpoint + token still come from the env or
`.mcp.json`.)

## Mapping cheat-sheet

```text
tier home           → scope global
tier project-shared → scope repo::{owner}/{repo}
tier project-local  → scope branch::{owner}/{repo}::{branch}
bucket <name>       → key "<name>::<slug>"  +  tag "skill::<name>"
lesson entry        → LoreKit value (markdown, verbatim frontmatter+body)
ADD / UPDATE        → memory.write (upsert on same scope+key)
DELETE / consolidate / forget → memory.archive / memory.purge / memory.delete
read (2-tier)       → memory.list global then repo::{owner}/{repo}, merge
```

Full contract: [`../rules/backend-lorekit.md`](../rules/backend-lorekit.md).
