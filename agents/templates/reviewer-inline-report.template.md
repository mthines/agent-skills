---
for: reviewer
step: 5.8
description: "Inline terminal report format for PR (self-review) sub-mode."
---

# Self-Review Report: PR #<number> (<repo>)

**Branch**: <head> → <base>
**Reviewed by**: @<me> (self-authored PR)
**Auto-fixed**: <N> issues (see Step 4.3 post-fix summary above)

---

## Critical (block before merge)

<!-- One line per finding: [file:line] issue: <description> -->
<!-- Example: [agents/reviewer.md:412] issue: Step 4 blanket --pr skip overrides self-review intent. (blocking) -->
<!-- If none: "None." -->

## High (should fix before merge)

<!-- One line per finding: [file:line] suggestion: <description> -->
<!-- If none: "None." -->

## Medium (address in a follow-up)

<!-- One line per finding: [file:line] suggestion: <description> -->
<!-- If none: "None." -->

## Low / Nitpick

<!-- One line per finding: [file:line] nitpick: <description> -->
<!-- If none: "None." -->

## Praise

<!-- One line per positive finding: [file:line] praise: <description> -->
<!-- If none: omit this section. -->

---

**Verdict**: <Approve | Approve with comments | Request changes> — <score>/10
<One-line rationale.>

---

**Orchestrator**: Review the Critical and High items above. Auto-fixed items are already
committed (see Step 4.3). Address Critical items before undrafting. Address High items
before merging. Medium and Low items may be deferred to follow-up PRs.
