#!/bin/sh
# The client against OpenLDAP (osixia/openldap, the image the tests of ldapts and go-ldap use): the container on free
# ports of the loopback, its readiness checked with its own ldapsearch, the URLs given to the tests by environment
# variables; the container removed on exit. Build the package first (npm run compile).
#
#   sh test-env/openldap/run.sh [image]
set -eu
IMAGE="${1:-osixia/openldap:1.5.0}"
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
NAME="lakutata-ldap-openldap-$$"
cleanup() {
    docker rm -f -v "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM
docker run -d --name "$NAME" \
    -p 127.0.0.1::389 -p 127.0.0.1::636 \
    -e LDAP_ORGANISATION=Example -e LDAP_DOMAIN=example.com -e LDAP_ADMIN_PASSWORD=secret \
    -e LDAP_TLS_VERIFY_CLIENT=never \
    "$IMAGE" >/dev/null
for attempt in $(seq 1 60); do
    if docker exec "$NAME" ldapsearch -x -H ldap://localhost -b dc=example,dc=com -D cn=admin,dc=example,dc=com -w secret -s base >/dev/null 2>&1; then
        break
    fi
    if [ "$attempt" = 60 ]; then
        docker logs "$NAME" | tail -20
        echo "OpenLDAP did not start" >&2
        exit 1
    fi
    sleep 1
done
PLAIN="$(docker port "$NAME" 389/tcp | head -1 | sed 's/.*://')"
SECURE="$(docker port "$NAME" 636/tcp | head -1 | sed 's/.*://')"
cd "$DIR"
LDAP_TEST_URL="ldap://127.0.0.1:$PLAIN" \
LDAP_TEST_LDAPS_URL="ldaps://127.0.0.1:$SECURE" \
LDAP_TEST_BASE="dc=example,dc=com" \
LDAP_TEST_ADMIN="cn=admin,dc=example,dc=com" \
LDAP_TEST_PASSWORD="secret" \
LDAP_TEST_CONTAINER="$NAME" \
node --test --test-timeout=120000 dist/esm/tests/servers/*.spec.js
