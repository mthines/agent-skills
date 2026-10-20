# Why verify is shaped this way

Read on demand.

## One orchestrator, separate witnesses

`verify` decides what to prove and where; `ui-verify` proves it in the browser and `telemetry-verify` proves it in what the services recorded.
Each witness runs alone too, but only `verify` starts environments, fixes code, and writes the combined report, so the logic for "is this feature done" lives in one place.
The telemetry read runs in a sub-agent per window: the query results are large, the read stays independent of whoever wrote the code, and its ingest wait overlaps the next browser run.

## One committed config

A config file and a setup command per tool drift apart and make every new repo a multi-step setup.
`.agents/aw/` holds the config once, per environment, committed: a teammate who clones the repo runs `/verify` with no setup.
It sits under `.agents/` rather than `.claude/` because every agent tool reads it, not only Claude Code.
Personal values (a dataset only you export to, the MCP server key, your policies) stay in `~/.agents/aw/config.yml`, so the committed files never fork per developer.

## One spec contract

`/aw`, `ui-verify`, and `verify` all read `.agent/{branch}/specs.md` in the intent format, the only one that can say "the route may vary, the outcome may not" — what lets one file run on localhost during development and on the preview after the PR opens.
`verify` reuses an `/aw` brief instead of deriving its own, so the acceptance criteria, sealed checks, specs, and report share `AC-{n}` IDs.

## No repo presets

A public skill cannot carry one company's component map, ports, login flow, or dataset, and a preset helps only the repo it names.
`setup` detects or asks for every such value once and stores it with the repo; every rule file stays repo-agnostic.

## Real screenshots

`attach-media` uploads to GitHub's attachment store directly, so the comment shows the images the run captured, after checking each for secrets.
