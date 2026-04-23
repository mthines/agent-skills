# UX Writing & Microcopy Rules

UX writing is interface design with words. Every user-facing string is a design decision.

## Core Principles

### 1. Clarity Over Cleverness
- Say exactly what you mean. No ambiguity.
- "Delete this project?" not "Are you sure?"
- "Save changes" not "Submit"
- Test: could a non-native speaker understand this immediately?

### 2. Concise
- Omit unnecessary words. Frontload the important part.
- "3 items in cart" not "You currently have 3 items in your shopping cart"
- Button labels: 1-3 words. Descriptions: 1-2 sentences max.
- If it takes more than 5 seconds to read, it's too long for inline UI copy.

### 3. Useful
- Every word should help the user take action or understand their situation.
- Include: what happened, what to do next
- Exclude: technical details, internal terminology, blame

### 4. Consistent Voice
- Same terminology throughout the app for the same concept
- Same tone across similar contexts (all errors feel similar, all successes feel similar)
- "Sign in" everywhere, not "Sign in" here and "Log in" there

## Specific Copy Types

### Buttons & CTAs
| Do | Don't |
|----|-------|
| "Create account" | "Submit" |
| "Save changes" | "OK" |
| "Delete project" | "Yes" |
| "Send message" | "Confirm" |
| "Try free for 14 days" | "Start trial" |

- Use action verbs that describe what happens
- Be specific: "Add to cart" not "Add"
- Primary action should be the most specific label
- Destructive actions: name what's being destroyed ("Delete 3 photos")

### Error Messages

**Structure**: What happened + Why (optional, if helpful) + What to do

| Do | Don't |
|----|-------|
| "Couldn't save. Check your connection and try again." | "Error 500: Internal server error" |
| "That email is already registered. Sign in or use a different email." | "Duplicate entry" |
| "Password must be at least 8 characters" | "Invalid password" |
| "We couldn't find that page. Go back to home." | "404 Not Found" |
| "File too large. Maximum size is 10 MB." | "Upload failed" |

- Don't blame the user: "We couldn't process..." not "You entered..."
- Be specific about the problem AND the fix
- No technical jargon, error codes, or stack traces in user-facing copy
- Use sentence case, not ALL CAPS

### Empty States
- Explain why it's empty + what to do
- "No messages yet. Start a conversation with your team." [New Message]
- "No results for 'xyz'. Try different keywords or check spelling."
- Friendly but not overly cute. Helpful, not just decorative.

### Confirmations & Success
- Confirm what happened: "Project created" / "Changes saved" / "Message sent"
- If there's a next step, mention it: "Account created. Check your email to verify."
- Keep it brief — success states should feel fast

### Onboarding & Tooltips
- One concept per step
- Focus on value, not features: "Find anything in seconds" not "We have a search feature"
- Action-oriented: tell users what they CAN DO, not what the app IS
- Skip option always available
- Max 3-5 onboarding steps

### Form Labels & Help Text
- Labels: noun or short phrase ("Email address", "Password")
- Help text below field: format hints, requirements ("Must be at least 8 characters")
- Don't put instructions in placeholders (they disappear)
- Use the same terminology the user would use ("Phone number" not "Mobile telephone")

### Navigation Labels
- Short (1-2 words): "Home", "Search", "Profile", "Settings"
- Noun-based for sections, verb-based for actions
- Predictable: user should know what they'll find before tapping
- Match the page title to the nav label

### Permissions & Data Requests
- Explain WHY before asking: "Enable notifications to get updates when your order ships"
- Use the value to the user, not the feature name
- Pre-permission screen before system dialog (explain, then trigger)
- Graceful degradation copy for denied permissions: "You can enable notifications later in Settings"

### Loading & Wait States
- "Loading your dashboard..." (specific) not "Loading..." (vague)
- For long waits: "This usually takes about 30 seconds"
- Progress copy: "Uploading photo 2 of 5..."
- Don't over-communicate: a brief spinner is fine for <2s operations

## Tone Guidelines

### Context-Appropriate Tone
| Context | Tone | Example |
|---------|------|---------|
| Success | Warm, confident | "You're all set! Your account is ready." |
| Error | Calm, helpful | "Something went wrong. Let's try that again." |
| Destructive | Clear, serious | "This will permanently delete 12 files. This can't be undone." |
| Onboarding | Encouraging, clear | "Welcome! Let's get you set up in 2 minutes." |
| Empty state | Friendly, guiding | "No projects yet. Create your first one to get started." |
| Waiting | Reassuring | "Hang tight — we're processing your payment." |

### Inclusive Language
- Use "they/them" as default singular pronoun
- Avoid gendered terms: "sales team" not "salesmen"
- No culture-specific metaphors or idioms
- "Sign in" not "Log in" (log is jargon)
- Name fields: single "Full name" field or "Given name" / "Family name" (not "First/Last")
- No ableist language: "check" not "see", "review" not "look at"

### Numbers & Formatting
- Spell out 1-9, numerals for 10+
- Use relative time for recent: "2 minutes ago", "Yesterday"
- Use absolute time for older: "March 15" or "Mar 15, 2024"
- Currency: always show symbol and decimals ($12.00 not 12)
- Truncate long numbers: "1.2K" not "1,234" in compact UI

## What to Flag

- Generic button labels: "Submit", "OK", "Yes/No", "Click here"
- Error messages with error codes, jargon, or blame
- Empty states with no guidance
- Placeholder text used as the only label
- Inconsistent terminology (sign in / log in / authenticate)
- ALL CAPS text (except very short labels in specific design systems)
- Walls of text in UI (>3 sentences inline)
- Missing confirmation after important actions
- Technical language in user-facing strings
- Permissions asked without explanation
- Destructive action confirmations that say "Are you sure?" without naming the action
- Loading text that doesn't indicate what's loading
- Tooltip or help text that restates the label without adding value
- Copy that assumes cultural context, gender, or technical knowledge
