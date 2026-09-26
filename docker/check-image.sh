#!/usr/bin/env bash
# Checks a built image from outside, the way it ships. Every probe ends on its
# own, and the one container this script starts is removed on exit.
#
#   bash docker/check-image.sh <image> [host-port]
set -euo pipefail

image=${1:?usage: bash docker/check-image.sh <image> [host-port]}
port=${2:-18080}
base="http://127.0.0.1:$port"
name="rb-check-$$"
work=$(mktemp -d)
fail=0

cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

problem() {
  echo "FAIL: $*"
  fail=1
}

# The first value of header $1 in the `curl -D` dump $2, or nothing.
header() {
  { grep -i "^$1:" "$2" || true; } | head -n 1 | cut -d' ' -f2- | tr -d '\r'
}

# --- The container: unprivileged, on 8080 ------------------------------------
docker run -d --name "$name" -p "127.0.0.1:$port:8080" \
  --add-host=api:127.0.0.1 "$image" >/dev/null
for _ in $(seq 1 30); do
  curl -sf -o /dev/null "$base/" && break
  sleep 1
done
if ! curl -sf -o /dev/null "$base/"; then
  docker logs "$name" || true
  echo "FAIL: nothing served on container port 8080"
  exit 1
fi

[ "$(docker inspect -f '{{.Config.User}}' "$image")" = 101 ] || problem "the image's user is not 101"
# Real and effective uid of every process in the container, nginx's master
# and workers included.
uids=$(docker exec "$name" sh -c 'cat /proc/[0-9]*/status 2>/dev/null | awk "/^Uid:/ { print \$2; print \$3 }"' | sort -u)
[ "$uids" = 101 ] || problem "processes run as uid(s): $(echo $uids)"

exit "$fail"
