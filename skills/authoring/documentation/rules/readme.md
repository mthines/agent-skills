# README.md Authoring

A README is read once by a human evaluating the project. That human is
making three decisions in the **first viewport** (~600 px of scroll):

1. **What is this?**
2. **Does it solve my problem?**
3. **Can I trust it?**

Every rule below derives from those three decisions plus the
[standard-readme spec](https://github.com/RichardLitt/standard-readme/blob/main/spec.md),
GitHub's official README guidance, and the curated patterns in
[awesome-readme](https://github.com/matiassingers/awesome-readme).

## 1. Mandatory Section Order

For a typical OSS library or app, sections appear in this order. Brackets
mark optional sections — drop when there is nothing to say.

```
# <Project Name>

[Banner]
[Badges]

<Short description — 1 line, ≤ 120 chars>

[Long description — 1 short paragraph]

[Table of Contents — required if README > 100 lines]

[Security]

[Background]

## Install

## Usage

[API]

[Maintainers]

[Thanks]

## Contributing

## License
```

Standard-readme rules:

- **Short description** is ≤ 120 chars, no blockquote prefix, and
  matches the package-manager + GitHub repo descriptions verbatim.
- **TOC** captures at least all H2s and is required only if README
  > 100 lines.
- **License** cites an [SPDX identifier](https://spdx.org/licenses/)
  and is the final section.

## 2. The Above-the-Fold Rule

The first viewport (~600 px in GitHub's web view) **must** answer "what
is this, does it solve my problem, can I trust it?" The mandatory
above-the-fold content:

| Element                          | Required | Note                                                |
| -------------------------------- | -------- | --------------------------------------------------- |
| Project name (H1)                | yes      | One line, no version numbers in the title           |
| One-line tagline                 | yes      | ≤ 120 chars; matches package description            |
| Hero visual or demo GIF          | strong recommendation | Drives 40-60% of conversion on OSS pages |
| Primary CTA badges (3-5)         | yes      | Build status, version, license at minimum           |
| One install line                 | yes      | Copy-pasteable                                      |

If a reader has to scroll to learn what the project is, the README has
already failed.

## 3. Badge Selection

**Cap: 5–10 badges.** Beyond that, badges become noise.

### Signal — keep

- CI build status (`actions/<workflow>`)
- Test coverage (Codecov, Coveralls)
- Package version (npm, PyPI, crates, etc.)
- License (SPDX)
- Language version minimum (e.g. "Node ≥ 20")
- Security / SAST status (Snyk, CodeQL)
- "All contributors" (`all-contributors`)

### Noise — drop

- "Made with love"
- Visitor counters
- Stars / forks (already visible in the GitHub UI)
- Every social link (LinkedIn, Twitter/X, Discord, …)
- Deprecated services (Travis CI badge on a GitHub Actions repo)

### Maintenance

Revisit badges monthly. A stale badge actively misleads — a green "build
passing" badge from a workflow that no longer runs is worse than no
badge at all.

## 4. Audit Rubric (use in `audit` and `readme` modes)

For each item, score PASS / WARN / FAIL with one line of evidence.

### 4.1 First impression (above the fold)

| Check                                                                   | Pass condition                                          |
| ----------------------------------------------------------------------- | ------------------------------------------------------- |
| Project name present as H1                                              | First line is `# <Name>`                                |
| Tagline ≤ 120 chars on line 2 or 3                                      | Measure                                                 |
| Hero visual or demo GIF or short code sample                            | Visible without scrolling                               |
| Primary CTA badges (3-5) present                                        | Build / version / license at minimum                    |
| One install line visible above the fold                                 | A copy-pasteable `npm install …` or equivalent          |

### 4.2 Structure (standard-readme)

| Check                                                                   | Pass condition                                          |
| ----------------------------------------------------------------------- | ------------------------------------------------------- |
| Sections appear in the order above                                      | Order check                                             |
| TOC present if README > 100 lines                                       | Conditional                                             |
| `## Install` exists                                                     | Section present                                         |
| `## Usage` exists with at least one example                             | Section present, code block present                     |
| `## Contributing` exists                                                | Section present (can link to `CONTRIBUTING.md`)         |
| `## License` is the final section and cites SPDX                        | Last H2 of the file                                     |

### 4.3 Content quality

| Check                                                                   | Pass condition                                          |
| ----------------------------------------------------------------------- | ------------------------------------------------------- |
| No marketing adjectives without benchmarks                              | No "blazingly fast", "simply", "easily"                 |
| Usage examples show expected output                                     | Each example block followed by what it prints           |
| Badges all in the 5–10 range                                            | Count badges                                            |
| Every badge represents signal (not noise)                               | See §3                                                  |
| Every relative link resolves                                            | Run a link checker                                      |
| Every image renders                                                     | Run a link checker on `<img>` tags                      |
| No API reference dump in the README itself                              | Long API tables / function lists go to `docs/reference/` |
| No content duplicated from `docs/` or `CLAUDE.md`                       | One owner per fact                                      |

### 4.4 Maintenance signals

| Check                                                                   | Pass condition                                          |
| ----------------------------------------------------------------------- | ------------------------------------------------------- |
| Install instructions reference the actual lockfile / package manager    | If `pnpm-lock.yaml` exists, README says `pnpm install` |
| Version badge points to the actual registry                             | npm badge for npm packages, etc.                        |
| `Maintainers` or `Authors` section is current                           | No "TODO: add maintainers"                              |
| `License` matches `LICENSE` file in repo                                | SPDX in README matches `LICENSE`                        |
| Min language version matches `engines` / `rust-toolchain` / etc.        | Cross-reference with actual project files               |

## 5. Anti-patterns

- **Wall of badges (>15).** Reads as desperation.
- **TOC on a 60-line README.** Scroll is faster than re-clicking.
- **Marketing prose ("blazingly fast", "simply", "easily") with no
  benchmark or citation.**
- **API reference dump.** Move to `docs/reference/`. Link from README.
- **User docs and contributor docs mixed in one section.** Separate them.
- **Broken images after a folder rename.** Use relative paths; CI
  link-check.
- **Absolute URLs to the same repo.** Use relative links — clones and
  forks still resolve.
- **README > 500 KiB.** GitHub truncates the rendered view. Move long
  content to `docs/` or a wiki.
- **`<details>` everywhere as a TOC substitute.** Renders poorly on
  mobile and in package-manager landing pages (npm, PyPI).

## 6. Length Guidance

| Project type             | Target README length            |
| ------------------------ | ------------------------------- |
| Small library / utility  | 50 – 150 lines                  |
| Application / CLI tool   | 100 – 300 lines                 |
| Monorepo root            | 150 – 400 lines (with per-package READMEs absorbing depth) |
| Framework / large OSS    | 200 – 500 lines (TOC mandatory) |

A 500+ line README without a `docs/` tree is almost always a `docs/`
tree waiting to happen.

## 7. Monorepo READMEs

The root README explains the **workspace as a whole**:

- What is published (and from which `packages/<pkg>/`)
- Where each app lives
- Monorepo-wide setup (one install command for everything)
- Tooling versions (Node, pnpm, Turbo, Nx, etc.)
- A one-line summary table linking to each package's own README

Each `packages/<pkg>/README.md` is treated like its own OSS project:
what *this package* does, its public API, install/usage if it is
independently published.

**Do not duplicate** install instructions across READMEs — link to root.

## 8. Worked Example — Above the Fold (Good)

```markdown
# wrangler

> The command-line interface for building, deploying, and managing Cloudflare Workers.

[![npm](https://img.shields.io/npm/v/wrangler.svg)](https://www.npmjs.com/package/wrangler)
[![CI](https://github.com/cloudflare/workers-sdk/actions/workflows/test.yml/badge.svg)](https://github.com/cloudflare/workers-sdk/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

![Wrangler demo](./docs/img/demo.gif)

## Install

```bash
npm install -g wrangler
```
```

That fragment answers all three above-the-fold questions in five lines
of source. Compare to a README that opens with "Welcome! This is the
official repository for the Cloudflare Workers CLI tool, which is part of
the broader Cloudflare developer platform…" — by the time the reader
has finished the paragraph, they could have run `npm install -g wrangler`.

## 9. Worked Example — Above the Fold (Bad)

```markdown
# Our Amazing Framework

Welcome to the documentation for our framework! We are excited to have you here.

This project was started in 2019 by a small team passionate about developer
experience. Over the years it has grown to support thousands of users and we
are proud of how robust, scalable, and elegant it has become…
```

Failure modes in five lines:

- No tagline — what *is* the framework?
- No badges — is the build passing?
- No install line — what do I run?
- Marketing prose ("amazing", "robust", "scalable", "elegant") with no
  evidence.
- History a reader does not need yet.

Rewrite:

```markdown
# Framework

> The TypeScript framework for building real-time multiplayer apps. 0 dependencies.

[badges]

```bash
npm install framework
```

![demo](./demo.gif)
```
