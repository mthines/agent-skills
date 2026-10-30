# Why one PR is applied in this context

A sub-agent earns its dispatch when the work runs in parallel, or when it needs a fresh context it can throw away afterwards.
Applying one PR's pack meets neither.
The calling context has already fetched every comment, read the code around it, and run `/critical` and `/confidence` on each `apply` entry.
A lone worker starts cold, re-reads the pack and the same files, and hands back a summary the caller then has to trust, with no parallelism gained.

Applying is not judging.
The judgment already happened in Phase 4, its evidence is in the pack, and the worker contract forbids re-scoring it, so the context that ran the gates loses no independence by also making the edits.
`review-loop`'s local mode applies its findings in the loop's own context on the same reasoning (`review-loop`'s `rules/local-mode.md`, § Sub-step B).

Two or more PRs keep one worker each: they apply in parallel, and each worker's context holds only its own PR, which the caller then discards.

The one-commit-per-comment, full-check-before-push, and resolve-after-push rules are the contract either way; only who carries them out changes.
