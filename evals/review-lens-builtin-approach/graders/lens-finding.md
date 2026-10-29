---
type: regex
pattern: '## Findings file[\s\S]*packages/ui/avatar\.mjs[\s\S]{0,600}(apps/web|session|layer|boundar|app)'
flags: i
---

A finding on `packages/ui/avatar.mjs` says the shared UI package now imports from the `apps/web` app, breaking the layering every other caller follows: a rule the built-in `optimize-approach` lens states ("a package does not import from an app").
