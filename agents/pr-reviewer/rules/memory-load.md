---
title: pr-reviewer — Step 1.0 LoreKit failure handling
impact: MEDIUM
tags:
  - pr-reviewer
  - memory
  - lorekit
---

# pr-reviewer — Step 1.0 LoreKit failure handling

Read only when a Step 1.0 `mcp__lorekit__memory_list` call throws, the tool is missing from the registry, or its schema lacks `view`.
The read itself, its four filters, and its counters are in [`pr-reviewer.md` § 1.0](../../pr-reviewer.md).

## When a LoreKit call fails

**Retry a transient failure before declaring `false`.** A thrown MCP error on the *first* `memory_list` call is far more often a momentary timeout/transport hiccup than a real outage, and treating that single blip as terminal is what makes the `Memories — not connected` line flap between otherwise-identical runs. So when the first call throws, retry it up to **2 more times** (3 attempts total) with a short backoff before setting `LOREKIT_CONNECTED=false`. A hard "tool unavailable" error (`No such tool available: mcp__lorekit__memory_list`) has **two causes that must not be treated alike** — conflating them is what makes a whole multi-round run capture nothing:

- **The tool is not in this agent's `tools:` grant.** Static for the run: no wait or retry can change it. Set `LOREKIT_CONNECTED=false` immediately and move on.
- **The MCP server has not connected *yet*.** An MCP server connects asynchronously and a harness may report it as "still connecting" while its tools are unregistered — so the same tool that is missing at Step 1.0 can be callable minutes later, in the same session. Do **not** settle `false` on this: first try to load the tool through whatever registry affordance the harness offers (in Claude Code, `ToolSearch` with `select:mcp__lorekit__memory_list`, which waits for a connecting server), and only if that also comes back empty treat the read as unavailable **for this step** — never for the run.

Distinguish them by whether the tool exists in the session's registry at all: absent from the tool list ⇒ grant problem; present-but-unregistered or reported as connecting ⇒ not connected yet.

**A `false` from the second cause is provisional, and every later memory step re-probes.** The write sites (Step 2.9c's relevance outcome, and Step 4c's state record) attempt their call regardless of what Step 1.0 concluded, because the earlier verdict is a fact about an earlier moment. This is the difference between a run that captures nothing and one that captures everything after the first few minutes. Any attempt returning without a tool error (even an empty list) is a success: stop retrying and set `LOREKIT_CONNECTED=true`.

## Without `view`

**`view` is a capability, not a guarantee — probe once, then commit.** It requires LoreKit
**≥ the release carrying lorekit#464**; older servers do not have it.

Bind `SUMMARY_VIEW` before the first call and never re-evaluate it mid-fan-out, so all four calls
and every later step agree on one answer:

- **`true`** — the live `mcp__lorekit__memory_list` schema lists `view`. Send `view="summary"` on
  all four calls. This is the default outcome on a current server.
- **`false`** — either failure shape below fired. The calls return full bodies.

The two failure shapes are handled differently, and neither may cost you `LOREKIT_CONNECTED`:

- **The tool's input schema does not list `view`.** Check the live `mcp__lorekit__memory_list`
  schema before the first call. If `view` is absent, set `SUMMARY_VIEW = false` and issue all four
  calls WITHOUT it. Do not send an unknown key to a strict-schema tool.
- **The call throws specifically because of `view`** (an unknown/unexpected-argument error naming
  it). Set `SUMMARY_VIEW = false`, retry that same call once without `view`, and carry on. This
  retry is **not** one of the three transport retries and a schema rejection is **never** evidence
  the backend is down — flipping `LOREKIT_CONNECTED` here would turn a missing optimisation into a
  total memory outage.

When `SUMMARY_VIEW` is `false` the four calls return full bodies, exactly as they did before this
pipeline existed. That is a cost regression, not a correctness one: skip Step 1.2d entirely (the
bodies are already in hand), and match at Step 1.2e against them directly.
