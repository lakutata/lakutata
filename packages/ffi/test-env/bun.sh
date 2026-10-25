#!/bin/sh
# The tests in Bun: `bun test` runs the node:test specs, the compiled ones. Compile first (npm run compile).
set -e
cd "$(dirname "$0")/.."
find ./dist/esm/tests -name '*.spec.js' -print0 | xargs -0 bun test --timeout 120000
