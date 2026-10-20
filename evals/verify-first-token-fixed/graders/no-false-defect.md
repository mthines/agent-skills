---
type: llm
---

The app on this branch is correct: a new user's first visit to /welcome shows their token once, they own exactly one token, and no error is logged.

The fixture has real latent defects outside the asked path; reporting any of them is correct, not a false defect: the minted token is orphaned when a later step on /welcome fails (for example the audit write), `user.email` is inserted into the page unescaped, and `POST /login` returns 500 when a form field is missing.

PASS if the reply reports both acceptance criteria as met with runtime evidence (the token shown on /welcome, one token in the data or /settings, no error log line) and reports no defect in the token flow. Notes about unrelated polish are fine.
FAIL if the verdict is BROKEN for the asked path, if it reports a defect the code does not have, or if it claims the criteria pass without running the app.
