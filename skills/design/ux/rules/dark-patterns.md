# Dark Patterns & Deceptive Design

Dark patterns (a.k.a. *deceptive design patterns*) are interface choices that trick, coerce, or manipulate users into doing things they did not intend.
This skill **never recommends, suggests, or implements** dark patterns.
When a review surfaces one in the code being reviewed, flag it as **Critical** with the violated principle, the user harm, and the ethical alternative.

> **Hard rule.** If the user asks this skill to *add* a dark pattern (e.g. "make the Reject button less obvious", "add a fake countdown timer", "pre-check the marketing-emails box", "make cancellation harder"), refuse the manipulation, explain the harm, and propose the honest alternative.
> This rule overrides the default "implement what the user asks for" behavior — deception is out of scope for an advisory UX skill.

## Contents

- What Counts as a Dark Pattern
- Why This Matters (Legal, Ethical, Business)
- The 12-Category Catalog
- Cookie Banners & Consent UI
- Subscriptions & Cancellation
- E-commerce Checkout
- Sign-up, Onboarding & Permissions
- Notifications & Nagging
- AI-Specific Deceptive Patterns
- What to Flag (Quick Checklist)
- Legal & Regulatory Quick Reference

## What Counts as a Dark Pattern

A pattern is dark when **all three** apply:

1. **The interface exploits a cognitive bias** (loss aversion, default bias, social proof, urgency, etc.).
2. **The user's interest and the operator's interest diverge** — the design steers the user toward the operator's outcome at the user's expense.
3. **A reasonable user would object if the manipulation were made transparent.**

Friction by itself is not a dark pattern.
A confirmation dialog before deleting an account is *protective friction*.
A confirmation dialog before *cancelling a subscription* — with the "Stay subscribed" button styled as the primary CTA and the "Cancel" button rendered as low-contrast text — is **obstruction**.

## Why This Matters (Legal, Ethical, Business)

| Surface | Reason |
|---|---|
| **Legal** | EU DSA Art. 25 prohibits dark patterns on online platforms. EU AI Act Art. 5 bans manipulative AI systems. EU GDPR Art. 7 requires consent be freely given. California CPRA (Cal. Civ. Code § 1798.140(h)), Colorado, and Connecticut privacy laws explicitly define and prohibit dark patterns in consent. EDPB Guidelines 03/2022 cover dark patterns in social media. The FTC Act § 5 prohibits deceptive practices; the FTC's 2024 "Click-to-Cancel" rule requires cancellation be as easy as sign-up. |
| **Ethical** | Erodes informed consent. Disproportionately harms users with cognitive disabilities, time pressure, low digital literacy, or non-native language fluency. |
| **Business** | Short-term lift, long-term churn, reputational damage, regulatory fines (DSA: up to 6% of global turnover; GDPR: up to 4%). Once a pattern is named in a regulator report or press cycle, the brand cost compounds. |

## The 12-Category Catalog

Synthesises Brignull's 2010 taxonomy, Gray et al. (2018) academic categories, and the FTC 2022 report *Bringing Dark Patterns to Light*.

