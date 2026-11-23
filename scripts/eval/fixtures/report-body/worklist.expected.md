<!-- PR_REVIEWER_REPORT -->
### 🟠 1 blocking · 1 to decide · 1 non-blocking

Moves the aw Full tier's telemetry check behind the new `checks.lock` seal.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.com/user-attachments/assets/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b">
  <img alt="What changes on merge. 1: telemetry check stuck pending. 2: logged-out preview runs. 3: stale Skeleton paths." src="https://github.com/user-attachments/assets/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b">
</picture>

| | Finding | Where |
|:-:|---|---|
| 🟠&nbsp;**1** | **aw Full's telemetry check never leaves `pending`**<br><sub>Blocking · Fix: mark it `unsatisfiable` when no backend can see the signal.</sub> | [`full-tier.md:99`](https://github.com/o/r/pull/1#discussion_r9 "skills/workflow/aw/full-tier.md") |
| 🟡&nbsp;**2** | **Decide: Repo migration order versus logged-out preview runs** | [`runner.md:31`](https://github.com/o/r/pull/1#discussion_r10 "skills/testing/ui-verify/rules/runner.md") |
| ⚪&nbsp;**3** | **Stale paths in the Skeleton example**<br><sub>Fix: point both links at `templates/`.</sub> | [`full-tier.md:140`](https://github.com/o/r/pull/1#discussion_r11 "skills/workflow/aw/full-tier.md") |

<details>
<summary>Review details</summary>
<br>

✅ Description vs. code<br>
✅ Prior review feedback<br>
✅ Documentation<br>
✅ Self-review signals

<details>
<summary>❌ <b>Code review</b></summary>

1 blocking finding — see inline comments.

</details>

| Run | Details |
|---|---|
| Mode | full · 388 lines in delta · tier standard · depth diff-only — consumer, type, and test verification unavailable |
| Anomaly | ⚠️ no checkout available — tier capped at standard; consumer, type, and test checks skipped |
| Checked | 6 possible issues → 3 confirmed → 3 posted |
| Found | produced 6 → posted inline 3 · cleared 3 · carried forward 0 · deferred 0 · below-bar 0 |
| Severity | 🟠 1 high · 🟡 1 medium · ⚪ 1 low |
| Memories | 53 indexed · 0 used |

<sup>Nothing to report — standards (2 docs), optimality (2 judged), measurability (3 paths classified), integrations (not activated), 0 files skipped.</sup>

</details>

<sup>`pr-reviewer` · commit `3c4d5e6` · full review · [how these findings are produced](https://github.com/mthines/agent-skills/blob/main/agents/pr-reviewer.md) · updated <relative-time datetime="2026-11-10T11:15:00.000Z">Nov 10, 2026 11:15am UTC</relative-time></sup>
