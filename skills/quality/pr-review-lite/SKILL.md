---
name: pr-review-lite
description: >
  Reviews a PR in shadow at low cost: a script makes direct, cached model calls over the pr-reviewer's
  review packet (no harness session, no tools) and compares its findings with the full reviewer's.
  Writes artifacts only, never to GitHub. Invoke with /pr-review-lite.
disable-model-invocation: false
argument-hint: '<pr-url|#n> --out <dir> [--repo-dir <dir>] [--model <id>] [--reflect-model <id>] [--prices <json>] | compare --lite <dir>/findings.json --pr <ref>'
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: command
---

# /pr-review-lite — shadow reviewer built for cost

Run [`scripts/lite-review.mjs`](./scripts/lite-review.mjs) on a PR, then compare it with the full `pr-reviewer` using [`scripts/lite-compare.mjs`](./scripts/lite-compare.mjs).
It never posts: it writes `findings.json`, `report.md`, `skipped.json`, and `usage.json` to `--out`.
Why it is shaped this way, and what it gives up: [`references/design-rationale.md`](./references/design-rationale.md).

## Steps

1. Run it; add `--transport claude-cli` to use a Claude Code login with no API key (usage and dollars then come from the CLI's own output), and `--with a,b` to load named lenses as `/pr-review` does (it makes real model calls, so run it only on a PR the user named; `--transport api` needs `ANTHROPIC_API_KEY`):

   ```bash
   node ${CLAUDE_SKILL_DIR}/scripts/lite-review.mjs --pr <url|#n> --out <dir> --repo-dir <checkout>
   ```

   It runs `prepare-review.mjs` from the agent's support tree, so the packet is the one the full reviewer reads ([`rules/dispatch.md`](./rules/dispatch.md)).
   Models: the review stage defaults to `claude-haiku-5-5` and reflection to `claude-sonnet-5-5`.
   Override per repo in `.agents/review/config.yaml`, or per run with `--model` and `--reflect-model` (a flag beats the config, the config beats the default):

   ```yaml
   lite:
     review_model: claude-haiku-5-5
     reflect_model: claude-sonnet-5-5
     exclude:
       - "**/generated/**"
   ```

   A model id that does not start with `claude-` exits 2.
2. Read `<dir>/skipped.json`. Every file lite did not review is listed with its reason; report that list, never "reviewed everything".
3. Compare after the full reviewer has posted on the same head:

   ```bash
   node ${CLAUDE_SKILL_DIR}/scripts/lite-compare.mjs --lite <dir>/findings.json --pr <owner/repo#n|url> --full-author <login the full reviewer posts as>
   ```

   Thread replies and outdated comments are excluded; without `--full-author`, a human's inline comment counts as a full-only finding.

4. Report the lenses `report.md` names as loaded (or "none loaded"), then the overlap, lite-only, and full-only counts and the usage line exactly as printed.

```text
✗ Wrong — "lite found 2 issues, so the PR is clean"
✓ Right — "lite found 2 findings in 9 of 11 files; 2 files not reviewed (see skipped.json); full-only: 3"
```

## Rules

- [`rules/dispatch.md`](./rules/dispatch.md) — what is reviewed, grouped, and skipped, and what lite reuses read-only.
- [`rules/output-contract.md`](./rules/output-contract.md) — what each stage returns and which filters apply.
- [`rules/lenses.md`](./rules/lenses.md) — how team lenses in `.agents/review/lenses/` reach lite.

## Hard rules

- **Shadow only.** Never post, resolve, or edit anything on GitHub; `--post` does not exist.
- **Never hard-code a price.** USD appears only when `--prices` or `LITE_PRICES` supplies a price, or when the `claude-cli` transport reports the cost itself.
- **Never present lite's output as a verdict.** Its recall is unmeasured; it is compared, not trusted.
- **Do not edit `agents/pr-reviewer/**`, `finders.md`, or `finding-verifier.md` from this skill.** Lite reads them and nothing more.
