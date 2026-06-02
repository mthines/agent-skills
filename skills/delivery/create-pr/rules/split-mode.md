# Split Mode (`--split`)

Detailed rule for the `--split` branch of `/create-pr`.
Loaded only when the user invokes split mode; default-mode users skip this file.

Use when the branch has accumulated several unrelated changes and a single PR would be hard to review.
The skill analyses the diff, proposes a small number of focused PRs, and after explicit user approval executes the split as dependency-ordered draft PRs.

## When to split (and when not to)

Split is worth it when **at least one** of these is true:

- 6+ conceptual bullets are needed under "What changed" in default mode
- The diff touches 3+ unrelated subsystems (auth, telemetry, UI, infra, ...)
- A natural refactor-then-feature ordering exists
- The body still exceeds 40 lines after trimming per Step 5

Don't split when:

- The change is one coherent idea, even if large (e.g. a single big migration)
- Splits would produce trivial PRs (< ~50 LOC each) — one slightly bigger PR beats five fragments
- File-level splits would break the build on intermediate PRs (verify with the user's quick check command before proposing)

## Step S1: Analyze the diff

Run in parallel:

```bash
git branch --show-current
git log main..HEAD --oneline
git diff main...HEAD --name-status
git diff main...HEAD --stat
git diff main...HEAD              # full diff — needed to classify each file
```

Read enough of the diff to classify every changed file by **conceptual concern**, not extension or directory.
Concerns are things like *refactor X*, *new feature Y*, *unrelated lint fixes*, *DB migration*, *test additions for pre-existing code*, *docs update*.

## Step S2: Group files into PRs

Target **2–4 PRs**.
Hard cap: 5.
Apply this priority order:

1. **Pre-requisite refactors first.** Code moves, renames, extractions — any change other PRs build on.
2. **Independent concerns next.** Each group should be reviewable standalone (modulo stacking).
3. **Tests with their code.** Don't put tests in a separate PR unless they cover *pre-existing* code (code that exists on `main` today, not code introduced in this branch).
4. **Docs and lint fixes** can be their own PR only if substantial; otherwise fold into the most related PR.

For each candidate group, ask: *could I write a coherent "Why" plus 2–4 "What changed" bullets for this?*
If the answer is no, the group is wrong — merge it with another or re-cut.

## Step S3: Detect dependencies

For each group, check whether its files depend on another group's files.
Coupling is broader than imports — walk **every** category before declaring a group independent:

- **Static imports / requires** of symbols introduced or modified elsewhere
- **Runtime / dynamic references** — string-keyed lookups, dependency injection, dynamic `import()`, `require(name)` from config
- **Config files** referencing code (routes, plugins, schema URIs, feature flags)
- **DB migrations / schema files** — ordering matters; later migrations assume earlier ones
- **Generated / derived artifacts** — codegen output, OpenAPI specs, lockfiles, snapshots
- **Shared test fixtures** or factories touched by another group
- **Stringly-typed cross-references** — CSS class names referenced from JSX, i18n keys, route tables, env var names

If any category matches, the dependent group must stack on top of the other.

Produce a dependency order (topological sort).
If cycles emerge, the groups are wrong — re-group until acyclic.

**File-level only.** A single file with changes belonging to two conceptual PRs cannot be split — assign it to one group (preferentially the lower one in the stack so the other can build on it) and note the compromise in the Step S4 rationale. Do not attempt hunk-level splits via `git add -p` / `git restore -p` — they produce diffs that don't match any commit a human would write.

## Step S4: Propose the split to the user

Render the proposal as a table:

| # | Title                              | Files | LOC | Stacks on |
| - | ---------------------------------- | ----- | --- | --------- |
| 1 | refactor: extract auth helpers     | 3     | 80  | —         |
| 2 | feat(auth): add 401 refresh        | 4     | 220 | PR #1     |
| 3 | docs: update auth README           | 1     | 30  | —         |

Below the table, write one short rationale line per PR (why this is a coherent unit, what risk it isolates).

**Stop and confirm.**
Do not execute until the user says go.
Offer three responses:

- `approve` — execute as proposed
- `modify <instructions>` — accept user adjustments (combine PRs, move files between groups, rename, drop a PR)
- `abort` — fall back to default mode (single PR) or exit

## Step S5: Execute the split

**Preflight — run once, before touching any branch:**

```bash
git status --porcelain                          # MUST be empty; abort if not
git fetch origin                                # refresh remote refs
git rev-parse HEAD                              # capture original branch SHA as <original-sha>
ORIGINAL_BRANCH=$(git branch --show-current)
```

- If `git status --porcelain` is non-empty (uncommitted changes or untracked files), **stop and ask the user to commit, stash, or clean**. Do not proceed.
- Pin `<parent-branch>` for the first PR to `origin/main` (not local `main`), so a stale local checkout cannot silently re-base on old code.
- Record `<original-sha>` — Step S7 needs it to restore the user's branch if the split is aborted partway.

For each PR in dependency order:

1. **Branch off the parent:**
   ```bash
   git checkout <parent-branch>          # origin/main for #1, or the previous split branch for stacked PRs
   git checkout -b <split-branch>        # required form: split/<original-branch>/<NN>-<kebab-title>
                                         # NN is zero-padded order (01, 02, ...); collision check below
   ```
   Before creating the branch, run `git rev-parse --verify <split-branch> 2>/dev/null` — if it resolves, the name collides. Append `-rerun-<short-sha>` and warn the user.
2. **Extract this PR's changes as a patch.** This must encode deletions, renames, and mode bits — plain `git checkout <ref> -- <file>` cannot represent any of those because the file may not exist at the source tip.
   ```bash
   git diff <parent-branch> <original-sha> -- <file1> <file2> ... \
     | git apply --index --3way
   ```
   - `--index` stages the result so the next commit captures it cleanly.
   - `--3way` falls back to a three-way merge if the patch context drifted (rare but possible if the parent moved). On conflict, `git apply --3way --reject` is **not** acceptable — stop and ask the user.
   - For pure-rename PRs (`R` rows in `git diff --name-status`), include **both** the old and new paths in the file list so the rename is captured as a rename, not as add+delete.
   - Dry-run first: `git diff <parent-branch> <original-sha> -- <files> | git apply --check`. If `--check` fails, the file-level split is wrong (a file's hunks depend on a sibling that's in another group) — stop, report which file(s) failed, and ask the user.
3. **Sanity check the result.** If the user has a quick build/lint/type command, run it. A failure here means a coupling category from Step S3 was missed — stop, report, and ask the user (do **not** silently pull in extra files to make it green).
4. **Commit** with a message that matches the proposed title.
5. **Push with explicit upstream and create the draft PR.** New branches have no tracking, so the default-mode `git push` will fail — use `-u`:
   ```bash
   git push -u origin HEAD
   gh pr create --draft --base <parent-branch> --title "..." --body "$(cat <<'EOF'
   <narrative description from default-mode Steps 2–5>
   EOF
   )"
   ```
   For stacked PRs, `<parent-branch>` is the previous split branch's name on origin — confirm it was pushed before creating PR N+1.
6. Record the PR URL and the branch name.
   If subsequent PRs stack on this one, use this branch as their parent in iteration N+1.

## Step S6: Watch CI bottom-up; rebase the stack after auto-fix

After all PRs are open, watch CI **from the bottom of the stack upward**:

```bash
# Independent PRs (no `Stacks on` in the proposal) — watch in parallel
# Stacked PRs — watch the bottom; only move up once it's green
gh pr checks <bottom-pr> --watch
```

Auto-fix per default-mode Steps 8–9 only on the bottom PR while the stack is still red.
**If the bottom PR receives an auto-fix commit, every stacked PR above it now points at a stale tip.** Rebase each upward PR onto the new bottom-PR head before watching it:

```bash
git checkout <stacked-branch>
git rebase <bottom-pr-branch>
git push --force-with-lease           # safe-force only; never plain --force
```

If a rebase produces conflicts, stop and ask the user — do not resolve unfamiliar conflicts to make the stack green.

## Step S7: Abort and rollback

If any step from preflight through Step S8 fails irrecoverably (patch conflict, sanity-check failure with no fix, user types `abort`, push rejected for non-trivial reason), **stop immediately and run the rollback**:

```bash
# 1. Show the user exactly what was created so they can audit
git branch --list 'split/<original-branch>/*'
gh pr list --head 'split/<original-branch>/*' --state open

# 2. Restore the user's original branch state
git checkout "$ORIGINAL_BRANCH"
git reset --hard <original-sha>       # only if the original branch was modified; verify first

# 3. Ask the user before deleting any pushed branches or closing draft PRs
#    (these are visible to teammates and may have already been linked)
```

Never delete a remote branch or close a draft PR without explicit user confirmation — they may have shared a link already.
Report the outcome with the list of branches and PRs in flight, so the user can finish the cleanup manually if they prefer.

## Step S8: Report

Output a stack diagram and the recommended merge order:

```
PR #1 (base: main):        <url> — refactor: extract auth helpers
  └── PR #2 (base: PR #1): <url> — feat(auth): add 401 refresh
PR #3 (base: main):        <url> — docs: update auth README

Recommended merge order: #1 → #2, then #3 (independent).
```

Leave the user to choose when to merge.
Do not mark any PR ready-for-review on their behalf.

## Split-mode hard rules

- **Never** push or open a PR before the user approves the Step S4 proposal table.
- **Never** modify production code to make a split clean — only re-grouping files is allowed.
- **Never** split a single logical commit across PRs unless the user explicitly asks.
- **Never** create more than 5 PRs in one run.
  If five focused groups isn't enough, the original branch was sprawling enough to need human judgment, not mechanical splitting — stop and report.
- **Never** start the split with a dirty working tree.
  Preflight fails closed; the user must commit, stash, or clean before proceeding.
- **Never** use `git checkout <ref> -- <files>` to extract a PR's changes — it silently loses deletions and corrupts renames. Always use `git diff <parent> <original-sha> -- <files> | git apply --index --3way`.
- **Never** swallow a sanity-check failure (Step S5.3) or a `git apply --check` failure (Step S5.2) by silently pulling extra files into the PR — surface it.
- **Never** force-push to a stacked branch with plain `--force`. Use `--force-with-lease` so a colleague's concurrent push isn't overwritten.
- **Never** delete a pushed split branch or close a draft split PR during rollback (Step S7) without explicit user confirmation.
