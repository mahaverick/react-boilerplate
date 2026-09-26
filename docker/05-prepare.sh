#!/bin/sh
# Run by the image's entrypoint before 20-envsubst-on-templates.sh: the
# entrypoint runs /docker-entrypoint.d/ in name order, under `set -e`.
set -eu

# envsubst skips rendering, logging one line and exiting 0, when its output
# directory is not writable, and a missing one is not. /tmp starts empty.
mkdir -p "$NGINX_ENVSUBST_OUTPUT_DIR"

# proxy_pass takes this verbatim: a path, even "/", rewrites every /api/ URI,
# and anything but a host and port is nginx syntax or an nginx variable.
# grep matches line by line, so a value with a newline is refused first.
upstream=${API_UPSTREAM:-}
if [ "$(printf '%s' "$upstream" | wc -l)" -ne 0 ] ||
  ! printf '%s\n' "$upstream" | grep -Eq '^https?://([A-Za-z0-9._-]+|\[[0-9A-Fa-f:.]+\])(:[0-9]{1,5})?$'; then
  echo "API_UPSTREAM must be scheme://host[:port] with no path, got: $upstream" >&2
  exit 1
fi
