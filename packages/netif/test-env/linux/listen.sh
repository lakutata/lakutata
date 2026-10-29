#!/bin/sh
# The listening on an interface of Linux, end to end (run on the host, with Docker): a server container on two networks
# (eth0 on netif-a, eth1 on netif-b, IPv4 and IPv6) listens on eth1 with listenOn(); clients on each network connect.
# Checked: the clients of eth1 are served; the ones of eth0 are refused, also when they send to the address of eth1
# through eth0; an address added to eth1 is served without a new listening; eth1 unplugged and plugged back is listened
# on again. Uses node:24-alpine; removes its containers and networks.
#   sh test-env/linux/listen.sh   (from packages/netif, after npm run build:js)
set -e
cd "$(dirname "$0")/../.."
PACKAGE="$PWD"
ADDON="$PWD/../../node_modules/node-addon-api"
IMAGE="${IMAGE:-node:24-alpine}"
cleanup() {
    docker rm -f netif-srv netif-ca netif-cb >/dev/null 2>&1 || true
    docker network rm netif-a netif-b >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup
docker network create --ipv6 --subnet 172.30.1.0/24 --subnet fd30:1::/64 netif-a >/dev/null
docker network create --ipv6 --subnet 172.30.2.0/24 --subnet fd30:2::/64 netif-b >/dev/null
docker run -d --name netif-srv --cap-add NET_ADMIN --network netif-a --ip 172.30.1.10 --ip6 fd30:1::10 \
    -v "$PACKAGE":/package:ro -v "$ADDON":/node-addon-api:ro "$IMAGE" sleep 1200 >/dev/null
docker network connect --ip 172.30.2.10 --ip6 fd30:2::10 netif-b netif-srv
docker run -d --name netif-ca --cap-add NET_ADMIN --network netif-a --ip 172.30.1.20 --ip6 fd30:1::20 "$IMAGE" sleep 1200 >/dev/null
docker run -d --name netif-cb --network netif-b --ip 172.30.2.20 --ip6 fd30:2::20 "$IMAGE" sleep 1200 >/dev/null
docker exec netif-ca sh -c 'ip route add 172.30.2.0/24 via 172.30.1.10 && ip -6 route add fd30:2::/64 via fd30:1::10'
docker exec -d netif-srv sh -c 'sh /package/test-env/linux/run.sh --no-tests test-env/linux/listen-server.mjs > /tmp/server.log 2>&1'
for attempt in $(seq 1 120); do
    docker exec netif-srv grep -q '^listening' /tmp/server.log 2>/dev/null && break
    sleep 1
done
FAILED=0
# get <client> <host> <expected>: the client asks http://host:8080/, the answer (or the error) compared; "unreachable"
# expects any error
get() {
    result=$(docker exec "$1" node -e "
        const host = process.argv[1]
        fetch('http://' + (host.includes(':') ? '[' + host + ']' : host) + ':8080/', {signal: AbortSignal.timeout(3000)})
            .then(response => response.text()).then(text => console.log(text))
            .catch(error => console.log(error.cause?.code ?? error.name))
    " "$2")
    if [ "$result" = "$3" ] || { [ "$3" = unreachable ] && [ "${result#via}" = "$result" ]; }; then
        echo "ok   $1 -> $2: $result"
    else
        echo "FAIL $1 -> $2: $result (expected $3)"
        FAILED=1
    fi
}
get netif-cb 172.30.2.10 'via 172.30.2.10'
get netif-cb fd30:2::10 'via fd30:2::10'
get netif-ca 172.30.1.10 ECONNREFUSED
get netif-ca fd30:1::10 ECONNREFUSED
get netif-ca 172.30.2.10 ECONNREFUSED
get netif-ca fd30:2::10 ECONNREFUSED
docker exec netif-srv ip addr add 172.30.2.11/24 dev eth1
sleep 1
get netif-cb 172.30.2.11 'via 172.30.2.11'
docker network disconnect netif-b netif-srv
sleep 2
get netif-cb 172.30.2.10 unreachable
docker network connect --ip 172.30.2.10 --ip6 fd30:2::10 netif-b netif-srv
sleep 3
get netif-cb 172.30.2.10 'via 172.30.2.10'
get netif-cb fd30:2::10 'via fd30:2::10'
echo '-- server'
docker exec netif-srv cat /tmp/server.log
exit $FAILED
