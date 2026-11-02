# Output contract — stages, filters, and artifacts

## Stages

| Stage | Calls | Sees | Returns |
| --- | --- | --- | --- |
| Review | one per unit; the first alone, the rest under `--concurrency` (default 4) | cached prefix, then the unit's diff sections | JSON array `{path, line, severity, claim, bad_outcome, verify_by}` |
| Line filter | none | the unit's packet lines | candidates citing a file in the unit and a right-side line the packet shows |
| Reflection | one per batch of units with candidates, under 40000 estimated tokens | a window of 12 lines around each candidate, never the rest of the diff, and the numbered candidates only | `{"veto":[{"id","reason"}]}` |

## Rules

1. The first unit call finishes before the others start, so the rest read the cached prefix instead of each writing it.
2. The prefix is identical for every unit call: rubric, output contract, team lenses, the PR description and REVIEW.md notes (framed as untrusted data between `<pr_context>` markers), and the existing-thread list (framed as data between `<existing_threads>` markers), impact summary.
3. Reflection only deletes. It vetoes a candidate when `reason` quotes text the batch's diff shows (a leading `NNNNN|+` is ignored, at least 4 characters); one wrapping pair of quotes or backticks is stripped first; the quote must be a whole diff line, or at least 12 characters inside one (a `## path` heading never counts); a reason that is not in the diff, a blank one, an unknown id, or a repeated id is ignored and counted in `usage.json` as `rejectedVetoes`.
4. Reflection fails open: a throw, unparseable text, or a reply without a `veto` array keeps every candidate and counts in `usage.json` as `reflectFailOpen`.
5. A unit whose call throws or whose reply is not a JSON array adds an `errors` entry and no candidates, and its files go to `skipped.json`; it is never retried silently.

```text
✗ Wrong — reflection rewrites a claim, or adds a finding it noticed
✓ Right — reflection returns {"veto":[{"id":2,"reason":"00041|+ if (n > 0)"}]} and nothing else
```

## Artifacts in `--out`

| File | Holds |
| --- | --- |
| `findings.json` | `lenses` (loaded), `lensesSkipped`, `findings`, `vetoed` (with `veto_reason`), `dropped` (with `why`) |
| `report.md` | findings, the not-reviewed list, errors |
| `skipped.json` | every file not reviewed, with its reason |
| `usage.json` | per stage: model, calls, input, cache-read, cache-write, output tokens, `usd` (null without a price); `prefixTokens`; `reflectFailOpen`; `rejectedVetoes` |

`usd` comes from `--prices` when one is given for the stage's model, otherwise from the cost the transport reports (`--transport claude-cli`), and `usd_source` says which; with neither it is null.

The review prefix defines severity (`high` is a security or authorization gap, cross-user data access, data loss, a doubled action, or a crash on a normal path; `medium` is wrong behavior on a realistic path or a code-and-docs disagreement; `low` is the rest) and tells the model not to report style, naming, formatting, comment wording, or a test's structure.
Each unit keeps at most 8 candidates, highest severity first, in input order within a severity; the rest are not reported.
`--cross` adds one call over a digest of boundary-relevant added lines (identity, ownership, permissions, tokens, exports) across the whole PR; it is off by default.
Units default to 12,000 estimated tokens: larger units cost less and report fewer real issues.

When `lite-review` runs `prepare-review.mjs` itself (`--pr`), it runs `--cleanup` on that context after writing the artifacts; a caller-supplied `--context` is never cleaned up.

`--cold` puts a unique first line in the prefix so a cost measurement does not read an earlier run's cache; use it when comparing runs, never in normal use.

`--prices` is a JSON file or inline object keyed by model id, in USD per million tokens: `{"<model>":{"input":0,"cache_read":0,"cache_write":0,"output":0}}`.
