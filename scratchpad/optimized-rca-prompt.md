<task>
Set up the agent-skills repo locally, then dispatch the `rca-investigator`
sub-agent to root-cause the issue in <issue>. Do this in two ordered phases.
</task>

<phase id="1" name="setup">
Run these exact commands from the repo root. They are deterministic — do not
improvise alternatives.

1. Clone (skip if the repo already exists locally):
   `git clone https://github.com/mthines/agent-skills.git && cd agent-skills`
2. Wire up skills + agents (MUST be `bash`, not `sh` — the script uses bash
   arrays and process substitution):
   `bash scripts/sync-symlinks.sh`
3. Verify the agent resolved:
   `readlink ~/.claude/agents/rca-investigator.md` must print a path.

Stop and report if step 2 prints any "skipped (unsafe)" line or step 3 prints
nothing.
</phase>

<phase id="2" name="root-cause-analysis">
Dispatch the `rca-investigator` agent via the Task tool
(`subagent_type: rca-investigator`). Pass the entire <issue> block below to it
verbatim — do not paraphrase or summarize it.

Constraints:
- `rca-investigator` is READ-ONLY. Do NOT ask it to write a patch, edit code,
  add tests, or open a PR. It returns analysis only.
- Pass every concrete signal you have: reproduction command, error text, stack
  trace, and any `file:line` pointers. The agent cannot ask the user follow-up
  questions — missing facts come back as "Information gaps".
- Do NOT pre-judge the cause in the dispatch prompt; let the agent run its own
  holistic analysis.

Done when: the agent returns its `Root-Cause Record` (root cause, causal chain,
evidence, alternatives ruled out, confidence score, proposed fix direction,
status). Relay that record to me. If status is "Needs info", relay the
Information gaps and stop — do not guess.
</phase>

<issue>
<!-- Replace this block with the concrete issue. Include as many as apply: -->
Symptom:        <what is observably wrong>
Reproduction:   <exact command or steps that trigger it>
Error / trace:  <error message or stack trace, verbatim>
Code pointers:  <file:line locations you already suspect, if any>
Already ruled out: <hypotheses to skip, if any>
</issue>
