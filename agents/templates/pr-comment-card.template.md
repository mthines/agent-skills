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
<body — already conforms to comment-shape.md and starts with Conventional-Comments prefix; every code symbol in prose is backticked>

_Pseudo-code — verify before applying._

```<lang>
<≤ 10-line suggested replacement — strongly preferred for suggestion / issue when a concrete patch exists>
```

---
```

The trailing `---` separates cards. The pseudo-code block is **strongly preferred for `suggestion` and `issue` categories** when there is a concrete patch — that fenced block is the part the PR author actually copies. Omit it only when the fix is shorter to describe in prose, when there is no code change, or when the fix would exceed 10 lines (route long-form fixes to the terminal proposal). Always include the italic disclaimer when a pseudo-code block is present.

## Field definitions

| Field | Required | Source | Example |
| --- | --- | --- | --- |
| `N` | yes | running 1-indexed counter | `3` |
| `file` | yes | path relative to repo root | `src/foo.ts` |
| `line` | yes | RIGHT-side line number (single) | `42` |
| `end_line` | no | RIGHT-side line number (multi) | `42-48` |
| `category` | yes | one of: `praise`, `nitpick`, `suggestion`, `issue`, `question` | `suggestion` |
| `confidence` | yes | the weighted **Final** score (Correctness 40 %, Completeness 30 %, No-regressions 30 %) from `per-comment-confidence.md` | `87` |
| `Code` anchor | yes | the literal 1–3 line slice from the changed file at the pinned line | the actual code being commented on |
| `Comment` body | yes | passes `comment-shape.md`; starts with Conventional-Comments prefix; optionally ends with decoration | `suggestion: Could use a Map here for clearer iteration semantics. **(non-blocking)**` |
| Pseudo-code | no | only for `suggestion` / `issue` with a concrete replacement | `const cache = new Map<string, Value>();` |

## Validation before emit

Both agents run this assertion immediately before emitting any card:

```python
import re

FENCE_RE = re.compile(r"```[a-zA-Z0-9_+-]*\n.*?\n```", re.DOTALL)

def card_is_valid(card: dict) -> bool:
    body = card["body"]
    prose = FENCE_RE.sub("", body).strip()  # 240 cap applies to prose only
    return (
        card["file"] and card["line"] >= 1
        and card["category"] in {"praise", "nitpick", "suggestion", "issue", "question"}
        and 0 <= card["confidence"] <= 100
        and card["confidence"] >= 80
        and card["anchor"] and len(card["anchor"].splitlines()) <= 3
        and body.startswith((
            "praise:", "nitpick:", "suggestion:", "issue:", "question:"
        ))
        and len(prose) <= 240
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
suggestion: A `Map<string, Value>` reads clearer than `Record<string, Value>` here and avoids prototype-key pitfalls. **(non-blocking)**

_Pseudo-code — verify before applying._

```typescript
const cache = new Map<string, Value>();
```

---
```

### Example 2 — issue with snippet

```
#### 2. `src/bar.ts:15-18` — issue (90%)

**Code:**
```typescript
try {
  return await fetchUser(id);
} catch {}
```

**Comment:**
issue: Empty `catch {}` swallows network vs. not-found errors — worth surfacing the failure to the caller. **(blocking)**

_Pseudo-code — verify before applying._

```typescript
try {
  return await fetchUser(id);
} catch (err) {
  if (err instanceof NotFoundError) return null;
  throw err;
}
```

---
```

### Example 3 — issue with multi-line fix block

```
#### 3. `src/oauth-popup.ts:42` — issue (90%)

**Code:**
```typescript
popupRef.current = window.open("/", "_blank", "popup=true,…");
setIsConnecting(true);
```

**Comment:**
issue: If the user closes the OAuth popup manually, `isConnecting` is never reset — the button stays disabled until reload. **(blocking)**

_Pseudo-code — verify before applying._

```typescript
useEffect(() => {
  if (!isConnecting) return;
  const id = setInterval(() => {
    if (popupRef.current?.closed) {
      setIsConnecting(false);
      clearInterval(id);
    }
  }, 500);
  return () => clearInterval(id);
}, [isConnecting]);
```

---
```

### Example 4 — praise (no fix block)

```
#### 4. `src/baz.ts:7` — praise (85%)

**Code:**
```typescript
type Result<T> = { ok: true; value: T } | { ok: false; err: Error };
```

**Comment:**
praise: Nice — the discriminated union on `Result<T>` makes exhaustiveness checks free. **(non-blocking)**

---
```

## How the two agents use the card differently

| Agent | What the card becomes |
| --- | --- |
| `pr-reviewer` | The body is extracted (without `_Pseudo-code_` disclaimer, without the Code anchor) and posted to `gh api pulls/{n}/reviews` as one `comments[]` entry. The full card is also printed to the terminal proposal in Step 3. |
| `reviewer` Self-Review | The full card is printed to the terminal. Nothing is posted. The orchestrator agent reads the cards and decides whether to address them before undrafting. |

The card is the contract. If the agent emits something that does not match this template, the renderer is broken.
