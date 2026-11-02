# Team lenses

A lens is a checklist a team keeps in `.agents/review/lenses/<name>.md`; the full reviewer and lite load the same ones.
Lite does not select lenses itself: `prepare-review.mjs` does, and lite reads `context.json` → `lenses.loaded`.

## What reaches the model

1. Selection is the full reviewer's: repo lenses, `.review.yaml` `lenses:`, `--with a,b`, and built-in auto lenses, filtered by each lens's `applies-to`, `diff-matches`, and `min-tier`.
2. Repo files are read at the PR's base commit, so a PR cannot add or weaken the lens that reviews it.
3. Every loaded lens becomes a `### Lens: <name>` section of the shared prefix, with its `Applies to:` file list (at most 20 named), so the prefix stays identical across units and cached.
4. A finding that comes from a lens carries `lens: "<name>"`; a name that was not loaded is dropped from the finding, which stays.
5. `report.md` and `findings.json` name the lenses loaded, and `findings.json` the ones skipped with their reason.

```text
✗ Wrong — read .agents/review/lenses/*.md from the head checkout
✓ Right — use context.json lenses.loaded, which came from the base commit
```
