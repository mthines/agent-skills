---
title: Dependency finder — match usage against the version that shipped
impact: HIGH
tags:
  - pr-reviewer
  - dependencies
  - changelog
---

# Dependency finder

A dependency bump is the only kind of change where the breaking code is not in the diff.
The diff says `14.2.0 → 16.0.1`. What broke is in the upstream's changelog, and whether it matters is in this repo's usage sites.

This finder resolves all three: the **version that actually shipped**, the **documented breaks between them**, and the **places this repo calls the affected APIs**.

## Contents

- [Resolve the version from the lockfile](#resolve-the-version-from-the-lockfile)
- [The changelog ladder](#the-changelog-ladder)
- [Intersect with usage sites](#intersect-with-usage-sites)
- [Three outcomes, and never a fourth](#three-outcomes-and-never-a-fourth)
- [The withheld hypothesis](#the-withheld-hypothesis)
- [Transitive bumps](#transitive-bumps)
- [Scope by tier](#scope-by-tier)

---

## Resolve the version from the lockfile

`impact.json.dependencies[]` already carries this, computed from lockfile deltas rather than manifest ranges.

**Never read the version from the manifest.**

```text
❌ WRONG — package.json says "stripe": "^14.0.0" → assume 14.x
✅ RIGHT — package-lock.json base 14.2.0, head 16.0.1 → major, two majors of breaks to read
```

A manifest carries a range; the lockfile carries the version that ships.
The two disagree in both directions: a PR that widens a range to `^16` moves nothing until the lock updates, and a PR that touches no manifest at all can move a transitive dependency two majors.

A `0.x` minor is treated as `major` with `zerover: true`.
Pre-1.0 packages break on minors by convention, and the SemVer spec says so explicitly — reading `0.4 → 0.5` as a minor is how a breaking change arrives unreviewed.

## The changelog ladder

Try in order. Stop at the first that yields the notes for the whole range `(from, to]`.

1. **Registry metadata** — the npm/PyPI/crates registry API for the package, which often carries a changelog URL or the release body.
2. **GitHub releases** — `gh api repos/<upstream>/releases` filtered to the tags in range. This is usually the richest source, and it is the one that lists breaking changes under a heading.
3. **The repository's changelog file** — `CHANGELOG.md` at the tag, via the contents API.
4. **An anonymous shallow clone of the public upstream**, when the notes are only in git history.
5. **The installed package's own bundled changelog**, when `workspace.install: true` put it on disk.

Every rung is read-only and anonymous. **Never authenticate to a third-party registry**, and never run an upstream's install scripts to learn its version.

### A cross-owner `gh api` 401 is scoping, not breakage

**The injected `gh` credential is scoped to this PR's own repository, so `gh api` 401s on every OTHER owner** — the upstream whose releases rung 2 wants to read, a third-party action, a base image, or any pinned spec.
That 401 says the credential does not cover the target; it says nothing about whether the target is readable.
Never read it as "unverifiable", and never spend a retry on it.

Pivot to plain anonymous HTTP, which reaches any public repository regardless of credential scope:

- `webfetch` against `api.github.com` for releases, tags, and compare ranges.
- `webfetch` against `raw.githubusercontent.com` for a pinned ref's file contents (a `CHANGELOG.md` at a tag).

"`webfetch`" means the caller's HTTP-fetch capability — the `WebFetch` tool where the grant carries it, and an anonymous `curl -fsSL` through `Bash` where it does not.
Either is fine; the rung is defined by *anonymous HTTP to a public host*, not by which tool issues it.
What is never fine is retrying the `gh` call, or reporting the 401 as the target being unreachable.

Only after **both** the `gh` rung and the HTTP rung fail is the range genuinely unreachable, and then it takes the withheld form below — labelled `unverified (upstream unreachable)`, never asserted as confirmed.
On a dependency-bump PR this is the normal path, not an edge case: a release-notes claim about an upstream repository is a cross-owner target by definition.

When even HTTP is unreachable (a private registry, a rate limit, a network-restricted runner), substitute the four checks that need no access to the dependency's own repository — the manifest/lockfile diff itself, a vendored changelog if the repo carries one, this PR's own CI result, and a grep of this repo's usage sites against the new version's locally-visible type surface if the package ships types — and still label the release claim `unverified (upstream unreachable)`.

Extract, per version in range:

- **Breaking changes** — removed APIs, renamed exports, changed signatures, changed defaults, dropped runtime or platform support.
- **Deprecations** — still working, will not be.
- **Behavior changes that are not API changes** — a default timeout, a retry policy, an error type. These are the ones the changelog buries and the ones that break production quietly.

## Intersect with usage sites

`usage_sites[]` from the impact graph gives `{path, line, api}` per call.
For each documented break, ask whether **this repo** touches it.

```text
stripe 15.0.0 BREAKING: `charges.create` removed; use `paymentIntents.create`
usage_sites: src/billing/charge.ts:12 → stripe.charges.create
→ issue, anchored at src/billing/charge.ts:12, quoting the changelog line
```

The anchor is the **usage site**, never the lockfile.
A comment on `package-lock.json` line 4021 is unactionable; a comment on the call that breaks is a fix.

Quote the changelog line verbatim in the evidence.
A finding that says "stripe 16 removed this" is an assertion; one that quotes the upstream's own sentence is a citation, and the author can act on it without going to look.

## Three outcomes, and never a fourth

| Outcome | Output |
| --- | --- |
| A documented break intersects a usage site | `issue` at the usage site, changelog line quoted |
| The changelogs were read and nothing intersects | a **one-line report note**: "`stripe` 14 → 16: 6 usage sites checked against the v15 and v16 changelogs, none affected" |
| The upstream could not be reached | a **withheld hypothesis**, below |

There is no silent fourth outcome.
The failure this replaces is a lens that fired only when the diff touched a manifest, resolved no versions when it did, and produced nothing either way — so a major bump and no bump at all read identically in the report.

## The withheld hypothesis

When every rung of the ladder fails — a private registry, a network-restricted runner, an upstream that publishes no notes — say what you would have checked.

```markdown
suggestion: `internal-sdk` 3.1.0 → 4.0.0 is a major bump and its release notes were not
reachable from this runner. The 4 usage sites are `src/auth/session.ts:22`,
`…:41`, `src/api/mw.ts:9`, `src/api/mw.ts:57` — worth confirming against the upgrade
notes before merge. (unverified: upstream unreachable)
```

This is a `suggestion`, decorated `(unverified: <reason>)`, and it appears in the report's withheld section.
It is **never** an `issue`: nothing was verified, so nothing is claimed.

The alternative — silence — leaves the maintainer believing a major bump was checked.
Naming the usage sites is the part that makes it useful: the reviewer did the half of the work it could do, which is finding where the risk is concentrated.

## Transitive bumps

A transitive bump is not automatically less important than a direct one, and it is usually less visible.

| Situation | Treatment |
| --- | --- |
| Transitive, and the repo has **no** usage sites for it | one line in the report note, no finding. The consumer is the direct dependency's problem. |
| Transitive, and the repo **imports it directly anyway** (a common accident) | treat as direct. The lockfile is the truth, and the code imports it. |
| Transitive `major`, no usage sites, but the direct parent's range did not move | flag as a `question`: the parent re-resolved without declaring it, which is worth a maintainer's attention even when nothing here breaks. |

## Scope by tier

| Tier | Deltas examined |
| --- | --- |
| `deep` | every dependency delta in the PR |
| `standard` | the deltas in this push |
| `quick` | none |

Any `semver_delta == major` is itself a `deep` trigger ([`depth-routing.md`](./depth-routing.md)), so a major bump is never reviewed at `quick`.
