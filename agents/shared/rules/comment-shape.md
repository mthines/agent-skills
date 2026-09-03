---
title: Comment shape — hard caps and mechanical checks
impact: HIGH
tags:
  - pr-reviewer
  - comment-shape
---

# Comment shape

Every inline review comment — whether posted to GitHub by `pr-reviewer` or emitted to the terminal by `reviewer` Self-Review — passes these checks before it leaves the agent.

Research grounding: AI-review tools that ship < 5 % false-positive rate and short, scannable comments (CodeRabbit, Greptile in their 2026 field tests) are the ones developers keep reading. Long comments are skipped; skipped comments make the entire review feel like noise.

Optimality proposals (Step 2.4c) are **out of scope** for this rule: they render as cards in a report section, not as comments, and are exempt from every cap below (`optimality-review.md § Gates`).

## Contents

- [Hard caps](#hard-caps)
- [The `Evidence:` line](#the-evidence-line)
- [The fingerprint marker](#the-fingerprint-marker)
- [Inline code](#inline-code)
- [Suggestion / issue → include a fix block when a concrete patch exists](#suggestion--issue--include-a-fix-block-when-a-concrete-patch-exists)
- [Shape](#shape)
- [Tone](#tone)
- [What goes elsewhere](#what-goes-elsewhere)
- [Mechanical pre-emit check](#mechanical-pre-emit-check)
- [Severity label](#severity-label)

---

## Hard caps

| Property | Cap | On fail |
| --- | --- | --- |
| **Prose** length (body excl. fenced code blocks) | ≤ 240 characters | Trim once; drop on second fail |
| Sentence count (prose only) | ≤ 2 | Drop |
| Headings (`#`, `##`, `###`) in body | 0 | Drop |
| Bullet lists (`-`, `*`, `1.`) in body | 0 | Drop |
| Code fences | ≤ 1, ≤ 10 lines, language tagged | Strip extra fences; drop on missing tag |
| **Inline backticks on every code symbol** | required | Auto-wrap before shape check; see § Inline code |
| `Evidence:` line | ≤ 1, ≤ 3 `path:line` references, ≤ 180 characters | Trim to the 3 strongest; drop the line, never the comment |
| Fingerprint marker | exactly 1 on an `issue:` / `suggestion:` finding | Rebuild via `fingerprint.mjs`; see § The fingerprint marker |

The 240-char cap applies to the **prose** portion only — the fenced code block, the `Evidence:` line, and the fingerprint marker are all excluded from the count. Fences render visually distinct and carry the patch the author copies; the `Evidence:` line is a citation list, not argument; the marker is invisible. The prose still has to make the point in one or two sentences.

Character count is measured **after** the Conventional-Comments prefix is prepended (so `suggestion: ` + prose must fit). Sentence count is measured against the prose only and counts `.`, `!`, `?` followed by space or end-of-string. Punctuation inside backticks or fenced code does not count.

## The `Evidence:` line

An `issue:` or `suggestion:` finding may carry **one** `Evidence:` line, immediately after the prose
and before the fix fence.

```markdown
issue (high): `retryRequest` now throws `RetryExhausted` where it returned `null`; `sync.ts:88` still checks `=== null` and has no catch.
Evidence: src/api/client.ts:214 (throw added) · src/jobs/sync.ts:88 (null check) · no covering test.

```ts
try { await retryRequest(job) } catch (e) { if (e instanceof RetryExhausted) return markFailed(job); throw e }
```
```

Rules:

| Rule | Why |
| --- | --- |
| At most **3** references, `·`-separated | a fourth is a list, and a list is the thing the no-bullets rule exists to prevent |
| Each is a `path:line`, optionally with a ≤ 5-word parenthetical | a reference the author cannot click is not evidence |
| **Exempt from the sentence count** | it is a citation list, not a second argument. Counting it would force the prose down to one sentence to make room for the proof. |
| Excluded from the 240-char prose cap, with its own 180-char bound | so the caps do not fight |
| Only the paths the receipt actually touched | a fabricated citation is worse than none: it converts an unverified claim into a confident-looking one |
| Never on `praise` / `question` / `nitpick` | nothing is being proved |

This line is the largest credibility gain available at **zero model cost**. It is assembled from the
candidate's `evidence[]` and the verifier's receipt, both of which already exist — nothing is
generated for it. An author who can check the claim in one click either fixes it or refutes it; one
who cannot has to take the reviewer's word, and a reviewer whose word has to be taken gets ignored.

**Never write an `Evidence:` line the receipt does not support.** If the verdict was `unobtainable`,
the decoration is `(unverified: <reason>)` and there is no evidence line —
[`verification-receipt.md`](./verification-receipt.md) owns that distinction.

## The fingerprint marker

Every `issue:` and `suggestion:` finding ends with its structural fingerprint as an HTML comment:

```markdown
<!-- fp:v2:consumer-impact:contract-break:retryRequest@src/api/client.ts -->
```

Build it — never type it:

```bash
FP="${AGENT_MD%/pr-reviewer.md}/pr-reviewer/scripts/fingerprint.mjs"
node "$FP" marker "$(node "$FP" build --finder consumer-impact \
  --defect-class contract-break --symbol retryRequest --path src/api/client.ts)"
```

Resolve `$FP` from `$AGENT_MD` with the same idiom the other scripts use; a bare relative path only
resolves when the shell's cwd happens to be this repo's checkout.

The marker does three jobs at once, which is why it is worth the invisible bytes:

1. **Exact recovery.** The relevance recorder reads the key back rather than re-deriving it from
   prose, so the write path and the read path cannot disagree.
2. **Self-attribution.** Only this agent writes it, so its presence identifies the author with no
   login configuration — and the bot login is genuinely unavailable on access paths where `/user`
   returns 401.
3. **Version tagging.** `v2` means a formula change re-keys explicitly instead of silently
   splitting one finding's history across two key spaces.

It is invisible in rendered Markdown, excluded from every cap, and **must not** be added to
`praise` / `question` / `nitpick`: those never arm a relevance rule, and a marker on one would
create a key that accumulates signal for a finding class that has no suppression semantics.

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

- The terminal summary (Step 3) for design-level concerns.
- A linked file (`docs/`, `RFC.md`) for genuinely long-form rationale.
- A separate `question:` comment that asks for context first.

## Mechanical pre-emit check

`pr-reviewer` runs these in order immediately before emitting / posting:

```python
import re

FENCE_RE    = re.compile(r"```[a-zA-Z0-9_+-]*\n.*?\n```", re.DOTALL)
EVIDENCE_RE = re.compile(r"^Evidence:.*$", re.MULTILINE)
MARKER_RE   = re.compile(r"<!--\s*fp:v\d+:[^\s>]+?\s*-->")

def strip_fences(body: str) -> tuple[str, list[str], str]:
    """Split the body into prose, fences, and the one evidence line.

    All three of fences, the evidence line, and the marker are stripped BEFORE the prose
    is measured. Measuring any of them against the prose caps makes the caps fight each
    other: a comment carrying a legitimate 10-line fix and a 3-reference citation would
    fail `length` on the strength of the very parts that make it useful.
    """
    fences = FENCE_RE.findall(body)
    rest   = FENCE_RE.sub("", body)

    match    = EVIDENCE_RE.search(rest)
    evidence = match.group(0) if match else ""
    rest     = EVIDENCE_RE.sub("", rest)

    prose = MARKER_RE.sub("", rest).strip()
    return prose, fences, evidence

def passes_shape(body: str) -> tuple[bool, str]:
    # Body has already been through the inline-backtick auto-wrap pass.
    prose, fences, evidence = strip_fences(body)

    # The evidence line has its own bound and its own reference cap; it is never measured
    # against the prose caps, and a failure here drops the LINE, never the comment.
    if evidence:
        if len(evidence) > 180 or evidence.count("·") > 2:
            return (True, "evidence-line-oversized")   # caller drops the line and re-checks
        if len(MARKER_RE.findall(body)) > 1:
            return (False, "duplicate-fingerprint-marker")

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

`evidence-line-oversized` is the one non-fatal return: it passes, and the caller **drops the
`Evidence:` line and re-runs the check**. The evidence line is an enhancement, and dropping a
correct finding because its citation list was one reference too long would be the tail wagging the
dog.

On `length` fail: attempt one trim pass that drops the trailing rationale clause from the **prose** (never from the fence). If the trimmed prose no longer makes the point standalone, drop the comment and surface it in the terminal output for the user to post manually.

On `sentences`, `structure`, `too-many-fences`, `fence-too-long`, or `fence-missing-language` fail: drop without retry. These shapes are not recoverable and re-trying the same model in the same turn would re-produce them.

Dropped comments are logged with the dropped body verbatim in the agent's terminal output so the user can paste them manually if they want — never silently discarded.

## Severity label

The reviewer tiers every finding by default (`review-config.md` § Severity-aware thresholds) and shows the tier as a visible label decoration — `issue (high): …` (`conventional-comments.md` § Severity decoration). It sits in the prefix region, so it is included in the 240-char cap like the prefix itself (it adds ~7 characters, measured after prepending, per § Hard caps). `scripts/record-comment-relevance.mjs` reads the tier from this label into the relevance record's `severity` field and strips it before fingerprinting, so the claim-gist is unchanged whether or not the label is present. Omit the label only when no tier was assigned (a flat-override run, or a non-`pr-reviewer` bot).

## Fix-with-Agent0 button

When the `--fix-links` mode is on (`agents/shared/rules/agent0-fix-links.md § Opt-in`; default off), append the **Fix with Agent0** button as the final line of an `issue:` / `suggestion:` finding, *after* the fix block — a linked image built per `agents/shared/rules/agent0-fix-links.md § Button markup`, **passing the same `--env <env>` the run resolved once at `pr-reviewer.md § --fix-links mode` (`review-config.md § Run-level fields`) — never rebuild or default the environment per finding — and `--source fix-this` (always this literal value here; `agent0-fix-links.md § Click attribution`).** Omitting `--env` here silently falls back to `build-agent0-link.mjs`'s own `production` default regardless of `agent0_environment`, which is exactly the bug this line now guards against (a `development`-configured repo whose Fix-all report button correctly linked to `app.dash0-dev.com` while its inline Fix-this buttons still linked to `app.dash0.com`). `--source` has no default at all — the script throws rather than silently mis-tagging or dropping the click-attribution data.

**Invoke the script by its `$AGENT_MD`-resolved path, never a bare `agents/pr-reviewer/scripts/build-agent0-link.mjs`.** This step (Step 2.8/2.9) is its own tool call, separate from Step 4a — shell state including any previously-resolved `$AGENT_MD` is gone, so re-resolve it fresh here with the same `resolve()` idiom `pr-reviewer.md § Step 1.2` uses for `CLASSIFY` (`pr-reviewer.md § --fix-links mode` shows the exact `BUILD_LINK` derivation). A bare relative path only happens to resolve when the shell's cwd is this repo's own checkout, which is not guaranteed on every dispatch — silent failure here reads as a fabricated or defaulted URL rather than a loud error, which is how a `production` link survived on `mthines/lorekit#318` well after the `--env` gap above was already fixed.

Like the severity label it is appended after the mechanical pre-emit check, so it is excluded from the 240-char prose cap — and it is skipped, not aborted, when `$BUILD_LINK` doesn't exist: re-check `[ -f "$BUILD_LINK" ]` fresh at this same re-resolution point (`pr-reviewer.md § --fix-links mode`'s Fix-this bullet re-checks it per finding, since this is a separate tool call from Step 4a where the existence check was first added). Skip it for `nitpick` / `question` / `praise`, and omit it entirely when the mode is off.

Its deep link is a call to Agent0's `/implement` skill carrying the PR URL, the reviewer's login, and this finding's own `path:line` — **no part of the body** (`agent0-fix-links.md § Prompt templates`). It is finding-*located* but not finding-*quoting*, so the link is unaffected by a prose trim under § Hard caps and may be built before or after it. Do not re-add a `{lead}` line or any other excerpt: the body is read live by `/implement` from the posted comment, and quoting it into the URL is how the link went stale on a trim and grew to ~880 chars.

Unlike the severity label, the button is not unbounded either: the embedded deep link is capped by `build-agent0-link.mjs`'s own `MAX_URL` guard (4000 chars — read that constant for why it is not the 8000 it once was), which applies identically to the **Fix this** and **Fix all** links since both are built by that script's `encodePrompt` / `buildLink`. Both now sit between ~190 and ~360 chars, so the guard is a guard; if a **Fix this** prompt would somehow push the link past that bound (a pathologically long path), omit the button for that finding rather than truncate the URL — log the omission in the agent's terminal output the same way an unrecoverable `passes_shape` drop is logged above, so the finding is never silently shortened into a broken link.