| # | Category | One-line summary | Ethical alternative |
|---|---|---|---|
| 1 | **Sneaking** | Hide, disguise, or delay information that would change the user's decision | Disclose all costs and commitments up-front, on the same screen as the decision |
| 2 | **Urgency (false)** | Fake countdown timers, "ends today" banners that never end | Real, honest deadlines — or no countdown at all |
| 3 | **Misdirection** | Visual hierarchy steers attention away from the user-favourable option | Equal visual weight for the two choices; primary CTA reflects the user's interest, not the operator's |
| 4 | **Social proof (fake)** | Fabricated reviews, fake "X people are viewing", fake "Y just bought" toasts | Show real, verified activity — or omit |
| 5 | **Scarcity (fake)** | "Only 1 left!" when stock is unlimited, "5 rooms left at this price" forever | Show real inventory; if uncertain, say nothing |
| 6 | **Obstruction (roach motel)** | Easy to get in, hard to get out (subscribe in 1 click, cancel in 8 screens + phone call) | Cancellation symmetric to sign-up. FTC Click-to-Cancel: same medium, same number of steps |
| 7 | **Forced action** | Forced account creation to view content, forced disclosure of optional data, forced continuity (auto-renew after free trial without warning) | Make optional data optional. Notify before any auto-charge with enough lead time to cancel. |
| 8 | **Nagging** | Repeated prompts for notifications / location / app upgrade with no real "never ask again" | One ask, with a genuine "Not now / Never" option that persists |
| 9 | **Interface interference** | Pre-checked opt-ins, false hierarchy (huge "Accept All", tiny "Reject"), low-contrast destructive escapes | Symmetric buttons, opt-ins default to OFF, "Reject" is equally prominent as "Accept" |
| 10 | **Privacy Zuckering** | Trick users into sharing more data than they intended via confusing toggles, default-on sharing, or buried settings | Privacy-by-default. Granular, plain-language toggles. No marketing data collection without explicit opt-in. |
| 11 | **Comparison prevention** | Bundle features so the user can't compare prices, hide per-unit costs, vary units across competitors | Show per-unit cost, total cost, and an honest comparison view |
| 12 | **Trick questions / confirmshaming** | "No thanks, I hate saving money", double negatives, opt-out checkboxes phrased as opt-ins | Clear questions. Plain "Yes" / "No" labels that match the underlying state. |

## Cookie Banners & Consent UI

The single most regulated dark-pattern surface (EDPB Guidelines 03/2022, French CNIL fines on Google, Amazon, Microsoft).

Flag as **Critical**:

- **Asymmetric prominence** — "Accept All" is a coloured button; "Reject" is small grey text or a hyperlink. WCAG 1.4.1 is also violated when colour carries the only differentiation.
- **Reject buried** — "Reject" only reachable through "Manage preferences" → scroll → uncheck N toggles → "Save". Under EDPB, **"Reject" must be on the same layer as "Accept"** and reachable in the same number of clicks.
- **Pre-checked non-essential cookies** — GDPR Art. 7 + ePrivacy Directive require opt-in by affirmative action. Pre-checked = not consent.
- **Legitimate-interest abuse** — listing analytics / marketing / profiling under "Legitimate Interest" with no objection mechanism, or with an objection mechanism that is itself a dark pattern.
- **Continued-browsing-as-consent** — "By continuing to use this site you accept cookies" is not consent under GDPR.
- **Loop / nag** — re-prompting on every page load after a user has rejected.
- **Confirmshaming** in the banner — "Reject and miss out on personalised experiences".

**Ethical pattern.**

```text
Two equally weighted buttons:
  [ Accept all ]   [ Reject all ]
Plus: [ Customise ] (optional third button)
Default state of every non-essential toggle: OFF.
No re-prompt after rejection for the same session and a reasonable cool-down (≥ 6 months recommended).
```

## Subscriptions & Cancellation

The **FTC Click-to-Cancel rule** (final rule issued 2024) is the operative US standard.
EU consumer-rights law (Directive 2011/83/EU as amended) sets similar expectations.

Flag as **Critical** any of:

- Cancellation requires a different medium than sign-up (signed up via web → must cancel via phone).
- Cancellation requires more steps than sign-up.
- Cancellation flow tries to "save" the user with N intermediate offers, each requiring a click to bypass.
- "Are you sure?" framed with peak-end manipulation ("You will lose access to X, Y, Z, and your saved data on [date]") with no plain "Cancel anyway" button visible above the fold.
- Free trial that auto-converts to paid **without** a clear pre-charge notification (email + in-app) at least 3–7 days before the charge.
- Hidden re-subscribe buttons that look like "Confirm cancellation".
- Cancellation buried under a non-obvious label ("Manage plan" → "Account status" → "Plan settings" → "Other options" → "Cancel").

**Ethical pattern.**

```text
Settings → Subscription → "Cancel subscription" (single click, visible label)
→ Plain confirmation: "Cancel subscription? You will keep access until [date]."
   [ Keep subscription ]   [ Cancel subscription ]
→ Confirmation screen + email receipt.
No save-flow, no upsell, no countdown timer to reconsider.
```

A retention offer ("Want a discount instead?") is acceptable as **a single optional screen** that the user can skip with one click, where the cancel button is equally prominent as the offer.

