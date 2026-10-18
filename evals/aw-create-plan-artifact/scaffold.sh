#!/bin/bash
# Copy fixtures/ into the empty run workspace and commit them on branch `report-json`,
# so the skill's `git branch --show-current` resolves a real branch name.
set -euo pipefail
cp -R "$(cd "$(dirname "$0")" && pwd)/fixtures/." .
git init -q -b report-json
git add -A
git -c user.name=eval -c user.email=eval@example.invalid commit -qm "fixture"
