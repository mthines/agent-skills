# `impact-graph` fixture

Two trees plus a PR file list, shaped so `build-impact-graph.mjs` has something real to
walk: a changed export with a **signature** change, a consumer reached by a relative
import, and a **major** lockfile bump with a usage site.

No test file lives here on purpose — covering-test detection is exercised by the
script's own `--self-test`, which builds its trees in a temp dir, so no `*.test.ts`
under `scripts/eval/fixtures/` can ever be picked up by a real test runner.

Used by L1 (`G34`) to exercise the script's CLI end to end — the self-test covers the
units, this covers the wiring (argument parsing, base-side reads, JSON shape).

`production.json` is the optional Dash0 exposure block (proposal § 4.8.2). L1 asserts
that adding it only ever RAISES the blast score, never lowers it.

Nothing here is a real repository; do not import from it.
