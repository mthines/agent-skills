# Why local-verify is shaped this way

Read on demand.

## One spec contract

`/aw`, `ui-verify`, and `local-verify` all read `.agent/{branch}/specs.md`.
When each assumed its own format, a spec written by one broke in the next: `ui-verify author` wrapped every lifted file as a grammar block, while `local-verify` wrote intent specs into the same path.
The intent format (`Format: intent`) is the shared contract because it is the only one that can say "the route may vary, the outcome may not", which is what lets the same file run on localhost during development and on the preview after the PR opens.
`local-verify` reuses an `/aw` brief and spec instead of deriving its own, so the acceptance criteria, the sealed checks, the spec, and the report all carry the same `AC-{n}` IDs.

## No repo presets

The skill once shipped a preset per repo: a component map, ports, a login flow, a telemetry dataset, and commit conventions for one company's monorepo.
A public skill cannot carry those, and a preset only helps the one repo it names.
`setup` now detects or asks for every such value once and stores it — shared values in the repo's own `.claude/local-verify.yml` and notes file, personal values in `~/.claude/local-verify.local.yml` — so a repo's facts live with the repo, and every rule file stays repo-agnostic.
The repo-specific stack tool became the generic `cli` driver, whose commands are config.

## Real screenshots, not placeholders

The report once carried one placeholder per screenshot for the developer to drag an image onto.
`attach-media` uploads to GitHub's attachment store directly, so the comment shows the images the run captured, after it has checked each one for secrets.
