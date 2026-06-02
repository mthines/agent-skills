---
for: reviewer
lens-version: 1
applies-to: <glob list (e.g. **/*.tsx, app/**/*.ts) OR the literal "always">
---

# <Skill Name> — Review Lens

## Trigger

<1–3 lines: when this lens should fire. Echo `applies-to` for humans and
add diff-shape context the glob can't express. Example: "Fires when the
diff touches Anthropic SDK calls or any file named `*-prompt.ts`.">

## Checklist

<!-- Each item: single sentence, falsifiable from a diff hunk, ends with a verb. -->
<!-- Aim for 5–15 items. Hard cap on the whole file is 80 lines. -->

- [ ] <criterion 1>
- [ ] <criterion 2>
- [ ] <criterion 3>
- [ ] <criterion 4>
- [ ] <criterion 5>

## Severity hints

- **Must-fix**: <which checklist items are blocking — quote the item text>
- **Should-fix**: <which are non-blocking suggestions>
- **Nice-to-have**: <which are praise-or-skip>
