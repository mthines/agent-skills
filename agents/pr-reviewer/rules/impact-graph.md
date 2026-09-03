---
title: Impact graph — what else this diff reaches
impact: HIGH
tags:
  - pr-reviewer
  - dependencies
  - blast-radius
---

# Impact graph

A diff tells you what changed. It does not tell you what depended on what changed, and that is where the expensive bugs are.

Phase B answers three questions mechanically, before any model looks at the code:

1. Which exported symbols changed, and **how** — added, removed, signature, body?
2. Who consumes them, in which files, across which packages, and is there a test?
3. Which third-party versions moved, by how much on the semver axis, and where is that package actually used?

It answers them with a script, not a model, because these are lookups and a model asked to do lookups invents plausible ones.

## Contents

- [Run it](#run-it)
- [What comes out](#what-comes-out)
- [How it is built, cheapest first](#how-it-is-built-cheapest-first)
- [Blast radius](#blast-radius)
- [Cross-branch overlap — the same symbol on another open PR](#cross-branch-overlap--the-same-symbol-on-another-open-pr)
- [The graph is a lead, never a verdict](#the-graph-is-a-lead-never-a-verdict)
- [Degradation](#degradation)

---

## Run it

```bash
node agents/pr-reviewer/scripts/build-impact-graph.mjs \
  --workdir "$WORKDIR" \
  --base-ref "$BASE_SHA" \
  --repo "$RESOLVED_REPO" --pr "$PR_NUMBER" --overlaps \
  < /tmp/pr-files.json > /tmp/impact.json
```

| Flag | Effect |
| --- | --- |
| `--workdir` | required — the Phase A checkout |
| `--base-ref` | base SHA for the lockfile and signature comparison; `--base-dir` instead when git history is unavailable (`tarball`) |
| `--overlaps` | query other open PRs for file and symbol overlap (one `gh` call, capped at 30 PRs) |
| `--production <file>` | merge a telemetry exposure block, see [`telemetry.md`](./telemetry.md) |
| `--no-rg` | force the JS search fallback; both backends are self-tested, so results agree |
| `--self-test` | run the 48 offline cases and exit |

The script is deterministic and self-tested, in the same shape as `classify-shape.mjs`, and L1 executes its self-test.
That matters more than it sounds: a routing input that is wrong 5 % of the time is worse than no routing input, because the tier decision is announced with it as justification.

## What comes out

```jsonc
{
  "symbols": [
    { "path": "src/api/client.ts", "name": "retryRequest", "kind": "function",
      "change": "signature", "exported": true,
      "consumers": [ { "path": "src/jobs/sync.ts", "line": 88, "kind": "call" } ],
      "consumer_count": 17, "consumer_files": 14, "cross_package": true,
      "covering_tests": [ "src/api/client.test.ts" ] }
  ],
  "modules": [ { "path": "src/api/client.ts", "importers": 9, "importer_paths": [ "…" ] } ],
  "dependencies": [
    { "manifest": "package.json", "name": "stripe", "from": "14.2.0", "to": "16.0.1",
      "direct": true, "semver_delta": "major",
      "usage_sites": [ { "path": "src/billing/charge.ts", "line": 12, "api": "stripe.charges.create" } ] }
  ],
  "config_consumers": [ { "changed": "config/schema.json", "readers": [ "src/config/load.ts" ] } ],
  "overlaps": [ { "pr": 212, "author": "alice", "head": "feat/retry-budget",
                  "files": [ "src/api/client.ts" ], "symbols": [ "retryRequest" ],
                  "kind": "same-symbol" } ],
  "blast_radius": { "score": 41, "band": "high",
                    "why": [ "retryRequest: 14 consumer files across 3 packages",
                             "stripe: major bump with 6 usage sites" ] }
}
```

`consumer_count` counts call sites; `consumer_files` counts distinct files and is what the score uses.
The distinction is not cosmetic — three calls in one file is one file's worth of risk, and scoring call sites made a single importer read as three consumers.

## How it is built, cheapest first

1. **Changed symbols** from the diff hunks, with language-aware declaration patterns (`function` / `class` / `type` / `interface` / `const` / `def` / `func` / `fn` / `pub fn`). `change` is `added` / `removed` / `signature` / `body`; `signature` comes from comparing the declaration line on the LEFT and RIGHT side of the hunk, not from guessing.

   A body-only hunk is attributed to its **enclosing** export, not to a local `const` inside it. Top-level-only patterns are indentation-guarded for exactly this reason.

2. **Consumers** by `rg -n` for the symbol across `$WORKDIR`, excluding the defining file. Import lines are **not** consumers — they are `modules.importers` — because counting both double-counts every importing file. Upgrade to `codexray --call-graph callers` when it is on `PATH`, the accelerator [`call-graph-map.md`](../../../skills/analysis/holistic-analysis/rules/call-graph-map.md) already describes.

3. **Importers** by import specifier resolving to the changed module path: relative forms, `tsconfig` `paths` aliases, and the `go.mod` module path.

4. **Covering tests** as the importer set ∩ the test globs (`classify-shape.mjs`'s exported `TEST_RE`, imported — not re-written).

5. **Dependency deltas from lockfiles, not manifests.** `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `go.sum` + `go.mod`, `Cargo.lock`, `poetry.lock`, `Gemfile.lock`, `composer.lock`, base vs head.

   Manifests carry ranges. A PR that changes nothing in `package.json` can still move `stripe` two majors through a transitive re-resolution, and a PR that widens a range to `^16` moves nothing until the lock updates. **The lockfile is the version that ships.**

   A `0.x` minor bump is classified `major` with `zerover: true`: pre-1.0 packages break on minors by convention, and treating `0.4 → 0.5` as a minor is how a breaking change arrives unreviewed.

6. **Blast radius**, below.

## Blast radius

```text
score = Σ over symbols   consumer_files
                       × (2 if cross_package)
                       × (3 if change ∈ {signature, removed})
                       × traffic_multiplier
      + Σ over deps      usage_sites × (3 if major, 1 if minor)

band  = none (0) · low (< 10) · medium (< 30) · high (≥ 30)
```

`traffic_multiplier` is `1` unless telemetry supplied a band: `1.5` for `medium`, `2` for `high`. It is **upward-only** — see [`telemetry.md`](./telemetry.md), where the reason is that zero spans means *unknown*, never *safe*.

The multipliers encode three claims worth stating plainly:

- **A signature change is categorically worse than a body change** (×3). A body change can be wrong; a signature change is wrong at every call site that was not updated.
- **Crossing a package boundary doubles it.** Consumers in the same package are usually updated in the same PR by the same author. Consumers in another package are usually not.
- **A major bump is three minors.** Not because the number is bigger, but because the upstream declared a break.

`why[]` is not decoration. It is what Phase C announces as the justification for the tier it picked, so every term that contributed must be nameable.

## Cross-branch overlap — the same symbol on another open PR

With `--overlaps`, the script asks GitHub for the 30 most recently updated open PRs and intersects their file lists with this PR's, then their changed symbols where the other head is fetchable.

| `kind` | Meaning | Effect |
| --- | --- | --- |
| `same-symbol` | both PRs change the same exported symbol | a `standard`-tier trigger, and a consequence note in `Impact` |
| `same-file` | both touch the file, different symbols | a note only |

```markdown
`retryRequest` is also changed on #212 by @alice (`feat/retry-budget`) — a semantic
conflict is likely even if git merges both cleanly.
```

This is the cheapest available answer to "find things between branches and authors": it needs no memory at all, only GitHub state that already exists.
Git will merge two clean edits to different lines of the same function and produce code neither author wrote.
The memory half — what a *previous, merged* PR taught the reviewer about this symbol — is [`memory.md`](./memory.md).

## The graph is a lead, never a verdict

Same stance as `call-graph-map.md § Step 4`, and it is not a formality.
Static search under-counts dynamic dispatch, reflection, string-keyed registries, dependency injection, and anything reached through a barrel re-export chain the resolver did not follow.

```text
✅ RIGHT — "the graph lists 14 consumer files; I read sync.ts:88 and it checks `=== null`"
❌ WRONG — "14 consumers are affected" (posted without reading one of them)
❌ WRONG — "no consumers, so this is safe" (the graph found none; that is not the same thing)
```

A finding cites the code the graph pointed at. The graph itself is never the evidence.

## Degradation

| Situation | Behavior |
| --- | --- |
| `DEPTH_CAPABILITY = diff-only` | symbols still extracted from hunks; `consumers`, `importers`, `covering_tests` empty; band computed from dependency terms only, and the report says the graph is partial |
| `DEPTH_CAPABILITY = tarball` | full graph; lockfile comparison needs `--base-dir` since there is no git history |
| `rg` absent | JS fallback, same results, slower |
| `gh` overlap query fails | `overlaps: []` and a note; never a failed run |
| A lockfile format the parsers do not know | that manifest is skipped, and named in the report as unparsed — never silently treated as "no dependency changes" |

Every one of these is a *declared* partial result. An empty `consumers[]` array that means "could not look" must never be read as "nobody calls it".
