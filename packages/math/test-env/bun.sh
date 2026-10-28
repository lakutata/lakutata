#!/bin/sh
# The tests in Bun: `bun test` runs the node:test specs, the compiled ones, with the addon built by Node.js (Bun does
# not run the install script). Build first (npm run build:native, npm run build:js).
set -e
cd "$(dirname "$0")/.."
find ./dist/esm/tests -name '*.spec.js' -print0 | xargs -0 bun test --timeout 900000
