---
title: Shrink Policy — What is Safe to Truncate
impact: MEDIUM
tags:
  - shrink
  - truncation
  - token-economics
---

# Shrink Policy

`shrink` mode truncates oversized string fields to keep fixture files
under a token budget. Pure shape-preserving work — every truncation
must leave the document valid JSON with identical keys, identical
types, and identical structure. Implementation lives in
[`scripts/shrink.py`](../scripts/shrink.py).

## Contents

- What is shrinkable — the three conditions a string must satisfy.
- Protected key names — the never-truncate list and `*Id$` regex.
- Strings that look parseable — URL / JSON / base64 / PEM heuristics.
- Truncation form — the marker and its idempotency guarantee.
- Decision flow — full lookup table for each string field.
- Common mistakes — pitfalls and their fixes.

## What is shrinkable

A string field is **shrinkable** when all of:

1. Its length exceeds `--max-string` (default `200` characters).
2. Its key name is **not** on the protected list (see below).
3. Its value is **not** something a consumer parses (no leading `{`,
   `[`, valid base64, valid URL, or recognisable JSON-in-string).

If a string fails any check, leave it untouched.

## Protected key names

These keys must never be truncated even if oversized. Truncation
breaks downstream lookups, deduplication, or auth flows.

| Key pattern         | Why protected                                    |
| ------------------- | ------------------------------------------------ |
| `id` / `*Id$`       | Identifier; fixture cross-references depend on it |
| `hash`              | Content hash; truncation breaks idempotency      |
| `actionId`          | Workflow correlation key                         |
| `threadId`          | Thread linkage                                   |
| `userId`            | Auth subject                                     |
| `panelId`           | Dashboard linkage                                |
| `dashboardId`       | Dashboard linkage                                |
| `traceId`, `spanId` | Telemetry correlation                            |
| `sessionId`         | Session linkage                                  |
| `key`               | Map key in `dimensions`-style arrays             |
| `type`              | Discriminated-union tag                          |
| `role`              | Conversation role                                |
| `name`              | Often the human-readable label                   |
| `version`           | Schema or library version                        |

Add to this list rather than removing from it. False negatives
(leaving a long field intact) are vastly preferable to false
positives (corrupting an id).

## Strings that look parseable

Run these heuristics before truncating. If any match, skip the field.

| Heuristic                                                  | Likely class                       |
| ---------------------------------------------------------- | ---------------------------------- |
| Starts with `{` and ends with `}` (after trim)             | JSON-in-string                     |
| Starts with `[` and ends with `]` (after trim)             | JSON-in-string                     |
| Matches `^https?://`                                       | URL                                |
| Matches `^[A-Za-z0-9+/]{40,}={0,2}$`                       | Base64                             |
| Starts with `-----BEGIN`                                   | PEM block                          |
| Contains `\n\n` and no spaces in the first 80 chars        | Probably structured (stack trace)  |

When a URL is the offender (e.g. the long `originUrl` in agent0
mocks), use the URL-shortening form: keep `scheme://host/path` and
collapse the query string to `?…(truncated, N chars)`.

## Truncation form

When a field is shrinkable and exceeds the threshold:

```
"<first N chars>…(truncated, was M chars)"
```

Where `N = max(40, max-string - 40)`. The trailing `…(truncated, was
M chars)` makes the truncation visible to a human reader and
reversible-on-paper (the original size is preserved).

## Idempotency

A field already containing `…(truncated, was N chars)` is
**already-shrunk**. The script must detect this marker and leave the
field alone — running `shrink` twice with the same threshold is a
no-op.

## Decision flow

| Signal                                                         | Action                                |
| -------------------------------------------------------------- | ------------------------------------- |
| String length ≤ threshold                                      | Leave alone                           |
| Key on protected list                                          | Leave alone                           |
| Heuristic match (URL, JSON-in-string, base64, PEM)             | Leave alone (URL gets special form)   |
| Already contains the truncation marker                         | Leave alone (idempotent)              |
| None of the above + length > threshold                         | Truncate with the marker              |

## Common mistakes

- **Truncating a `*Id` field because it was long.** Some ids exceed
  100 chars (compound keys). **Fix:** always check the key name
  before the length.
- **Truncating mid-multibyte.** Python strings index by code point
  so this is safe in Python 3, but if porting to another language,
  truncate on character boundaries, not byte boundaries.
- **Forgetting the marker.** Without `…(truncated, was N chars)` a
  re-run will further-truncate the truncated form. **Fix:** always
  emit the marker; always detect it on re-run.
- **Shrinking values that downstream code parses.** A stringified
  JSON blob inside `args` or `content` may be re-parsed by tests.
  **Fix:** run the parseable-string heuristics first.
