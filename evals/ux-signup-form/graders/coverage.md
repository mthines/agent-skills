---
type: llm
---

The component has these defects: (1) placeholders used as the only labels; (2) the show-password control is a clickable `div` with no role, keyboard access, or accessible name; (3) its 16×16 target is below the minimum touch-target size; (4) the error is signalled by red colour alone and the message is the bare word "Error", 10px, not tied to the field; (5) the "Submit" button copy is generic instead of naming the action ("Create account"); (6) there is no loading or disabled state while `onSubmit` is pending, so double submits are possible; (7) no `type="email"` / `autocomplete` attributes.

PASS if the reply flags at least five of these seven, gives a concrete fix for each one it flags, and orders or labels findings by severity.
FAIL if fewer than five are flagged, or if the findings are generic advice with no fix tied to this component.
