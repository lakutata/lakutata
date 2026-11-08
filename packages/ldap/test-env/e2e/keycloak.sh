#!/bin/sh
# Keycloak against the server on this machine (its port the first argument): Keycloak in a container, the checks of
# keycloak.mjs through its admin API. The container is removed on exit.
set -eu
PORT="$1"
IMAGE="${2:-quay.io/keycloak/keycloak:26.0.7}"
NAME="lakutata-ldap-keycloak-$$"
DIR="$(cd "$(dirname "$0")" && pwd)"
cleanup() {
    docker rm -f -v "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM
docker run -d --name "$NAME" --add-host host.docker.internal:host-gateway -p 127.0.0.1::8080 \
    -e KC_BOOTSTRAP_ADMIN_USERNAME=admin -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin "$IMAGE" start-dev >/dev/null
HTTP="$(docker port "$NAME" 8080/tcp | head -1 | sed 's/.*://')"
node "$DIR/keycloak.mjs" "http://127.0.0.1:$HTTP" "$PORT"
