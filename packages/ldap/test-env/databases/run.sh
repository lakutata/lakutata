#!/bin/sh
# The directory backend on PostgreSQL and MySQL in Docker: each database in a container on a free port of the loopback,
# its readiness checked with its own client, its URL given to the tests; the containers removed on exit. Build the
# package first (npm run compile).
#
#   sh test-env/databases/run.sh [postgres image] [mysql image]
set -eu
POSTGRES_IMAGE="${1:-postgres:16-alpine}"
MYSQL_IMAGE="${2:-mysql:8.4}"
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
POSTGRES="lakutata-ldap-postgres-$$"
MYSQL="lakutata-ldap-mysql-$$"
cleanup() {
    docker rm -f -v "$POSTGRES" "$MYSQL" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM
docker run -d --name "$POSTGRES" -p 127.0.0.1::5432 -e POSTGRES_PASSWORD=lakutata -e POSTGRES_DB=ldap "$POSTGRES_IMAGE" >/dev/null
docker run -d --name "$MYSQL" -p 127.0.0.1::3306 -e MYSQL_ROOT_PASSWORD=lakutata -e MYSQL_DATABASE=ldap "$MYSQL_IMAGE" >/dev/null
for attempt in $(seq 1 90); do
    if docker exec "$POSTGRES" pg_isready -U postgres -d ldap >/dev/null 2>&1 && docker exec "$MYSQL" mysql -uroot -plakutata -e 'SELECT 1' ldap >/dev/null 2>&1; then
        break
    fi
    if [ "$attempt" = 90 ]; then
        docker logs "$MYSQL" | tail -20
        echo "The databases did not start" >&2
        exit 1
    fi
    sleep 1
done
POSTGRES_PORT="$(docker port "$POSTGRES" 5432/tcp | head -1 | sed 's/.*://')"
MYSQL_PORT="$(docker port "$MYSQL" 3306/tcp | head -1 | sed 's/.*://')"
cd "$DIR"
LDAP_TEST_POSTGRES_URL="postgres://postgres:lakutata@127.0.0.1:$POSTGRES_PORT/ldap" \
LDAP_TEST_MYSQL_URL="mysql://root:lakutata@127.0.0.1:$MYSQL_PORT/ldap" \
node --test --test-timeout=300000 dist/esm/tests/servers/Databases.spec.js
