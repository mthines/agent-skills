# ui-verify — why `SKILL.md` is shaped this way

The operational authority is [`../SKILL.md`](../SKILL.md).
This file records the reasons behind choices there, so a later edit can tell a load-bearing line from an incidental one.

## Why Step 0 names every `mcp`-path call

The `gh`-path commands are not a mapping.
A reader handed only `gh pr edit` on a host without `gh` has to invent the MCP call, and an agent that cannot invent it writes nothing to the PR.
So Step 0 names the `mcp__github__*` equivalent of every GitHub call the skill makes, and every tool in `allowed-tools` is named in the body.

## Why the access-path precondition is enforced in `preview-url-resolution.md`

No `mcp__github__*` tool exposes the deployments API, so `run` on the `mcp` path needs an explicit `--url`.
The condition is *`run` invoked without `--url`* — an argument Step 0 cannot see — so the branch is enforced in [`rules/preview-url-resolution.md § The access-path precondition`](../rules/preview-url-resolution.md#the-access-path-precondition-check-this-before-step-1), which `runner.md § Step 2` treats as terminal.
Reporting `inconclusive: preview not deployed` there would assert a fact about a deployment that was never checked.

## Why the on-demand browser install lives in `SKILL.md`

An Agent0 Settings → Skills import copies `SKILL.md` and nothing else.
A block in a linked file is unreachable on an unprepared host, which is exactly the host that needs it (L1 `G85b` executes the inline block).
Why each line of the block is shaped as it is: [`agent0-browser-install.md`](./agent0-browser-install.md).

## Why `author` reports `failed (no GitHub access path)` instead of the drafted specs

Writing the block into the PR body is `author`'s only deliverable.
A drafted spec that never reached the PR is indistinguishable from none to every later reader, including `run`.

## Why `verify` never overwrites an existing block

`verify` is the entry point for PRs the caller did not author.
A block already in the body is either hand-written or was authored by an earlier run, and both are the spec the PR's author agreed to.
Keeping it verbatim also makes `verify` idempotent: a second run reuses the first run's block.

## Why gitignored spec sources are lifted, not linked

`.agent/{branch}/specs.md` and `/fix-bug` repro artifacts are local-only.
`author` runs in the worktree that wrote them and copies their content into the committed PR body, the durable artifact `run` reads from any checkout and any later session.
Full contract: [`rules/spec-sources.md § Two artifacts, two lifetimes`](../rules/spec-sources.md#two-artifacts-two-lifetimes).
