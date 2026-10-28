# Review context: why `REVIEW.md` works the way it does

The rule is [`../rules/review-context.md`](../rules/review-context.md); this file holds the reasons and the sources.

## The gap it closes

Standards discovery ([`discover-standards.mjs`](../../pr-reviewer/scripts/discover-standards.mjs)) keeps only lines matching must, always, never, do not, forbidden, or prefer-over.
That filter is right for enforcement, because a standards finding must cite a written rule.
It also drops every descriptive architecture note, such as "the query service reads only from replicas", so the one kind of knowledge a reviewer cannot recover from the code never reached a finder.
`path_instructions` did not fill the gap: it only adjusts confidence scoring for findings that already exist.

## Why a separate file, not more `CLAUDE.md`

`CLAUDE.md` loads into every coding session, so review-only notes there cost context on every task.
`REVIEW.md` is read only when reviewing.
Anthropic's Claude Code Review uses the same filename for the same split, with review guidance in `REVIEW.md` and general context in `CLAUDE.md` ([Claude Code Review customization](https://code.claude.com/docs/en/code-review-customize.md)).

## Why every ancestor directory, nearest wins

Claude Code Review, Cursor Bugbot (`.cursor/BUGBOT.md`), and Greptile (`.greptile/`) all load the root file plus nested files on the path to each changed file.
"Closest wins" is the [AGENTS.md](https://agents.md) precedence rule, and it matches how a subsystem owner expects their notes to override repo-wide ones.

## Why the base commit

A PR that edits the file that briefs its reviewer can silence or steer the review.
[GitInject (arXiv 2606.09935)](https://arxiv.org/html/2606.09935v1) shows this against agent config files (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`) loaded from a PR checkout.
Claude Code Review reads `REVIEW.md` from the base or default branch for this reason; GitHub Copilot review reads instructions from the PR head, which is the weaker design.
The review config already follows the same rule (`readBaseReviewConfig`).

## Why context and not instruction

Treating the notes as background rather than authority keeps a repo-writable file from changing severity, suppressing findings, or the output format.
Suppression already has audited paths (`/pr-review remember`, review-config `filters:`), so a second, unaudited one would only add an injection surface.
Each finding still needs code evidence, so a note can explain a defect but cannot invent one.

## Why 30,000 characters, whole files only

Bugbot caps each rule file at 30,000 characters and the combined set at 100,000.
This reviewer uses 30,000 across all files: the section rides in the review packet that every finder and the verifier read, so it is paid once per sub-agent, and 30,000 matches the existing standards budget.
This is a deliberate deviation from Bugbot's 100,000 total; raise it only with a measured recall gain.
Skipping a whole file rather than truncating follows Claude Code Review, and listing what was skipped follows Bugbot's verbose mode, so a missing note is never silent.

## What the evidence does and does not say

ETH Zurich ([arXiv 2602.11988](https://arxiv.org/abs/2602.11988)) found repository context files raise coding-agent cost by more than 20% without reliably raising success, and that repo overviews did not help.
That is why the authoring guidance asks for facts the code cannot show, not overviews.
No published study measures review precision or recall with and without such notes; the `review-context` cases in `scripts/eval/golden/bug-detection.jsonl` are this repo's own check.
