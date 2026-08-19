# Posted-body fixtures

Real `pr-reviewer` bodies as published, kept so the out-of-band validator
(`scripts/validate-report-shape.mjs`) is tested against production output rather than only against
output we generated ourselves.

| File | Origin | Expected verdict |
| --- | --- | --- |
| `lorekit-503-flat.md` | `mthines/lorekit#503` review `4964475125` (2026-08-18 18:31 UTC) | violations — no marker, no accordion, gate table and diagnostics at top level |
| `lorekit-503-report-as-pointer.md` | shape of reviews `4964076700` / `4964171425` / `4964277130` | violations — a full report body stamped `<!-- PR_REVIEWER_POINTER -->` |

Both are abridged to the structure under test; the prose is not load-bearing. They exist because a
validator written only against self-generated fixtures tends to encode the shape we *expect* to see
rather than the shape that actually shipped — the flat body omitted `**Run mode**`, which broke the
first classifier I wrote.
