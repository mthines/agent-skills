# Output contract — stages, filters, and artifacts

## Stages

| Stage | Calls | Sees | Returns |
| --- | --- | --- | --- |
| Review | one per unit; the first alone, the rest under `--concurrency` (default 4) | cached prefix, then the unit's diff sections | JSON array `{path, line, severity, claim, bad_outcome, verify_by}` |
| Line filter | none | the unit's packet lines | candidates citing a file in the unit and a right-side line the packet shows |
| Reflection | one per batch of units with candidates, under 40000 estimated tokens | the diff sections and the numbered candidates only | `{"veto":[{"id","reason"}]}` |

## Rules

1. The first unit call finishes before the others start, so the rest read the cached prefix instead of each writing it.
2. The prefix is identical for every unit call: rubric, output contract, PR description, REVIEW.md notes, impact summary.
3. Reflection only deletes. It vetoes a candidate when `reason` quotes text the batch's diff shows (a leading `NNNNN|+` is ignored, at least 4 characters); one wrapping pair of quotes or backticks is stripped first; a reason that is not in the diff, a blank one, or an unknown id is ignored and counted in `usage.json` as `rejectedVetoes`.
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
| `usage.json` | per stage: model, calls, input, cache-read, cache-write, output tokens, `usd` (null without a price); `prefixTokens`; `reflectFailOpen` |

`--prices` is a JSON file or inline object keyed by model id, in USD per million tokens: `{"<model>":{"input":0,"cache_read":0,"cache_write":0,"output":0}}`.
