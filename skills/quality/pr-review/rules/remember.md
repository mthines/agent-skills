---
title: remember — write a maintainer relevance rule
impact: HIGH
tags:
  - pr-review
  - lorekit
  - relevance-memory
---

# `remember` — write a maintainer relevance rule

`/pr-review remember <fact>` writes one rule into the relevance memory the reviewer reads on every run — the local equivalent of leaving the same comment on a PR, and the one write path that needs no corroboration.
[`memory.md`](../../../../agents/pr-reviewer/rules/memory.md#pr-review-remember--an-explicit-instruction-needs-no-corroboration) owns the semantics; this file owns only the invocation.
`remember` dispatches nothing and runs no review.

## Contents

- [Classify the direction](#classify-the-direction)
- [The key must be an `fp`, or there is no rule to write](#the-key-must-be-an-fp-or-there-is-no-rule-to-write)
- [The write](#the-write)
- [Two rules `remember` cannot write](#two-rules-remember-cannot-write)

## Classify the direction

| Wording | `direction` |
| --- | --- |
| "don't flag …", "stop flagging …", "we don't care about …" | `suppress` |
| "always check …", "watch for …", "this repo cares about …" | `amplify` |

## The key must be an `fp`, or there is no rule to write

The reviewer matches rules **by fingerprint** at read time, so a rule stored under any other key is never read again.

Resolve `$AGENT_SUPPORT` per [`SKILL.md` § Locating the support tree](../SKILL.md#locating-the-support-tree), then, in the same Bash call:

```bash
[ -f "$AGENT_SUPPORT/pr-reviewer/scripts/fingerprint.mjs" ] || {
  echo "pr-review remember: support tree unresolved (tried env.sh, ${CLAUDE_AGENT_FILE:-\$HOME/.claude/agents/pr-reviewer.md})" >&2; exit 1; }
node "$AGENT_SUPPORT/pr-reviewer/scripts/fingerprint.mjs" build \
  --finder <finder> --defect-class <class> --symbol <symbol|-> --path <repo-relative path>
```

An unresolved tree stops the write: without the script there is no `fp`.

The build needs a `finder`, a `defect-class`, and a `path` (`--symbol -` covers a whole-file rule).
Infer what the fact determines, then:

- **All three resolved** → build the `fp` and write the rule.
- **Any one missing** → ask for it in one question, naming the candidates from the enums the script validates against (`FINDERS` and `DEFECT_CLASSES` in `fingerprint.mjs`).

**Never invent a key to make the write succeed.**
**Why:** a prose-slug key writes a record the read path cannot see — it looks like success and stores nothing.

```text
✅ RIGHT
/pr-review remember don't flag maintainability in scripts/eval/golden/
→ fp = quality:maintainability:-@scripts/eval/golden/   → write suppress

❌ WRONG
/pr-review remember stop being so picky
→ no finder, no class, no path. Ask which finder and where; never write `rule::stop-being-so-picky`.
```

## The write

```text
mcp__lorekit__memory_write
  tag:    loop::reviewer-comment-relevance
  key:    rule::<fp>
  scope:  repo::{owner}/{repo}
  ttl:    60d
  body:   { direction, status: "active",
            source: { type: "human", agent: "other", explicit: true },
            reason: "<the fact, verbatim>", scope_globs: [<glob>] }
```

`status: active` immediately, with no corroboration threshold: a maintainer's statement is the evidence.

**`explicit: true` is required.**
The agent filters every relevance-rule read on `source.agent == "pr-reviewer" ∨ source.explicit == true` ([`memory.md`](../../../../agents/pr-reviewer/rules/memory.md#every-read-filters-on-sourceagent)); without the flag the record is byte-identical to the incidental human comment that filter rejects, and the reviewer never reads it.

## Two rules `remember` cannot write

A `suppress` rule can never silence a **`standards`** finding or a **`(blocking)`** one.
Refuse those two, say which, and write nothing:

```text
/pr-review: `standards` findings are not suppressible — they come from this repo's own governing
docs, so the fix is to change the doc (CLAUDE.md, AGENTS.md, .claude/rules/*.md), not to stop
enforcing it. Nothing was written.
```

Both exemptions are the agent's ([`memory.md`](../../../../agents/pr-reviewer/rules/memory.md#two-findings-memory-may-never-suppress)); this refusal restates them and must not diverge.
