<!-- PR_REVIEWER_REPORT -->
### 🟠 3 non-blocking findings · 2 notes

Reworks the retry path so `retryRequest` throws instead of returning `null`.

**Warnings:** 2 open review threads

| | Finding | Where |
|:-:|---|---|
| 🟠&nbsp;**1** | **Retry exhaustion now throws where it returned null** | [`client.ts:214`](https://github.com/o/r/pull/1#discussion_r11 "src/api/client.ts") |
| 🟡&nbsp;**2** | **Backoff jitter is seeded once per process** | [`backoff.ts:41`](https://github.com/o/r/pull/1#discussion_r12 "src/api/backoff.ts") |
| 🟡&nbsp;**3** | **`sync.ts` still branches on the old null contract** | [`sync.ts:88`](https://github.com/o/r/pull/1#discussion_r13 "src/jobs/sync.ts") |

<a href="https://app.dash0.com/goto/agent0?auto_submit=true&amp;initial_prompt=%2Fpr-fix%20owner%2Frepo%23123%20pr-review-bot&amp;utm_source=pr-reviewer-fix-all"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/mthines/agent-skills/main/agents/pr-reviewer/assets/fix-all-agent0-dark.svg"><source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/mthines/agent-skills/main/agents/pr-reviewer/assets/fix-all-agent0-light.svg"><img alt="Fix all with Agent0" src="https://raw.githubusercontent.com/mthines/agent-skills/main/agents/pr-reviewer/assets/fix-all-agent0.svg" height="36"></picture></a>

<details>
<summary>Notes (2) — posted inline</summary>
<br>

| | Finding | Where |
|:-:|---|---|
| **4** | nitpick: the header table still says GET /memories/activity<br><sub>Confidence 84</sub> | `packages/web/src/lib/queries/explorer-stats.ts:16` |
| **5** | question: no production call site remains for filtersToFacetParams<br><sub>Confidence 78</sub> | `packages/web/src/lib/filters.ts:713` |

</details>

<details>
<summary>Review details — 2 open review threads</summary>
<br>

| Gate | | Details |
|---|:-:|---|
| Description vs. code | ✅ | The description matches what the diff does. |
| Prior review feedback | ⚠️ | 2 unresolved review thread(s) — see the thread list below |
| Documentation | ✅ | The change is documented well enough to follow. |
| Self-review signals | ✅ | No debug logs, leftover TODOs, or unreviewed stubs. |
| Code review | ⚠️ | 3 non-blocking findings — see inline comments. |

**Open review threads (2)** <sup>4 resolved since `70cf147`</sup>

- [`packages/web/src/lib/filters.ts:23`](https://github.com/o/r/pull/1#discussion_r1) — the docblock still names filtersToQueryParams (human · `umanwizard`)
- [`packages/schemas/src/memory.ts:735`](https://github.com/o/r/pull/1#discussion_r2) — the advertised bound is 5x what the hop survives (bot · `cursor`)

| Run | Details |
|---|---|
| Mode | incremental · 256 lines in delta · 27 files touched |
| Checked | 7 possible issues → 5 confirmed → 5 posted |
| Found | produced 7 → posted inline 3 · notes 2 · cleared 3 · carried forward 0 · deferred 0 · below-bar 0 |
| Dropped | relevance 0 · dedupe 1 · grounding 0 · confidence 2 · shape 0 |
| Severity | 🟠 1 high · 🟡 2 medium |
| Measurability | ran · 2 paths classified · 1 missing · 0 unlinked |
| Verified | `node scripts/sync-edge-schemas.mjs --check` in sync (15 files). |
| CI | `Integration smoke (local Supabase)` is red on one case — `POST /memories/list` expected 200, got 500. |
| Memories | 62 indexed · 1 used |

**Memories used**

- [`pre-flight-logic:token-membership-tests-mis-ordered`](https://lorekit.io/lore?scope=%22repo%3A%3Ao%2Fr%22) — promoted, seen 2x

<sup>Nothing to report — standards (1 doc), optimality (3 judged), integrations (not activated), 0 files skipped.</sup>

</details>

<sup>`pr-reviewer` · commit `2c2bd19` · incremental review, delta since `70cf147` · [how these findings are produced](https://github.com/mthines/agent-skills/blob/main/agents/pr-reviewer.md) · updated <relative-time datetime="2026-08-20T14:33:00.000Z">Aug 20, 2026 2:33pm UTC</relative-time></sup>
