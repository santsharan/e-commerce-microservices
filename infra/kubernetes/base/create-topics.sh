#!/bin/sh
# Topic names must match infra/docker/kafka/create-topics.sh.
# scripts/infra-contract.test.ts checks both files.
set -eu

BOOTSTRAP="${KAFKA_BOOTSTRAP:-127.0.0.1:9092}"
PARTITIONS="${TOPIC_PARTITIONS:-3}"

TOPICS="
commerce.orders.v1
commerce.inventory.v1
commerce.payments.v1
commerce.inventory.commands.v1
commerce.payment.commands.v1
commerce.notification.commands.v1
commerce.orders.retry.1m
commerce.orders.retry.5m
commerce.orders.retry.30m
commerce.orders.dlq
"

PATH="/opt/kafka/bin:${PATH}"

for topic in $TOPICS; do
  kafka-topics.sh \
    --bootstrap-server "$BOOTSTRAP" \
    --create \
    --if-not-exists \
    --topic "$topic" \
    --partitions "$PARTITIONS" \
    --replication-factor 1
done
