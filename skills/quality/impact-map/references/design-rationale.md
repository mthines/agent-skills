# Why impact-map looks the way it does

Read on demand; nothing here is needed to run the skill.

## The format was set by two real runs

The skill was written from a run without a skill on two PRs: a 103-file feature (new routes, migrations, a secret-serving route) and a 528-file consolidation (deleted skills, a slimmed agent, an unrun eval suite).
The first draft had nine sections: a risk matrix, line-count bars, contract tables, a stack view, and a nine-file reading tour.
The reader called it overwhelming, and each cut since then kept only what a reviewer needs before approving.

| Choice | The failure it prevents |
| --- | --- |
| At most three decisions, as questions | A survey the reviewer skims and does not act on |
| Links nested inside their decision | Reading every concern twice, once as a decision and once as a link |
| Badges on diagram boxes | A diagram and a decision list that the reader must map onto each other |
| Expandable What / Risk / Ask rows | A dense verdict paragraph that hides which item matters |
| "Already settled" section | Reviewers re-raising behavior that a test or doc already marks as intended |
| Verify before writing | In the first run, three of the first draft's claims were wrong and two "risks" were tested, intended behavior |
| Red only for exposure | A color that meant both "decision" and "dangerous caller" |

## Research behind it (2025–2026)

| Source | Finding | Where it shows up |
| --- | --- | --- |
| "Does Order Matter? File Ordering and Code Review Effectiveness", arXiv, Sep 2026 (https://arxiv.org/abs/2609.22610) | Each extra file cuts the odds of any review comment by about 8.7%; alphabetical order is not neutral | Decisions ranked by reversibility and reach; "safe to skim" line |
| "Explaining Risk of Code Changes using LLM-Based Prediction Models", arXiv, Jul 2026 (https://arxiv.org/abs/2607.02782) | The top two highlighted hunks cover outage lines 54% of the time; reviewers read 26% of changed lines | ≤ 3 linked lines per decision |
| "Trust-Calibrated Code Review", arXiv, Jun 2026 (https://arxiv.org/html/2606.01969v1) | Multi-file LLM changes are a trust-calibration problem; overview → files → snippets | Three levels: verdict row → decision → line |
| "Does AI Code Review Lead to Code Changes?", IEEE TSE 2026 (https://arxiv.org/abs/2508.18771) | Concise, hunk-level comments with code are the ones acted on | One-sentence What / Risk / Ask; a question at each line |
| "How AI Coding Agents Communicate", MSR 2026 (https://arxiv.org/html/2602.17084) | Structured PR descriptions correlate with faster reviewer response | Collapsible, fixed-order comment |
| GitHub Blog, "Agent pull requests are everywhere", May 2026 | Check CI and tests first; one sentence of purpose, or split the PR | The "Why" line and the Verified / Not run line |

No 2025–2026 study tests diagrams in PRs directly, and none measures summary length itself; the length cap rests on the comment and structure findings above.
