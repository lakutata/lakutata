#!/bin/sh
# Gitea against the server on this machine (its port the first argument): an LDAP authentication source (bind DN, the
# administrators found by memberOf, the SSH keys, page size), then logins through the API of Gitea. The container is
# removed on exit.
set -eu
PORT="$1"
IMAGE="${2:-gitea/gitea:1.24.6}"
NAME="lakutata-ldap-gitea-$$"
cleanup() {
    docker rm -f -v "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM
docker run -d --name "$NAME" --add-host host.docker.internal:host-gateway -p 127.0.0.1::3000 \
    -e GITEA__security__INSTALL_LOCK=true -e GITEA__database__DB_TYPE=sqlite3 -e GITEA__service__DISABLE_REGISTRATION=true "$IMAGE" >/dev/null
HTTP="$(docker port "$NAME" 3000/tcp | head -1 | sed 's/.*://')"
for attempt in $(seq 1 60); do
    curl -sf "http://127.0.0.1:$HTTP/api/healthz" >/dev/null 2>&1 && break
    [ "$attempt" = 60 ] && { docker logs "$NAME" | tail -20; exit 1; }
    sleep 1
done
docker exec -u git "$NAME" gitea admin user create --username root --password root-password-1 --email root@example.com --admin --must-change-password=false >/dev/null
docker exec -u git "$NAME" gitea admin auth add-ldap --name directory --active --security-protocol unencrypted \
    --host host.docker.internal --port "$PORT" --bind-dn cn=admin,dc=example,dc=com --bind-password secret \
    --user-search-base ou=people,dc=example,dc=com --user-filter '(&(objectClass=inetOrgPerson)(uid=%s))' \
    --admin-filter '(memberOf=cn=developers,ou=groups,dc=example,dc=com)' \
    --username-attribute uid --firstname-attribute givenName --surname-attribute sn --email-attribute mail \
    --public-ssh-key-attribute sshPublicKey --synchronize-users --page-size 2 >/dev/null
FAILED=0
check() {
    if [ "$2" = "$3" ]; then echo "ok    $1"; else echo "FAIL  $1: got [$2], expected [$3]"; FAILED=1; fi
}
field() {
    sed -n "s/.*\"$1\":\\([^,}]*\\).*/\\1/p" | head -1
}
ALICE="$(curl -s -u alice:alice-password "http://127.0.0.1:$HTTP/api/v1/user")"
check 'alice logs in with her password' "$(printf '%s' "$ALICE" | field login)" '"alice"'
check 'alice is an administrator, by memberOf' "$(printf '%s' "$ALICE" | field is_admin)" 'true'
check 'the mail of alice' "$(printf '%s' "$ALICE" | field email)" '"alice@example.com"'
CAROL="$(curl -s -u carol:carol-password "http://127.0.0.1:$HTTP/api/v1/user")"
check 'carol logs in, not an administrator' "$(printf '%s' "$CAROL" | field is_admin)" 'false'
check 'a wrong password is refused' "$(curl -s -o /dev/null -w '%{http_code}' -u alice:wrong "http://127.0.0.1:$HTTP/api/v1/user")" '401'
check 'an unknown user is refused' "$(curl -s -o /dev/null -w '%{http_code}' -u nobody:x "http://127.0.0.1:$HTTP/api/v1/user")" '401'
docker exec -u git "$NAME" gitea admin user list 2>/dev/null >/dev/null
check 'the SSH key of alice' "$(curl -s -u root:root-password-1 "http://127.0.0.1:$HTTP/api/v1/users/alice/keys" | grep -o 'ssh-ed25519 [A-Za-z0-9+/=]*' | head -1 | cut -c1-23)" 'ssh-ed25519 AAAAC3NzaC1'
exit $FAILED
