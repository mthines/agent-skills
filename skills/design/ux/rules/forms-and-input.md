# Forms & Input Rules

## Form Layout

- **Single-column layout**: significantly faster completion than multi-column (CXL research)
- **Top-aligned labels**: fastest to scan and complete. Always visible (never placeholder-only).
- **Group related fields**: use visual grouping (spacing, headers, fieldsets)
- **Progressive disclosure**: show fields only when relevant (conditional logic)
- **Logical order**: match mental model (name before address, card number before expiry)

## Labels & Placeholders

| Rule | Details |
|------|---------|
| Labels always visible | Never use placeholder as sole label — it disappears on input |
| Placeholder for format hints | "e.g., john@example.com" or "MM/DD/YYYY" |
| Required vs optional | Mark the minority — if most fields required, mark optional ones "(optional)" |
| Associated labels | `<label htmlFor>` on web, `accessibilityLabel` on RN |
| Help text below field | For additional context, not in placeholder |

## Input Types & Keyboards

### Web
- `type="email"` for email fields
- `type="tel"` for phone numbers
- `type="number"` with `inputMode="numeric"` for numeric input
- `type="password"` with show/hide toggle
- `type="search"` for search fields
- `autocomplete` attributes for autofill (critical for UX + accessibility)

### React Native
- `keyboardType`: `email-address`, `phone-pad`, `numeric`, `decimal-pad`, `url`
- `textContentType` (iOS): `emailAddress`, `password`, `newPassword`, `oneTimeCode`, `name`, etc.
- `autoComplete` (Android): `email`, `password`, `tel`, `postal-code`, etc.
- `secureTextEntry` for passwords
- `returnKeyType`: `done`, `next`, `search`, `send`, `go`
- `autoFocus` on first field of focused forms
- `blurOnSubmit={false}` + `onSubmitEditing` to move to next field

## Validation

### When to Validate
- **On blur**: validate when user leaves a field (not on every keystroke)
- **On submit**: validate all fields, scroll to first error
- **Exception**: real-time validation OK for: password strength, username availability, character count

### Error Display
- Inline below the field (not in a toast or alert)
- Red/error color border on the field + error message + icon
- Don't use color alone — include text and/or icon
- Persist until fixed (never auto-dismiss)
- Plain language: "Please enter a valid email address" not "Invalid input for field email_addr"
- For long forms: error summary at top with links to specific fields

### Success States
- Show validation success (green checkmark) for fields that were previously in error
- Helps users feel progress and confidence

## Field Sizing
- Size should indicate expected length: ZIP code field shorter than address
- Full-width fields are fine for most inputs on mobile
- Multi-line inputs: use `TextInput multiline` (RN) or `<textarea>` (web) with visible resize handle

## Submit Behavior
- Label with action verb: "Create account" / "Send message" — never just "Submit"
- Show loading state on button during submission
- Disable button during submission (prevent double-submit)
- Never disable submit on initial load (users don't know why it's disabled)
- On success: clear/redirect + confirmation
- On failure: show errors, preserve all user input, focus first error field

## Common Violations to Flag
- Placeholder text as the only label
- Missing `autocomplete` / `textContentType` attributes (kills autofill)
- Wrong keyboard type for the input (numeric field showing full keyboard)
- No inline validation — errors only on submit with vague messages
- Submit button disabled without explanation
- Form data lost on navigation or error
- No way to show/hide password
- Date input as free text instead of date picker
- Multi-column form layout on mobile
- Missing `returnKeyType` / `onSubmitEditing` flow in React Native (can't tab through fields)
- Required field indicators missing entirely
