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

# --- Security headers on pages and assets ------------------------------------
asset=$({ curl -sf "$base/" || true; } | { grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' || true; } | head -n 1)
[ -n "$asset" ] || problem "index.html names no /assets/index-*.js entry chunk"
csp="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
for path in / /dashboard "$asset" /theme-init.js /assets/does-not-exist.js; do
  curl -s -D "$work/headers" -o /dev/null "$base$path"
  while IFS='|' read -r field value; do
    got=$(header "$field" "$work/headers")
    [ "$got" = "$value" ] || problem "$path: $field is [$got], expected [$value]"
  done <<EOF
Content-Security-Policy|$csp
Permissions-Policy|camera=(), microphone=(), geolocation=(), payment=(), usb=()
Referrer-Policy|no-referrer
X-Content-Type-Options|nosniff
X-Frame-Options|DENY
Cross-Origin-Opener-Policy|same-origin
Server|nginx
EOF
done
curl -s -D "$work/headers" -o /dev/null "$base/theme-init.js"
[ "$(header Content-Type "$work/headers")" = application/javascript ] || problem "/theme-init.js is not served as JavaScript"
[ "$(header Cache-Control "$work/headers")" = no-store ] || problem "/theme-init.js is not no-store"

# --- A missing asset is a 404 that no cache keeps ----------------------------
status=$(curl -s -D "$work/headers" -o "$work/body" -w '%{http_code}' "$base/assets/does-not-exist.js")
[ "$status" = 404 ] || problem "a missing asset answered $status, not 404"
if grep -q 'id="root"' "$work/body"; then problem "a missing asset was answered with index.html"; fi
[ -z "$(header Cache-Control "$work/headers")" ] || problem "a 404 carries Cache-Control"
curl -s -D "$work/headers" -o /dev/null "$base$asset"
[ "$(header Cache-Control "$work/headers")" = 'public, max-age=31536000, immutable' ] \
  || problem "$asset is not cached as immutable"

exit "$fail"
