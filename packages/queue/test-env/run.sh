#!/bin/sh
# The drivers of the queues on their servers in Docker: the oldest version supported and the newest of each server
# started on free ports, the conformance suite run on each, the containers removed after it.
#
#   test-env/run.sh            every server
#   test-env/run.sh redis      the Redis servers only
set -u
cd "$(dirname "$0")/.."
npm run compile >/dev/null || exit 1
ONLY="${1:-}"
REDIS_IMAGES="redis:5.0-alpine redis:6.2-alpine redis:8-alpine"
CONTAINERS=""
cleanup() {
    [ -n "$CONTAINERS" ] && docker rm -f -v $CONTAINERS >/dev/null 2>&1
}
trap cleanup EXIT INT TERM
port() {
    docker port "$1" "$2" | head -1 | sed 's/.*://'
}
STATUS=0
if [ -z "$ONLY" ] || [ "$ONLY" = redis ]; then
    URLS=""
    INDEX=0
    for IMAGE in $REDIS_IMAGES; do
        NAME="lk-queue-redis-$INDEX"
        docker rm -f -v "$NAME" >/dev/null 2>&1
        docker run -d --name "$NAME" -p 127.0.0.1::6379 "$IMAGE" >/dev/null || exit 1
        CONTAINERS="$CONTAINERS $NAME"
        for attempt in $(seq 1 60); do
            docker exec "$NAME" redis-cli ping >/dev/null 2>&1 && break
            sleep 1
        done
        URLS="$URLS${URLS:+,}redis://127.0.0.1:$(port "$NAME" 6379)"
        export "QUEUE_TEST_REDIS_NAME_$INDEX=$IMAGE"
        INDEX=$((INDEX + 1))
    done
    QUEUE_TEST_REDIS="$URLS" node --test --test-concurrency=1 --test-timeout=120000 dist/esm/tests/servers/Redis.spec.js || STATUS=1
fi
exit $STATUS
