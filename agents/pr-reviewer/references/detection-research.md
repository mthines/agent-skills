---
title: Detection research — where the six-phase design came from
impact: MEDIUM
tags:
  - pr-reviewer
  - research
  - references
---

# Detection research

Every load-bearing decision in the [detection core](../../pr-reviewer.md) has a source outside this
repository, and this file is where those sources live.
It exists so a maintainer changing one of those decisions can see what it was reasoning against —
a design note with no citation is indistinguishable from a preference.

It is **not** a design document and carries no rules.
The rules live in the phase files; this is the reading list behind them.

**Provenance and caveats.**
The material was compiled 2026-09-03.
`cursor.com`, `greptile.com`, `graphite.com`, `docs.coderabbit.ai`, and `docs.github.com` were
egress-blocked from the research sandbox, so claims attributed to those pages come from
search-engine excerpts (quoted text, URL preserved) rather than a direct fetch; only
`code.claude.com` and `github.com` were fetched directly.
Re-verify any figure against the live page before quoting it, and treat every vendor-run benchmark
below as vendor-run — the rankings flip by author.

## Contents

- [What this design borrowed](#what-this-design-borrowed)
- [What this design rejected](#what-this-design-rejected)
- [Precision numbers, and why none of them is a target](#precision-numbers-and-why-none-of-them-is-a-target)
- [Sources](#sources)

---

## What this design borrowed

| Principle | Where it lives here | Source |
| --- | --- | --- |
| **Finders flag; a separate verification step checks candidates against actual code behaviour before posting.** | [`finders.md`](../rules/finders.md) + [`finding-verifier.md`](../../shared/rules/finding-verifier.md) — Phases D and E | [Claude Code Review](https://code.claude.com/docs/en/code-review) |
| **Aggressive finders, not cautious ones.** Cursor's agentic rebuild *under*-flagged until prompts told it to "investigate every suspicious pattern and err on the side of flagging"; precision came from the pipeline around the generator, not from a timid generator. | the polarity rule — "a finder that self-censors costs a finding nothing downstream can recover" | [Building Bugbot](https://cursor.com/blog/building-bugbot) |
| **Diversify then vote** — N passes over a permuted diff order, keeping what several agree on. | `--effort high` raises the finder count from 3 to 5 ([`depth-routing.md`](../rules/depth-routing.md)) | [Building Bugbot](https://cursor.com/blog/building-bugbot) |
| **Effort tiers that trade cost for recall while holding the resolution rate constant.** | `--effort high` and the three depth tiers | [May 2026 Bugbot changes](https://cursor.com/blog/may-2026-bugbot-changes) |
| **Incremental review by default** — review only the delta since the last bot review. | the run-mode axis ([`depth-routing.md`](../rules/depth-routing.md)) and the per-PR state record ([`memory.md`](../rules/memory.md)) | [Bugbot docs](https://cursor.com/docs/bugbot) |
| **Read existing PR threads before posting** so a human's or another bot's finding is not restated. | [`prior-comment-awareness.md`](../../shared/rules/prior-comment-awareness.md) | [Bugbot docs](https://cursor.com/docs/bugbot) |
| **A passing status means no issues *and* no unresolved earlier bot comments** — otherwise neutral, never failing. | Gate 3's tri-state, and Gate 2 warning rather than failing | [Bugbot docs](https://cursor.com/docs/bugbot) |
| **Learned rules via candidate → promote → auto-disable**, from downvotes, replies, and human-reviewer comments, plus an explicit `remember` for direct teaching. | the relevance rule's read-time lifecycle and [`/pr-review remember`](../../../skills/quality/pr-review/SKILL.md) | [Bugbot learning](https://cursor.com/blog/bugbot-learning) |
| **Commit-level evidence as a learning signal** — whether a comment was addressed between the first and the last commit. | the `fixed` / `declined` outcome signals in [`comment-relevance-memory.md`](../../shared/rules/comment-relevance-memory.md) | [Greptile memory and learning](https://www.greptile.com/docs/how-greptile-works/memory-and-learning) |
| **Directory-scoped rule files, loaded by walking up from the changed files, root always included.** | the governing-doc discovery in [`standards-conformance.md`](../../shared/rules/standards-conformance.md) | [Bugbot docs](https://cursor.com/docs/bugbot) |
| **A graph of the codebase, so impact is assessed beyond the diff** — "changing a function in one file silently breaks a caller in another that the PR never touched". | [`impact-graph.md`](../rules/impact-graph.md) + `scripts/build-impact-graph.mjs` — Phase B | [Greptile](https://www.greptile.com/docs/how-greptile-works/graph-based-codebase-context), [Macroscope](https://macroscope.com/content/cursor-bugbot-vs-macroscope-ai-code-review) |

## What this design rejected

Three departures, each deliberate.

**Similarity search is not consumer discovery.** An embedding index "returns the code most similar to
your query, which is a different set from the repositories that declare a dependency on what you are
changing" ([riftmap](https://riftmap.dev/blog/claude-code-cursor-cross-repo-context/)).
Bugbot's caller awareness is best-effort agentic search, and no official source describes a
persistent call graph for it.
Phase B resolves consumers structurally instead, which is why `blast_radius.band` can be an input to
routing at all — a best-effort search cannot be.

**Dependency reasoning had no prior art to copy.** No Cursor documentation was found on reasoning
about library versions, upgrade breaking changes, or lockfile diffs; Cursor routes library migrations
to its Agent rather than to Bugbot
([code modernization](https://cursor.com/for/code-modernization)), and its vulnerability scanner is a
separate product.
[`finder-dependency.md`](../rules/finder-dependency.md) is therefore built from first principles: read
the version from the **lockfile** rather than the manifest, walk the changelog over the whole range,
and intersect each documented break with this repo's own usage sites.

**Memory is keyed structurally, and is not per-repository-opaque.** Bugbot's learned rules are per
repository, and cross-repo context is unsupported.
This design keeps the `repo::` scope but keys records on `symbol@path` rather than on comment prose,
so what one author's PR taught the reviewer is available on the next author's PR touching the same
symbol — the cross-branch, cross-author property [`memory.md`](../rules/memory.md) exists for.

## Precision numbers, and why none of them is a target

The published figures disagree with each other by a factor of two, which is the useful finding.

| Benchmark | Bugbot | Notes |
| --- | --- | --- |
| [Greptile](https://www.greptile.com/benchmarks) (50 PRs, recall only) | 58 % | vendor-run by a competitor; explicitly ignores false positives |
| [Macroscope](https://macroscope.com/content/best-ai-code-review-tools-github-2026) (118 bugs, 45 repos) | 42 % detection, 0.91 comments/PR "all runtime-relevant" | vendor-run by a competitor |
| [Tenki](https://tenki.cloud/benchmarks/code-reviewer) (122 bugs, 50 PRs) | 32.0 % recall / 51.3 % precision / 39.4 F1 | highest precision of the bots measured |
| [AIMultiple](https://aimultiple.com/ai-code-review-tools) | ranked below CodeRabbit | independent |

Cursor's own metric is **resolution rate** — an LLM judges at merge time which flagged bugs the
author actually fixed — reported as rising from 52 % to over 70 % across "40 major experiments", and
"nearing 80 %" by April 2026
([out of beta](https://cursor.com/blog/bugbot-out-of-beta), [building Bugbot](https://cursor.com/blog/building-bugbot), [learning](https://cursor.com/blog/bugbot-learning)).

Two things follow for this repo, and both are already implemented rather than aspirational:

1. **Recall and precision are gated together.** `scripts/eval/l2-detection.mjs` gates on
   `recall ≥ 0.7` **and** `fp ≤ 0.2`, so neither can be bought with the other — the failure mode
   every recall-only benchmark above cannot see.
2. **The false-positive rate is measured against decoys, not against difficulty.**
   `golden/bug-detection.jsonl` carries ten controls, each a seeded record with the defect removed or
   the consumer fixed in the same PR, so the number measures discrimination.

A resolution-rate equivalent is what the `review-outcomes` bus and
[`outcome-learning.md`](../../shared/rules/outcome-learning.md) collect post-merge.
It is the right metric and it is not yet a gate, because it needs merged PRs to exist first.

## Sources

Grouped by what they document.

**Bugbot architecture and precision.**
[Building Bugbot](https://cursor.com/blog/building-bugbot) ·
[Out of beta](https://cursor.com/blog/bugbot-out-of-beta) ·
[Autofix](https://cursor.com/blog/bugbot-autofix) ·
[Learning](https://cursor.com/blog/bugbot-learning) ·
[May 2026 changes](https://cursor.com/blog/may-2026-bugbot-changes) ·
[Bugbot docs](https://cursor.com/docs/bugbot) ·
[AI code review guide](https://cursor.com/guides/ai-code-review)

**Competitor designs.**
[Greptile graph context](https://www.greptile.com/docs/how-greptile-works/graph-based-codebase-context) ·
[Greptile memory and learning](https://www.greptile.com/docs/how-greptile-works/memory-and-learning) ·
[CodeRabbit incremental review](https://docs.coderabbit.ai/overview/pull-request-review) ·
[CodeRabbit learnings](https://docs.coderabbit.ai/knowledge-base/learnings) ·
[Graphite review customization](https://graphite.com/docs/ai-review-customization) ·
[Copilot review customization](https://docs.github.com/en/copilot/tutorials/customize-code-review) ·
[Claude Code Review](https://code.claude.com/docs/en/code-review)

**Benchmarks.**
[Greptile](https://www.greptile.com/benchmarks) ·
[Macroscope](https://macroscope.com/content/best-ai-code-review-tools-github-2026) ·
[Tenki](https://tenki.cloud/benchmarks/code-reviewer) ·
[Martian](https://github.com/withmartian/code-review-benchmark) ·
[AIMultiple](https://aimultiple.com/ai-code-review-tools)
