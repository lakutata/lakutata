#!/bin/sh
# The tests and the forwarding benchmark of the package on Linux, in a node:24-alpine container (Docker): the repository
# is mounted read-only at the same path, so the links of the workspace resolve. Compile first (npm run compile).
#   sh test-env/linux.sh [tests|bench|all]
# The tests with Chrome and ffmpeg are skipped there. On macOS and Windows, Docker runs Linux in a virtual machine: its
# numbers are those of that machine, not of a Linux server.
set -e
cd "$(dirname "$0")/.."
package=$(pwd)
repo=$(cd ../.. && pwd)
what=${1:-all}
image=node:24-alpine
run() {
    docker run --rm --name lakutata-webrtc-linux -v "$repo:$repo:ro" -w "$package" "$image" "$@"
}
docker image inspect "$image" > /dev/null 2>&1 || docker pull "$image"
echo "== Linux: $(run sh -c 'echo "$(uname -sr) $(uname -m), $(nproc) cores, node $(node -v)"')"
if [ "$what" = tests ] || [ "$what" = all ]; then
    echo "== tests"
    run node --test --test-timeout=120000 "dist/esm/tests/**/*.spec.js"
fi
if [ "$what" = bench ] || [ "$what" = all ]; then
    echo "== forwarding: one room of 4 publishers and 10 subscribers, in the main thread"
    run node test-env/bench/forward.mjs --sfu --publishers 4 --subscribers 10 --seconds 10
    echo "== forwarding: 4 rooms of 12 publishers and 10 subscribers, in the main thread, then in 4 worker threads"
    run node test-env/bench/forward.mjs --sfu --rooms 4 --publishers 12 --subscribers 10 --seconds 10
    run node test-env/bench/forward.mjs --sfu --rooms 4 --publishers 12 --subscribers 10 --workers 4 --seconds 10
fi
