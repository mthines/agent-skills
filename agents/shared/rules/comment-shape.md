---
title: Comment shape — hard caps and mechanical checks
impact: HIGH
tags:
  - reviewer
  - pr-reviewer
  - comment-shape
---

# Comment shape

Every inline review comment — whether posted to GitHub by `pr-reviewer` or emitted to the terminal by `reviewer` Self-Review — passes these checks before it leaves the agent.

Research grounding: AI-review tools that ship < 5 % false-positive rate and short, scannable comments (CodeRabbit, Greptile in their 2026 field tests) are the ones developers keep reading. Long comments are skipped; skipped comments make the entire review feel like noise.

## Hard caps

| Property | Cap | On fail |
| --- | --- | --- |
| **Prose** length (body excl. fenced code blocks) | ≤ 240 characters | Trim once; drop on second fail |
| Sentence count (prose only) | ≤ 2 | Drop |
| Headings (`#`, `##`, `###`) in body | 0 | Drop |
| Bullet lists (`-`, `*`, `1.`) in body | 0 | Drop |
| Code fences | ≤ 1, ≤ 10 lines, language tagged | Strip extra fences; drop on missing tag |
| **Inline backticks on every code symbol** | required | Auto-wrap before shape check; see § Inline code |

The 240-char cap applies to the **prose** portion only — fenced code blocks are excluded from the count because GitHub renders them visually distinct from comment text and they carry the actionable patch the author copies. The prose still has to make the point in one or two sentences; the fence carries the fix.

Character count is measured **after** the Conventional-Comments prefix is prepended (so `suggestion: ` + prose must fit). Sentence count is measured against the prose only and counts `.`, `!`, `?` followed by space or end-of-string. Punctuation inside backticks or fenced code does not count.

## Inline code

Every code symbol in the prose body **must** be wrapped in backticks. This includes:

| Token kind | Examples |
| --- | --- |
| Identifiers and variables | `` `popupRef` ``, `` `isConnecting` ``, `` `userIds` `` |
| Property / method access | `` `event.data?.type` ``, `` `popupRef.current.closed` ``, `` `mcp.urls[0]` `` |
| Function / method calls | `` `fetchUser(id)` ``, `` `.min(1)` ``, `` `window.open()` `` |
| String / number / null literals | `` `"mcp-oauth-connected"` ``, `` `null` ``, `` `0` `` |
| Operators and expressions | `` `event.origin !== window.location.origin` ``, `` `?? ""` ``, `` `=== "mcp"` `` |
| Types | `` `EnsureMcpIntegrationId` ``, `` `Map<string, Value>` ``, `` `Record<string, Value>` `` |
| File paths and globs | `` `src/foo.ts` ``, `` `app/**/*.tsx` ``, `` `package.json` `` |
| Config keys, env vars, flags | `` `PER_COMMENT_CONFIDENCE_THRESHOLD` ``, `` `--publish` `` |

Run an auto-wrap pass over the prose body **before** the shape check. Detection heuristics:

```python
import re

CODE_PATTERNS = [
    r"\b[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z_$][a-zA-Z0-9_$]*)+\b",   # method/property chains
    r"\b[a-z][a-zA-Z0-9_]*\([^)]*\)",                            # function calls
    r"\b[A-Z][a-zA-Z0-9]+(?:<[^>]+>)?\b",                        # PascalCase types
    r"`[^`]+`",                                                  # already-backticked, skip
    r"\b[a-z][a-zA-Z0-9]+\[[^\]]+\]",                            # indexed access
    r"[!=<>]==?|&&|\|\||=>|\?\?",                                # operators (wrap with surrounding tokens)
    r'"[^"]*"|\'[^\']*\'',                                       # string literals
    r"\b[a-z_][a-zA-Z0-9_]*\.(?:[a-zA-Z]+)",                     # any.dotted.access
    r"[a-z]+/[a-z./*]+\.[a-z]{2,4}",                             # file paths
]
```

Pass each match through a guard before wrapping: skip the match if it is already inside a fenced code block or already inside backticks. If the prose contains ambiguous English words that happen to match (e.g. "URL" matching the PascalCase pattern), prefer not wrapping over wrapping incorrectly — false positives wrapped as code read worse than missed code.

## Suggestion / issue → include a fix block when a concrete patch exists

For `suggestion:` and `issue:` comments with a known concrete change, **include a fenced code block** with the proposed replacement. The fix block is the part the author actually copies; the prose is just the framing.

Skip the fix block only when:
- The fix is shorter to describe in prose (`` `userIds` reads clearer than `ids` ``).
- The fix is not a code change (a configuration change, a docs note, an architectural decision).
- The fix would exceed 10 lines — route the long-form fix to the terminal proposal or a linked file.

## Shape

```
<one-sentence prose point — what + why — with every code symbol in backticks>

