---
description: severity's deterministic path floor must lift a display-only defect under src/billing/ to high.
tags: [ablation, severity]
max_turns: 6
timeout_seconds: 180
allowed_tools: [Read, Glob, Grep, Skill]
---

A reviewer flagged this on our PR and I need to decide whether it blocks the merge.

> `src/billing/invoice-pdf.ts:42` formats the tax line of the generated invoice PDF with `toFixed(1)` instead of `toFixed(2)`, so a tax of 12.35 renders as 12.4.
> The stored amounts and the amount actually charged are correct; only the text on the PDF the customer downloads is off.

How severe is this finding?
Start your reply with one line `Severity: <critical|high|medium|low>`, then explain.
