# Research Sources

Citations for every claim and numeric threshold in this skill. Verified
2026-05. Replace any URL that returns a 404 before relying on a quote;
rules in this skill have been re-stated in our own words specifically so
that source rot does not invalidate the guidance itself.

## 1. README — Authoring Standards

| Source                                  | URL                                                                                                                       | Used for                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| GitHub Docs — About READMEs             | https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes | "What / why / how / where / who"; 500 KiB truncation; recognized locations |
| standard-readme spec                    | https://github.com/RichardLitt/standard-readme/blob/main/spec.md                                                          | Mandatory section order; ≤ 120-char short description; TOC > 100 lines; SPDX license |
| Make a README                           | https://www.makeareadme.com/                                                                                              | Suggested order; "show expected output"                 |
| awesome-readme                          | https://github.com/matiassingers/awesome-readme                                                                           | Pattern that distinguishes excellent READMEs            |
| dwyl/repo-badges                        | https://github.com/dwyl/repo-badges                                                                                       | Badge selection (signal vs. noise)                      |
| shields.io                              | https://github.com/badges/shields                                                                                         | Badge sources                                           |
| SPDX licenses                           | https://spdx.org/licenses/                                                                                                | License identifier list                                 |

## 2. `docs/` — Structural Frameworks

| Source                                  | URL                                                                                                                       | Used for                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Diátaxis (Daniele Procida)              | https://diataxis.fr/                                                                                                      | The four-quadrant framework                             |
| Diátaxis — Tutorials                    | https://diataxis.fr/tutorials/                                                                                            | Tutorial quadrant rules                                 |
| Diátaxis — How-to guides                | https://diataxis.fr/how-to-guides/                                                                                        | How-to quadrant rules                                   |
| Diátaxis — Reference                    | https://diataxis.fr/reference/                                                                                            | Reference quadrant rules                                |
| Diátaxis — Explanation                  | https://diataxis.fr/explanation/                                                                                          | Explanation quadrant rules                              |
| GitLab Docs Style Guide                 | https://docs.gitlab.com/development/documentation/styleguide/                                                              | Topic types (task / reference / concept); heading rules |
| Write the Docs                          | https://www.writethedocs.org/guide/                                                                                       | Community guidance                                      |

### Static site generators

| Tool          | URL                                       |
| ------------- | ----------------------------------------- |
| Docusaurus    | https://docusaurus.io/                    |
| Starlight     | https://starlight.astro.build/            |
| Nextra        | https://nextra.site/                      |
| MkDocs        | https://www.mkdocs.org/                   |
| VitePress     | https://vitepress.dev/                    |

## 3. Technical Writing — Voice and Style

| Source                                  | URL                                                                                       | Used for                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Google Developer Documentation Style    | https://developers.google.com/style                                                       | Active voice, second person, present tense              |
| Google Style — highlights               | https://developers.google.com/style/highlights                                            | Quick rules                                             |
| Microsoft Writing Style Guide — Top 10  | https://learn.microsoft.com/en-us/style-guide/top-10-tips-style-voice                     | Bigger ideas with fewer words; contractions; sentence case |
| plainlanguage.gov                       | https://www.plainlanguage.gov/                                                            | Grade 8 reading level target                            |
| 18F Content Guide                       | https://content-guide.18f.gov/                                                            | Paragraph length; "skip filler"                         |

## 4. Docs for AI Agents

| Source                                  | URL                                                                                                                       | Used for                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Anthropic — Claude Code memory          | https://code.claude.com/docs/en/memory                                                                                    | `CLAUDE.md` load order; 200-line guidance; `@imports`; specificity rule |
| agents.md                               | https://agents.md/                                                                                                        | The cross-tool open spec; nesting rules                 |
| Cursor — Rules                          | https://cursor.com/docs/rules                                                                                             | `.cursor/rules/*.mdc`; 500-line cap; activation modes   |
| Aider — Conventions                     | https://aider.chat/docs/usage/conventions.html                                                                            | `CONVENTIONS.md` pattern                                |
| GitBook — LLM-ready docs                | https://gitbook.com/docs/publishing-documentation/llm-ready-docs                                                          | The agent-readable docs pattern                         |

### Key Anthropic guidance — verbatim

From the Claude Code memory docs (re-stated in this skill as
"Specificity"):

> **Specific:** "Use 2-space indentation" not "Format code properly."
> **Specific:** "Run `npm test` before committing" not "Test your changes."
> **Specific:** "API handlers live in `src/api/handlers/`" not "Keep files organized."

## 5. Monorepo Patterns

| Source                                  | URL                                                                                       | Used for                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Turborepo — Structuring a repository    | https://turborepo.dev/docs/crafting-your-repository/structuring-a-repository              | `apps/` + `packages/` convention; per-package READMEs   |
| Nx                                      | https://nx.dev/                                                                           | Same pattern                                            |

## 6. Maintenance — Lint and Automation

