#!/bin/bash
# The image entrypoint fixes the data directory, then drops to the mongodb user.
set -eu
docker-entrypoint.sh mongod --replSet rs0 --bind_ip_all &
pid="$!"
trap 'kill -TERM "$pid"' TERM INT
ready=0
for _ in $(seq 1 90); do
  if mongosh --quiet --host 127.0.0.1 --eval 'db.adminCommand({ ping: 1 })' >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "mongod did not answer ping" >&2
  exit 1
fi
mongosh --quiet --host 127.0.0.1 --file /scripts/mongo-init.js
wait "$pid"
