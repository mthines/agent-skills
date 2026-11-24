# Why verify is shaped this way

Read on demand.

## One orchestrator, separate witnesses

`aw-verify` decides what to prove and where; `ui-verify` proves it in the browser and `telemetry-verify` proves it in what the services recorded.
Each witness runs alone too, but only `aw-verify` starts environments, fixes code, and writes the combined report, so the logic for "is this feature done" lives in one place.
The telemetry read runs in a sub-agent per window: the query results are large, the read stays independent of whoever wrote the code, and its ingest wait overlaps the next browser run.

## One committed config

A config file and a setup command per tool drift apart and make every new repo a multi-step setup.
`.agents/aw/` holds the config once, per environment, committed: a teammate who clones the repo runs `/aw-verify` with no setup.
It sits under `.agents/` rather than `.claude/` because every agent tool reads it, not only Claude Code.
Personal values (a dataset only you export to, the MCP server key, your policies) stay in `~/.agents/aw/config.yml`, so the committed files never fork per developer.

## One spec contract

`/aw`, `ui-verify`, and `aw-verify` all read `.agent/{branch}/specs.md` in the intent format, the only one that can say "the route may vary, the outcome may not" — what lets one file run on localhost during development and on the preview after the PR opens.
`aw-verify` reuses an `/aw` brief instead of deriving its own, so the acceptance criteria, sealed checks, specs, and report share `AC-{n}` IDs.

## No repo presets

A public skill cannot carry one company's component map, ports, login flow, or dataset, and a preset helps only the repo it names.
`setup` detects or asks for every such value once and stores it with the repo; every rule file stays repo-agnostic.

## Real screenshots

`attach-media` uploads to GitHub's attachment store directly, so the comment shows the images the run captured, after checking each for secrets.

## One criteria list, two writers

`/aw` opens the PR before `aw-verify` can post, so both publish the same `intent` region: `/aw` from the brief (`--from-plan`, statuses from `run-checks.mjs`), `aw-verify` from what it observed (surfaces, Proof, final statuses).
One renderer for a brief means the text is byte-identical whoever publishes it, and a status means "as of the last run": a run starts by republishing `⬜` and ends by ticking every row, so a crash never leaves a tick from an older head.
A criterion with no surface of its own (a CLI exit code, an internal rule) is `check`, which production verification reports as not watched instead of inventing a route.

## A ui: criterion needs the browser

A `ui:` criterion promises something the user sees, so a unit or component test is a stand-in for it, not proof; letting such a criterion stay `⏭️` under a `✅` verdict let a run check some criteria in the browser and wave the rest through on tests.
An `api:` or `worker:` criterion has no surface a reviewer would look at, so committed tests remain enough there, listed under **Worth a look in the preview**.

## The gate runs before the PR too

`/aw` runs `aw-verify` with `--no-comment` before the PR exists, and that is where the fix loop decides whether to continue.
A gate that reads only the PR therefore ran after every decision it should have bounded, so `--check --local` applies the same rules to the run directory.
Agents claim completion far more often than they finish, and an instruction does not change that; a deterministic count of criteria with a final mark does ([arXiv 2611.10063](https://arxiv.org/pdf/2611.10063), [MAST, arXiv 2503.13657](https://arxiv.org/pdf/2503.13657v3)).

## The agent signs in only where the user said

The fixture login is run by the user or a scheduler by default, because a credential typed by the agent is a credential the agent holds.
`sign_in_host` lets the user lift that for one host and one test user, from the personal config only, so an unattended run on their own machine can refresh an expired session instead of stopping at `blocked (auth: … expired)`.
It is personal, not committed, because a committed key would grant the same sign-in to every agent that clones the repo.
The exact-host match and the never-create-accounts rule keep a redirect or a sign-up page from widening that grant.

