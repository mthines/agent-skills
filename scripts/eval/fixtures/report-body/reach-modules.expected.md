<!-- PR_REVIEWER_REPORT -->
### ✅ No issues found

Reworks the private jitter helper behind every retrying client and exports `parseRetryAfter`.

**Checked:** 3 of 3 changed files read · 1 of 1 dependent file traced · 3 possible issues → 0 confirmed → 0 posted

<details>
<summary>What this change reaches — 1 changed export · 1 dependent file · 1 checked · 1 changed file imported by 9 files</summary>

```mermaid
flowchart LR
  subgraph pr["Changed in this PR"]
    s1["parseRetryAfter<br/>added"]:::changed
    m1["src/api/backoff.ts<br/>file changed"]:::changed
  end
  s1c1["src/api/client.ts<br/>✓ checked"]:::ok
  m1i1["src/jobs/ · 3 files<br/>import this file"]:::imports
  m1i2["src/api/ · 2 files<br/>import this file"]:::imports
  m1i3["packages/billing/src/charge.ts<br/>imports this file"]:::imports
  m1i4["+3 more files<br/>import this file"]:::imports
  s1 --> s1c1
  m1 -.-> m1i1
  m1 -.-> m1i2
  m1 -.-> m1i3
  m1 -.-> m1i4
  classDef changed fill:#eef2ff,stroke:#6366f1,color:#1e1b4b
  classDef ok fill:#e7f6ec,stroke:#16a34a,color:#14532d
  classDef partial fill:#fef9c3,stroke:#ca8a04,color:#713f12
  classDef unknown fill:#f3f4f6,stroke:#9ca3af,stroke-dasharray:4 3,color:#374151
  classDef bad fill:#fde8e8,stroke:#dc2626,color:#7f1d1d
  classDef warn fill:#fff4e5,stroke:#d97706,color:#78350f
  classDef imports fill:#f8fafc,stroke:#64748b,stroke-dasharray:4 3,color:#1e293b
```

- `parseRetryAfter` (`src/api/headers.ts`) — added change · 1 consumer file · 1 verified unaffected
- `src/api/backoff.ts` — changed file · imported by 9 files, not traced

</details>

<details>
<summary>Review details</summary>

| Gate | Status | Details |
|---|---|---|
| Description vs. code | ✅ | The description matches what the diff does. |
| Prior review feedback | ✅ | Earlier review comments are resolved. |
| Documentation | ✅ | The change is documented well enough to follow. |
| Self-review signals | ✅ | No debug logs, leftover TODOs, or unreviewed stubs. |
| Code review | ✅ | The multi-lens review found no blocking issues. |

**Found**

Quality — produced 3 → posted inline 0 · cleared 0 · carried forward 0 · deferred 0 · below-bar 0

**Run**

full · 46 lines in delta · tier deep · depth checkout
Memories — 53 indexed · 0 used

<sup>Nothing to report — standards (2 docs), optimality (2 judged), measurability (3 paths classified), integrations (not activated), severity, 0 files skipped.</sup>

</details>

<sup>`pr-reviewer` · commit `4e7a91c` · full review · [how these findings are produced](https://github.com/mthines/agent-skills/blob/main/agents/pr-reviewer.md) · updated <relative-time datetime="2026-10-03T21:40:00.000Z">Oct 3, 2026 9:40pm UTC</relative-time></sup>
