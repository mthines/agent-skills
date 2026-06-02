---
title: Shape Extraction — Deterministic JSON Fingerprints
impact: HIGH
tags:
  - shape
  - fingerprint
  - schema-inference
---

# Shape Extraction

Produce a deterministic structural fingerprint for any JSON document
so two documents with the same shape (regardless of values, key
order, or whitespace) hash to the same string. The algorithm is
implemented in [`scripts/shape.py`](../scripts/shape.py) — this rule
documents the contract so an agent can verify the script output by
hand for a small file.

## Contents

- Algorithm — the recursive walk and canonical emission rules.
- Optionality — when a key is required vs optional.
- Path notation — JSONPath-lite used in drift reports.
- Examples — a worked good case and a non-deterministic bad case.
- Decision flow — what to emit for the edge cases.
- Common mistakes — pitfalls and their fixes.

## Algorithm

1. Parse the file as JSON. JSONL files are split on `\n` and each
   non-empty line is a separate document.
2. Walk the parsed tree recursively. At each node:
   - **Object**: emit `{key1:T1, key2:T2, ...}` with **keys sorted
     alphabetically**.
   - **Array**: emit `[T]` where `T` is the union of element types.
     For a homogeneous array, `T` is a single type. For a
     heterogeneous array, `T` is `union(T1, T2, ...)` with members
     sorted alphabetically by their fingerprint string.
   - **Empty array**: `[]` (no element type — drift-detection treats
     `[]` as compatible with `[T]` for any `T`).
   - **Scalar**: `string`, `number`, `boolean`, or `null`.
3. Collapse adjacent identical types in a union.
4. Emit the fingerprint as a single canonical string.

## Optionality

A key is **optional** if it appears in some objects of the same
"position" but not others within a single document. Optionality is
detected during corpus-wide drift analysis, not per-file. For per-file
fingerprints, every key present is "required" — drift is detected by
comparing fingerprints across files.

## Path notation

When reporting drift, key paths use JSONPath-lite:

| Notation             | Meaning                                  |
| -------------------- | ---------------------------------------- |
| `thread.id`          | Object key under root                    |
| `messages[]`         | Each element of the `messages` array     |
| `messages[].role`    | The `role` key on every message          |
| `messages[0].id`     | A specific index (use sparingly)         |

## Examples

### Good — three messages, two shapes

```json
{
  "thread": { "id": "abc", "createdAt": "2026-01-01T00:00:00Z" },
  "messages": [
    { "id": "m1", "role": "human", "content": "hi" },
    { "id": "m2", "role": "assistant", "content": "hello", "cost": { "total": 0.01 } }
  ]
}
```

Fingerprint:

```
{messages:[union({content:string,id:string,role:string},{content:string,cost:{total:number},id:string,role:string})],thread:{createdAt:string,id:string}}
```

The `cost` field appears in only one message, so the union has two
members. Drift detection will flag `messages[].cost` as optional
once the corpus-wide analysis runs.

### Bad — non-deterministic shape (do not emit this)

```
{ thread: {id, createdAt}, messages: [...] }   // unsorted keys, lossy types
```

Keys must be sorted, types must be enumerable, no abbreviations.

## Decision flow

| Signal                                                | Action                                              |
| ----------------------------------------------------- | --------------------------------------------------- |
| Array contains objects of differing shape             | Emit `union(...)` element type                      |
| Same key appears with different types across files    | Optional **type drift** (HIGH severity in Phase 2)  |
| Empty array `[]`                                      | Emit `[]`; treat as compatible with any `[T]`       |
| `null` value for a normally-typed field               | Emit `null`; mark as nullable in drift report       |

## Common mistakes

- **Sorting array elements.** Arrays are ordered data. Only object
  keys are sorted. **Fix:** preserve array order; sort only `dict.items()`.
- **Including leaf string values in the fingerprint.** Then every
  thread id would be a different fingerprint. **Fix:** emit `string`,
  not the actual string.
- **Collapsing `null` into the type union too eagerly.** A field that
  is sometimes `null` and sometimes `string` is genuinely nullable —
  the report needs to surface that. **Fix:** keep `null` as a
  first-class type in the union, then report nullability separately.
