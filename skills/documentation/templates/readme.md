# README.md Template

A drop-in skeleton compliant with the
[standard-readme spec](https://github.com/RichardLitt/standard-readme/blob/main/spec.md).
Replace every `<placeholder>`. Drop optional sections (`Background`,
`API`, `Maintainers`, `Thanks`) when there is genuinely nothing to say.

The first viewport (~600 px) **must** carry: name, tagline, hero,
primary badges, install line.

---

```markdown
# <Project Name>

> <One-line description — ≤ 120 chars; matches package-manager description verbatim>

[![CI](https://github.com/<owner>/<repo>/actions/workflows/test.yml/badge.svg)](https://github.com/<owner>/<repo>/actions/workflows/test.yml)
[![npm](https://img.shields.io/npm/v/<package>.svg)](https://www.npmjs.com/package/<package>)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

![<Project Name> demo](./docs/img/demo.gif)

<Optional: one short paragraph that elaborates on the tagline. Skip if the tagline is already self-explanatory.>

## Table of Contents

<!-- Required only if README > 100 lines. Capture every H2 below. -->

- [Install](#install)
- [Usage](#usage)
- [API](#api)
- [Contributing](#contributing)
- [License](#license)

## Install

```bash
npm install <package>
# or
pnpm add <package>
# or
yarn add <package>
```

## Usage

```typescript
import { <thing> } from "<package>";

const result = <thing>("<example input>");
console.log(result);
// => <expected output>
```

<Optional: more examples. Show **expected output** alongside every code block.>

## API

<Optional: short API summary. Move long API reference to `docs/reference/api.md` and link here.>

For the full API reference, see [docs/reference/api.md](./docs/reference/api.md).

## Contributing

PRs welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the dev
environment setup, branch workflow, and PR conventions.

## License

MIT © <owner>
```

---

## Author Checklist

Before merging the README:

- [ ] First viewport carries name, tagline, hero, badges, install line.
- [ ] Tagline ≤ 120 chars.
- [ ] Badge count between 3 and 10.
- [ ] Every badge is signal (build, version, license, coverage),
      not noise (stars, "made with love").
- [ ] Usage examples show **expected output**.
- [ ] No marketing prose ("blazingly fast", "simply", "easily")
      without benchmarks.
- [ ] License is the final section and cites an SPDX identifier.
- [ ] Every relative link resolves.

## Variants

| Project type             | Adjustments                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| **CLI tool**             | Replace "Usage" code block with a `bash` block; add `# my-cli --help` output as evidence.  |
| **Library**              | Keep the template as-is.                                                                   |
| **Application / service** | Replace "Install" with **Quickstart** (`docker compose up` or `pnpm dev`); drop "API".     |
| **Monorepo root**        | Add a "Packages" table linking to each `packages/<pkg>/README.md`; drop "Install" specifics. |
