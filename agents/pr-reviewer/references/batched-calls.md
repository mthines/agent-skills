# Batched calls

The reviewer issues independent calls and mandatory reads in one message.
The invariant is the same reads, the same calls, and the same results in fewer turns.

## What is batched

| Batch | Calls | Why they are independent |
| --- | --- | --- |
| Step 1.0 memory lists | three `mcp__lorekit__memory_list` calls | each filters on its own scope and tag, and the merge happens after all three return |
| Step 1.2c searches | two `mcp__lorekit__memory_search` calls | each takes one loop tag and the same query, built before either is issued |
| Step 2 rule reads | `inline-pipeline.md` and `verify-and-render.md` | Step 2 always runs through 2.6b to 2.9b unless the zero-delta short-circuit skips it, so no path gains a read |

## Why a batch saves cost

Every model turn re-reads the whole session context, so a turn costs the same whether it carries one call or three.
Turns are the unit that adds up: the context is large and fixed, and the output of a call is small.
Folding independent calls into one turn removes whole re-reads without changing what any call returns.

## What stays the same

- The state-record read at Step 0.7 stays first and alone, because `prepare-review.mjs --state` needs its result.
- The lean-budget skip of the three lists, `repo::` precedence on a key collision, and the attribution filter are unchanged.
- Failure handling matches the sequence a batch replaces: the first list is retried until it returns, and each other list that threw is issued once more after it, per [`memory-load.md`](../rules/memory-load.md#when-a-lorekit-call-fails). A blip that fails the whole batch therefore loses no list.
- The `### 1.0` and `### 1.2c` bodies are untouched, so the retrieval-relevance suite that reads them has no changed rubric.

## What a batch does not do

It does not reduce the number of calls or the number of files read.
Dropping the ranked lists, which would remove calls, changes what the reviewer can recall; that needs the retrieval suite and is a separate decision.
