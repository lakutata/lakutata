#!/bin/sh
# The tests of the package in a Linux container: the package (its sources, dist built by the host) mounted read-only at
# /package, copied, its addon built, then the unit tests and the scripts given (test-env/linux/*.mjs) run as root.
#   docker run --rm --cap-add NET_ADMIN -v "$PWD":/package:ro -v "$PWD/../../node_modules/node-addon-api":/node-addon-api:ro \
#     node:24-alpine sh /package/test-env/linux/run.sh test-env/linux/events.mjs
set -e
if command -v apk >/dev/null; then
    apk add -q python3 make g++ linux-headers iproute2 >/dev/null
else
    apt-get update -qq >/dev/null && apt-get install -y -qq python3 make g++ iproute2 >/dev/null
fi
mkdir -p /work/node_modules
cp -r /package/binding.gyp /package/native /package/dist /package/package.json /package/test-env /work/
cp -r /node-addon-api /work/node_modules/node-addon-api
cd /work
npx -y node-gyp@11 rebuild -j max >/tmp/gyp.log 2>&1 || { tail -40 /tmp/gyp.log; exit 1; }
echo "== $(uname -r), node $(node --version), $(ldd --version 2>&1 | head -1)"
node --test --test-timeout=60000 "dist/esm/tests/**/*.spec.js" 2>&1 | grep -E '^ℹ (tests|pass|fail)|✖' || true
for script in "$@"; do
    echo "== $script"
    node "$script"
done
