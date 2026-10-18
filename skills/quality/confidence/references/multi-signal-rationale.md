# Why confidence is multi-signal

A single LLM-confidence number is unreliable as a stand-alone gate: token probability is not correctness.
Plan mode therefore combines the LLM's dimensional scoring with deterministic rule checks, and the final score is gated on both.

The failure mode it catches: a plan scores 95% on LLM judgment but fails rule check #4 (it references a file path that does not exist).
The 89% cap makes that plan fail the gate, so a model that is confident in a plan grounded in hallucinated paths cannot clear it.

Rule #9 is the requirement→criterion traceability gate: a plan cannot silently drop a user-stated requirement.
Rule #10 is the anti-reinvention gate: no new unit without a recorded reuse search.
The Completeness dimension complements rule #10 — the rule checks that the Existing Code Survey is present, the dimension checks the quality of the searches behind it.

The `bug-analysis` alias keeps in-flight workflows and existing transcripts working while callers migrate to `analysis`; remove it once callers have migrated.
