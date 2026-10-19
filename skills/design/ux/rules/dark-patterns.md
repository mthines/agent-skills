# Dark patterns

This skill never recommends, suggests, or implements a dark pattern.
Flag any dark pattern found in reviewed code as **Critical**, with the harm and the honest alternative.

> **Hard rule.** When the user asks to add one ("make Reject less obvious", "add a countdown", "pre-check the marketing box", "make cancelling harder"), refuse the manipulation, name the harm, and propose the honest alternative.
> This overrides the default "implement what is asked" behaviour.

## Test

A pattern is dark when all three hold:

1. It exploits a bias (default, loss aversion, urgency, social proof).
2. It steers the user toward the operator's interest at the user's expense.
3. A reasonable user would object if it were made transparent.

Protective friction is not a dark pattern: confirming an account deletion is fine; a cancel flow whose "Stay" button is primary and "Cancel" is low-contrast text is obstruction.

## Catalog

| Category | Looks like | Honest alternative |
| --- | --- | --- |
| Sneaking / drip pricing | Fees, taxes, add-ons revealed at the last step; items added to the basket by default | Total cost before payment entry; add-ons default OFF |
| False urgency / scarcity | Timers that reset, "only 1 left" not backed by data | Real deadlines and real stock, or nothing |
| Fake social proof | Invented "X viewing now", fabricated reviews | Verified activity, or omit |
| Misdirection / interface interference | Big "Accept all", grey-link "Reject"; pre-checked opt-ins | Equal visual weight; non-essential opt-ins default OFF |
| Obstruction (roach motel) | One-click sign-up, multi-screen or phone-only cancel | Cancel in the same medium and no more steps than sign-up |
| Forced action / continuity | Account wall before content; optional data marked required; trial converts with no notice | Optional fields marked optional; notify before any charge |
| Nagging | Re-asking after denial; "Don't ask again" that resets | One ask with Yes / Not now / Never; Never persists |
| Bundled consent / privacy defaults | Terms + marketing + sharing in one checkbox; sharing on by default | Separate, granular, default-off toggles |
| Trick questions / confirmshaming | "No thanks, I hate saving money"; double negatives | Plain Yes / No that matches the stored state |
| Obscured cost | Credits or tokens without a real-currency price | Show the real-currency equivalent |

## Surface checks

| Surface | Flag |
| --- | --- |
| Cookie / consent banner | Reject not on the first layer or not as prominent as Accept; non-essential toggles pre-checked; "continuing means consent"; re-prompting after rejection |
| Subscription / cancellation | Cancel needs another medium or more steps than sign-up; more than one skippable retention screen; trial auto-converts without notice in advance |
| Checkout | Late fees; default-on warranty, insurance, or donation; hidden recurring charge; "free" that requires payment |
| Sign-up / permissions | Required fields the service does not need; bundled consent; a pre-prompt that makes "Don't allow" look impossible |
| Notifications / modals | Re-prompt after denial; dismiss control below 24×24 px or low contrast |
| AI surfaces | No disclosure that the user is talking to AI; no uncertainty or sources on generated answers; retention-driven flattery or emotional bait |

## Honest consent pattern

```text
[ Accept all ]   [ Reject all ]   [ Customise ]
Equal size and weight. Every non-essential toggle OFF by default.
No re-prompt after rejection.
```

## Legal anchors (cite when relevant)

EU: DSA Art. 25, GDPR Art. 7, EDPB Guidelines 03/2022, AI Act Art. 5 and Art. 50.
US: FTC Act § 5, FTC negative-option ("click-to-cancel") rule, CPRA § 1798.140(h) and the Colorado and Connecticut privacy acts (consent via dark pattern is void).
