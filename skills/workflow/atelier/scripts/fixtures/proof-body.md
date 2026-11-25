Falls back to %TEMP% on Windows.

Fixes #192.

<!-- verify:report -->

<!-- verify:section=intent -->
<details><summary>📋 Acceptance criteria — 2 criteria · 2 ✅ · 1 guardrail</summary>

| | Criterion | Proof |
| :-- | :-- | :-- |
| ✅&nbsp;AC‑1 | When os.tmpname() returns a bare name and TEMP is set, temp_dir() shall return TEMP. | check |
| ✅&nbsp;AC‑2 | When TEMP is empty and TMP is set, temp_dir() shall return TMP. | check |
| 🛡️&nbsp;G‑1 | Keep unchanged: the macOS and Linux temp path — docs/render.md | guardrail |

</details>
<!-- /verify:section=intent -->

<!-- verify:section=aggregate -->
## ✅ Verified — 2 of 2 criteria proven by recorded test runs

Checks-only run: each criterion is a command run on this branch, and on the base first where it can run there. Nothing needs a human.

<sub>`h1h1h1h` · checks-only · 0 findings · updated 2026-11-25 14:00 UTC</sub>

<details><summary>Details</summary>

**How I tested it.** No UI file in the diff, so no browser or environment ran. A criterion is ✅ only when its command passed on the branch; the Before column is the same command on the base, where a fail shows the test catches the change.

| AC | Command | Before (base) | After (branch) | Evidence |
| --- | --- | --- | --- | --- |
| AC‑1 | `pnpm vitest run render-lib -t 'TEMP'` | fails (catches it) | ✅ pass | 1 failed → 1 passed |
| AC‑2 | `pnpm vitest run render-lib -t 'TMP'` | fails (catches it) | ✅ pass | 1 failed → 1 passed |

Re-run: `/aw-verify run checks`

</details>
<!-- /verify:section=aggregate -->
<!-- /verify:report -->

