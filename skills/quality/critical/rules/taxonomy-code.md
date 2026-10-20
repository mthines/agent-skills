# Taxonomy — `code` mode

Read this in every `critical code` run, including `deep code`, where every lens walks it.

Walk every row.
Skip rows that are not applicable to the diff, but state which were skipped.

| # | Concern | Probe |
| - | --- | --- |
| 1 | Edge cases on changed paths | Empty input, max length, zero, negative, null, unicode, off-by-one, leap-second / DST |
| 2 | Concurrency, races, ordering | What happens under two concurrent callers? Retry storms? Deadlock potential? |
| 3 | Error paths and partial failures | What does the caller see when each `try/catch`, `await`, or external call fails halfway through? |
| 4 | Performance / hot path | N+1 queries, unbounded allocations, sync IO in async paths, regressions vs. the prior implementation |
| 5 | Test assertion strength | Do tests assert the *meaningful* output, or just that something was called? |
| 6 | Backwards compatibility / migration safety | API consumers, on-disk format, persisted state, feature-flag combinations |
| 7 | Naming and clarity for future readers | Misleading names, leaky abstractions, surprises at the boundary |
| 8 | Security / authz / PII surface | New attack surface, missing authz, logged secrets, broadened access |

Row 9 is the [Steelman alternative](../SKILL.md#mandatory-steelman-alternative) — mandatory, written in the SKILL.md structure.
