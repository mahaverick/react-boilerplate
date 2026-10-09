#!/usr/bin/env bash
# Checks a built image from outside, the way it ships. Every probe ends on its
# own, and the one container this script starts is removed on exit.
#
#   bash docker/check-image.sh <image> [host-port] [release]
#
# `release` is the GIT_SHA the image was built with (default `dev`). The
# proxied-API check also uses host-port + 1.
set -euo pipefail

image=${1:?usage: bash docker/check-image.sh <image> [host-port] [release]}
port=${2:-18080}
release=${3:-dev}
base="http://127.0.0.1:$port"
name="rb-check-$$"
work=$(mktemp -d)
fail=0

cleanup() {
  docker rm -f "$name" "$name-bad" "$name-api" "$name-proxy" >/dev/null 2>&1 || true
  docker network rm "$name-net" >/dev/null 2>&1 || true
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

# --- The run-time configuration is validated before nginx starts -------------
# A bad value stops the container: started detached, exactly as it ships, it
# must exit non-zero, and its log must name the variable without showing the
# value. The probe value is unique, so finding it anywhere in the log fails,
# and it matches none of the patterns (uppercase, underscores, no scheme).
probe='PII_PROBE_VALUE'
for var in POSTHOG_KEY POSTHOG_UI_HOST ANALYTICS_CONSENT_MODE ANALYTICS_HANDOFF_ORIGINS APP_ENVIRONMENT; do
  docker run -d --name "$name-bad" --read-only --tmpfs /tmp --add-host=api:127.0.0.1 \
    -e "$var=$probe" "$image" >/dev/null
  # Polled rather than `docker wait`, which would hang on a container that started.
  for _ in $(seq 1 30); do
    [ "$(docker inspect -f '{{.State.Running}}' "$name-bad")" = false ] && break
    sleep 1
  done
  state=$(docker inspect -f '{{.State.Running}} {{.State.ExitCode}}' "$name-bad")
  logs=$(docker logs "$name-bad" 2>&1)
  docker rm -f "$name-bad" >/dev/null
  case $state in
    'false 0' | true*) problem "started with an invalid $var ($state)" ;;
  esac
  case $logs in
    *"10-runtime-config.sh: $var must be"*) ;;
    *) problem "no validation message for an invalid $var: $logs" ;;
  esac
  case $logs in
    *"$probe"*) problem "the log of an invalid $var shows its value" ;;
  esac
done

# --- The container: unprivileged, on 8080 ------------------------------------
# Started with run-time settings, passed the way every deployment passes
# them: plain environment variables.
docker run -d --name "$name" -p "127.0.0.1:$port:8080" --read-only --tmpfs /tmp \
  --add-host=api:127.0.0.1 -e POSTHOG_KEY=phc_test_key_not_real -e APP_ENVIRONMENT=check \
  -e ANALYTICS_HANDOFF_ORIGINS=https://www.example.test "$image" >/dev/null
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
for path in / /dashboard "$asset" /theme-init.js /runtime-config.js /assets/does-not-exist.js; do
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

# --- /api/ responses carry each security header once --------------------------
# Two of a header leave a browser enforcing neither cleanly (two COOP lines do
# not parse). With no API behind it, nginx's own 502 carries nginx's set; behind
# an API that sends its own, as express's helmet does, the response keeps the
# API's and nginx adds only what the API left out.
security_fields='Content-Security-Policy X-Frame-Options Cross-Origin-Opener-Policy Referrer-Policy X-Content-Type-Options Permissions-Policy'
# How many times header $1 appears in the `curl -D` dump $2.
header_count() {
  { grep -ci "^$1:" "$2" || true; } | tr -d ' '
}
curl -s -D "$work/headers" -o /dev/null "$base/api/v1/health"
for field in $security_fields; do
  count=$(header_count "$field" "$work/headers")
  [ "$count" = 1 ] || problem "/api/ with no API behind it: $field sent $count times, not once"
done
# A stand-in API: this image's nginx, answering every path with helmet's
# values for the five headers helmet sets, and no Permissions-Policy.
api_port=$((port + 1))
cat >"$work/stub.conf" <<'STUB'
pid /tmp/stub.pid;
events {}
http {
  access_log off;
  client_body_temp_path /tmp/stub-client;
  proxy_temp_path /tmp/stub-proxy;
  fastcgi_temp_path /tmp/stub-fastcgi;
  uwsgi_temp_path /tmp/stub-uwsgi;
  scgi_temp_path /tmp/stub-scgi;
  server {
    listen 8081;
    location / {
      add_header Content-Security-Policy "default-src 'none';frame-ancestors 'none'" always;
      add_header X-Frame-Options "SAMEORIGIN" always;
      add_header Cross-Origin-Opener-Policy "same-origin" always;
      add_header Referrer-Policy "no-referrer" always;
      add_header X-Content-Type-Options "nosniff" always;
      return 200 '{}';
    }
  }
}
STUB
docker network create "$name-net" >/dev/null
docker run -d --name "$name-api" --network "$name-net" --tmpfs /tmp \
  -v "$work/stub.conf:/etc/stub.conf:ro" --entrypoint nginx "$image" -c /etc/stub.conf -g 'daemon off;' >/dev/null
