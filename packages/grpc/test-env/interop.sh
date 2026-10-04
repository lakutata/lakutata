#!/bin/sh
# The service actions over gRPC with the gRPC of the other implementations, in Docker: the official gRPC of Python
# (grpcio, its stubs generated from SERVICE_PROTO) and grpcurl (the gRPC of Go) call a service of lakutata on this
# machine (host.docker.internal).
#
#   test-env/interop.sh
set -u
cd "$(dirname "$0")/.."
WORK="$(mktemp -d)"
npm run compile >/dev/null || exit 1
node dist/esm/tests/interop/Server.js "$WORK/service.proto" > "$WORK/server.log" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; rm -rf "$WORK"' EXIT INT TERM
for attempt in $(seq 1 50); do
    grep -q '^listening' "$WORK/server.log" && break
    sleep 0.2
done
PORT=$(sed -n 's/^listening //p' "$WORK/server.log")
[ -n "$PORT" ] || { cat "$WORK/server.log"; exit 1; }
cp test-env/client.py "$WORK/"
FAILED=0

echo "== Python (grpcio)"
docker run --rm -v "$WORK:/work" python:3.12-slim sh -c "pip install -q --disable-pip-version-check --root-user-action=ignore grpcio grpcio-tools >/dev/null && python /work/client.py host.docker.internal:$PORT" || FAILED=1

echo "== Go (grpcurl)"
DATA=$(printf '{"cmd":"order.get","id":7}' | base64)
OUTPUT=$(docker run --rm -v "$WORK:/work" fullstorydev/grpcurl -plaintext -import-path /work -proto service.proto -H 'id: go-1' -d "{\"data\": \"$DATA\"}" "host.docker.internal:$PORT" lakutata.service.v1.Service/Invoke) || FAILED=1
PAYLOAD=$(printf '%s' "$OUTPUT" | sed -n 's/.*"payload": "\([^"]*\)".*/\1/p' | base64 -d 2>/dev/null)
if [ "$PAYLOAD" = '{"id":7,"client":"go-1"}' ]; then echo "ok    an action invoked by grpcurl"; else echo "FAIL  an action invoked by grpcurl: $OUTPUT"; FAILED=1; fi

[ "$FAILED" = 0 ] && echo "== interoperable with Python and Go" || { echo "== failed"; exit 1; }
