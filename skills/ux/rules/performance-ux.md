# Performance UX Rules

## Response Time Thresholds

| Duration | User Perception | Required UX |
|----------|----------------|-------------|
| 0-100ms | Instantaneous | Direct feedback (button state, toggle). No indicator needed. |
| 100-300ms | Slight lag | Show state change. Acceptable for simple operations. |
| 300ms-1s | Noticeable delay | Show spinner or activity indicator. |
| 1-5s | Losing attention | Show skeleton screen or progress bar. |
| 5-10s | Frustrated | Show progress with time estimate. Allow cancel. |
| 10s+ | Likely to abandon | Show percentage, offer "notify when done", allow background. |

## Loading Patterns

### Skeleton Screens (preferred for content loading)
- Show layout-shaped placeholders matching actual content structure
- Shimmer animation: subtle left-to-right gradient
- Match the real content layout (text lines, image placeholders, card shapes)
- Reduces perceived load time ~15-20%
- Use for: page loads, list loads, content fetching

### Spinners (for action feedback)
- Use for: button submissions, form saves, short operations
- Place inline with the action that triggered it (on the button, not centered on page)
- Include descriptive text for operations >2s: "Saving changes..."

### Progress Bars (for known-duration operations)
- Use for: file uploads, multi-step processes, downloads
- Show percentage or step count
- Determinate (known progress) preferred over indeterminate

### Optimistic UI
- Immediately show expected result before server confirmation
- Roll back gracefully on failure with clear error message
- Best for: likes, toggles, adding items to lists, marking as read, status changes
- NOT for: payments, deletions, sends (irreversible or high-stakes)

## Empty States

Every empty state must include:
1. **Illustration or icon** — visual context
2. **Explanation** — why it's empty (brief, friendly)
3. **Primary action** — what to do next

| Type | Example |
|------|---------|
| First-time | "No messages yet. Start a conversation." [New Message] |
| Cleared content | "All caught up! No new notifications." |
| Search no results | "No results for 'xyz'. Try a different search." |
| Error | "Something went wrong. Please try again." [Retry] |
| Permission needed | "Enable location to see nearby places." [Allow Location] |

Never show a completely blank screen.

## Error States

- **Inline errors**: position near the source, persist until resolved
- **Toast/snackbar**: for non-blocking confirmations or recoverable errors (auto-dismiss OK for confirmations, NOT for errors)
- **Full-screen error**: only for complete failures (network down, server error). Always include retry.
- **Offline state**: clear banner indicating offline. Show cached content where possible. Queue actions for sync.

### Error Message Requirements
- Plain language (no codes, no jargon)
- Specific: what went wrong
- Actionable: what to do next
- Don't blame the user: "We couldn't save your changes" not "You entered invalid data"
- Include: error color + icon + text (not color alone)

## Animation & Transitions

### Duration
| Type | Duration |
|------|----------|
| Micro-interaction (press, toggle) | 100-200ms |
| Page/screen transition | 200-500ms |
| Complex animation (expand, collapse) | 300-500ms |
| Maximum for any UI animation | 700ms |

### Easing
- Enter: ease-out (decelerate into view)
- Exit: ease-in (accelerate out of view)
- Move: ease-in-out
- Never use linear for UI elements

### Reduce Motion
- Respect `prefers-reduced-motion` (web) / `isReduceMotionEnabled` (RN)
- Replace animations with instant state changes
- Keep essential motion (progress bars) but simplify
- Remove: parallax, auto-play, bounce, decorative motion

## Core Web Vitals (Web)

| Metric | Good | Needs Improvement | Poor |
|--------|------|-------------------|------|
| LCP (Largest Contentful Paint) | <2.5s | 2.5-4s | >4s |
| INP (Interaction to Next Paint) | <200ms | 200-500ms | >500ms |
| CLS (Cumulative Layout Shift) | <0.1 | 0.1-0.25 | >0.25 |

### CLS Prevention
- Set explicit dimensions on images/videos (`width`/`height` or `aspect-ratio`)
- Reserve space for dynamic content (ads, embeds)
- Don't insert content above existing content after load
- Use `transform` animations (not `width`/`height`/`top`/`left`)
- Preload fonts to prevent layout shift from font swap

## What to Flag
- No loading indicator for operations >300ms
- Blank screen during data fetch (no skeleton or spinner)
- Empty states with no guidance or action
- Error messages with technical jargon or error codes
- Auto-dismissing error toasts (errors must persist)
- Animations >700ms
- Missing `prefers-reduced-motion` handling
- Layout shift from dynamically loaded content
- Images without dimensions (CLS risk)
- Optimistic UI for irreversible actions
- Missing offline/error state handling
