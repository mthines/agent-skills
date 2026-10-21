# Step 6.2 — Attach screenshots and recordings

Loaded at Step 6.2 unless `--no-media` is in `$ARGUMENTS`.
Put the real files into the PR body; never a placeholder for a human to fill.
Skip when no file is selected below.

Select files in this order, stopping at **6 images and 2 videos**:

1. Every path passed with `--attach <file>` in `$ARGUMENTS`, in order.
2. Explicit `CAPTURE` screenshots from this branch's runs: `.agent/{branch}/.aw-tester/captures/*.png`, excluding `*-auto-*`.
3. Final-state auto-captures: `.agent/{branch}/.aw-tester/captures/*-auto-final.png`.
4. Recordings of passing specs: `.agent/{branch}/.aw-tester/recordings/spec-*.webm`.
5. Adversarial-pass screenshots from `ui-verify` (and `aw-verify`, which runs it): `.agent/{branch}/.ui-verify/adversarial/captures/*.png`.
6. Adversarial-pass recordings: `.agent/{branch}/.ui-verify/adversarial/recordings/*.webm`.

Rows 2–6 take only files newer than the merge base with the PR's own base branch, so a capture from an older branch with the same name is never shown:

```bash
PR_NUMBER=$(gh pr view --json number -q .number)
BASE_REF=$(gh pr view "$PR_NUMBER" --json baseRefName -q .baseRefName)
BASE=$(git merge-base "origin/$BASE_REF" HEAD 2>/dev/null)
if [ -z "$BASE" ]; then
  echo "none (merge base unresolved)"   # skip rows 2–6; record this for Step 10
else
  SINCE=$(git log -1 --format=%cI "$BASE")
  find ".agent/$BRANCH/.aw-tester/captures" ".agent/$BRANCH/.aw-tester/recordings" \
       ".agent/$BRANCH/.ui-verify/adversarial/captures" ".agent/$BRANCH/.ui-verify/adversarial/recordings" \
       \( -name '*.png' -o -name '*.webm' \) -newermt "$SINCE" 2>/dev/null | sort
fi
```

Apply each row's name pattern to that list, in row order.
When `BASE` is empty, skip rows 2–6 and record `none (merge base unresolved)` as the Step 10 `Media` line, unless row 1 supplied files.
Never run the `find` with an empty `SINCE`: it silently selects nothing, which reads as "no captures".

Use the capture's label as its alt text: `<file>#<label>`.
Then delegate:

```text
Skill("attach-media", "<pr-url> <file>#<alt> ... --to body")
```

`attach-media` owns the upload, the secret check, and the owned `<!-- attach-media:v1 -->` region.
Record its first report line for Step 10.
If it reports rung 3 (`not attached`), continue: the PR stays valid without media, and the report says so.