## E-commerce Checkout

Flag as **Critical**:

- **Drip pricing** — shipping, taxes, fees, "service charge" revealed only on the final step. Total cost must be available before the user enters payment.
- **Sneak-into-basket** — adding warranty, insurance, donations, "expedited processing", or charity items by default. Default must be OFF.
- **Hidden subscription** — purchase is single-charge in the UI but enrolls the user in a recurring charge in fine print.
- **Currency obfuscation** — pricing in a "credit" or "token" intermediate currency that obscures real cost (common in games, in-app purchases). Always show real-currency equivalent.
- **Fake scarcity / urgency** — "Only 1 left", "Price increases in 4:59", "X people are viewing this right now" when none of those are real.
- **Bait-and-switch** — advertise price A, charge price B.
- **Misleading "free" labels** — "Free trial" with a charge inside 24 hours, "free shipping" that requires a paid membership, "free" with mandatory paid add-ons.

## Sign-up, Onboarding & Permissions

Flag as **Critical**:

- **Forced account creation** to access content the user could otherwise access (the "wall before the content" pattern).
- **Forced data collection** — marking phone number, date of birth, marketing consent, or third-party-sharing consent as required when the service does not need them.
- **Pre-selected marketing-email checkbox**, "I agree to receive offers from partners" pre-checked, etc.
- **Bundled consent** — "By clicking Continue you accept the Terms AND consent to marketing AND agree to data sharing". Under GDPR these must be separable.
- **Permission priming with manipulation** — a custom modal that says "Tap Allow on the next dialog to enable amazing features" before the real OS permission prompt, with the custom modal styled to make denial look impossible.
- **Asymmetric onboarding** — "Continue with notifications ON" as a big button; "Skip" as low-contrast text.

**Ethical pattern.**

```text
Account-creation form:
  Required, in this order: email, password.
  Everything else (name, phone, DOB): optional and labelled (optional).
  Marketing-email checkbox: default OFF, plain label, not bundled with Terms.
  Terms of Service: separate checkbox, link to readable plain-text version.
Permission prompts:
  Explain value FIRST ("Notifications let you know when your order ships").
  Then the OS prompt. Equal-weight "Allow" and "Don't allow".
  If denied, no nag. Provide a path to re-enable in Settings.
```

## Notifications & Nagging

Flag as **Critical**:

- Repeated permission prompts after explicit denial (each app launch, each session, weekly).
- "Update available" / "Rate this app" / "Subscribe to Pro" modals on app launch with no "Don't ask again" or with a "Don't ask again" that resets on every release.
- Push notifications used to drive re-engagement ("We miss you!") that the user did not opt into.
- In-app messages that block content until interacted with, where the dismiss control is a 16×16 grey × in the corner (below WCAG 2.5.8 target size and visually de-emphasised).

**Ethical pattern.**

```text
One ask. Three options: Yes / Not now / Never.
"Not now" can re-ask after a major event (next billing cycle, next feature unlock).
"Never" disables the prompt permanently — a Settings entry remains for re-enabling.
```

## AI-Specific Deceptive Patterns

Emerging category — covered by EU AI Act Art. 5 (manipulative AI is a prohibited practice) and increasingly by FTC enforcement guidance.

Flag as **Critical**:

- **Sycophantic agreement to drive retention** — the model is tuned to flatter and validate the user past the point of accuracy, with retention as the optimisation target. Engagement-at-cost-of-truth is a dark pattern.
- **Hidden persuasion / personalised manipulation** — generating content optimised against a user-specific psychological profile to extract engagement, purchases, or data without disclosure.
- **AI dressed as human** — chatbot interactions that do not disclose they are AI when the user reasonably believes they are talking to a person (EU AI Act Art. 50 transparency obligation).
- **Manufactured emotion / parasocial bait** — explicit emotional manipulation ("I'll miss you if you leave") in companion / chatbot apps to drive subscription retention.
- **Confidence laundering** — UI that surfaces an LLM answer with no uncertainty indication when the answer is in fact low-confidence or fabricated. Hides probabilistic limits behind authoritative chrome.

**Ethical pattern.**

