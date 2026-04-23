# Touch Targets & Interaction Rules

## Touch Target Sizes

| Standard | Minimum | Recommended | Min Spacing |
|----------|---------|-------------|-------------|
| Apple HIG (iOS) | 44x44 pt | 44x44 pt | 8pt |
| Material Design 3 (Android) | 48x48 dp | 48x48 dp | 8dp |
| WCAG 2.2 AA | 24x24 CSS px | 44x44 CSS px | — |
| WCAG 2.2 AAA | 44x44 CSS px | — | — |

**Key**: Interactive area can exceed visual element (padding counts). A 24px icon inside a 44px touchable area is fine.

### What to Flag
- Buttons, links, or touchables with dimensions below platform minimum
- Touch targets closer than 8dp/pt apart (risk of mis-taps)
- Small close/dismiss buttons (common violation — the X button)
- Inline action buttons in dense lists
- Icon-only buttons without sufficient padding

### React Native Specifics
- Use `hitSlop` to extend touch area beyond visual bounds: `hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}`
- Prefer `Pressable` over `TouchableOpacity` (more flexible, supports hover on web)
- Check `minHeight` and `minWidth` on all interactive `Pressable`/`TouchableOpacity` components
- `TouchableWithoutFeedback` — flag: every touch MUST have visual feedback

## Interaction Feedback

Every user action requires visible feedback:

| Action | Expected Feedback | Timing |
|--------|-------------------|--------|
| Button press | Visual state change (opacity, color, scale) | <100ms |
| Toggle/switch | State change + optional haptic | <100ms |
| Form submission | Loading state on button + disable | Immediate |
| Pull to refresh | Refresh indicator | Immediate |
| Long press | Visual indication (scale, highlight) | 200-500ms hold |
| Swipe action | Revealed action with elastic feel | Follows finger |
| Destructive action | Confirmation dialog or undo toast | Before execution |

### Haptic Feedback (Mobile)
- Use `expo-haptics` or `react-native-haptic-feedback`
- Light: selection, toggle, minor interactions
- Medium: confirmations, successful actions
- Heavy/Error: destructive actions, errors, warnings
- Never: decorative, continuous, or high-frequency actions
- Always respect system haptic settings

### States Every Interactive Element Needs

| State | Visual Treatment |
|-------|-----------------|
| Default | Base appearance |
| Hover (web) | Subtle change: background tint, underline, cursor pointer |
| Pressed/Active | Visible depression: opacity reduction, scale down, color shift |
| Focused | Focus ring: 2px+ outline, 3:1 contrast |
| Disabled | Reduced opacity (0.4-0.5), no pointer events, `aria-disabled` |
| Loading | Spinner or skeleton replacing content, disabled interaction |
| Error | Error color border/outline, error message, icon |
| Success | Success color/icon, confirmation text |

### Common Violations
- `TouchableWithoutFeedback` used for primary actions (no visual feedback)
- Disabled buttons with no explanation of why disabled
- Loading states that don't disable the trigger (double-submit risk)
- Missing hover states on web (elements feel non-interactive)
- Swipe actions with no discoverability hint
- Long-press actions with no visual indication during hold
- Custom buttons missing pressed/active state styling
