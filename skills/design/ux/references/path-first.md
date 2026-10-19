# Why the path comes first

A checklist-led audit (contrast, focus, ARIA, targets, tiered by WCAG severity) reliably produces accurate accessibility fixes but misses defects that block the user's task: a setup flow in the wrong order, a control whose handler does the opposite of its label, a filter that skips browser history, a silent row limit.
Those defects only surface when the reviewer names the user's task and traces each control's handler, state, and URL effect.
The base model already knows WCAG 2.2 success criteria unaided, so the rule files carry corrections and precise patterns rather than textbook tables.

A WCAG-tier report skeleton also pushes path defects down or out, because they have no WCAG criterion to slot under; ordering by impact on the task keeps them at the top.

Behavioural claims made from labels and component names are the main source of false findings; reading the handler, or labelling the claim unverified, removes them.
