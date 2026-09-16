# CI diagnosis — <branch>

Use only for the diagnostic path; keep at `.agent/{branch}/ci-auto-fix-plan.md`.
Update existing evidence rather than repeating the whole plan each iteration.

- Target: <repo / PR / branch / baseline SHA / run IDs and attempts>
- Failure groups: <workflow / job / matrix / step / signature; blocked jobs>
- Verdict and cause: <one per group; supporting and conflicting evidence>
- Proposed fix and scope: <files, affected consumers, preserved invariants>
- Verification: <local command/results, CI scope, local reproduction gaps>
- Lessons applied: <only if relevant memory was available>

## Attempt <N>

- Fix SHA / parent / pushed SHA: <exact commits, refreshed after rebase>
- Checks/results: <local and CI links, run attempts, remaining failures>
- Interpretation: <same / subset / exposed / unrelated / regression / unclear>
- Counters: <fix-push cycles / 4; infrastructure rerun used; completion windows / 6; registration attempts / 3 for this revision>
- Next action: <evidence needed, or reverted SHA and verified rollback outcome>
