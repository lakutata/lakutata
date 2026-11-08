#!/bin/sh
# SSSD against the server on this machine (its port the first argument): a Debian container with sssd-ldap, the NSS and
# PAM modules and pamtester, configured for rfc2307bis; it checks getent, id, the groups, a PAM authentication and the
# SSH keys. The container is removed on exit; the image (lakutata-ldap-sssd) stays for the next runs.
set -eu
PORT="$1"
NAME="lakutata-ldap-sssd-$$"
cleanup() {
    docker rm -f -v "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM
docker build -q -t lakutata-ldap-sssd - >/dev/null <<'DOCKERFILE'
FROM debian:bookworm-slim
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends sssd-ldap libnss-sss libpam-sss pamtester procps && rm -rf /var/lib/apt/lists/*
DOCKERFILE
docker run -d --name "$NAME" --add-host host.docker.internal:host-gateway --entrypoint sleep lakutata-ldap-sssd infinity >/dev/null
docker exec -i "$NAME" sh -c 'cat > /etc/sssd/sssd.conf && chmod 600 /etc/sssd/sssd.conf' <<CONF
[sssd]
services = nss, pam, ssh
domains = example

[domain/example]
id_provider = ldap
auth_provider = ldap
ldap_uri = ldap://host.docker.internal:$PORT
ldap_search_base = dc=example,dc=com
ldap_default_bind_dn = cn=admin,dc=example,dc=com
ldap_default_authtok = secret
ldap_schema = rfc2307bis
ldap_user_ssh_public_key = sshPublicKey
ldap_auth_disable_tls_never_use_in_production = true
cache_credentials = false
CONF
docker exec "$NAME" sh -c "sed -i 's/^passwd:.*/passwd: files sss/; s/^group:.*/group: files sss/' /etc/nsswitch.conf"
docker exec -d "$NAME" sssd -i
sleep 3
FAILED=0
check() {
    if [ "$2" = "$3" ]; then echo "ok    $1"; else echo "FAIL  $1: got [$2], expected [$3]"; FAILED=1; fi
}
check 'getent passwd alice' "$(docker exec "$NAME" getent passwd alice | cut -d: -f1,6,7)" 'alice:/home/alice:/bin/sh'
check 'the groups of alice' "$(docker exec "$NAME" id -Gn alice | tr ' ' '\n' | grep -c developers)" '1'
check 'getent group developers' "$(docker exec "$NAME" getent group developers | cut -d: -f3,4 | tr ',' '\n' | sort | tr '\n' ' ')" '20000:alice bob '
check 'carol is not a developer' "$(docker exec "$NAME" id -Gn carol | grep -c developers || true)" '0'
check 'PAM authentication with the password' "$(printf 'alice-password\n' | docker exec -i "$NAME" pamtester login alice authenticate 2>&1 | grep -c 'successfully authenticated' || true)" '1'
check 'PAM refuses a wrong password' "$(printf 'wrong\n' | docker exec -i "$NAME" pamtester login alice authenticate 2>&1 | grep -c 'successfully authenticated' || true)" '0'
check 'the SSH key of alice' "$(docker exec "$NAME" sss_ssh_authorizedkeys alice | cut -d' ' -f1,3)" 'ssh-ed25519 alice@example'
exit $FAILED