| Source                                  | URL                                                                                                                       | Used for                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Vale                                    | https://vale.sh/                                                                                                          | Prose linter; pre-built Google / Microsoft style packs  |
| markdownlint                            | https://github.com/DavidAnson/markdownlint                                                                                | Structural linter                                       |
| alex                                    | https://github.com/get-alex/alex                                                                                          | Insensitive-language linter                             |
| lychee                                  | https://github.com/lycheeverse/lychee                                                                                     | Link checker                                            |
| Datadog — How we use Vale               | https://www.datadoghq.com/blog/engineering/how-we-use-vale-to-improve-our-documentation-editing-process/                  | Vale at scale                                           |
| Conventional Commits 1.0.0              | https://www.conventionalcommits.org/en/v1.0.0/                                                                            | Type-scope-subject format                               |
| release-please                          | https://github.com/googleapis/release-please                                                                              | Language-agnostic auto-CHANGELOG                        |
| semantic-release                        | https://github.com/semantic-release/semantic-release                                                                      | npm-coupled auto-CHANGELOG                              |

## 7. Drift — Empirical Evidence

| Source                                  | URL                                                                       | Used for                                                |
| --------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------- |
| GetDX — Developer Documentation Study (2025) | https://getdx.com/research/                                          | "2–3 months added to ramp"; "3–10 hours/week searching" |
| Fiberplane — Drift linter               | https://fiberplane.com/blog/drift-documentation-linter/                  | Tree-sitter + git anchoring approach                    |

## 8. Auto-Update Loop — Sources

Citations for the rules in [`rules/auto-update-loop.md`](../rules/auto-update-loop.md).

| Source                                  | URL                                                                                                                       | Used for                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Anthropic blog — Using CLAUDE.md files  | https://claude.com/blog/using-claude-md-files                                                                             | "Treat customization as an ongoing practice"; 200-line guidance |
| Eric Ma — Self-improving coding agents  | https://ericmjl.github.io/blog/2026/1/17/how-to-build-self-improving-coding-agents-part-1/                                | Reactive correction pattern; user-triggered persistence |
| Addy Osmani — Self-Improving Agents     | https://addyosmani.com/blog/self-improving-agents/                                                                        | AGENTS.md as semantic memory; Ralph Wiggum technique    |
| vercel/ai — AGENTS.md                   | https://github.com/vercel/ai/blob/main/AGENTS.md                                                                          | Reference structure with explicit "Do Not" section      |
| Cursor — Rules docs                     | https://cursor.com/docs/rules                                                                                             | Rule auto-creation by user request                      |
| Aider — Update docs example             | https://aider.chat/examples/update-docs.html                                                                              | Conversational doc-update flow                          |
| lychee link checker                     | https://lychee.cli.rs/                                                                                                    | Post-write link verification                            |
| lychee GitHub Action                    | https://github.com/marketplace/actions/lychee-broken-link-checker                                                         | CI integration                                          |
| Augment Code — Build your AGENTS.md     | https://www.augmentcode.com/guides/how-to-build-agents-md                                                                 | Modern AGENTS.md authoring patterns                     |
| paddo.dev — Path-specific rules         | https://paddo.dev/blog/claude-rules-path-specific-native/                                                                 | `paths:` frontmatter walkthrough                        |
| Substack — How Claude Code rules work   | https://joseparreogarcia.substack.com/p/how-claude-code-rules-actually-work                                               | Loading semantics                                       |

### Frontmatter compatibility — bug tracker entries

The `paths:` frontmatter has documented edge cases. Cite these when the
`globs:` fallback is invoked or when verifying load.

| Issue                                                                       | Symptom                                                          |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [claude-code#17204](https://github.com/anthropics/claude-code/issues/17204) | YAML-list `paths:` silently fails on some versions              |
| [claude-code#13905](https://github.com/anthropics/claude-code/issues/13905) | Quoted globs in `paths:` parse but don't match                  |
| [claude-code#16299](https://github.com/anthropics/claude-code/issues/16299) | Rules sometimes load globally regardless of `paths:`            |
| [claude-code#16853](https://github.com/anthropics/claude-code/issues/16853) | Path-scoped rules in subdirectories aren't always loaded        |
| [claude-code#23478](https://github.com/anthropics/claude-code/issues/23478) | Rules load on Read but not on Write                             |

## 9. Notes for Future Editors

- The diataxis.fr `/needs/` page returned a 404 at the time of this
  research. The four per-quadrant pages are the canonical replacement —
  link those directly.
- "Above the fold" for READMEs is folk convention from web design, not
  an entry in any formal GitHub spec — phrase it as a heuristic, not a
  rule.
- AGENTS.md is described in 2026 ecosystem write-ups as a "de facto
  convention", **not** an ISO/IETF standard — phrasing should reflect
  that.
- The strongest crossover finding across Anthropic, Cursor, Aider, and
  GitBook for agent-readable docs is: **prescriptive bullets, decision
  tables, code examples, and tight files (200–500 lines)**. Every rule
  in this skill encodes that pattern.
