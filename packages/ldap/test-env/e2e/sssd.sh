#!/bin/sh
# SSSD against the server on this machine (its port the first argument, its Unix socket in LDAP_SOCKET): a Debian
# container with sssd-ldap, the NSS and PAM modules and pamtester, configured for rfc2307bis; it checks getent, id, the
# groups, a PAM authentication and the SSH keys, over the port and over the socket (ldapi, SSSD 2.9 and later), where
# SSSD sends the password without TLS and without ldap_auth_disable_tls_never_use_in_production. StartTLS is turned off
# (on by default since SSSD 2.10): the server has no certificate. The containers are removed on exit; the image
# (lakutata-ldap-sssd) stays for the next runs.
set -eu
PORT="$1"
SOCKET="${LDAP_SOCKET:-}"
NAME="lakutata-ldap-sssd-$$"
cleanup() {
    docker rm -f -v "$NAME-port" "$NAME-socket" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM
docker build -q -t lakutata-ldap-sssd - >/dev/null <<'DOCKERFILE'
FROM debian:trixie-slim
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends sssd-ldap libnss-sss libpam-sss pamtester procps && rm -rf /var/lib/apt/lists/*
DOCKERFILE
FAILED=0
check() {
    if [ "$2" = "$3" ]; then echo "ok    $1"; else echo "FAIL  $1: got [$2], expected [$3]"; FAILED=1; fi
}
# The checks in a container of SSSD on a URI, the options given added to its domain
# $1: what the run is called and its container's suffix, $2: the URI, $3: the more options, then the options of docker run
checks() {
    RUN="$1"
    URI="$2"
    MORE="$3"
    shift 3
    CONTAINER="$NAME-$RUN"
    docker run -d --name "$CONTAINER" "$@" --entrypoint sleep lakutata-ldap-sssd infinity >/dev/null
    docker exec -i "$CONTAINER" sh -c 'cat > /etc/sssd/sssd.conf && chmod 600 /etc/sssd/sssd.conf' <<CONF
[sssd]
services = nss, pam, ssh
domains = example

[domain/example]
id_provider = ldap
auth_provider = ldap
ldap_uri = $URI
ldap_search_base = dc=example,dc=com
ldap_default_bind_dn = cn=admin,dc=example,dc=com
ldap_default_authtok = secret
ldap_schema = rfc2307bis
ldap_user_ssh_public_key = sshPublicKey
ldap_id_use_start_tls = false
cache_credentials = false
$MORE
CONF
    docker exec "$CONTAINER" sh -c "sed -i 's/^passwd:.*/passwd: files sss/; s/^group:.*/group: files sss/' /etc/nsswitch.conf"
    docker exec -d "$CONTAINER" sssd -i
    sleep 3
    check "$RUN: getent passwd alice" "$(docker exec "$CONTAINER" getent passwd alice | cut -d: -f1,6,7)" 'alice:/home/alice:/bin/sh'
    check "$RUN: the groups of alice" "$(docker exec "$CONTAINER" id -Gn alice 2>/dev/null | tr ' ' '\n' | grep -c developers)" '1'
    check "$RUN: getent group developers" "$(docker exec "$CONTAINER" getent group developers | cut -d: -f3,4 | tr ',' '\n' | sort | tr '\n' ' ')" '20000:alice bob '
    check "$RUN: carol is not a developer" "$(docker exec "$CONTAINER" id -Gn carol 2>/dev/null | grep -c developers || true)" '0'
    check "$RUN: PAM authentication with the password" "$(printf 'alice-password\n' | docker exec -i "$CONTAINER" pamtester login alice authenticate 2>&1 | grep -c 'successfully authenticated' || true)" '1'
    check "$RUN: PAM refuses a wrong password" "$(printf 'wrong\n' | docker exec -i "$CONTAINER" pamtester login alice authenticate 2>&1 | grep -c 'successfully authenticated' || true)" '0'
    check "$RUN: the SSH key of alice" "$(docker exec "$CONTAINER" sss_ssh_authorizedkeys alice | cut -d' ' -f1,3)" 'ssh-ed25519 alice@example'
    docker rm -f -v "$CONTAINER" >/dev/null 2>&1 || true
}
checks port "ldap://host.docker.internal:$PORT" 'ldap_auth_disable_tls_never_use_in_production = true' --add-host host.docker.internal:host-gateway
if [ -n "$SOCKET" ]; then
    checks socket 'ldapi://%2Frun%2Fldapi' '' -v "$SOCKET:/run/ldapi"
fi
exit $FAILED
