---
title: Comment shape — hard caps and mechanical checks
impact: HIGH
tags:
  - pr-reviewer
  - comment-shape
---

# Comment shape

Every inline review comment — whether posted to GitHub by `pr-reviewer` or emitted to the terminal by `reviewer` Self-Review — is **rendered by a script**, not composed by hand.

```bash
node "$RENDER_COMMENT" /tmp/finding.json     # RENDER_COMMENT="${AGENT_MD%/pr-reviewer.md}/pr-reviewer/scripts/render-comment.mjs"
```

**Why it is a script.** The report layout was taken away from the model for a documented reason: five production runs posted marker-less, accordion-less reports from a correct prose spec, so `render-report.mjs` was written and the model was left supplying data. This rule had the same problem and the opposite treatment — it specified the shape in prose and shipped a `passes_shape()` function that *nothing executed*. The contract therefore held only as long as the model remembered it, and on `dash0hq/dash0#18362` one posted finding dropped three of the decorations below at once (the severity label, the bold on `**(blocking)**`, and its position) and omitted the fix fence its own rule requires for a finding with a concrete patch.

So the caps, the decorations, the evidence line, the fingerprint marker, the button markup and the footer are all **derived** now. This file is the reference for *what the shapes are and why*; [`render-comment.mjs`](../../pr-reviewer/scripts/render-comment.mjs) is the authority on whether a given body conforms, and it fails closed — a rejected payload prints nothing on stdout, so a caller that pipes stdout can never post a half-formed finding.

**The vocabulary is shared with the report.** Both renderers import [`comment-spine.mjs`](../../pr-reviewer/scripts/comment-spine.mjs) for the tier glyphs, the attribution footer, the button markup, and the caps. That single import is the mechanism: a change to the vocabulary cannot land on one surface only. The one deliberate asymmetry between the two surfaces is a rule you can say in a sentence — **a `###` heading means the report; a bold title means one finding** — and each renderer's post-conditions enforce its own half.

Research grounding: AI-review tools that ship < 5 % false-positive rate and short, scannable comments (CodeRabbit, Greptile in their 2026 field tests) are the ones developers keep reading. Long comments are skipped; skipped comments make the entire review feel like noise. The title added below is not a relaxation of that: it *replaces* the opening clause that used to do a title's job badly, and the prose cap drops from 240 to 200 to pay for most of it.

Optimality proposals (Step 2.4c) are **out of scope** for this rule: they render as cards in a report section, not as comments, and are exempt from every cap below (`optimality-review.md § Gates`).

## Contents

