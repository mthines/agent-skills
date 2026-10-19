#!/bin/bash
# Copy this case's fixtures/ into the empty run workspace (the current directory).
set -euo pipefail
cp -R "$(cd "$(dirname "$0")" && pwd)/fixtures/." .
