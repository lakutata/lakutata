#!/bin/sh
# The engine tests of @lakutata/containerd with versions of containerd, in Docker (privileged containers): a local
# BuildKit (its containerd worker) and a remote one (TCP) for the builds.
#
#   test-env/run.sh [--build] [version…]     versions: 1.6 (Debian 12), 1.7, 2.4 (all of them by default)
#
# --build builds the images again. The package is compiled first. The containers and the network are removed after.
set -u
cd "$(dirname "$0")/.."
PACKAGE="$(pwd)"
REPOSITORY="$(cd ../.. && pwd)"
BUILDKIT_IMAGE=moby/buildkit:v0.16.0
REBUILD=0
VERSIONS=""
for argument in "$@"; do
    case "$argument" in
        --build) REBUILD=1 ;;
        *) VERSIONS="$VERSIONS $argument" ;;
    esac
done
[ -n "$VERSIONS" ] || VERSIONS="1.6 1.7 2.4"

# The containerd and the runc of a version
versions() {
    case "$1" in
        1.6) echo "debian -" ;;
        1.7) echo "1.7.36 1.3.6" ;;
        2.4) echo "2.4.1 1.5.2" ;;
        *) echo "unknown version $1 (1.6, 1.7, 2.4)" >&2; return 1 ;;
    esac
}

cleanup() {
    docker rm -f -v lk-containerd lk-buildkit >/dev/null 2>&1
    docker network rm lk-net >/dev/null 2>&1
}
trap cleanup EXIT INT TERM

npm run compile >/dev/null || exit 1
cleanup
docker network create lk-net >/dev/null
docker run -d --privileged --name lk-buildkit --network lk-net "$BUILDKIT_IMAGE" --addr tcp://0.0.0.0:1234 >/dev/null || exit 1

FAILED=""
for version in $VERSIONS; do
    set -- $(versions "$version") || exit 1
    image="lakutata-test-containerd:$version"
    if [ "$REBUILD" = 1 ] || ! docker image inspect "$image" >/dev/null 2>&1; then
        echo "== building $image"
        docker build -q --build-arg "CONTAINERD_VERSION=$1" --build-arg "RUNC_VERSION=$2" -t "$image" test-env >/dev/null || exit 1
    fi
    echo "== containerd $version"
    docker rm -f -v lk-containerd >/dev/null 2>&1
    docker run -d --privileged --name lk-containerd --network lk-net -v /var/lib/containerd -v "$REPOSITORY:/repo" "$image" >/dev/null || exit 1
    sleep 3
    docker exec lk-containerd sh -c 'mount -t binfmt_misc binfmt_misc /proc/sys/fs/binfmt_misc 2>/dev/null; containerd --version; runc --version | head -1'
    # The buildkitd of the image of BuildKit, run with the containerd worker
    helper=$(docker create "$BUILDKIT_IMAGE") && docker cp "$helper:/usr/bin/buildkitd" - | docker cp - lk-containerd:/usr/local/bin/ && docker rm "$helper" >/dev/null
    docker exec -d lk-containerd sh -c 'mkdir -p /run/buildkit && buildkitd --oci-worker=false --containerd-worker=true --containerd-worker-addr /run/containerd/containerd.sock --addr unix:///run/buildkit/buildkitd.sock > /var/log/buildkitd.log 2>&1'
    sleep 3
    if ! docker exec lk-containerd sh -c 'cd /repo/packages/containerd && CONTAINERD_TEST=1 CONTAINERD_TEST_BUILDKIT=unix:///run/buildkit/buildkitd.sock,tcp://lk-buildkit:1234 node --test --test-concurrency=1 --test-reporter=dot dist/esm/tests/engine/*.spec.js'; then
        FAILED="$FAILED $version"
    fi
done

if [ -n "$FAILED" ]; then
    echo "== failed with containerd:$FAILED"
    exit 1
fi
echo "== passed with containerd:$VERSIONS"
