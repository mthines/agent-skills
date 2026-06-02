---
for: reviewer
lens-version: 1
applies-to: "**/*.tsx, **/*.jsx, **/*.vue, **/*.svelte, app/**/*.ts, app/**/*.tsx, **/screens/**, **/components/**"
---

# UX & Accessibility — Review Lens

## Trigger

Fires when the diff touches UI files (web JSX/TSX/Vue/Svelte, React Native screens, App Router screens). NOTE: the `reviewer` agent already auto-loads `ux` when UI files are present — `--with ux` is normally a no-op (deduped). This lens exists as the canonical interface and lets external review tooling consume the same checklist.

## Checklist

- [ ] Interactive elements meet touch-target minimums: iOS 44×44 pt, Android 48×48 dp, WCAG AA 24×24 px, with ≥ 8 dp/pt spacing between adjacent targets.
- [ ] Text contrast ratios meet WCAG AA: 4.5:1 for normal text, 3:1 for large text (≥ 18 pt) or UI components.
- [ ] Body text size meets platform minimum: ≥ 16 px on web, ≥ 17 pt on iOS, ≥ 14 sp on Android.
- [ ] Async actions have explicit loading states: spinner for 300 ms–1 s, skeleton/progress for 1 s–5 s, percentage + cancel beyond 5 s.
- [ ] Form inputs have associated `<label>` (web) or `accessibilityLabel` (RN); placeholders are NOT used as labels.
- [ ] Interactive non-native elements have an explicit role and accessible name (`role="button"` + `aria-label`, or RN `accessibilityRole` + `accessibilityLabel`).
- [ ] Focus is visible on keyboard interaction; tab order matches visual order; focus is not trapped except in modals.
- [ ] Color is never the sole carrier of meaning (WCAG 1.4.1) — pair with icon, label, or position.
- [ ] Navigation respects limits: bottom tabs 3–5 items, primary web nav 5–8 items, Hick's-Law decisions ≤ 5–7 options.
- [ ] Error messages explain WHAT failed AND what the user can do next — no bare "Something went wrong" or raw exception text.
- [ ] Empty states have illustration / icon + one-line context + primary CTA (not a blank screen).
- [ ] Motion / transitions are gated on `@media (prefers-reduced-motion: reduce)` (web) or `AccessibilityInfo.isReduceMotionEnabled()` (RN).
- [ ] No dark patterns: Accept/Reject buttons in consent UI have equal visual weight; non-essential opt-ins default to OFF; cancellation is symmetric to sign-up (FTC Click-to-Cancel); no fake urgency / scarcity / social-proof; no confirmshaming; total cost (incl. shipping, taxes, fees) shown before payment step; AI surfaces disclose AI involvement and surface uncertainty.

## Severity hints

- **Must-fix**: touch target below platform minimum; contrast below WCAG AA; missing form label; missing accessible name on interactive non-native element; color as sole carrier of meaning; **any dark pattern** (asymmetric consent, pre-checked non-essential opt-in, roach-motel cancellation, fake urgency/scarcity, drip pricing, confirmshaming, forced continuity without pre-charge notice, undisclosed AI).
- **Should-fix**: missing loading state on async action; missing error state; focus invisible on keyboard; nav exceeding item limits; no `prefers-reduced-motion` branch on a non-trivial animation.
- **Nice-to-have**: microcopy improvements; body text exactly at minimum (could go larger); empty state without illustration.
