---
title: Evidence Gate
impact: HIGH
tags: [ci, evidence, verification]
---

# Evidence gate

Apply this gate to every proposed fix. The mechanical path records it briefly in
the transcript; the diagnostic path uses the [plan](../templates/plan-artifact.md).
A numerical confidence score is not required and cannot replace evidence.

Before applying a fix, establish:

1. **Cause:** the log, relevant code/configuration, and reproduction or equivalent
   evidence support a causal explanation. Explain why the proposed change addresses it.
2. **Scope:** identify affected callers and invariants. Inspect shared consumers
   before changing their contract, environment, or configuration.
3. **Verification:** name a check capable of disproving the fix and the CI scope
   that must pass. State any local reproduction gap explicitly.

If evidence is incomplete, run the cheapest useful discriminating check: inspect
a referenced version, reproduce the command, compare a passing matrix member, or
check whether a downstream job ran in the baseline. Expand investigation when
results conflict; do not invoke unrelated skills or reread all workflows by default.

Proceed autonomously for a supported, scoped fix within the user's authorization.
Ask only when a necessary choice cannot be resolved from repository evidence or
would exceed that authorization. Prepare a concrete proposed diff and its impact
before requesting approval. Existing authorization persists across iterations.

Stop with the competing explanations and missing evidence if no useful diagnostic
step remains. Never use a high self-assigned score to authorize a speculative fix.
For a broad or disputed diagnosis, a confidence review can supplement these checks;
it is optional and does not replace reproduction or verification.
