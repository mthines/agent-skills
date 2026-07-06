---
title: Evidence Resolution — Per-Input Procedures
impact: HIGH
tags:
  - evidence
  - dash0
  - stack-trace
  - error-message
  - code-pointer
  - linear
---

# Evidence Resolution

Once Phase 0 has classified `$ARGUMENTS`, resolve each input to a concrete evidence record the
analysis phase can consume. Walk only the procedures that match the classified input(s).

## Contents

- [Dash0 resolution](#dash0-resolution)
- [Linear input](#linear-input)
- [Code pointer](#code-pointer)
- [Stack trace](#stack-trace)
- [Error message](#error-message)
- [Multi-input merging](#multi-input-merging)

---

## Dash0 resolution

1. **Detect Dash0 MCP availability.** Scan the available MCP tool list for any tool prefixed with
   `mcp__dash0__` (or equivalent — the prefix may vary by MCP server name).
2. If no Dash0 MCP is configured, print this exact message and wait:

   ```text
   Dash0 MCP is not configured for this session. Either install it, or paste
   the relevant span / log payload directly into the chat and I will use that
   as evidence.
   ```

3. Extract the artefact identifier from the URL:
   - Trace / span: `traceId`, `spanId` query parameters or path components.
   - Log: log entry ID or query expression.
   - Web event: RUM event ID, session replay ID.
4. **Compensate for time zones when constructing time-range queries.** Dash0 stores timestamps in
   UTC, but URLs and chat input often carry the user's local time. Before issuing a time-bounded
   query (e.g. "logs around the failing span"):
   - If the artefact URL contains `from` / `to` query parameters, use those values verbatim — they
     are already UTC.
   - If you derive a window from a human-readable timestamp the user pasted, convert it to UTC
     using their reported time zone (or `Intl.DateTimeFormat().resolvedOptions().timeZone` if
     unstated) before sending it to the MCP tool.
   - Pad the window by ±5 minutes — clock skew between the user's browser and the ingest pipeline
     can shift events by seconds to minutes.
5. Call the appropriate Dash0 MCP tool to fetch the artefact. Capture:
   - Service name, environment, deployment / release version.
   - Operation name, span attributes (especially `code.*`, `exception.*`, `http.*`, `db.*`).
   - Stack trace if present (often in `exception.stacktrace`).
   - Linked spans (parent, root, children) — bugs frequently live one or two hops up the trace
     from where they surface.
   - Surrounding logs in the same trace (correlate by `trace_id`).
6. If the span has `exception.stacktrace`, also route the stacktrace through [Stack trace](#stack-trace)
   so source mapping benefits from both signals.

## Linear input

Linear tickets are resolved by the `linear-ticket-investigator` agent, which reads the ticket via
Linear MCP, applies the project's domain navigator, and returns an Evidence Record. Invoke it via:

```text
Agent({
  subagent_type: "linear-ticket-investigator",
  description: "Investigate Linear ticket {ID}",
  prompt: "Extract evidence from Linear ticket {ID}. Return an Evidence Record (no analysis)."
})
```

Pass the returned Evidence Record forward to Phase 2 of `/fix-bug` like any other input. Do not
re-investigate; the investigator owns the ticket-reading step.

### Analyse any video attachment (before Phase 2)

The investigator cannot analyse videos (it has no `Bash` / `ffmpeg`) — it only flags them in the
Evidence Record's `Video evidence` field. `/fix-bug` runs on the main context and **does** have
`Bash`, so it owns the analysis:

1. Read the returned Evidence Record's `Video evidence` field.
2. If it is `Present`, run the video-analyser skill once per flagged video before continuing —
   pass the Linear ticket URL so the skill's own Linear resolution obtains an authenticated
   (pre-signed) download URL via MCP:

   ```text
   Skill("video-analyser", "<Linear ticket URL>")
   ```

   For a ticket with multiple distinct videos, re-invoke with each direct video URL from the
   `Video evidence` list.
3. Fold the structured video findings (errors, UI state, inferred reproduction steps) into the
   merged Evidence Record — append them to `Symptom`, `Sources`, and `Reproduction`. A screen
   recording usually carries the clearest reproduction steps available, so they take precedence
   over a vague free-text repro.
4. If `Video evidence` is `None`, skip this step silently.

If the `video-analyser` skill is not installed in the host project, note the un-analysed video URL
in the Evidence Record's `Sources` and continue — do not block resolution on it.

If the Linear MCP server is not configured, print this message and wait:

```text
Linear MCP is not configured. Open the ticket, copy the most useful evidence
(Dash0 link, stack trace, screenshot or video, code pointer) into this chat,
and I will continue.
```

## Code pointer

1. Read the file at the pointer.
2. Read at least 30 lines of context above and below the pointed line.
3. Read all callers via `Grep` over the workspace.
4. Capture the pointer, the function the line belongs to, and the immediate caller graph as the
   evidence record.

## Stack trace

1. For each frame, extract `<file>:<line>`. Filter out `node_modules`, vendored, and runtime frames
   unless the user explicitly asks for them — application frames are almost always where bugs live.
2. For each application frame, read the file region (10 lines above and below the frame's line).
3. Build a frame table:

   ```markdown
   | # | File | Line | Function | Application? | Notes |
   |---|------|------|----------|--------------|-------|
   | 0 | ...  | ...  | ...      | yes          | top-of-stack — start hypothesis here |
   ```

4. The top-of-stack application frame is the **starting** evidence. Holistic analysis (Phase 3 of
   the parent skill) walks both directions from it.

## Error message

1. Search the codebase for the literal error message. If it contains interpolations (e.g. `${...}`,
   `%s`, `{0}`), strip them before searching.
2. Locate the `throw` / `raise` / `panic` / `Err` site(s).
3. Treat the throw site as a synthetic stack-trace top-of-stack and follow the [Stack trace](#stack-trace)
   procedure from there.
4. If the message is too generic to locate (`"Failed"`, `"undefined"`, `"Error"`), do not guess.
   Return to Phase 0's clarifying questions and ask for stack-trace or telemetry.

## Multi-input merging

If the user provided more than one piece of evidence (e.g. a Dash0 link plus a stack trace), run
each procedure independently and then merge the results into a single Evidence Record before
handing off to Phase 2. Do not pick "the most authoritative" input and discard the rest — they are
usually complementary.

Merge rules:

- Affected-file tables: union, dedupe on `file:line`.
- Symptoms: concatenate, ordered by source (Dash0 first, then trace, then user-stated symptom).
- Reproduction: prefer Dash0 (it has real request IDs and user IDs) over the user's free text.
- Conflicts: surface them in the Evidence Record's "Notes" column rather than silently picking one.