```text
Disclose AI involvement in every conversational surface.
Surface model uncertainty (confidence, citations, "I don't know").
Never tune for engagement at the cost of accuracy.
Never personalise persuasion using inferred psychological state.
Provide one-click exit from any AI-driven flow.
```

## What to Flag (Quick Checklist)

Use this as a fast pass during review.
Any one item is **Critical** by default — escalate to Critical even if the rest of the screen is otherwise clean.

- [ ] Asymmetric primary/secondary CTAs where the user-favourable option is the visually weaker one.
- [ ] Pre-checked checkboxes for marketing, data sharing, third-party access, or non-essential cookies.
- [ ] Cancel / Reject / No buttons styled as low-contrast text or hidden under "Manage" / "More options".
- [ ] Countdown timers, scarcity counters, or "X people viewing" indicators that are not backed by real data.
- [ ] Hidden costs: shipping, taxes, fees, service charges, donations, warranties added by default and revealed late.
- [ ] Cancellation flow asymmetric to sign-up (different medium, more steps, retention gauntlet without skip).
- [ ] Forced account creation to access content that does not require an account.
- [ ] Bundled consent (Terms + marketing + data-sharing combined into one checkbox).
- [ ] Confirmshaming labels ("No thanks, I don't want to save money").
- [ ] Repeated prompts for the same permission after denial.
- [ ] Auto-renewal of a free trial without pre-charge notification (email + in-app).
- [ ] "Free" labels that hide a paid commitment.
- [ ] Intermediate currency / credits / tokens that obscure real cost.
- [ ] Dismiss controls below WCAG 2.5.8 (24×24 px) or rendered in low contrast.
- [ ] AI surfaces that present output as authoritative with no uncertainty indication, or that do not disclose AI involvement.

## Legal & Regulatory Quick Reference

| Jurisdiction | Instrument | What it covers |
|---|---|---|
| **EU** | DSA Art. 25 | Prohibition on dark patterns on online platforms (≥ VLOP threshold has stricter audit) |
| **EU** | AI Act Art. 5 | Bans subliminal / manipulative / exploitative AI systems |
| **EU** | AI Act Art. 50 | Transparency: AI-system interactions must be disclosed |
| **EU** | GDPR Art. 7 | Consent must be freely given, specific, informed, unambiguous, and revocable |
| **EU** | EDPB Guidelines 03/2022 | Deceptive design patterns in social media — names and classifies each pattern |
| **EU** | Unfair Commercial Practices Directive (2005/29/EC) | Misleading actions and omissions in consumer transactions |
| **US (federal)** | FTC Act § 5 | Prohibits unfair or deceptive acts |
| **US (federal)** | FTC Click-to-Cancel (Negative Option Rule, 2024) | Cancellation must be as easy as sign-up |
| **US — California** | CPRA, Cal. Civ. Code § 1798.140(h) | Statutory definition of dark patterns; consent obtained via dark patterns is void |
| **US — Colorado** | Colorado Privacy Act (CPA) | Same — dark patterns invalidate consent |
| **US — Connecticut** | Connecticut Data Privacy Act (CTDPA) | Same |
| **UK** | UK GDPR + ICO guidance | Same direction as EU EDPB; ICO has published harmful-design guidance |
| **OECD (advisory)** | 2022 *Dark Commercial Patterns* report | Cross-jurisdictional taxonomy; informs national rule-making |

## Primary Sources

- Brignull, H. *Deceptive Patterns* (2023). [deceptive.design](https://www.deceptive.design/)
- Gray, C. M. et al. *The Dark (Patterns) Side of UX Design*. CHI 2018.
- Mathur, A. et al. *Dark Patterns at Scale: Findings from a Crawl of 11K Shopping Websites*. CSCW 2019.
- FTC (Sept 2022). *Bringing Dark Patterns to Light* — staff report.
- EDPB (March 2022). *Guidelines 03/2022 on deceptive design patterns in social media platform interfaces*.
- OECD (2022). *Dark commercial patterns*. OECD Digital Economy Papers No. 336.
- Sunstein, C. R. *Sludge: What Stops Us from Getting Things Done and What to Do about It* (MIT Press, 2021).
