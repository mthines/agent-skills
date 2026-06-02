# Writing Style

Three sources govern every word in every documentation surface:

1. **Google Developer Documentation Style Guide** — active voice, second
   person, present tense.
2. **Microsoft Writing Style Guide** — bigger ideas with fewer words.
3. **The agent-readable docs pattern** — prescriptive, decision-tabled,
   self-contained.

The first two are the canonical sources for technical writing. The third
is the additional discipline this skill enforces for any file an AI
agent reads.

## 1. Voice and Tense (Google + Microsoft)

| Rule                                            | Do                                                | Don't                                  |
| ----------------------------------------------- | ------------------------------------------------- | -------------------------------------- |
| **Active voice.**                               | "The function returns X."                          | "X is returned by the function."       |
| **Second person.**                              | "You can configure this in `settings.json`."       | "The user can configure…" / "We…"     |
| **Present tense.**                              | "The CLI accepts `--verbose`."                     | "The CLI will accept `--verbose`."     |
| **Verb-first imperatives in instructions.**     | "Run `pnpm test` before committing."               | "You should run pnpm test."            |
| **Conditions before instructions.**             | "Before you deploy, verify the configuration."     | "Deploy, then verify."                 |
| **Use contractions.**                           | "it's", "you'll", "we're", "let's"                | "it is", "you will", "we are"          |
| **Sentence-style capitalization in headings.**  | `## Run the tests`                                 | `## Run The Tests`                     |
| **Skip end punctuation on titles / short items.** | "Install" (header)                                | "Install."                             |
| **Oxford comma.**                               | "Android, iOS, and Windows"                        | "Android, iOS and Windows"             |
| **Start statements with a verb.**               | "Configure the API key."                           | "You can configure the API key."       |

## 2. Plain Language Rules

| Rule                                              | Source                  |
| ------------------------------------------------- | ----------------------- |
| Target **Grade 8** reading level for general docs | plainlanguage.gov       |
| Sentence average **≤ 20 words**                   | Hemingway heuristic     |
| Paragraphs **≤ 4 sentences**                      | 18F Content Guide       |
| **One idea per sentence**                         | Microsoft Top 10        |
| Avoid "obviously", "simply", "just", "easily"     | Apple-style content rule |

The "simply" rule is non-negotiable. Every "just" or "simply" in
documentation shames the reader. Remove them on sight.

## 3. The Agent-Readable Docs Pattern

The convergent finding across Anthropic, Cursor, Aider, and GitBook
guidance for LLM-readable documentation:

| Rule                                            | Example                                            |
| ----------------------------------------------- | -------------------------------------------------- |
| **Be prescriptive, not descriptive.**           | "Run `pnpm test:unit` before pushing." not "Tests are important." |
| **Decision tables and numbered lists** beat prose | Lookup tables are surfaced more reliably by LLMs.  |
| **Every actionable rule gets a code example.**  | Show both correct and incorrect patterns.          |
| **No subjective language.**                     | "≤ 200 lines" not "keep it short".                 |
| **Each file self-contained.**                   | Do not rely on cross-file context for a rule.      |
| **Predictable headings (H2 main, H3 sub).**     | LLMs anchor on heading structure.                  |
| **Reference files; do not copy them.**          | Cite `file.ts:42`; do not paste the code.          |

Anthropic's own guidance, verbatim from `CLAUDE.md` docs:

> "Use 2-space indentation" *not* "Format code properly."
> "Run `npm test` before committing" *not* "Test your changes."
> "API handlers live in `src/api/handlers/`" *not* "Keep files organized."

## 4. Punctuation and Typography

| Rule                                              | Detail                                |
| ------------------------------------------------- | ------------------------------------- |
| Oxford comma in every list                        | Always.                               |
| Em-dashes **without** surrounding spaces          | "Run the tests—then commit."          |
| One space after periods                           | Never two.                            |
| Backticks around every filename, command, flag    | `pnpm test`, `src/api/handler.ts`, `--verbose` |
| Code fences declare a language identifier         | ` ```bash`, ` ```typescript`          |
| End complete sentences with a period              | Including in bullet points.           |
| Bullets **without** end punctuation when **fragments** | "Atomic commits" not "Atomic commits."   |

## 5. Heading Hierarchy

| Rule                                              | Detail                                |
| ------------------------------------------------- | ------------------------------------- |
| One H1 per file (the title)                       | Never two.                            |
| H2–H5 with no level skipping                      | H2 → H4 is a defect.                  |
| Sentence-style capitalization                     | "Run the tests" not "Run The Tests".  |
| Use the title to set the topic; use H2s for major sections | Reader scans the H2 list as a TOC.    |
| Make headings task-oriented when possible         | "Install dependencies" not "Dependencies". |

## 6. Banned Words and Phrases

| Banned                | Why                                                   |
| --------------------- | ----------------------------------------------------- |
| "obviously"           | Implies the reader is dim. Often hides a real concept. |
| "simply", "just"      | Same. Also frequently inaccurate.                     |
| "easily"              | Marketing word with no evidence.                      |
| "blazingly fast"      | Marketing. Use a benchmark or drop the claim.         |
| "we", "I"             | Use "you" or imperative voice.                        |
| "please"              | Drop. Imperative is enough.                           |
| "best practice"       | Cite the source or drop. Otherwise just an assertion. |
| "robust", "scalable", "elegant" | Hollow without evidence. Show the property, do not claim it. |

## 7. Prose Rules (This Repo)

Inherited from the repo's CLAUDE.md and applied to every doc surface:

- **One sentence per line** (semantic line breaks). Diffs read cleanly.
- **Use inline Markdown links**, not reference-style.
- **Fence code with a language identifier.**
- **End sentences with full stops.**
- **Oxford comma.**

## 8. Tone — A Worked Example

| Bad                                                                                                       | Good                                                       |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| "This blazingly fast and robust library will easily help you simply build APIs that scale to any size."   | "Build typed REST APIs in TypeScript. 0 dependencies."     |
| "We recommend you should probably consider running the tests."                                            | "Run `pnpm test` before pushing."                          |
| "The function will return a value of type `User` once it has finished its execution."                     | "`getUser()` returns a `User`."                            |
| "Obviously, you'll want to configure the API key first."                                                  | "Set `API_KEY` in `.env` before running the dev server."   |

The Bad column averages 19 words. The Good column averages 6. Same
information; one third the cognitive load.

## 9. Edits Checklist (apply to every draft)

Before declaring a doc done, run this pass:

- [ ] Every sentence ≤ 20 words.
- [ ] No "simply", "just", "easily", "obviously".
- [ ] Every command in backticks.
- [ ] Every code block has a language identifier.
- [ ] Active voice throughout.
- [ ] Second person, never "we" or "the user".
- [ ] No marketing adjectives without benchmarks.
- [ ] Headings sentence-case.
- [ ] One H1 per file.

If two consecutive items fail, re-edit before continuing.
