---
name: meeting-notes
description: >
  Turn a meeting transcript into tight, scannable notes — the essence, not a
  wall of text. Source-agnostic: works on pasted text, a file path, or a URL,
  from any transcription tool (Granola, Otter, Meet, Fireflies, Zoom, manual).
  Works for planning meetings, brainstorms, technical discussions, and 1:1s.
  Extracts a one-line TL;DR, decisions, action items (owner + due), open
  questions, key points, and named entities — then stops. Never invents facts
  not in the transcript, degrades gracefully on messy input, and emits stable
  headings so other skills (e.g. linear-planning) can consume the output.
  Use this WHENEVER the user shares a transcript, recording, or raw notes and
  wants them distilled — even if they don't say "meeting-notes". Trigger
  phrases: "summarize this meeting", "notes from this transcript", "extract
  action items", "what were the decisions", "TL;DR of this call", "clean up
  these meeting notes", "turn this transcript into notes", "meeting notes",
  "/meeting-notes".
argument-hint: '<transcript path | url> — or just paste the transcript'
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: analysis
  tags:
    - meeting
    - transcript
    - notes
    - action-items
    - summarization
    - extraction
    - analysis
---

# Meeting Notes

Distil a meeting transcript into notes someone can skim in seconds.

The transcript is the record; these notes are the **index** to it.
Their whole value is compression — surfacing the few things that matter
(what was decided, who does what next, what's still open) out of a long,
noisy conversation.
A summary that is itself long has failed at its one job.

## The core principle: essence over volume

This is the rule the whole skill serves, so optimise for it over
completeness:

- **Scannable, not readable.** Tables and one-line bullets beat paragraphs.
  The reader should get the whole picture from the shape of the page, before
  reading a full sentence.
- **Signal, not stenography.** Extract decisions, next steps, and open
  threads. Drop chatter, restated context, and the play-by-play. This is not
  minutes.
- **Ceilings, not exhaustiveness.** Each section below has a soft cap. If you
  blow past it, you are transcribing, not distilling — merge, cut, or raise
  only the highest-signal items.
- **Whole note fits on roughly one screen.** If it doesn't, it's too long.

## Getting the transcript

Resolve the input in this order, and never block on tooling:

1. **Pasted text** in the conversation → use it directly.
2. **File path** → read the file.
3. **URL** → fetch it if reachable.
4. **A connector is needed but unavailable** (e.g. the transcript lives in
   Google Drive / Meet and that connector isn't authorised) → say so once and
   ask the user to paste the text or give a file path. Do not guess at
   contents.

If no transcript is provided at all, ask for one — don't fabricate a meeting.

## How to read it

Separate signal from noise as you go:

- A **decision** is a committed choice ("we'll go with Postgres"), not an
  option that was merely discussed. If the group weighed X and Y but didn't
  land, that's an *open question*, not a decision.
- An **action item** is something a person will now do. Capture the owner
  **only if it was actually assigned** — inferring an owner from who talked
  most is a guess, and a wrong owner is worse than none.
- A **key point** is a requirement, constraint, or insight that shapes the
  work but isn't itself a decision or a task.
- Attribute a name only when the transcript makes it unambiguous. Speaker
  labels like "Speaker 2" stay as-is unless context clearly names them.

## Output format

Use these exact headings and this order, because their stability is the
contract other skills rely on.
**Omit any section that has no real content** — an empty "Decisions" heading
is noise. Keep it lean:

```markdown
## <Topic or meeting title> — <date, only if known>
**TL;DR:** <one or two sentences, max>

### Decisions
- <what was decided> — <one-line why, only if stated>

### Action items
| Owner | Action | Due |
|-------|--------|-----|
| <name or —> | <concise next step> | <date/"—"> |

### Open questions
- <unresolved question> — <who/what is needed to resolve it, if stated>

### Key points
- <requirement, constraint, or insight — one line>

### Entities
People: <…> · Projects: <…> · Systems/tools: <…>
```

Soft caps: **TL;DR** ≤ 2 sentences; **Decisions / Open questions / Key points**
≤ ~7 bullets each; **Action items** ≤ ~10 rows.
Past a cap, the meeting had too many threads to list flat — group them, or
keep only the ones that change what happens next, and say you did.

## Adapt emphasis to the meeting type

The skeleton stays the same; which sections carry the weight shifts.
Let the empty ones fall away rather than padding them:

- **Planning** → Decisions and Action items dominate; scope belongs in Key
  points.
- **Brainstorm** → Key points (the ideas) and Open questions dominate;
  there may be few or no Decisions, and that's fine — don't manufacture them.
- **Technical / design** → Decisions (the approach chosen), Key points
  (constraints, trade-offs), Open questions, and Systems entities.
- **1:1** → usually just TL;DR, Action items, and Open questions. Keep it
  small and factual; leave interpretation to the reader.

## Degrade gracefully

Real transcripts are messy. Handle it without inventing:

- **Missing owner or date** → `—`. Never guess one.
- **No clear decisions** → omit the section. A short honest note beats a
  padded one.
- **Partial or garbled transcript** → add one line at the top,
  `_[partial transcript — notes cover what was captured]_`, then extract what
  is reliable.
- **Ambiguity** → mark it `(unclear)` rather than resolving it silently.
- **Never** add facts, names, numbers, dates, or decisions that aren't in the
  source. When unsure whether something was decided, put it under Open
  questions.

## Composability (for other skills)

Downstream skills such as `linear-planning` consume this output.
Two things make that reliable, so preserve them:

1. **Stable headings** exactly as above — they are the parse contract.
2. On request (e.g. `--json`, or when a calling skill asks for structured
   output), also emit a compact machine-readable block after the markdown —
   same fields, no prose:

```json
{
  "title": "", "date": "",
  "tldr": "",
  "decisions": [{ "decision": "", "rationale": "" }],
  "action_items": [{ "owner": "", "action": "", "due": "" }],
  "open_questions": [{ "question": "", "needs": "" }],
  "key_points": [""],
  "entities": { "people": [], "projects": [], "systems": [] }
}
```

Default to the concise markdown only; add the JSON block just when asked.

## Anti-patterns

- A paragraph-form or chronological recap — that's minutes, not notes.
- Restating context and discussion that led nowhere.
- Inventing owners, due dates, or decisions to fill the template.
- Editorialising or grading contributions.
- Burying the one thing that matters in a long list — lead with signal, cap
  the rest.
