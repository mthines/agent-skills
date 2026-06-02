# Core UX Principles

Always-loaded reference. Apply these principles to every review.

## Nielsen's 10 Usability Heuristics

| # | Heuristic | What to Check |
|---|-----------|---------------|
| 1 | **Visibility of System Status** | Loading indicators, progress bars, state changes, feedback on actions, sync status |
| 2 | **Match Between System and Real World** | Jargon-free labels, familiar metaphors, natural information order, culturally appropriate icons |
| 3 | **User Control and Freedom** | Undo/redo support, cancel buttons, back navigation, dismissible modals, reversible actions |
| 4 | **Consistency and Standards** | Same component = same behavior, platform conventions followed, consistent terminology |
| 5 | **Error Prevention** | Confirmation for destructive actions, constraints on input, good defaults, disabled invalid options |
| 6 | **Recognition Over Recall** | Visible options, contextual help, recent items, search suggestions, breadcrumbs |
| 7 | **Flexibility and Efficiency** | Keyboard shortcuts, gestures, customization, bulk actions, saved preferences |
| 8 | **Aesthetic and Minimalist Design** | No unnecessary elements, clear visual hierarchy, whitespace, focused content |
| 9 | **Error Recovery** | Plain-language errors, specific problem identification, actionable fix suggestion, persistent until resolved |
| 10 | **Help and Documentation** | Searchable help, contextual tooltips, onboarding, task-focused guidance |

## Cognitive Laws

### Fitts's Law
- **Rule**: Time to reach a target depends on distance and size
- **Check**: Primary actions are large and close to current focus. Destructive actions are separated from primary actions. Edge/corner placement used for frequent actions.

### Hick's Law
- **Rule**: Decision time increases with number of choices (logarithmically)
- **Check**: Max 5-7 navigation items. Max 3-5 CTAs visible. Recommended/default option highlighted. Advanced options behind progressive disclosure. Dropdowns with >15 items use search/filter.

### Miller's Law
- **Rule**: Working memory holds 4±1 unfamiliar chunks, 7±2 familiar
- **Check**: Information chunked (phone numbers, card numbers). Content grouped in 3-5 related items. Not too many form fields visible at once (5-7 optimal).

### Jakob's Law
- **Rule**: Users expect your app to work like others they use
- **Check**: Standard patterns used (login, cart, settings). Platform conventions followed. Standard icon meanings respected. Navigation in expected locations.

### Aesthetic-Usability Effect
- **Rule**: Beautiful interfaces are perceived as more usable
- **Check**: Consistent spacing and alignment. Cohesive color palette. Polished typography. Visual rhythm.

### Peak-End Rule
- **Rule**: Experience judged by peak moment and ending
- **Check**: Success/completion states are rewarding. Worst pain points addressed. Flows end on positive note (confirmation, next steps).

### Serial Position Effect
- **Rule**: First and last items in a series are most memorable
- **Check**: Most important nav items placed first and last. Key info at start/end of lists. Primary CTA at top or bottom of forms.

### Von Restorff Effect
- **Rule**: Visually distinct items are more memorable
- **Check**: Primary CTA stands out (color, size, elevation). Only the most important element is isolated. Not everything competes for attention.

### Zeigarnik Effect
- **Rule**: Incomplete tasks are remembered better than completed ones
- **Check**: Progress indicators for multi-step flows. "Resume where you left off" for interrupted tasks. Visible checklists for remaining steps.

### Doherty Threshold
- **Rule**: Productivity increases when response time <400ms
- **Check**: Direct manipulation feedback <100ms. System responses <400ms. Loading indicator shown for >400ms operations. Optimistic UI for common actions.

## Gestalt Principles (Applied to UI)

| Principle | Check For |
|-----------|-----------|
| **Proximity** | Related items grouped close (20-30px), unrelated separated (>50px) |
| **Similarity** | Same visual treatment for same-category elements. Interactive elements look interactive. |
| **Continuity** | Aligned labels and fields. Consistent visual flow direction. |
| **Closure** | Simplified icons still readable. Progress indicators leverage closure. |
| **Figure-Ground** | Foreground/background clearly distinguishable. Sufficient contrast. Proper elevation/layering. |
| **Common Region** | Related items enclosed in cards/borders/backgrounds. Clear section boundaries. |
| **Focal Point** | One clear primary action per screen/section. Size, color, contrast create hierarchy. |
