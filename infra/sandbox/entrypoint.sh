#!/usr/bin/env sh
set -e

# Start the inner Docker daemon (this container must run --privileged).
dockerd-entrypoint.sh &

# Wait for the inner daemon's socket to come up before accepting work.
for i in $(seq 1 30); do
  if docker info >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! docker info >/dev/null 2>&1; then
  echo "inner dockerd did not become ready in time" >&2
  exit 1
fi

exec tail -f /dev/null
