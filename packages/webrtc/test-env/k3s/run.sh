#!/bin/sh
# The end-to-end test of a multi-instance deployment in k3s: a server and an agent of k3s in Docker (two nodes, the
# repository mounted read-only at /repo), NATS, the signaling on both nodes, a TURN server and a media server on the
# network of each (manifests.yaml), then a client (client.yaml) connecting two members through two pods and the TURN
# servers only, and two members through the media servers of the two nodes. The pods it names on the lines DELETE (the
# address of a pod of the signaling) and DELETE-POD (the name of a pod) are deleted; the test passes when its last line
# is RESULT ok. The containers, their volumes and the network are removed after it; the images node:24-alpine and
# nats:latest come from the Docker of the host, the ones of k3s itself (pause, coredns) are pulled by its nodes, through
# the mirror of the host's Docker if it has one.
set -u
cd "$(dirname "$0")/../.." || exit 1
REPO=$(cd ../.. && pwd)
npm run compile >/dev/null || exit 1
K3S_IMAGE="rancher/k3s:latest"
IMAGES="node:24-alpine nats:latest"
NETWORK="lk-webrtc-k3s"
SERVER="lk-webrtc-k3s-server"
AGENT="lk-webrtc-k3s-agent"
TOKEN="lk-webrtc-e2e"
CONFIG=""
cleanup() {
    docker rm -f -v "$SERVER" "$AGENT" >/dev/null 2>&1
    docker network rm "$NETWORK" >/dev/null 2>&1
    [ -n "$CONFIG" ] && rm -rf "$CONFIG"
}
trap cleanup EXIT INT TERM
cleanup
CONFIG=$(mktemp -d)
# The mirror of the host's Docker, for the images k3s pulls
MIRROR=$(docker info --format '{{range .RegistryConfig.Mirrors}}{{.}} {{end}}' | awk '{print $1}')
if [ -n "$MIRROR" ]; then
    printf 'mirrors:\n  docker.io:\n    endpoint:\n      - %s\n' "$MIRROR" > "$CONFIG/registries.yaml"
else
    printf 'mirrors: {}\n' > "$CONFIG/registries.yaml"
fi
docker network create "$NETWORK" >/dev/null || exit 1
for NODE in "$SERVER" "$AGENT"; do
    if [ "$NODE" = "$SERVER" ]; then
        ARGS="server --disable traefik --disable servicelb --disable metrics-server --disable local-storage"
        ENV="-e K3S_TOKEN=$TOKEN"
    else
        ARGS="agent"
        ENV="-e K3S_TOKEN=$TOKEN -e K3S_URL=https://$SERVER:6443"
    fi
    docker run -d --name "$NODE" --hostname "$NODE" --network "$NETWORK" --privileged --tmpfs /run --tmpfs /var/run \
        $ENV -v "$REPO:/repo:ro" -v "$CONFIG/registries.yaml:/etc/rancher/k3s/registries.yaml:ro" \
        "$K3S_IMAGE" $ARGS >/dev/null || exit 1
    # The agent joins once the server answers
    if [ "$NODE" = "$SERVER" ]; then
        for attempt in $(seq 1 120); do
            docker exec "$SERVER" kubectl get --raw /readyz >/dev/null 2>&1 && break
            sleep 1
        done
    fi
done
kubectl() {
    docker exec -i "$SERVER" kubectl "$@"
}
echo "Waiting for the nodes"
for attempt in $(seq 1 180); do
    [ "$(kubectl get nodes --no-headers 2>/dev/null | grep -c ' Ready')" = 2 ] && break
    sleep 1
done
kubectl get nodes -o wide
echo "Importing $IMAGES"
for NODE in "$SERVER" "$AGENT"; do
    docker save $IMAGES | docker exec -i "$NODE" ctr -n k8s.io images import - >/dev/null || exit 1
done
kubectl apply -f - < test-env/k3s/manifests.yaml || exit 1
for WORKLOAD in deployment/nats deployment/signaling daemonset/turn daemonset/sfu; do
    kubectl -n webrtc rollout status "$WORKLOAD" --timeout=600s || {
        kubectl get pods -A -o wide
        kubectl -n webrtc describe pods
        exit 1
    }
done
kubectl -n webrtc get pods -o wide
kubectl apply -f - < test-env/k3s/client.yaml || exit 1
# The client: the pods deleted when it asks, until its result
DELETED=""
DELETED_POD=""
RESULT=""
for attempt in $(seq 1 360); do
    LOGS=$(kubectl -n webrtc logs job/client 2>/dev/null)
    ADDRESS=$(printf '%s\n' "$LOGS" | sed -n 's/^DELETE //p' | head -1)
    if [ -n "$ADDRESS" ] && [ -z "$DELETED" ]; then
        DELETED=$(kubectl -n webrtc get pods -l app=signaling -o jsonpath='{range .items[*]}{.metadata.name} {.status.podIP}{"\n"}{end}' | awk -v ip="$ADDRESS" '$2 == ip {print $1}')
        echo "Deleting the pod $DELETED ($ADDRESS)"
        kubectl -n webrtc delete pod "$DELETED" --wait=false >/dev/null
    fi
    # A pod of the media servers, by its name
    POD=$(printf '%s\n' "$LOGS" | sed -n 's/^DELETE-POD //p' | head -1)
    if [ -n "$POD" ] && [ -z "$DELETED_POD" ]; then
        DELETED_POD="$POD"
        echo "Deleting the pod $POD"
        kubectl -n webrtc delete pod "$POD" --wait=false >/dev/null
    fi
    RESULT=$(printf '%s\n' "$LOGS" | sed -n 's/^RESULT //p' | tail -1)
    [ -n "$RESULT" ] && break
    sleep 1
done
echo "--- client"
printf '%s\n' "$LOGS"
if [ "$RESULT" != "ok" ]; then
    echo "--- pods"
    kubectl -n webrtc get pods -o wide
    for POD in $(kubectl -n webrtc get pods -o jsonpath='{.items[*].metadata.name}'); do
        echo "--- $POD"
        kubectl -n webrtc logs "$POD" --tail=40 2>&1
    done
    exit 1
fi