docker run -d --name "$name-proxy" --network "$name-net" -p "127.0.0.1:$api_port:8080" --read-only \
  --tmpfs /tmp -e "API_UPSTREAM=http://$name-api:8081" "$image" >/dev/null
status=
for _ in $(seq 1 30); do
  status=$(curl -s -D "$work/headers" -o /dev/null -w '%{http_code}' "http://127.0.0.1:$api_port/api/v1/health" || true)
  [ "$status" = 200 ] && break
  sleep 1
done
if [ "$status" != 200 ]; then
  problem "the proxied /api/ check got $status from the stand-in API, not 200"
else
  for field in $security_fields; do
    count=$(header_count "$field" "$work/headers")
    [ "$count" = 1 ] || problem "proxied /api/: $field sent $count times, not once"
  done
  [ "$(header X-Frame-Options "$work/headers")" = SAMEORIGIN ] \
    || problem "proxied /api/: X-Frame-Options is not the API's own"
  [ "$(header Content-Security-Policy "$work/headers")" = "default-src 'none';frame-ancestors 'none'" ] \
    || problem "proxied /api/: Content-Security-Policy is not the API's own"
fi
curl -s -D "$work/headers" -o /dev/null "$base/theme-init.js"
[ "$(header Content-Type "$work/headers")" = application/javascript ] || problem "/theme-init.js is not served as JavaScript"
[ "$(header Cache-Control "$work/headers")" = no-store ] || problem "/theme-init.js is not no-store"

# --- Source maps, chunk ids and the release ----------------------------------
# The build stage uploads the maps and deletes them: none may ship. The prune
# keeps find out of the kernel's own trees.
maps=$(docker run --rm --entrypoint sh "$image" -c \
  'find / \( -path /proc -o -path /sys -o -path /dev \) -prune -o -name "*.map" -print 2>/dev/null' || true)
[ -z "$maps" ] || problem "the image holds source maps: $maps"
docker run --rm --entrypoint sh "$image" -c 'cat /usr/share/nginx/html/assets/*.js' >"$work/bundle.js"
grep -q 'sourceMappingURL' "$work/bundle.js" && problem "a chunk names a source map"
grep -q '__APP_RELEASE__' "$work/bundle.js" && problem "__APP_RELEASE__ was not replaced at build time"
# Quoted any way the minifier quotes a string literal, backticks included.
grep -qE "[\"'\`]${release}[\"'\`]" "$work/bundle.js" || problem "the release \"$release\" is not in the bundle"
# posthog-cli's inject prepends a chunk-id IIFE and appends a chunkId comment;
# a release-less inject writes no release id into it.
curl -sf "$base$asset" >"$work/entry.js" || problem "could not fetch $asset"
grep -q '_posthogChunkIds' "$work/entry.js" || problem "$asset has no injected chunk id"
grep -q '^//# chunkId=' "$work/entry.js" || problem "$asset has no chunkId comment"
grep -qE '_posthogReleaseId=[A-Za-z_$]+\._posthogReleaseId\|\|' "$work/bundle.js" \
  && problem "a chunk carries an injected release id: inject must stay release-less"

# --- The run-time configuration, written at start under /tmp -----------------
curl -s -D "$work/headers" -o "$work/body" "$base/runtime-config.js"
[ "$(header Content-Type "$work/headers")" = application/javascript ] \
  || problem "/runtime-config.js is not served as JavaScript"
[ "$(header Cache-Control "$work/headers")" = no-store ] || problem "/runtime-config.js is not no-store"
cat >"$work/expected" <<'EOF'
window.__APP_CONFIG__ = Object.freeze({
  "POSTHOG_KEY": "phc_test_key_not_real",
  "POSTHOG_UI_HOST": "",
  "ANALYTICS_CONSENT_MODE": "",
  "ANALYTICS_HANDOFF_ORIGINS": "https://www.example.test",
  "APP_ENVIRONMENT": "check"
})
EOF
cmp -s "$work/expected" "$work/body" \
  || problem "/runtime-config.js is not what the container was started with: $(cat "$work/body")"
case $(curl -sf "$base/" || true) in
  *'<script src="/runtime-config.js"'*) ;;
  *) problem "index.html does not load /runtime-config.js" ;;
esac

# --- A missing asset is a 404 that no cache keeps ----------------------------
status=$(curl -s -D "$work/headers" -o "$work/body" -w '%{http_code}' "$base/assets/does-not-exist.js")
[ "$status" = 404 ] || problem "a missing asset answered $status, not 404"
if grep -q 'id="root"' "$work/body"; then problem "a missing asset was answered with index.html"; fi
[ -z "$(header Cache-Control "$work/headers")" ] || problem "a 404 carries Cache-Control"
curl -s -D "$work/headers" -o /dev/null "$base$asset"
[ "$(header Cache-Control "$work/headers")" = 'public, max-age=31536000, immutable' ] \
  || problem "$asset is not cached as immutable"

exit "$fail"
