# Why impact-map looks the way it does

Read on demand; nothing here is needed to run the skill.

## Each part earns its place

The view holds only what a reviewer needs before approving.
A risk matrix, line-count bars, contract tables, a stack view, and a file-by-file reading tour are left out: together they read as a survey, and reviewers skim a survey.

| Choice | The failure it prevents |
| --- | --- |
| At most three decisions, as questions | A survey the reviewer skims and does not act on |
| Links nested inside their decision | Reading every concern twice, once as a decision and once as a link |
| Badges on diagram boxes | A diagram and a decision list that the reader must map onto each other |
| Expandable What / Risk / Ask rows | A dense verdict paragraph that hides which item matters |
| "Already settled" section | Reviewers re-raising behavior that a test or doc already marks as intended |
| Verify before writing | Claims written from the diff alone that the code, its permissions, or its tests contradict |
| Red only for exposure | A color that meant both "decision" and "dangerous caller" |
| One map per PR in a stack, with `Same gap in #<n>` on shared risks | A stack-wide view that becomes a survey, or per-PR maps that each show half of one contract bug |
| Workers build with `--dry-run`; the requesting session posts | A worker started before the user consented reads a relayed "post it" as unverified, so posting splits into refusals, blocked posts, and flagged posts |
| Consent check before the image upload | GitHub user-attachment uploads cannot be deleted, so a post blocked after the upload leaves images on GitHub that nothing links to |
| PNG render checked when the page is built | Labels spilling out of a box show only in the render; checking only when posting republishes the page late |

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
