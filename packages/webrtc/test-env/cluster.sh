#!/bin/sh
# The transports of the cluster on their servers in Docker: NATS and Redis started on free ports of 127.0.0.1 (fixed
# ports: a test restarts the server, which keeps them), the tests of the cluster run on each, the containers removed
# after them.
#
#   test-env/cluster.sh          both servers
#   test-env/cluster.sh nats     NATS only
#   test-env/cluster.sh redis    Redis only
set -u
cd "$(dirname "$0")/.."
npm run compile >/dev/null || exit 1
ONLY="${1:-}"
NATS_IMAGE="nats:latest"
REDIS_IMAGE="redis:8-alpine"
CONTAINERS=""
cleanup() {
    [ -n "$CONTAINERS" ] && docker rm -f -v $CONTAINERS >/dev/null 2>&1
}
trap cleanup EXIT INT TERM
free_port() {
    node -e "const server = require('node:net').createServer().listen(0, '127.0.0.1', () => { console.log(server.address().port); server.close() })"
}
if [ -z "$ONLY" ] || [ "$ONLY" = nats ]; then
    NAME="lk-webrtc-nats"
    PORT=$(free_port)
    MONITOR=$(free_port)
    docker rm -f -v "$NAME" >/dev/null 2>&1
    docker run -d --name "$NAME" -p "127.0.0.1:$PORT:4222" -p "127.0.0.1:$MONITOR:8222" "$NATS_IMAGE" -m 8222 >/dev/null || exit 1
    CONTAINERS="$CONTAINERS $NAME"
    # The image has no shell: its monitoring port tells when it is ready
    for attempt in $(seq 1 60); do
        curl -sf "http://127.0.0.1:$MONITOR/healthz" >/dev/null 2>&1 && break
        sleep 1
    done
    export WEBRTC_TEST_NATS="nats://127.0.0.1:$PORT" WEBRTC_TEST_NATS_CONTAINER="$NAME"
fi
if [ -z "$ONLY" ] || [ "$ONLY" = redis ]; then
    NAME="lk-webrtc-redis"
    PORT=$(free_port)
    docker rm -f -v "$NAME" >/dev/null 2>&1
    docker run -d --name "$NAME" -p "127.0.0.1:$PORT:6379" "$REDIS_IMAGE" >/dev/null || exit 1
    CONTAINERS="$CONTAINERS $NAME"
    for attempt in $(seq 1 60); do
        docker exec "$NAME" redis-cli ping >/dev/null 2>&1 && break
        sleep 1
    done
    export WEBRTC_TEST_REDIS="redis://127.0.0.1:$PORT" WEBRTC_TEST_REDIS_CONTAINER="$NAME"
fi
node --test --test-concurrency=1 --test-timeout=180000 dist/esm/tests/servers/ClusterServers.spec.js
