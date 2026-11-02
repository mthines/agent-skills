# Design rationale

## Why a script and not an agent

The full reviewer is an agent in a harness session. Every model turn re-reads the session's whole context, so cost is turns multiplied by that context, and the context does not shrink when the work is small.
Lite makes direct API calls with a small, fixed prefix that is cached, so each call pays for its own unit and a cheap cached read of the prefix.
The deterministic work that already exists (`prepare-review.mjs`: packet, hunks with head line numbers, impact graph, REVIEW.md) runs in code before any model call.

## Alternatives it beat

- **An agent in a harness, trimmed.** Pruning the existing reviewer's instructions saves single-digit percent, because the cost is the per-turn context re-read rather than the instruction text. It beats nothing on cost, so it was the baseline and not the design.
- **Tools per file (an agent loop per file).** An isolated sub-agent per file with bounded read and search tools gives the model room to chase a caller or a definition, which raises recall. It also reintroduces many turns per file. Lite gives each unit the packet and the impact summary and no tools; the checks a tool would have run go to `verify_by`.
- **No reflection.** Skipping the second stage saves one call per batch, but the line filter checks only that a line exists, not that the claim holds. A separate filter-only call that sees just the diff and the candidates removes claims the diff itself contradicts, and fails open so it can never remove a finding because of an error.

## Source design

Lite follows the shape of rule-guided, per-file, filter-reflected reviewers such as [OpenCodeReview](https://arxiv.org/html/2608.09290v1): deterministic dispatch, isolated per-unit context (a unit is one file or a few small ones), and an independent filter-only reflection that sees the diff and the comments but not the exploration.

## Known limitation

That design trades recall for precision. Lite inherits the trade and adds one of its own: with no tools it cannot follow a call into code the packet does not show. Its recall against the full reviewer is unmeasured.
A file the packet does not inline, that falls past the unit cap, or whose unit call failed is not reviewed; `skipped.json` names it so a gap is never silent.
Memory is the static layers only (the REVIEW.md notes in the packet, the team lenses `prepare-review.mjs` selects, and `lite.yaml`); governing-doc standards are not read; learned suppression and relevance records are not read.
