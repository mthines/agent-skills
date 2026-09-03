<!-- PR_REVIEWER_REPORT -->
Reviewed your changes — no blocking issues, **3 warning(s)**: 2 open review thread(s); 3 non-blocking finding(s); CI red: Integration smoke.
<sub>Updated 2026-08-20 14:33 UTC</sub>

<details>
<summary>Additional findings (2) — cleared review, not inlined</summary>

- `packages/web/src/lib/queries/explorer-stats.ts:16` — nitpick: the header table still says GET /memories/activity (confidence 84)
- `packages/web/src/lib/filters.ts:713` — question: no production call site remains for filtersToFacetParams (confidence 78)

</details>

<details>
<summary>Review details — 2 open review threads</summary>

<sup>Incremental review for commit `2c2bd19` (delta since `70cf147`).</sup>

**Needs attention**

| Gate | Status | Details |
|---|---|---|
| Description vs. code | ✅ | The description matches what the diff does. |
| Prior review feedback | ⚠️ | 2 unresolved review thread(s) — see the thread list below |
| Documentation | ✅ | The change is documented well enough to follow. |
| Self-review signals | ✅ | No debug logs, leftover TODOs, or unreviewed stubs. |
| Code review | ⚠️ | 3 non-blocking findings — see inline comments. |

**Open review threads (2)** <sup>4 resolved since `70cf147`</sup>

- [`packages/web/src/lib/filters.ts:23`](https://github.com/o/r/pull/1#discussion_r1) — the docblock still names filtersToQueryParams (human · `umanwizard`)
- [`packages/schemas/src/memory.ts:735`](https://github.com/o/r/pull/1#discussion_r2) — the advertised bound is 5x what the hop survives (bot · `cursor`)

**Found**

Quality — produced 7 → posted inline 3 · cleared 3 · carried forward 0 · deferred 2 · below-bar 0
Dropped — relevance 0 · dedupe 1 · grounding 0 · confidence 2 · shape 0
Measurability — ran · 2 paths classified · 1 missing · 0 unlinked
Verified — `node scripts/sync-edge-schemas.mjs --check` in sync (15 files).

**Run**

incremental · 256 lines in delta · 27 files touched
CI — `Integration smoke (local Supabase)` is red on one case — `POST /memories/list` expected 200, got 500.
Memories — 62 indexed · 1 used

- [`pre-flight-logic:token-membership-tests-mis-ordered`](https://lorekit.io/lore?scope=%22repo%3A%3Ao%2Fr%22) — promoted, seen 2x

<sup>Nothing to report — standards (1 doc), optimality (3 judged), integrations (not activated), severity, 0 files skipped.</sup>

<sup>Reviewed by the [`pr-reviewer`](https://github.com/mthines/agent-skills/blob/main/agents/pr-reviewer.md) agent — open it to read how these gates and findings are produced.</sup>

</details>
