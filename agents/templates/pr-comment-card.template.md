---
for: pr-reviewer, reviewer
description: "Canonical comment-card shape emitted by both agents. Used in the local proposal (terminal output) and as the source for the GitHub posting payload (pr-reviewer only)."
---

# PR Comment Card — Template

Each finding that survives the full pipeline (rubric-composition → finding-grounding → per-comment-confidence → comment-shape → conventional-comments → line-validity) is emitted as one card in this exact shape.

The card is the **handoff format** between the review pipeline and the emit step. Do not invent a different shape per agent — both `reviewer` Self-Review and `pr-reviewer` cross-review render this same card.

---

## Card shape

```
#### <N>. `<file>:<line[-end_line]>` — <category> (<confidence>%)

**Code:**
```<lang>
<1–3 anchor lines from the changed file>
```

**Comment:**
<body — already conforms to comment-shape.md and starts with Conventional-Comments prefix>

_Pseudo-code — verify before applying._

```<lang>
<optional ≤ 6-line suggested replacement — only for suggestion / issue categories>
```

---
```

The trailing `---` separates cards. The trailing pseudo-code block is **optional** and only present when a concrete code suggestion clarifies the comment. Always include the italic disclaimer when a pseudo-code block is present.

## Field definitions

| Field | Required | Source | Example |
| --- | --- | --- | --- |
| `N` | yes | running 1-indexed counter | `3` |
| `file` | yes | path relative to repo root | `src/foo.ts` |
| `line` | yes | RIGHT-side line number (single) | `42` |
| `end_line` | no | RIGHT-side line number (multi) | `42-48` |
| `category` | yes | one of: `praise`, `nitpick`, `suggestion`, `issue`, `question` | `suggestion` |
| `confidence` | yes | the `min(accurate, actionable, helpful)` from `per-comment-confidence.md` | `87` |
| `Code` anchor | yes | the literal 1–3 line slice from the changed file at the pinned line | the actual code being commented on |
| `Comment` body | yes | passes `comment-shape.md`; starts with Conventional-Comments prefix; optionally ends with decoration | `suggestion: Could use a Map here for clearer iteration semantics. **(non-blocking)**` |
| Pseudo-code | no | only for `suggestion` / `issue` with a concrete replacement | `const cache = new Map<string, Value>();` |

## Validation before emit

Both agents run this assertion immediately before emitting any card:

```python
def card_is_valid(card: dict) -> bool:
    return (
        card["file"] and card["line"] >= 1
        and card["category"] in {"praise", "nitpick", "suggestion", "issue", "question"}
        and 0 <= card["confidence"] <= 100
        and card["confidence"] >= 80
        and card["anchor"] and len(card["anchor"].splitlines()) <= 3
        and card["body"].startswith((
            "praise:", "nitpick:", "suggestion:", "issue:", "question:"
        ))
        and len(card["body"]) <= 240
    )
```

A card that fails this assertion was misrouted — either an earlier pipeline step missed a drop, or the renderer mutated the body. Halt and report the malformed card in the terminal output. Do not fall back to a "best-effort" render.

## Examples

### Example 1 — suggestion with snippet

```
#### 1. `src/foo.ts:42` — suggestion (95%)

**Code:**
```typescript
const cache: Record<string, Value> = {};
```

**Comment:**
suggestion: Could use a `Map` here for clearer iteration semantics. **(non-blocking)**

_Pseudo-code — verify before applying._

```typescript
const cache = new Map<string, Value>();
```

---
```

### Example 2 — issue without snippet

```
#### 2. `src/bar.ts:15-18` — issue (90%)

**Code:**
```typescript
try {
  return await fetchUser(id);
} catch {}
```

**Comment:**
issue: Empty catch swallows network vs. not-found errors — worth surfacing the failure. **(blocking)**

---
```

### Example 3 — praise

```
#### 3. `src/baz.ts:7` — praise (85%)

**Code:**
```typescript
type Result<T> = { ok: true; value: T } | { ok: false; err: Error };
```

**Comment:**
praise: Nice — the discriminated union makes exhaustiveness checks free. **(non-blocking)**

---
```

## How the two agents use the card differently

| Agent | What the card becomes |
| --- | --- |
| `pr-reviewer` | The body is extracted (without `_Pseudo-code_` disclaimer, without the Code anchor) and posted to `gh api pulls/{n}/reviews` as one `comments[]` entry. The full card is also printed to the terminal proposal in Step 5.5. |
| `reviewer` Self-Review | The full card is printed to the terminal. Nothing is posted. The orchestrator agent reads the cards and decides whether to address them before undrafting. |

The card is the contract. If the agent emits something that does not match this template, the renderer is broken.
