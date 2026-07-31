### Optimality proposal — <file>:<line>

> **<imperative one-line TL;DR of the switch — what to change, in ≤ 12 words>**

| | Approach |
| --- | --- |
| **Now** | <how the diff does it today — one sentence> |
| **Better** | <the concretely better way — one to two sentences> |

**Why it's better** · _<codebase-fit \| simplicity \| performance \| robustness>_ — <one sentence naming the concrete, checkable win>
**Trade-off** · <the cost the switch introduces — what gets worse, harder, or riskier — or `none material`>
**Evidence** · `<util / pattern / caller>` — <grep-resolvable location, or a stated measurable fact>

<sub>Intent: <what this unit is trying to achieve> · Blast radius: `<files>` · Confidence: <NN>%<apply-status></sub>

<!--
Rendering contract — keep the card scannable and decision-ready:
- The blockquote headline is the TL;DR: an imperative "do X instead of Y", not a question.
  (pr-reviewer still frames the *Better* row as a question — cross-review asymmetry — but the
  headline stays a crisp statement so the reader can scan it in one line.)
- The Now/Better table IS the decision surface — the reader compares the two rows and judges
  whether Better is objectively better. Keep each row to one idea.
- Trade-off is mandatory. A proposal with no honest cost reads as a sales pitch; if the switch
  truly costs nothing, write `none material` — do not omit the line.
- <apply-status> footer suffix (reviewer own-work only; omit for pr-reviewer cross-review):
  ` · applied` | ` · withheld: low-confidence` | ` · withheld: not-apply-safe`
  | ` · withheld: forbidden-target` | ` · reverted: `<check>``
-->
