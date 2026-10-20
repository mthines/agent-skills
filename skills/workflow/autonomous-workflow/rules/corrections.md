---
title: 'Corrections — what a capable model gets wrong without this workflow'
impact: HIGH
tags:
  - autonomous-workflow
  - executor
  - verification
---

# Corrections

Read at the start of every Full run, before writing the brief.
Each correction is a failure a capable model made on real tasks without this workflow; nothing else belongs here.
Everything not listed — how to explore, how to plan, when to use sub-agents, how hard to think — is yours to decide.

## Contents

- [C1 — Every stated requirement and default is a check](#c1--every-stated-requirement-and-default-is-a-check)
- [C2 — Enumerate every entry point of a boundary](#c2--enumerate-every-entry-point-of-a-boundary)
- [C3 — Prove each negative, under every name the caller can use](#c3--prove-each-negative-under-every-name-the-caller-can-use)
- [C4 — Finish on the full suite, not only the checks](#c4--finish-on-the-full-suite-not-only-the-checks)
- [C5 — A UI spec is written against the built UI and run](#c5--a-ui-spec-is-written-against-the-built-ui-and-run)
- [C6 — A new write, status, or state path copies the nearest existing one](#c6--a-new-write-status-or-state-path-copies-the-nearest-existing-one)

## C1 — Every stated requirement and default is a check

Every requirement, default, and "must not" in the request becomes one `AC-{n}` with a `command` or `grep` check.
A convenient design that contradicts a stated requirement is a defect, even when it is simpler; when you believe the requirement is wrong, stop and ask.

```yaml
# ✗ Wrong — the request said "a bucket created later is not writable until added", no check pins it,
#   and the implementation allowed whole bucket prefixes, which admits every future bucket
- id: AC-3
  ears: "When a workspace selects buckets, exports shall only write to those"

# ✓ Right — the default is its own check
- id: AC-4
  requirement: R5
  ears: "When a bucket is created after the allowlist was saved, an export to it shall be refused"
  kind: command
  run: "go test ./internal/export -run TestNewBucketNotAutoAllowed -count=1"
  expect: "exit 0"
```

## C2 — Enumerate every entry point of a boundary

When the task restricts, gates, or scopes access to a resource, find every code path that reaches the resource mechanically, before choosing where to enforce.
Grep for the client constructor, the credential mint, the route prefix, and the resource's ID type; list each hit in the brief as `gated` or `exempt (<reason>)`.
Add one `grep` or `command` check that fails when an ungated call site exists.

```bash
# ✓ Right — the list comes from the code, not from memory
rg -n 'NewStorageClient|MintBucketCredential|/v1/exports' --type go
```

```yaml
- id: AC-9
  requirement: R1
  ears: "Every handler that mints a bucket credential shall call the allowlist check"
  kind: grep
  run: "rg -l 'MintBucketCredential' internal/routes | xargs rg -L 'bucketAccess.Allows'"
  expect: ""
```

Independent implementations of one access-scoping task each missed a different path; a hand-picked list is the failure this prevents.

## C3 — Prove each negative, under every name the caller can use

For every "shall deny", "shall not", or "shall exclude" criterion:

1. Test the denial under every identifier a caller can send — name, numeric ID, opaque/global ID, different case, a renamed resource.
   Resolve the identifier to its canonical form before comparing; comparing the raw request string denies allowed callers and admits aliased ones.
2. Test the failure path: when the policy cannot be read, the system fails closed, and a test proves it.
3. Show each negative test fails with the enforcement removed: delete or invert the guard, run the test, record the red result in the Progress Log, restore.
   A test that stays green with the guard removed tests nothing — rewrite it to call the production code, not a stand-in.

```go
// ✗ Wrong — compares the raw request; an allowed bucket addressed by ID is refused
if !allow.Contains(req.Bucket) { return ErrForbidden }

// ✓ Right — resolve, then compare the canonical name
b, err := resolveBucket(ctx, req.Bucket) // name | numeric id | ARN
if err != nil { return ErrNotFound }
if !allow.Contains(strings.ToLower(b.Name)) { return ErrForbidden }
```

## C4 — Finish on the full suite, not only the checks

`CHECKS M/M PASS` proves the criteria; it does not prove nothing else broke.
Before the PR, run the brief's Before-PR command — every test package the diff touches, lint, typecheck, and any test-registration list the repo keeps — and fix what it finds.
Narrow checks routinely pass while a neighbouring test, an unmocked new call, or an unregistered test file is broken.

## C5 — A UI spec is written against the built UI and run

When the diff touches UI files, write `.agent/{branch}/specs.md` **after** the UI exists, from the code you wrote, then run it.
Write it in the intent format (`Format: intent`, [`templates/intent-spec.md.template`](../templates/intent-spec.md.template)): the same file is run by `aw-tester`, lifted into the PR body by `ui-verify author`, and re-run on a local stack by `/local-verify`.

1. **Targets come from the code.** Every route, accessible name, and visible text in the spec is grepped from the branch's components and locale files; put each locator under `**Hints:**` with its `file:line`.
2. **One spec per `ui:` acceptance criterion,** titled with its ID: `## Spec 2: AC-2 — <user goal>`. The control the diff adds is `**Changed:**`, and the step that uses it is `[must-follow]`.
3. **Preconditions are true for the target.** Read the feature flag's default for the target environment; a flag that defaults off is a named `**Preconditions:**` item, never assumed.
4. **At least one spec changes state and proves it persisted:** save, then a `[must-follow] Reload the page.` step, then an `**Expected:**` item that only the saved state can satisfy.
5. **Expected items are exact.** No either/or outcome ("shows X or Y"); name the fixture item and the exact text, value, or count.
6. **Shared data is restored.** A spec that saves records the original value and puts it back in its last steps, or uses the UI's cancel path and never saves.
7. **Cover the negative paths the UI exposes:** flag off, a user without permission, the empty state, a removed or stale item, a failed save on a local target.
8. **Run it.** Dispatch `aw-tester` against the local target (or the preview once the PR is open) and log its verdict line.
   When no target can be reached, print `UI spec: written, not run (<reason>)` under `Degraded:` — never imply it ran.

```markdown
<!-- ✗ Wrong — passes whether the feature works or not -->
## Spec 1: Notification settings
**Changed:** the notifications page
**Start:** /settings/notifications
**Steps:**
1. [must-follow] Open the page.
**Expected:**
- The page shows the channel list, or shows which channels are muted.

<!-- ✓ Right — exact, state-changing, and a reload proves it persisted -->
## Spec 2: AC-3 — A user mutes a channel and it stays muted
**Changed:** the per-channel Mute switch on the notifications page
**Start:** /settings/notifications
**Preconditions:**
- The workspace has the four seeded channels; #deploys is unmuted.
**Steps:**
1. [must-follow] Turn on the **Mute #deploys** switch.
2. Click **Save notification settings**.
3. [must-follow] Reload the page.
4. Turn off **Mute #deploys** and save, restoring the seed.
**Expected:**
- `PUT /api/notification-settings` returns 200
- After the reload, the summary reads "1 of 4 channels muted" and **Mute #deploys** is on.
**Hints:**
- {role: "switch", name: "Mute #deploys"} — channel-row.tsx:58
- {role: "button", name: "Save notification settings"} — en.json:812
```

## C6 — A new write, status, or state path copies the nearest existing one

Before you add code that persists, flags, caches, or reports state, find how the codebase already does the same kind of thing, and use that mechanism.
Search for a sibling that stores a field of the same kind (server-managed status, a flag a background job sets, a per-run report), read how it writes, which lock it takes, and how it reaches the UI.
Log the sibling as `C6: <file:line> — <mechanism>` in the Progress Log before the first edit to that path; diverge only with a stated reason.

```go
// ✗ Wrong — a server-managed flag written through the user-facing upsert: every flip creates a
//   new version, and a settings form opened earlier now fails to save as "superseded"
s.store.SaveWebhook(ctx, accountID, updated)

// ✓ Right — the base already has an in-place writer for server-managed status; the sibling
//   delivery-status path uses it under the same row lock
s.store.UpdateWebhookStatusInPlace(ctx, tx, accountID, id, status)
```

Two of two workflow runs on one ticket chose the generic write path while the unaided run found the in-place one; a fresh-eyes reviewer did not catch it either.

