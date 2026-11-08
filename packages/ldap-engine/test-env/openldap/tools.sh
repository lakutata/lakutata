#!/bin/sh
# The server against the command line tools of OpenLDAP (ldapsearch, ldapadd, ldapmodify, ldapdelete, ldapmodrdn,
# ldapcompare, ldapwhoami, ldappasswd, ldapexop) of osixia/openldap: the server runs on this machine, the tools in a
# container reaching it as host.docker.internal, and in containers mounting its Unix socket; the containers removed on
# exit. Build the package first.
#
#   sh test-env/openldap/tools.sh [image]
set -eu
IMAGE="${1:-osixia/openldap:1.5.0}"
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
NAME="lakutata-ldap-tools-$$"
SOCKETS="$(mktemp -d)"
cleanup() {
    docker rm -f -v "$NAME" >/dev/null 2>&1 || true
    rm -rf "$SOCKETS"
}
trap cleanup EXIT INT TERM
docker run -d --name "$NAME" --add-host host.docker.internal:host-gateway --entrypoint sleep "$IMAGE" infinity >/dev/null
cd "$DIR"
LDAP_TOOLS_CONTAINER="$NAME" LDAP_TOOLS_SOCKETS="$SOCKETS" LDAP_TOOLS_IMAGE="$IMAGE" node --test --test-timeout=300000 dist/esm/tests/servers/OpenLDAPTools.spec.js
