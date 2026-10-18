---
type: llm
focus: { source: file, path: .agent/report-json/plan.md }
---

PASS if the plan's acceptance criteria cover all four stated behaviours — `--json` prints one JSON object on stdout, output without the flag is unchanged, an unknown flag prints usage to stderr and exits 2, and `formatJson(rows)` is added to `src/format.mjs` — and each criterion is concrete enough to check with a command or a test.
FAIL if the file is missing, any of the four behaviours has no criterion, or the criteria are vague ("works correctly", "looks right").
