#!/bin/sh
# The drivers of the queues on their servers in Docker: the oldest version supported and the newest of each server
# started on free ports, the conformance suite run on each, the containers removed after it.
#
#   test-env/run.sh            every server
#   test-env/run.sh redis      the Redis servers only
#   test-env/run.sh nats       the NATS servers only
#   test-env/run.sh rabbitmq   the RabbitMQ servers only
#   test-env/run.sh kafka      the Kafka brokers only (on the ports 19092 and 19093: a broker tells its address)
set -u
cd "$(dirname "$0")/.."
npm run compile >/dev/null || exit 1
ONLY="${1:-}"
REDIS_IMAGES="redis:5.0-alpine redis:6.2-alpine redis:8-alpine"
# NATS 2.9.4: the delays given back until due; 2.12 and later: the scheduled messages
NATS_IMAGES="nats:2.9.4 nats:latest"
RABBITMQ_IMAGES="rabbitmq:3.6 rabbitmq:4"
# Kafka 3.5 (Confluent Platform 7.5.0) and the latest Apache Kafka, single KRaft nodes
KAFKA_IMAGES="confluentinc/cp-kafka:7.5.0 apache/kafka:latest"
CONTAINERS=""
cleanup() {
    [ -n "$CONTAINERS" ] && docker rm -f -v $CONTAINERS >/dev/null 2>&1
}
trap cleanup EXIT INT TERM
port() {
    docker port "$1" "$2" | head -1 | sed 's/.*://'
}
STATUS=0
if [ -z "$ONLY" ] || [ "$ONLY" = redis ]; then
    URLS=""
    INDEX=0
    for IMAGE in $REDIS_IMAGES; do
        NAME="lk-queue-redis-$INDEX"
        docker rm -f -v "$NAME" >/dev/null 2>&1
        docker run -d --name "$NAME" -p 127.0.0.1::6379 "$IMAGE" >/dev/null || exit 1
        CONTAINERS="$CONTAINERS $NAME"
        for attempt in $(seq 1 60); do
            docker exec "$NAME" redis-cli ping >/dev/null 2>&1 && break
            sleep 1
        done
        URLS="$URLS${URLS:+,}redis://127.0.0.1:$(port "$NAME" 6379)"
        export "QUEUE_TEST_REDIS_NAME_$INDEX=$IMAGE"
        INDEX=$((INDEX + 1))
    done
    QUEUE_TEST_REDIS="$URLS" node --test --test-concurrency=1 --test-timeout=120000 dist/esm/tests/servers/Redis.spec.js || STATUS=1
fi
if [ -z "$ONLY" ] || [ "$ONLY" = nats ]; then
    URLS=""
    INDEX=0
    for IMAGE in $NATS_IMAGES; do
        NAME="lk-queue-nats-$INDEX"
        docker rm -f -v "$NAME" >/dev/null 2>&1
        docker run -d --name "$NAME" -p 127.0.0.1::4222 -p 127.0.0.1::8222 "$IMAGE" -js -m 8222 >/dev/null || exit 1
        CONTAINERS="$CONTAINERS $NAME"
        # The image has no shell: its monitoring port tells when it is ready
        for attempt in $(seq 1 60); do
            curl -sf "http://127.0.0.1:$(port "$NAME" 8222)/healthz" >/dev/null 2>&1 && break
            sleep 1
        done
        URLS="$URLS${URLS:+,}nats://127.0.0.1:$(port "$NAME" 4222)"
        export "QUEUE_TEST_NATS_NAME_$INDEX=$IMAGE"
        INDEX=$((INDEX + 1))
    done
    QUEUE_TEST_NATS="$URLS" node --test --test-concurrency=1 --test-timeout=120000 dist/esm/tests/servers/Nats.spec.js || STATUS=1
fi
if [ -z "$ONLY" ] || [ "$ONLY" = rabbitmq ]; then
    URLS=""
    INDEX=0
    for IMAGE in $RABBITMQ_IMAGES; do
        NAME="lk-queue-rabbitmq-$INDEX"
        docker rm -f -v "$NAME" >/dev/null 2>&1
        docker run -d --name "$NAME" -p 127.0.0.1::5672 "$IMAGE" >/dev/null || exit 1
        CONTAINERS="$CONTAINERS $NAME"
        # Its log tells when it has started (rabbitmqctl run before it has written its Erlang cookie crashes it)
        for attempt in $(seq 1 120); do
            docker logs "$NAME" 2>&1 | grep -q "Server startup complete" && break
            sleep 1
        done
        URLS="$URLS${URLS:+,}amqp://127.0.0.1:$(port "$NAME" 5672)"
        export "QUEUE_TEST_RABBITMQ_NAME_$INDEX=$IMAGE"
        # The reconnection test restarts its application
        export "QUEUE_TEST_RABBITMQ_CONTAINER_$INDEX=$NAME"
        INDEX=$((INDEX + 1))
    done
    QUEUE_TEST_RABBITMQ="$URLS" node --test --test-concurrency=1 --test-timeout=120000 dist/esm/tests/servers/RabbitMQ.spec.js || STATUS=1
fi
if [ -z "$ONLY" ] || [ "$ONLY" = kafka ]; then
    URLS=""
    INDEX=0
    for IMAGE in $KAFKA_IMAGES; do
        NAME="lk-queue-kafka-$INDEX"
        PORT=$((19092 + INDEX))
        docker rm -f -v "$NAME" >/dev/null 2>&1
        docker run -d --name "$NAME" -p "127.0.0.1:$PORT:$PORT" \
            -e KAFKA_NODE_ID=1 -e KAFKA_PROCESS_ROLES=broker,controller -e CLUSTER_ID=MkU3OEVBNTcwNTJENDM2Qk \
            -e KAFKA_LISTENERS="PLAINTEXT://0.0.0.0:$PORT,CONTROLLER://0.0.0.0:9093" \
            -e KAFKA_ADVERTISED_LISTENERS="PLAINTEXT://127.0.0.1:$PORT" \
            -e KAFKA_CONTROLLER_LISTENER_NAMES=CONTROLLER -e KAFKA_CONTROLLER_QUORUM_VOTERS=1@localhost:9093 \
            -e KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT \
            -e KAFKA_INTER_BROKER_LISTENER_NAME=PLAINTEXT \
            -e KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1 -e KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR=1 \
            -e KAFKA_TRANSACTION_STATE_LOG_MIN_ISR=1 \
            -e KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS=0 \
            "$IMAGE" >/dev/null || exit 1
        CONTAINERS="$CONTAINERS $NAME"
        for attempt in $(seq 1 120); do
            docker logs "$NAME" 2>&1 | grep -q "Kafka Server started" && break
            sleep 1
        done
        URLS="$URLS${URLS:+,}127.0.0.1:$PORT"
        export "QUEUE_TEST_KAFKA_NAME_$INDEX=$IMAGE"
        INDEX=$((INDEX + 1))
    done
    QUEUE_TEST_KAFKA="$URLS" node --test --test-concurrency=1 --test-timeout=120000 dist/esm/tests/servers/Kafka.spec.js || STATUS=1
fi
exit $STATUS
