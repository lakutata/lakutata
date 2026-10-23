#!/bin/sh
# The tests in Bun: `bun test` runs the node:test specs, the compiled ones without those of the browsers (they test the
# browsers, not the runtime). Compile first (npm run compile). Four tests of the TURN refresh use the fake clock of the
# test shim, which reaches the imports of node:timers/promises only in Node.js: they fail in Bun.
set -e
cd "$(dirname "$0")/.."
find ./dist/esm/tests -name '*.spec.js' ! -name 'Browser*.spec.js' -print0 | xargs -0 bun test --timeout 120000
