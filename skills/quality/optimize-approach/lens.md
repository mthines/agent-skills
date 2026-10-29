---
for: pr-reviewer
lens-version: 1
applies-to: always
auto: true
min-tier: deep
---

# Optimize approach — Review Lens

## Trigger

Every `deep` review (large, risky, or `--effort high` PRs), on any file; name it with `--with optimize-approach` to run it on a smaller review.
It judges the shape of the solution against the codebase it lands in, not its lines.
The always-on `quality` checklist already flags a duplicated helper, a pattern that differs from its neighbours, and a simpler approach in one hunk; this lens looks across the whole change.

## Checklist

- [ ] **Architecture fit:** the change respects the layering the repo already has: UI does not reach into persistence, a package does not import from an app, and a new cross-module call goes through the module's existing public entry point.
- [ ] **One way to do it:** a new mechanism (cache, queue, retry, auth check, feature flag, state store, HTTP client) does not sit beside an existing one that serves the same purpose; name the existing one by `path:line`.
- [ ] **New dependency:** a new package or service is not added for something an existing dependency or a few lines of code already do.
- [ ] **Complexity class:** no O(n²) loop, per-item query, or per-request recomputation where the data shape allows one pass, one batch, or one cached value.
- [ ] **Invariants by construction:** a rule the code keeps by hand at several call sites is not one a type, schema, or DB constraint could enforce once.
- [ ] **Concurrency shape:** the chosen shape does not invite a race (read-then-write without a lock or conditional write, fire-and-forget without ownership) that a different shape avoids.
- [ ] **Abstraction earns its keep:** a new class, interface, factory, or config knob has at least two real users in this diff or the codebase; one user means a plain function.

Raise an item only when the better approach is material (a namable win), grounded (two sentences with `file:line` you read), and worth switching to now.
Never raise taste, a rename, or a failure mode with no better shape: those belong to `quality` and `critical`.

## Severity hints

- **Must-fix**: a layering break that couples a package to an app or UI to persistence; a race the shape invites.
- **Should-fix**: a second mechanism beside an existing one; a needless dependency; a complexity-class win on a hot path.
- **Nice-to-have**: an abstraction with one user; an invariant a type could hold.
