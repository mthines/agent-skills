---
for: pr-reviewer
lens-version: 1
applies-to: "**/*.tsx, **/*.jsx, **/*.vue, **/*.svelte"
auto: true
---

# UX & Accessibility — Review Lens

## Trigger

Auto-loads when the diff touches a file matching `applies-to` (`auto: true`); `--with ux` is deduped by name.

## Checklist

- [ ] Each changed control does what its label promises — read the handler, including its keyboard branch.
- [ ] Changed filters, tabs, and pagination keep URL and Back-button behaviour consistent with their siblings (`push` vs `replace`).
- [ ] The changed flow can be completed with what the page provides; no step needs a value the user cannot reach.
- [ ] Empty, loading, stale-while-refetching, error, and truncated states are handled and visible.
- [ ] Contrast computed from resolved tokens meets AA (4.5:1 text, 3:1 large text, UI parts, and focus rings) in every theme.
- [ ] Focus moves correctly on dialog open / close, route change, and delete; no `outline: none` without a replacement.
- [ ] Live regions announce outcomes once and do not wrap streaming or looping content.
- [ ] Interactive non-native elements have a role, an accessible name, and Enter / Space handling; hover-only tooltips are also reachable by focus.
- [ ] Touch targets meet 24×24 px (WCAG AA), 44 pt (iOS), and 48 dp (Android).
- [ ] Motion stops under `prefers-reduced-motion` / `isReduceMotionEnabled()`.
- [ ] Errors say what failed and what to do; labels name outcomes, not "Submit".
- [ ] No dark patterns: equal-weight Accept / Reject, opt-ins default OFF, cancellation symmetric to sign-up, no fake urgency or scarcity, no confirmshaming, total cost before payment, AI disclosed.

## Severity hints

- **Critical**: a step of the changed flow cannot be completed; a control does the opposite of its label; keyboard or screen-reader lockout; any dark pattern.
- **High**: wrong or stale result shown as current; AA failure on the primary path; missing error state.
- **Medium**: AA failure off the main path; missing reduced-motion branch; inconsistent history behaviour.
- **Low**: copy polish.
- Behaviour not provable from the diff is labelled **unverified**, never asserted.
