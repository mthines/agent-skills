# Call-Graph Map — Optional Accelerator

Mechanically seed the execution map ([Phase 1 Step 1a](../SKILL.md#phase-1-full-execution-path-walkthrough)) and the caller/callee tracing ([Context Gathering](../SKILL.md#context-gathering) steps 2 and 9) when a call-graph CLI is available, instead of tracing imports and call sites by hand.

This is an **optional accelerator**.
When no call-graph CLI is on the `PATH`, skip this rule entirely and use the manual Explore + grep trace.
The analysis is identical either way — only the speed of building the map differs.

## When to use

Use it when:

- You are building the entry-to-exit execution map for a complex, multi-file flow.
- You need every caller or callee of a changed or suspect function.
- You are in a large repository or monorepo where manual import tracing is slow.

Skip it for a single-file flow or a trivial one-to-two-hop trace — reading the code directly is faster than invoking a tool.

## Step 1: Detect

Check whether a call-graph CLI is available.
The reference tool is [`codexray`](https://github.com/mthines/codexray), which resolves call graphs accurately for Go, Python, and TypeScript/JavaScript.

```bash
command -v codexray >/dev/null 2>&1 && echo available || echo absent
```

If it reports `absent`, stop here and fall back to the manual trace.

## Step 2: Generate the map

Give the tool the entry function and its file as the root, and pick a direction.

```bash
# transitive callees of an entry point (what it calls) — seeds the execution map
codexray --project-root . --call-graph chain \
  --call-graph-function <fn> --call-graph-file <path> --call-graph-depth 3 --format toon

# direct callees / callers of one function
codexray --project-root . --call-graph callees --call-graph-function <fn> --format toon
codexray --project-root . --call-graph callers --call-graph-function <fn> --format toon
```

Use `chain` to seed the execution map for Phase 1 Step 1a, and `callers` for Context Gathering step 2 (find every call site).
`--format toon` keeps the output compact.

## Step 3: Interpret

The output is a **skeleton** — nodes and edges with `file:line` anchors, not behavior.
Use it to:

- Order the steps of the execution map (Phase 1 Step 1a).
- Jump straight to each caller and callee instead of grepping for them.

Then read each function body in full (Context Gathering step 10).
The map tells you *where* to look, never *what* the code does.

## Step 4: Fall back when the map is thin

Treat the map as a lead, never as ground truth.
Fall back to the manual trace for anything it cannot resolve:

- **`callee_count: 0` or "not found"** — the tool could not resolve that function; trace it by hand.
  Never conclude "this function calls nothing" from an empty result.
- **Dynamic dispatch** — interfaces, dependency injection, callbacks, and event emitters are resolved conservatively or not at all; follow them manually.
- **Runtime path** — the map is static structure (every *reachable* call), not the path a specific input took.
  For a specific failing input, prefer a runtime trace (telemetry, a stack trace, or a debugger) and use the static map only for the surrounding surface.

## Anti-patterns

- Do NOT block the analysis on the tool: if it errors, is slow, or is absent, fall back immediately.
- Do NOT trust an empty or single-edge result as fact — verify by reading the code.
- Do NOT skip reading the bodies because the map "looks complete." The map is an index, not the analysis.
