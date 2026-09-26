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

# --- API_UPSTREAM is validated before nginx starts ---------------------------
# `nginx -t` as the command, so every run ends by itself. The message is what
# proves the check ran: `nginx -t` fails on its own for some of these values.
for good in http://api:4040 https://api.example.com; do
  if ! out=$(docker run --rm --add-host=api:127.0.0.1 --add-host=api.example.com:127.0.0.1 \
    -e "API_UPSTREAM=$good" "$image" nginx -t 2>&1); then
    problem "rejected API_UPSTREAM=$good: $out"
  fi
done
for bad in 'http://api:4040/' 'http://api:4040/v1' 'api:4040' '' 'http://$host' 'http://api:4040;' \
  'http://api:4040?x' 'http://u@api:4040' 'http://{api}:4040' 'http://api :4040' $'http://api:4040\nx'; do
  if out=$(docker run --rm --add-host=api:127.0.0.1 -e "API_UPSTREAM=$bad" "$image" nginx -t 2>&1); then
    problem "accepted API_UPSTREAM=[$bad]"
  fi
  case $out in
    *"API_UPSTREAM must be scheme://host[:port] with no path, got: $bad"*) ;;
    *) problem "no validation message for API_UPSTREAM=[$bad]: $out" ;;
  esac
done

# --- The container: unprivileged, on 8080 ------------------------------------
docker run -d --name "$name" -p "127.0.0.1:$port:8080" --read-only --tmpfs /tmp \
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

# --- Read-only root: the config is rendered under /tmp -----------------------
[ "$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}}' "$name")" = true ] || problem "the root filesystem is writable"
docker exec "$name" nginx -T >"$work/nginx-T" 2>&1 || true
grep -q '^# configuration file /tmp/nginx/conf.d/default.conf:' "$work/nginx-T" \
  || problem "the server config was not rendered into /tmp/nginx/conf.d"
grep -q 'location /api/ {' "$work/nginx-T" || problem "the /api/ location is not loaded"
# Nothing listens behind /api, so the proxy itself answers 502.
status=$(curl -s -o /dev/null -w '%{http_code}' "$base/api/v1/health")
[ "$status" = 502 ] || problem "/api/ with no API behind it answered $status, not 502"

exit "$fail"
