#!/bin/sh
# The tests in Bun: `bun test` runs the node:test specs, the compiled ones. Build first (npm run compile).
set -e
cd "$(dirname "$0")/.."
find ./dist/esm/tests -maxdepth 1 -name '*.spec.js' -print0 | xargs -0 bun test --timeout 900000
