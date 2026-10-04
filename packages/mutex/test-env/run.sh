#!/bin/sh
# The locks of the stores in Docker: Redis, PostgreSQL and MySQL started on free ports, the tests of the stores run with
# them, the containers removed after them.
#
#   test-env/run.sh
set -u
cd "$(dirname "$0")/.."
npm run compile >/dev/null || exit 1
cleanup() {
    docker rm -f -v lk-mutex-redis lk-mutex-postgres lk-mutex-mysql >/dev/null 2>&1
}
trap cleanup EXIT INT TERM
cleanup
docker run -d --name lk-mutex-redis -p 127.0.0.1::6379 redis:7-alpine >/dev/null || exit 1
docker run -d --name lk-mutex-postgres -p 127.0.0.1::5432 -e POSTGRES_PASSWORD=secret -e POSTGRES_DB=locks postgres:16-alpine >/dev/null || exit 1
docker run -d --name lk-mutex-mysql -p 127.0.0.1::3306 -e MYSQL_ROOT_PASSWORD=secret -e MYSQL_DATABASE=locks mysql:8.4 >/dev/null || exit 1
port() {
    docker port "$1" "$2" | head -1 | sed 's/.*://'
}
REDIS_PORT=$(port lk-mutex-redis 6379)
POSTGRES_PORT=$(port lk-mutex-postgres 5432)
MYSQL_PORT=$(port lk-mutex-mysql 3306)
echo "== waiting for the stores"
for attempt in $(seq 1 120); do
    docker exec lk-mutex-redis redis-cli ping >/dev/null 2>&1 \
        && docker exec lk-mutex-postgres pg_isready -U postgres -d locks >/dev/null 2>&1 \
        && docker exec lk-mutex-mysql mysql -uroot -psecret -e 'SELECT 1' locks >/dev/null 2>&1 \
        && break
    sleep 1
done
MUTEX_TEST_REDIS="redis://127.0.0.1:$REDIS_PORT" \
MUTEX_TEST_POSTGRES="postgres://postgres:secret@127.0.0.1:$POSTGRES_PORT/locks" \
MUTEX_TEST_MYSQL="mysql://root:secret@127.0.0.1:$MYSQL_PORT/locks" \
node --test --test-concurrency=1 --test-timeout=60000 dist/esm/tests/stores/*.spec.js
