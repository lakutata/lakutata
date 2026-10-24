#!/bin/sh
# The interop tests with Pion (Go) and aiortc (Python), in Docker. The signaling, the TURN server and a member of this
# package run in a node:24-alpine container (the repository mounted read-only at the same path: compile first), the
# clients in golang:1-alpine and python:3.12-slim beside it, on a network of their own, so they reach each other
# directly. Four rounds: the member connecting directly, then through the TURN relay only (Pion through the relay only
# too); both again with the engines of its connections in worker threads. See server.mjs, pion/main.go and
# aiortc/client.py.
#   npm run compile && sh test-env/interop/run.sh
# The Go modules and the pip packages are kept in $INTEROP_CACHE (default: $TMPDIR/lakutata-webrtc-interop).
set -e
cd "$(dirname "$0")"
here=$(pwd)
package=$(cd ../.. && pwd)
repo=$(cd ../../../.. && pwd)
cache=${INTEROP_CACHE:-${TMPDIR:-/tmp}/lakutata-webrtc-interop}
network=lakutata-webrtc-interop
containers="lakutata-interop-node lakutata-interop-pion lakutata-interop-aiortc"
mkdir -p "$cache/go-mod" "$cache/go-build" "$cache/pip"

cleanup() {
    docker rm -f -v $containers > /dev/null 2>&1 || true
    docker network rm "$network" > /dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup
docker network create "$network" > /dev/null
failed=0
for mode in direct relay direct-threads relay-threads; do
    echo "== $mode"
    relay=""
    threads=""
    case $mode in relay*) relay="--relay" ;; esac
    case $mode in *-threads) threads="--threads" ;; esac
    docker run -d --name lakutata-interop-node --network "$network" -v "$repo:$repo:ro" -w "$package" node:24-alpine \
        node test-env/interop/server.mjs --expect pion,aiortc --service aiortc --timeout 240 $relay $threads > /dev/null
    waited=0
    until docker logs lakutata-interop-node 2>&1 | grep -q '"ready"'; do
        waited=$((waited + 1))
        [ $waited -gt 30 ] && break
        sleep 1
    done
    url=ws://lakutata-interop-node:3001/
    docker run -d --name lakutata-interop-pion --network "$network" -v "$here/pion:/src:ro" -v "$cache/go-mod:/go/pkg/mod" \
        -v "$cache/go-build:/root/.cache/go-build" -w /src golang:1-alpine \
        sh -c "go build -o /tmp/client . && /tmp/client $url ${relay:+relay}" > /dev/null
    docker run -d --name lakutata-interop-aiortc --network "$network" -v "$here/aiortc:/src:ro" -v "$cache/pip:/root/.cache/pip" \
        python:3.12-slim sh -c "pip install -q --root-user-action=ignore --disable-pip-version-check -r /src/requirements.txt && python /src/client.py $url" > /dev/null
    node=$(docker wait lakutata-interop-node)
    pion=$(docker wait lakutata-interop-pion)
    aiortc=$(docker wait lakutata-interop-aiortc)
    for container in $containers; do
        docker logs "$container" 2>&1 | sed "s/^/  [${container#lakutata-interop-}] /"
    done
    echo "== $mode: node $node, pion $pion, aiortc $aiortc"
    [ "$node$pion$aiortc" = 000 ] || failed=1
    docker rm -f -v $containers > /dev/null 2>&1
done
exit $failed
