#!/bin/sh
# The end-to-end checks of the LDAPServer component with the directory backend: SSSD, Gitea and Keycloak against the
# server of server.mjs on this machine, on its port, SSSD on its Unix socket too. Build the package first (npm run
# compile).
#
#   sh test-env/e2e/run.sh [sssd] [gitea] [keycloak]
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
SOCKET="$WORK/ldapi"
node "$DIR/server.mjs" "$WORK/directory.sqlite" "$SOCKET" > "$WORK/server.log" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; rm -rf "$WORK"' EXIT INT TERM
for attempt in $(seq 1 50); do
    grep -q '^listening' "$WORK/server.log" && break
    sleep 0.2
done
PORT="$(sed -n 's/^listening //p' "$WORK/server.log")"
[ -n "$PORT" ] || { cat "$WORK/server.log"; exit 1; }
CHECKS="${*:-sssd gitea keycloak}"
FAILED=0
for check in $CHECKS; do
    echo "== $check"
    LDAP_SOCKET="$SOCKET" sh "$DIR/$check.sh" "$PORT" || FAILED=1
done
exit $FAILED
