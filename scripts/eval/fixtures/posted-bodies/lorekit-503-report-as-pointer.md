<!-- PR_REVIEWER_POINTER -->
Reviewed your changes — no blocking issues, **3 warnings**.

<details>
<summary>Additional findings (2) — cleared review, not inlined</summary>

- `packages/web/src/lib/queries/explorer-stats.ts:16` — nitpick: the header table still says GET /memories/activity (confidence 84)
- `packages/web/src/lib/filters.ts:713` — question: no production call site remains for filtersToFacetParams (confidence 78)

</details>

<details>
<summary>Review details — 2 open bot threads</summary>

<sup>Incremental review for commit `2c2bd19` (delta since `70cf147`).</sup>

| Gate | Status | Details |
|---|---|---|
| Description vs. code | ✅ | The description matches what the diff does. |
| Prior bot feedback | ⚠️ | 2 unresolved bot thread(s) — see the thread list below |
| Documentation | ✅ | The change is documented well enough to follow. |
| Self-review signals | ✅ | No debug logs, leftover TODOs, or unreviewed stubs. |
| Code review | ⚠️ | 3 non-blocking findings — see inline comments. |

**Open bot threads (2)** <sup>4 resolved since `70cf147`</sup>

- [`packages/web/src/lib/filters.ts:23`](https://github.com/o/r/pull/1#discussion_r1) — the docblock still names filtersToQueryParams
- [`packages/schemas/src/memory.ts:735`](https://github.com/o/r/pull/1#discussion_r2) — the advertised bound is 5x what the hop survives

**CI** — `Integration smoke (local Supabase)` is red on one case — `POST /memories/list` expected 200, got 500.

**Verified** — `node scripts/sync-edge-schemas.mjs --check` in sync (15 files).

**Run mode** — incremental · 256 lines in delta · 27 files touched

**Memories** — 62 indexed · 1 used

- [`pre-flight-logic:token-membership-tests-mis-ordered`](https://lorekit.io/lore?scope=%22repo%3A%3Ao%2Fr%22) — promoted, seen 2x


**Quality** — produced 7 → posted inline 3 · cleared 3 · carried forward 0 · deferred 2 · below-bar 0

- dropped: relevance 0 · dedupe 1 · grounding 0 · confidence 2 · shape 0

**Integrations** — not activated

**Optimality (2.4c)** — ran · 3 judged · 3 optimal · 0 proposal(s) · 0 inline pointer(s) · 0 withheld

**Standards (2.4d)** — ran · 1 doc · 0 finding(s)

**Skipped files** — none

<sup>Reviewed by the [`pr-reviewer`](https://github.com/mthines/agent-skills/blob/main/agents/pr-reviewer.md) agent — open it to read how these gates and findings are produced.</sup>

</details>
