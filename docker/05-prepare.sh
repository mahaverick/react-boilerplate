#!/bin/sh
# Runs before 20-envsubst-on-templates.sh: the image's entrypoint runs
# /docker-entrypoint.d/ in name order, under `set -e`.
set -eu

# The stock envsubst script logs one line and exits 0 without rendering when
# its output directory is not writable, and a missing one is not. /tmp starts
# empty. `:?` also refuses a set but empty value, which `set -u` lets through
# and `mkdir -p ""` rejects without naming this variable.
: "${NGINX_ENVSUBST_OUTPUT_DIR:?NGINX_ENVSUBST_OUTPUT_DIR must be set}"
mkdir -p "$NGINX_ENVSUBST_OUTPUT_DIR"

# nginx.conf substitutes this into `proxy_pass` as it is: a path, even "/",
# rewrites every /api/ URI, and anything but a host and port is nginx syntax or
# a variable. grep matches line by line, so a newline is refused first.
upstream=${API_UPSTREAM:-}
if [ "$(printf '%s' "$upstream" | wc -l)" -ne 0 ] ||
  ! printf '%s\n' "$upstream" | grep -Eq '^https?://([A-Za-z0-9._-]+|\[[0-9A-Fa-f:.]+\])(:[0-9]{1,5})?$'; then
  echo "API_UPSTREAM must be scheme://host[:port] with no path, got: $upstream" >&2
  exit 1
fi
