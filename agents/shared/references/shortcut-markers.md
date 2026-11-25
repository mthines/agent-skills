# Why shortcut markers exist

The smallest change that solves a task often has a ceiling: it holds for one process, for small inputs, or for today's caller count.
Without a record, that ceiling is invisible, and two things go wrong.

1. A reviewer flags the shortcut as a defect, and the author either adds the bigger version nobody needed or argues the point in a thread.
2. Nobody revisits the shortcut when the load grows, because nothing says what load it was built for.

A one-line comment that names the ceiling and the trigger fixes both.
The reviewer sees a decision with its bounds, and objects only when there is evidence that the load already crosses them.
The ledger turns every marker into a row someone can scan, so a deferral does not become permanent by being forgotten.

The form, `shortcut: <the limit>, <when to upgrade>`, and the ledger come from the [Ponytail](https://github.com/DietrichGebert/ponytail) skill, where they pair with a "smallest complete change" authoring rule.
The marker word is fixed so a plain `git grep` finds every marker; free-form `TODO` comments carry no ceiling and no trigger and cannot be told apart from forgotten notes.

A marker never covers validation at a trust boundary, data-loss handling, security, or accessibility.
Those cuts are defects at any load, so a marker on them is reported, not respected.
