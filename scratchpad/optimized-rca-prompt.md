<task>
Root-cause the issue in <issue> by following the `rca-investigator` agent
protocol, fetched directly from GitHub. Do NOT clone the repo and do NOT rely
on `Task()` or `Skill()` dispatch — nothing is installed. You will fetch the
instruction files and follow them inline.
</task>

<phase id="1" name="fetch-dependency-closure">
The protocol spans three files (the agent + the two skills it invokes in
`fix` mode). Fetch ALL THREE before doing anything else, so every dependency
is present:

1. Agent protocol:
   https://raw.githubusercontent.com/mthines/agent-skills/refs/heads/main/agents/rca-investigator.md
2. holistic-analysis skill (the agent runs this in `fix` mode):
   https://raw.githubusercontent.com/mthines/agent-skills/refs/heads/main/skills/analysis/holistic-analysis/SKILL.md
3. confidence skill (the analysis-mode confidence gate):
   https://raw.githubusercontent.com/mthines/agent-skills/refs/heads/main/skills/quality/confidence/SKILL.md

Note: `holistic-analysis`'s `review-mode.md` and `lens.md` are NOT needed —
those belong to `review` mode, which this protocol does not use.

If any fetch fails, stop and report which URL failed. Do not proceed with a
partial protocol.
</phase>

<phase id="2" name="follow-the-protocol-inline">
Execute `rca-investigator.md` against the <issue> block, with these
substitutions (because nothing is installed):

- Wherever the agent says `Skill("holistic-analysis", "fix\n\n...")`, instead
  follow the holistic-analysis SKILL.md you fetched in step 2, in `fix` mode.
- Wherever it says `Skill("confidence", "analysis\n\n...")`, instead follow
  the confidence SKILL.md you fetched in step 3, in `analysis` mode.

Constraints (from the agent's own contract — honour them):
- READ-ONLY. Do NOT edit code, write tests, create branches, or open a PR.
  Produce analysis only; describe the fix direction, never the patch.
- Do NOT hallucinate a root cause. Only cite `file:line` you actually opened
  and read. If the evidence is inconclusive, return the strongest hypotheses
  with their gaps — a fabricated single cause is worse than an honest "two
  ways, here's what would disambiguate".
- Pass the <issue> contents through verbatim; do not pre-judge the cause.

Done when: you have produced the `Root-Cause Record` exactly as specified in
the agent file (Symptom, Root cause, Causal chain, Key evidence, Alternatives
ruled out, Proposed fix direction, Confidence (analysis) score + breakdown,
Information gaps, Status). Output ONLY that record. If Status is "Needs info",
surface the Information gaps and stop — do not guess.
</phase>

<issue>
<!-- Replace this block with the concrete issue. Include as many as apply: -->
Symptom:           <what is observably wrong>
Reproduction:      <exact command or steps that trigger it>
Error / trace:     <error message or stack trace, verbatim>
Code pointers:     <file:line locations you already suspect, if any>
Already ruled out: <hypotheses to skip, if any>
</issue>
