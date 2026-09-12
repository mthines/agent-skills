# PR description examples

Worked examples of the [description contract](./description-contract.md) — three good descriptions
and one bad one. Read them alongside the contract's Step 3 output formats, not instead of them.


## Good — feature (lean, narrative, fits the 25-line budget)

```markdown
## Why

`gw add` silently auto-cleaned stale worktrees, making the CLI feel frozen on slow filesystems. Users couldn't tell whether it had hung or was working.

## What changed

- Replace background auto-clean with an interactive prompt before deletion
- Surface the same prompt from `gw list` when stale worktrees exist
- Update help text and README to describe the new flow

## How to verify

- `gw add foo` with stale worktrees: prompt appears; Y/N both behave correctly
```

## Good — feature with template (PR template repos)

```markdown
## Summary

Agent0 emits the same logical dashboard several times as it iterates. Today each emission is its own card with its own "Create" button — picking the right one is guesswork. This PR collapses that into one floating card always reflecting the latest version, with revision history folded into the create dialog so users can flip between revisions and see the rendered dashboard before deploying.

### Overview

| Desc.        | Value                                |
| ------------ | ------------------------------------ |
| Preview link | https://example/preview              |
| Feature flag | `USE_AGENT0_SDK`                     |

## What changed

- Floating ArtifactsList above the prompt input — one card per logical artifact
- Cross-chain dedup at the data layer so floating list + dialog tabs share one revisions array
- Revision tabs inside the create dialog with a `Show source` toggle for the YAML diff
- Removed the standalone revision sidebar (~600 LOC deleted)

## How to verify

- Generate a dashboard in the preview, ask the agent to refine it, confirm the card shows one entry with `v{N}` + `Create dashboard`
```

## Good — bug fix

```markdown
## Why

Auth refresh was firing on every request after a 401, causing a token-refresh storm
when the backend was briefly unreachable.

## What changed

- Debounce refresh to one in-flight request per session
- Return the same promise to all callers waiting on the refresh
```

## Bad — verbose, file-by-file

```markdown
## Summary

This PR adds a new feature to the auth module and also updates several other files
in the codebase to support this new functionality.

## Changes

- Modified `src/auth/refresh.ts` to add a new `debouncedRefresh` function
- Modified `src/auth/index.ts` to export the new function
- Modified `src/auth/types.ts` to add a new type
- Updated `tests/auth.test.ts` to add tests
- Updated `tests/refresh.test.ts` to add tests
- Updated `README.md` with new docs
- Updated `CHANGELOG.md`
- Various other small improvements and refactors

## Type
- [x] feat
- [ ] fix
- [ ] docs ...
```

(Why it's bad: the summary is empty calories, the change list is the file list, and the type checklist adds zero signal.)
