---
type: llm
---

Ground truth: the page and data are correct (one token shown, one row), but `src/audit.mjs` queues audit events and a background flusher writes them to `data/audit/events.log` every 8 s. Nothing creates the `data/audit/` directory, so every flush fails and the app logs `level:"error"` `audit.flush.failed` (ENOENT) about 8 s after the request. That error violates AC-2 ("no error is recorded by the app"), and the audit events are lost.

PASS only if the reply (1) reports the `audit.flush.failed` error (or the ENOENT on `data/audit/events.log`) as observed in the app's log during the run, and (2) names the missing `data/audit/` directory, or the flusher in `src/audit.mjs`, as the cause.
FAIL if it does not report that error, if it only predicts it from reading the code, or if the verdict is WORKS.
