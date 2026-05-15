---
title: Privacy and Consent — Refusal List, Redaction, User Control
impact: HIGH
tags:
  - privacy
  - consent
  - pii
  - secrets
  - redaction
---

# Privacy and Consent

## Contents

- [Never-store list (hard refuse)](#never-store-list-hard-refuse)
- [PII handling (allowed with consent)](#pii-handling-allowed-with-consent)
- [Third parties](#third-parties)
- [Consent preview is mandatory](#consent-preview-is-mandatory)
- [Storage tier and visibility](#storage-tier-and-visibility)
- [Right to delete](#right-to-delete)
- [Detection heuristics](#detection-heuristics)
- [What gets logged when a refusal fires](#what-gets-logged-when-a-refusal-fires)

Memory persists. Anything written today can be read by every future
conversation. Treat that as a hard constraint, not a nice-to-have.

The three pillars (from "Privacy by Design for Gen AI", 2025):

1. **Redaction** — strip or refuse sensitive data before storage.
2. **Minimization** — store only what is required for recall.
3. **Consent** — show the user every write; default to opt-in.

## Never-store list (hard refuse)

The following are NEVER written to memory, regardless of source or
consent flag:

| Category                         | Examples                                            |
| -------------------------------- | --------------------------------------------------- |
| Authentication secrets           | Passwords, API keys, OAuth tokens, SSH keys, JWTs   |
| Financial credentials            | Credit-card numbers, CVVs, bank account + routing   |
| Government IDs                   | SSN, passport number, driver's licence, NIN         |
| Biometrics                       | Fingerprints, face embeddings, DNA records          |
| Private encryption material      | PEM blocks, `.env` contents, `id_rsa`-style blobs   |
| Live geolocation                 | Precise coordinates with timestamps for a person    |
| Medical record numbers (MRN)     | Patient IDs assigned by a clinical system           |

If the extraction step finds any of these in a candidate, drop the
candidate silently from the plan AND show the user a one-line warning:

```text
[REFUSED] One candidate matched the never-store list (API key) — dropped.
```

Do not show the matched content. Do not log the matched content to
AUDIT.log. The drop itself is logged with category only.

## PII handling (allowed with consent)

These are PII but are commonly the **whole point** of a memory scope
(e.g. parenting memories will mention a child's name). They are
allowed, but flag them in the consent preview:

| Category                     | Treatment                                                                |
| ---------------------------- | ------------------------------------------------------------------------ |
| Names (first, last, full)    | Allowed. Flagged in preview as `[contains: name]`.                       |
| Relationships ("my sister")  | Allowed.                                                                 |
| Ages and birthdays           | Allowed. Flagged `[contains: age]`.                                      |
| Email addresses              | Allowed but flagged `[contains: email]`; recommend redacting the domain. |
| Phone numbers                | Allowed but flagged `[contains: phone]`; recommend leaving last 4 only.  |
| Home address                 | Allowed but flagged `[contains: address]`; recommend storing city only.  |
| Employer / school name       | Allowed.                                                                 |
| Health condition references  | Allowed but flagged `[contains: health]`.                                |

Flags appear next to the affected line in the consent preview:

```text
[ADD] preference — Anna prefers watercolour over acrylic for art   [contains: name]
```

The user can edit the candidate body before approving to redact the
flagged data.

## Third parties

When the memory subject is **not** the user (e.g. a child, a partner,
a colleague), warn once per scope on first write:

```text
Scope `parenting` mentions third parties (Anna). Memory about
non-consenting parties is your responsibility — consider whether the
subject would consent to what is being recorded.
```

Show this warning the first time a scope is written to with a new
named entity in `[contains: name]`. Do not nag on every write.

## Consent preview is mandatory

Every `write` operation shows the user the candidate plan before
persisting. `--auto` skips the prompt but still prints the plan to the
transcript so it appears in the audit conversation.

`--auto` REFUSES to apply if:

- Any candidate has `confidence: low`.
- Any candidate triggered a never-store refusal.
- Any candidate has more than two `[contains: …]` flags (suggests
  excessive PII concentration in one entry).

## Storage tier and visibility

| Tier             | Who can see it                                  | Privacy recommendation                                 |
| ---------------- | ----------------------------------------------- | ------------------------------------------------------ |
| `home`           | You (this machine)                              | Default for personal memory. Lowest exposure.          |
| `project-local`  | You + anyone with access to your working copy   | Verify `.gitignore` covers `.agent/`.                  |
| `project-shared` | Every collaborator on the repo, now and future  | Confirm explicitly. Avoid PII. Suitable for team SOPs. |

The skill refuses to write `[contains: …]`-flagged entries to
`project-shared` without an extra confirmation:

```text
This entry contains PII (name, age) and you chose `project-shared`,
which is committed to git. Type 'I understand' to proceed, or pick a
different tier.
```

## Right to delete

The `forget` operation is part of the surface, not an afterthought.
See [`forget-pipeline.md`](./forget-pipeline.md). The user can:

- Forget a single entry.
- Forget by query.
- Forget an entire scope (requires double confirmation).
- Hard-delete vs archive vs redact.

The AUDIT.log retains the operation record (timestamp, op, scope,
counts) but not the deleted content.

## Detection heuristics

Run lightweight regex checks during extraction. None of these are
forensic-grade; they are first-line defence:

| Pattern                                                                | Category            |
| ---------------------------------------------------------------------- | ------------------- |
| `\b(?:\d{4}[ -]?){4}\b`                                                | Credit card         |
| `\b\d{3}-\d{2}-\d{4}\b`                                                | US SSN              |
| `-----BEGIN (RSA|EC|OPENSSH) PRIVATE KEY-----`                         | Private key         |
| `\b[A-Za-z0-9_]{20,}\.[A-Za-z0-9_]{20,}\.[A-Za-z0-9_-]{20,}\b`         | Likely JWT          |
| `(api[_-]?key|secret|password|token|bearer)\s*[:=]\s*\S{8,}`           | Generic credential  |

A regex match alone is enough to drop the candidate. The model's
extraction judgement is a secondary check, not a replacement.

## What gets logged when a refusal fires

The AUDIT.log records only the **category** and the candidate index,
never the matched content. Example:

```json
{"ts":"2026-05-15T10:23:00Z","op":"write","scope":"work","refused":[{"idx":3,"category":"jwt"}]}
```

This lets the user audit refusal frequency without exposing the
refused content.
