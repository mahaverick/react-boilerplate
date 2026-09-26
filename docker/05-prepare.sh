#!/bin/sh
# Run by the image's entrypoint before 20-envsubst-on-templates.sh: the
# entrypoint runs /docker-entrypoint.d/ in name order, under `set -e`.
set -eu

# envsubst skips rendering, logging one line and exiting 0, when its output
# directory is not writable, and a missing one is not. /tmp starts empty.
mkdir -p "$NGINX_ENVSUBST_OUTPUT_DIR"
