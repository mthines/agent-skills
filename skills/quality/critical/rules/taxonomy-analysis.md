# Taxonomy — `analysis` mode

Read this in every `critical analysis` run, including `deep analysis`, where every lens walks it.

Walk every row.
For each, either produce a specific challenge or write `— ok` and a one-line reason.

| # | Concern | Probe |
| - | --- | --- |
| 1 | Root cause vs. symptom | What evidence *directly* proves the diagnosis vs. merely correlates with it? |
| 2 | Detection gap | Why didn't existing tests / monitoring / types catch this? What is missing? |
| 3 | Alternative root causes | Name at least one other code path that could produce the same symptom. |
| 4 | Fix scope | Does the fix address only the reported symptom, or the class of bug? Justify either choice. |
| 5 | Reproduction integrity | Can the bug be reproduced reliably before the fix and not after? Is the repro itself a weak proxy? |
| 6 | New surface introduced by the fix | What does the fix add that could itself fail? |

Row 7 is the [Steelman alternative root cause](../SKILL.md#mandatory-steelman-alternative) — mandatory, written in the SKILL.md structure.
