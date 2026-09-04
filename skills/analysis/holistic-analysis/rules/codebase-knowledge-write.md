# Writing verified facts to codebase-knowledge

`holistic-analysis` confirms durable structural facts about code — an invariant a
symbol upholds, a consumer/dependent count it swept, a root-cause defect pinned to a
symbol at a SHA. Those are the scarcest, most reusable entries in the shared
`codebase-knowledge` bucket, and this skill is the engine that verifies the *why*
behind them. When a run has genuinely established such a fact against the code,
contribute it back so the next code-changer plans with it in hand.

This is a **best-effort write, gated on real verification.** It never blocks or
reshapes the analysis output the caller consumes, and it runs only when the
LoreKit `memory.*` tools are connected and the repo has a git remote — skip it
silently otherwise.

## When to write

Write only a fact THIS analysis actually confirmed against the code:

- **An invariant** a symbol holds that callers rely on — Step 1c Contract Boundary
  Analysis confirmed it → `knowledge::<symbol>@<path>`.
- **A consumer / dependent count** you swept exhaustively — the call-graph map is
  complete, not sampled → `knowledge::<symbol>@<path>`.
- **A root-cause defect** pinned to a specific symbol at the analyzed SHA — fix mode,
  Phase 4 hypothesis that cleared the Phase 6 confidence gate →
  `knowledge::<symbol>@<path>`, the defect recorded in `history[]`.

Do **not** write a hypothesis, a hunch, or an approach you did not verify. An
unverified fact is worse than no fact, because a later reader treats it as ground
truth.

## How to write (contract)

Follow the multi-writer contract in
[`../../../../agents/shared/rules/codebase-knowledge.md`](../../../../agents/shared/rules/codebase-knowledge.md)
— every bullet, not a subset:

```text
# Merge, never clobber: read the existing record, append to the capped history[],
# carry the rest through unchanged. Same scope+key updates in place.
memory.read  { scope: "repo::{owner}/{repo}", key: "knowledge::<symbol>@<path>" }
memory.write {
  scope: "repo::{owner}/{repo}",
  key:   "knowledge::<symbol>@<path>",
  value: "<yaml: invariant / consumer-count / defect + verified_at_sha:<analyzed SHA>>",
  tags:  ["codebase-knowledge", "signal::knowledge"],
  kind:  "signal",
  host:  "holistic-analysis"
}
```

- **`verified_at_sha`** = the SHA the analysis ran against; **`source_agent:
  holistic-analysis`** stamped, so a reader knows who verified the fact and when.
- **Only what THIS run verified** against the code — never a guess, and never a fact
  about a person or a telemetry reading. A fact about code, keyed to code.
- **Raise care, never suppress.** A fact here only tells the next run to preserve an
  invariant or expect a hotspot; it never lowers a bar or silences a finding.
- **Privacy pre-flight.** Drop any candidate carrying a credential, a customer name,
  a token, or PII.

## Read posture

`holistic-analysis` is a **writer-primary** host: its own Context Gathering already
traces the touched files deeply, so it does not read `codebase-knowledge` in this
wiring. The read side is owned by the plan/apply-seam hosts (`aw`,
`implement-suggestion`, `fix-bug`, `ci-auto-fix`, `optimize-approach`,
`test-auto-fix`) — this skill feeds them.
