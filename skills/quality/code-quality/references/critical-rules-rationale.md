# Why the Critical Rules hold

The rules in [`SKILL.md` § Critical Rules](../SKILL.md#critical-rules-apply-always) reflect human cognitive limits, not style preferences.
Sources for each argument: [`citations.md`](./citations.md).

## Contents

- [The core bet](#the-core-bet)
- [Per-rule rationale](#per-rule-rationale)

## The core bet

Cognitive complexity — how hard code is to understand — is the best single proxy for long-term maintainability.
SonarSource's research showed that cyclomatic complexity (path counting) misses what hurts humans: nesting, broken linear flow, and decisions that compound.
So the rules target cognitive load, not theoretical complexity scores.
Readability comes before machine performance because readable code is cheaper to change, debug, and trust, and most performance wins come from algorithmic choices and profiling, not micro-optimizations.

## Per-rule rationale

1. **Linear flow** — each level of nesting is a condition the reader must hold in their head; guards-then-logic reads in one pass.
2. **Names** — code is read about 10× more than it is written, so a long intent-revealing name repays its keystrokes; single letters are fine where the scope is tight and the meaning is unambiguous (loop indices, math formulas).
3. **One thing per function** — an honest name like `validateAndPersistAndNotifyUser` exposes three reasons to change.
4. **No pre-building** — parameters, layers, and flags for hypothetical needs cost cognitive load today, and most hypotheticals never arrive.
5. **Comments explain why** — a comment that restates the code rots; one that records a non-obvious constraint or "we tried X and it broke because Y" is the one that earns its place.
6. **Measure first** — Knuth: only ~3% of code drives performance; the other 97% should be optimized for the human reader.
7. **Validate at boundaries** — defensive null checks in internal code hide real bugs by silently swallowing impossible states.
8. **Reuse first** — a second implementation drifts, bugs get fixed in only one copy, and the next reader cannot tell which one is canonical.
9. **One record per union** — N hand-synchronised maps over `OrderStatus` turn every new variant into N edits the compiler cannot check.
10. **Change footprint** — shotgun surgery compounds with every variant; consolidation before the variant keeps the next change one file.
11. **Illegal states unrepresentable** — the cheapest place to catch a bug is where it cannot exist; runtime guards the type system could enforce drift.
12. **Pure core** — pure code is the cheapest to test and reason about; the impure shell stays small enough for integration tests.
13. **Total functions** — every sentinel (`-1`, `""`, `0`) collides with a real value the next caller will hit.