- [The payload](#the-payload)
- [The title line](#the-title-line)

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

## The payload

One JSON object per finding. **It is data, not markdown.**

| Key | Required | Content |
| --- | --- | --- |
| `PREFIX` | yes | `issue` · `suggestion` · `nitpick` · `question` · `praise` |
| `TIER` | on a tiered run | `critical` · `high` · `medium` · `low`. Omit only when no tier was assigned (a flat-override run). |
| `TITLE` | on `issue` / `suggestion` | The noun phrase, ≤ 60 chars, no sentence punctuation. **Rejected** on the one-liner prefixes. |
| `BODY` | yes | One paragraph, ≤ 200 chars, ≤ 2 sentences, inline code kept. |
| `BLOCKING` | no | Boolean. **Rejected** on anything but `issue` — Gate 3 reads this token to decide whether an open thread fails a PR. |
| `EVIDENCE` | no | `[{path, line?, note?}]`, ≤ 3. Mutually exclusive with `UNVERIFIED`. Rejected on the one-liner prefixes. |
| `UNVERIFIED` | no | The rung that was unavailable. Rejected on `issue` — nothing was verified, so nothing is asserted. |
| `FENCE` | no | `{lang, code}`, ≤ 10 lines, `lang` required. |
| `PSEUDO` | no | Boolean; appends the pseudo-code disclaimer. Rejected with no `FENCE` to disclaim. |
| `FP` | on `issue` / `suggestion` | The v2 fingerprint. **Rejected** on the one-liner prefixes, and rejected if it is not a real v2 key. |
| `FIX_URL` | no | The Agent0 deep link (§ Fix-with-Agent0 button). |
| `SHA` | yes | `${HEAD_SHA:0:7}` — exactly 7 lowercase hex chars, for the footer. |

An unknown key is a hard error, not a no-op: a typo'd slot would otherwise render nothing and silently drop the evidence line, the patch, or the button.

## The title line

Line 1 is the finding's whole identity, and it is **machine-shaped first**:

```markdown
issue (high): 🟠 **Check-run variables rejected at runtime** **(blocking)**
```

Reading left to right: the Conventional-Comments prefix, the tier in parentheses, the colon, the tier glyph, the bold title, the decoration. The first three are unchanged, which is the point — `PREFIX_RE` in `record-comment-relevance.mjs` still matches at position 0 and `SEVERITY_RE` still reads the tier, so the title could be added without touching either regex.

**Why a title at all.** GitHub surfaces an inline comment in three places that show only its opening — the Files-changed rail, the conversation timeline, and the notification email — and a body opening `issue: Adding github.check_run here obligates the exhaustive Record<TriggerKind> maps…` gives none of them a handle. A finding that cannot be named cannot be triaged, referred to, or counted, which is also why the report's findings index carries the **same** `title` string: an index row and the comment it links to are recognisably the same finding.

**Why only on a claim.** `nitpick` / `question` / `praise` render as one line and take no title — a title on a nitpick costs more vertical height than the nitpick is worth, and the terseness of the one-liners is what buys the claims their extra structure. The renderer rejects a title on one and requires it on the other, so the split cannot erode in either direction.

**The title is a noun phrase, not a sentence.** No trailing full stop, no verb-first imperative — `Check-run variables rejected at runtime`, not `The check-run variables are rejected.` Sentence punctuation in a title is rejected, because a title that reads as a sentence competes with the body instead of labelling it.

## Hard caps

Enforced in code by `render-comment.mjs`; the `On fail` column describes what the *caller* does with a rejection.

| Property | Cap | On fail |
| --- | --- | --- |
| `TITLE` length | ≤ 60 characters | Rejected — shorten the noun phrase |
| `TITLE` sentence punctuation | 0 | Rejected — it is a label, not a sentence |
| **Prose** length (`BODY`, excl. fences) | ≤ 200 characters | Trim once; drop on second fail |
| Sentence count (prose only) | ≤ 2 | Drop |
| Paragraphs in `BODY` | 1 | Drop — a multi-paragraph finding goes to the terminal summary |
| Headings (`#`, `##`, `###`) in body | 0 | Drop |
| Bullet lists (`-`, `*`, `1.`) in body | 0 | Drop |
| Code fences | ≤ 1, ≤ 10 lines, language tagged | Strip extra fences; drop on missing tag |
| **Inline backticks on every code symbol** | required | Auto-wrap before rendering; see § Inline code |
| `Evidence:` line | ≤ 1, ≤ 3 `path:line` references, ≤ 180 characters | Trim to the 2 strongest; drop the line, never the comment |
| Fingerprint marker | exactly 1 on an `issue:` / `suggestion:` finding | Rebuilt via `fingerprint.mjs`; see § The fingerprint marker |
| Attribution footer | exactly 1, on every posted comment | Rejected — see § The footer |

The 200-char cap applies to the **prose** portion only — the fenced code block, the `Evidence:` line, and the fingerprint marker are all excluded from the count. Fences render visually distinct and carry the patch the author copies; the `Evidence:` line is a citation list, not argument; the marker is invisible. The prose still has to make the point in one or two sentences.

Character count is measured on `BODY` alone. The prefix, the tier label, the glyph and the title all live on line 1 and have their own bounds — measuring them against the prose cap is what used to make the caps fight each other. Sentence count is measured against the prose only and counts `.`, `!`, `?` followed by space or end-of-string. Punctuation inside backticks or fenced code does not count.

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
| Excluded from the 200-char prose cap, with its own 180-char bound | so the caps do not fight |
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

A **claim** (`issue` / `suggestion`) — seven blocks, blank-line separated, in this order:

```
<prefix> (<tier>): <glyph> **<title, ≤ 60 chars, noun phrase>** **(blocking|non-blocking)**

<≤ 2 sentences, ≤ 200 chars, every code symbol in backticks>

Evidence: `path:line` (≤ 5-word note) · `path:line`

```<lang>
<≤ 10-line fix block — the proposed replacement>
```

_Pseudo-code — verify before applying._      ← only when PSEUDO is set

<Fix with Agent0 button>                      ← only when the mode is on

<sup>`pr-reviewer` · commit `<sha7>`</sup>
<!-- fp:v2:<finder>:<class>:<symbol>@<path> -->
```

A **one-liner** (`nitpick` / `question` / `praise`) — the terse form, unchanged apart from the footer:

```
<prefix> (<tier>): <≤ 2 sentences> **(non-blocking)**

<sup>`pr-reviewer` · commit `<sha7>`</sup>
```

## The footer

Every posted inline comment ends with the shared attribution footer, built by
`comment-spine.mjs`'s `footerLine()` — the **same function** that builds the report's.

**One rule, no exceptions**, including `praise`. The exceptions are what drift: a per-prefix
carve-out is a decision to re-make on every finding, and the cost of the rule as stated is one
`<sup>` line on a rare comment.

**Inline carries the identity half only — `` `pr-reviewer` · commit `<sha7>` `` and nothing else.**
The shared function is the same; the *arguments* differ, and always have (the report passes its run
line and its `updated` stamp, an inline finding passes neither). The **methodology link** belongs
once per review, on the object that *is* the review — repeating
`[how these findings are produced]` under all twenty inline findings spends a line per comment to
say the same thing the report already says once, on the surface with the least room for it. So
`footerLine()`'s `docs` flag defaults **off** and only `render-report.mjs` passes `docs: true`: a
surface has to *ask* for the link, which is why this cannot silently come back. Guarded from both
directions — L1 `G46e` asserts the four inline reference renderings carry the whole footer and no
methodology link, and `G25` diffs the report's own renderings, which do carry it.

It answers two questions nothing else on this surface could. *Who is speaking* — an inline comment
is most often read in a notification email or the Files-changed rail, with no surrounding page to
identify the author, and this reviewer's login is not always resolvable (`/user` 401s on some access
paths) which is why the name is written rather than inferred. And *which commit was read* — a
finding on a stale SHA is a different claim from the same finding on HEAD, and the author cannot
tell them apart without it. It is the cue that makes an inline finding and the report recognisably
the same reviewer; Cursor's own footer does exactly this job, and its absence here is most of why
our two surfaces read as two bots.

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
- A 320-character prose explanation — trim once to ≤ 200; if the trim breaks the point, drop and surface in the terminal output instead.
- A 14-line fix block — exceeds the 10-line fence cap; trim the fence to the smallest patch that lands the change, or drop the block and route the long-form fix to the terminal proposal.

## Tone

- Friendly and collaborative — peer pointing something out, not a gatekeeper.
- Prefer questions over assertions when there's any chance the author has context the agent does not.
- Soften with `maybe`, `consider`, `could`, `what do you think about` — they read as collaborative.
- Never restate the code the comment is pinned to.
- For snippets in a `suggestion` comment, append the italic disclaimer `_Pseudo-code — verify before applying._` after the fence.

## What goes elsewhere

If a finding needs more than a 60-char title, 200 characters of prose, and 2 sentences to land, it does not belong as an inline comment. Route it to:

- The terminal summary (Step 3) for design-level concerns.
- A linked file (`docs/`, `RFC.md`) for genuinely long-form rationale.
- A separate `question:` comment that asks for context first.

## Mechanical pre-emit check

**This is `render-comment.mjs`'s job now, and the Python below is the reference, not the
implementation.** It is kept because it documents the *order* the checks run in and why each cap
exists; the executable version lives in the renderer and is exercised by `node
render-comment.mjs --self-test` plus committed fixtures in
`scripts/eval/fixtures/inline-comment/`, both run by L1 (`G41`). If the two ever disagree, the
renderer is right and this block is stale — that asymmetry is deliberate, and it is the whole
difference between this rule and the version of it that let three decorations quietly disappear.

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

    if len(prose) > 200:
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

The prose cap is measured on `BODY` alone, **after** the inline-backtick auto-wrap pass. The prefix, tier label, glyph, title, decoration, evidence line, fence, button, footer and marker all have their own bounds and are excluded — measuring them against the prose cap is what made the caps fight each other and pushed correct findings over the edge.

`evidence-line-oversized` is the one non-fatal return: it passes, and the caller **drops the
`Evidence:` line and re-runs the check**. The evidence line is an enhancement, and dropping a
correct finding because its citation list was one reference too long would be the tail wagging the
dog.

On `length` fail: attempt one trim pass that drops the trailing rationale clause from the **prose** (never from the fence). If the trimmed prose no longer makes the point standalone, drop the comment and surface it in the terminal output for the user to post manually.

On `sentences`, `structure`, `too-many-fences`, `fence-too-long`, or `fence-missing-language` fail: drop without retry. These shapes are not recoverable and re-trying the same model in the same turn would re-produce them.

Dropped comments are logged with the dropped body verbatim in the agent's terminal output so the user can paste them manually if they want — never silently discarded.

## Severity label

The reviewer tiers every finding by default (`review-config.md` § Severity-aware thresholds), and the tier appears **twice** on line 1: as the `(high)` label the machines read, and as the glyph a human scans (§ The title line). Both are derived from the payload's `TIER` by `render-comment.mjs`, from the one glyph map in `comment-spine.mjs` that the report's severity tally also uses — so the two surfaces cannot disagree about what `high` looks like. The label keeps its position immediately after the prefix because `scripts/record-comment-relevance.mjs` reads the tier from exactly there into the relevance record's `severity` field, and strips it before fingerprinting so the claim-gist is unchanged whether or not the label is present. Both are omitted when no tier was assigned (a flat-override run, or a non-`pr-reviewer` bot). Neither is counted against the prose cap.

## Fix-with-Agent0 button

When the buttons are on (`agents/shared/rules/agent0-fix-links.md § Opt-in` — on by default; a repo opts out with `agent0_fix_links: false`), build the deep link and pass it as the payload's **`FIX_URL`**. `render-comment.mjs` renders the button itself, from `comment-spine.mjs`'s `fixButton()`, after the fix block — **never hand-write the markup**, since the host validation, the theme pair and the alt text all live in that one function and a second copy is how the report's button and this one drift apart. Build the link with **the same `--env <env>` the run resolved once at `pr-reviewer.md § Fix-with-Agent0 buttons` (`review-config.md § Run-level fields`) — never rebuild or default the environment per finding — and `--source fix-this` (always this literal value here; `agent0-fix-links.md § Click attribution`).** Omitting `--env` here silently falls back to `build-agent0-link.mjs`'s own `production` default regardless of `agent0_environment`, which is exactly the bug this line now guards against (a `development`-configured repo whose Fix-all report button correctly linked to `app.dash0-dev.com` while its inline Fix-this buttons still linked to `app.dash0.com`). `--source` has no default at all — the script throws rather than silently mis-tagging or dropping the click-attribution data.

**Invoke the script by its `$AGENT_MD`-resolved path, never a bare `agents/pr-reviewer/scripts/build-agent0-link.mjs`.** This step (Step 2.8/2.9) is its own tool call, separate from Step 4a — shell state including any previously-resolved `$AGENT_MD` is gone, so re-resolve it fresh here with the same `resolve()` idiom `pr-reviewer.md § Step 1.2` uses for `CLASSIFY` (`pr-reviewer.md § Fix-with-Agent0 buttons` shows the exact `BUILD_LINK` derivation). A bare relative path only happens to resolve when the shell's cwd is this repo's own checkout, which is not guaranteed on every dispatch — silent failure here reads as a fabricated or defaulted URL rather than a loud error, which is how a `production` link survived on `mthines/lorekit#318` well after the `--env` gap above was already fixed.

Like the severity label it is rendered outside the prose, so it is excluded from the 200-char prose cap — and it is skipped, not aborted, when `$BUILD_LINK` doesn't exist: re-check `[ -f "$BUILD_LINK" ]` fresh at this same re-resolution point (`pr-reviewer.md § Fix-with-Agent0 buttons`'s Fix-this bullet re-checks it per finding, since this is a separate tool call from Step 4a where the existence check was first added) — omit `FIX_URL` from that one payload rather than dropping the finding. The renderer **rejects** `FIX_URL` on `nitpick` / `question` / `praise`, so the skip for those is enforced rather than remembered; omit it entirely when the mode is off.

Its deep link is a call to Agent0's `/pr-fix` skill carrying the PR URL, the reviewer's login, and this finding's own `path:line` — **no part of the body** (`agent0-fix-links.md § Prompt templates`). It is finding-*located* but not finding-*quoting*, so the link is unaffected by a prose trim under § Hard caps and may be built before or after it. Do not re-add a `{lead}` line or any other excerpt: the body is read live by `/pr-fix` from the posted comment, and quoting it into the URL is how the link went stale on a trim and grew to ~880 chars.

Unlike the severity label, the button is not unbounded either: the embedded deep link is capped by `build-agent0-link.mjs`'s own `MAX_URL` guard (4000 chars — read that constant for why it is not the 8000 it once was), which applies identically to the **Fix this** and **Fix all** links since both are built by that script's `encodePrompt` / `buildLink`. Both now sit between ~190 and ~360 chars, so the guard is a guard; if a **Fix this** prompt would somehow push the link past that bound (a pathologically long path), omit the button for that finding rather than truncate the URL — log the omission in the agent's terminal output the same way an unrecoverable `passes_shape` drop is logged above, so the finding is never silently shortened into a broken link.