```<lang>
<≤ 10-line fix block — proposed replacement for suggestion / issue,
 omitted for praise / question / nitpick>
```
```

### Examples that pass

```
suggestion: `mcp.urls[0]` has no nullish fallback while the OAuth path uses
`mcp.urls[0] ?? ""` — an empty array currently passes `undefined` into the
prefilled form. **(non-blocking)**

```typescript
formDefaults: {
  type: "mcp",
  mcp: {
    displayName: mcp.label,
    url: mcp.urls[0] ?? "",
  },
}
```
```

```
question: The listener checks `event.data?.type === "mcp-oauth-connected"`
but not `event.origin` — if the callback page is same-origin, an origin
check closes the attack surface at zero cost. **(non-blocking)**

```typescript
if (event.origin !== window.location.origin) return;
if (event.data?.type !== "mcp-oauth-connected") return;
```
```

```
issue: If the user closes the OAuth popup manually, `isConnecting` is
never reset — the button stays disabled until reload. **(blocking)**

```typescript
useEffect(() => {
  const id = setInterval(() => {
    if (popupRef.current?.closed) {
      setIsConnecting(false);
      clearInterval(id);
    }
  }, 500);
  return () => clearInterval(id);
}, [popupRef]);
```
```

```
nitpick: `userIds` reads clearer than `ids` in this scope.
```

```
praise: Nice — the discriminated union on `Result<T>` makes exhaustiveness
checks free.
```

### Examples that fail

- `suggestion: url: mcp.urls[0] has no nullish fallback here` — bare code symbols `url`, `mcp.urls[0]` not backticked → auto-wrap pass should fix; drop only if auto-wrap can't resolve them.
- Anything starting with `## Why` or `### Issue` — heading in body → drop.
- Anything containing `1. First, …\n2. Second, …` — bullets in body → drop.
- A 320-character prose explanation — trim once to ≤ 240; if the trim breaks the point, drop and surface in the terminal output instead.
- A 14-line fix block — exceeds the 10-line fence cap; trim the fence to the smallest patch that lands the change, or drop the block and route the long-form fix to the terminal proposal.

## Tone

- Friendly and collaborative — peer pointing something out, not a gatekeeper.
- Prefer questions over assertions when there's any chance the author has context the agent does not.
- Soften with `maybe`, `consider`, `could`, `what do you think about` — they read as collaborative.
- Never restate the code the comment is pinned to.
- For snippets in a `suggestion` comment, append the italic disclaimer `_Pseudo-code — verify before applying._` after the fence.

## What goes elsewhere

If a finding needs more than 240 characters and 2 sentences to land, it does not belong as an inline comment. Route it to:

- The terminal summary (Step 3 in either agent) for design-level concerns.
- A linked file (`docs/`, `RFC.md`) for genuinely long-form rationale.
- A separate `question:` comment that asks for context first.

## Mechanical pre-emit check

Both agents run these in order immediately before emitting / posting:

```python
import re

FENCE_RE = re.compile(r"```[a-zA-Z0-9_+-]*\n.*?\n```", re.DOTALL)

def strip_fences(body: str) -> tuple[str, list[str]]:
    fences = FENCE_RE.findall(body)
    prose = FENCE_RE.sub("", body).strip()
    return prose, fences

def passes_shape(body: str) -> tuple[bool, str]:
    # Body has already been through the inline-backtick auto-wrap pass.
    prose, fences = strip_fences(body)

    if len(prose) > 240:
        return (False, "length")
    if sum(prose.count(c) for c in ".!?") > 2:
        return (False, "sentences")
    if any(prose.lstrip().startswith(p) for p in ("#", "## ", "### ", "- ", "* ", "1. ")):
        return (False, "structure")

    if len(fences) > 1:
        return (False, "too-many-fences")
    for fence in fences:
        lines = fence.count("\n") - 1  # exclude the opening/closing fence lines
        if lines > 10:
            return (False, "fence-too-long")
        if not re.match(r"```[a-zA-Z0-9_+-]+\n", fence):
            return (False, "fence-missing-language")

    return (True, "")
```

The check runs **after** Conventional-Comments prefix prepending, **after** the optional `(blocking)` / `(non-blocking)` decoration, and **after** the inline-backtick auto-wrap pass, so the cap applies to what the PR author actually sees.

On `length` fail: attempt one trim pass that drops the trailing rationale clause from the **prose** (never from the fence). If the trimmed prose no longer makes the point standalone, drop the comment and surface it in the terminal output for the user to post manually.

On `sentences`, `structure`, `too-many-fences`, `fence-too-long`, or `fence-missing-language` fail: drop without retry. These shapes are not recoverable and re-trying the same model in the same turn would re-produce them.

Dropped comments are logged with the dropped body verbatim in the agent's terminal output so the user can paste them manually if they want — never silently discarded.
