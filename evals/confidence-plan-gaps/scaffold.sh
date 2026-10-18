#!/bin/bash
# Copy fixtures/ into the empty run workspace and commit them, so `git ls-files` resolves real paths.
set -euo pipefail
cp -R "$(cd "$(dirname "$0")" && pwd)/fixtures/." .
git init -q -b add-rate-limit
git add -A
git -c user.name=eval -c user.email=eval@example.invalid commit -qm "fixture"
