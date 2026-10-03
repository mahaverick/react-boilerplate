#!/bin/sh
# Run by the image's entrypoint after 05-prepare.sh and before
# 20-envsubst-on-templates.sh: the entrypoint runs /docker-entrypoint.d/ in
# name order, under `set -e`, so a non-zero exit here stops the container
# before nginx starts. Writes the run-time configuration the bundle reads
# (src/configs/runtime-config.ts) to $RUNTIME_CONFIG_DIR/runtime-config.js,
# which nginx.conf serves as /runtime-config.js.
#
# Every value is checked against the same pattern as
# src/configs/runtime-config.ts before it is written. The patterns admit no
# quote, backslash, `<` or newline, so a value goes into the file as it is,
# with no escaping; a value that does not match stops the container, so a typo
# fails the rollout instead of quietly switching analytics off. An unset or
# empty variable is written as "" and means "use the default". The error names
# the variable and never prints its value.
set -eu

out_dir=${RUNTIME_CONFIG_DIR:-/tmp/runtime}
https_origin='https://[A-Za-z0-9.-]+(:[0-9]{1,5})?'

# check NAME VALUE PATTERN WHAT
check() {
  [ -z "$2" ] && return 0
  if [ "$(printf '%s' "$2" | wc -l)" -ne 0 ] || ! printf '%s\n' "$2" | grep -Eq "^($3)\$"; then
    echo "10-runtime-config.sh: $1 must be $4; the value given does not match (not shown)" >&2
    exit 1
  fi
}

posthog_key=${POSTHOG_KEY:-}
posthog_ui_host=${POSTHOG_UI_HOST:-}
consent_mode=${ANALYTICS_CONSENT_MODE:-}
handoff_origins=${ANALYTICS_HANDOFF_ORIGINS:-}
app_environment=${APP_ENVIRONMENT:-}

check POSTHOG_KEY "$posthog_key" 'phc_[A-Za-z0-9_-]{8,128}' 'a PostHog project key (phc_...)'
check POSTHOG_UI_HOST "$posthog_ui_host" "$https_origin" 'an https:// origin with no path'
check ANALYTICS_CONSENT_MODE "$consent_mode" 'opt_out|required|off' 'opt_out, required or off'
check ANALYTICS_HANDOFF_ORIGINS "$handoff_origins" "$https_origin(,$https_origin)*" \
  'comma-separated https:// origins with no spaces or paths'
check APP_ENVIRONMENT "$app_environment" '[a-z][a-z0-9-]{0,31}' \
  'lowercase letters, digits and dashes, starting with a letter, at most 32'

# Written beside the target and renamed, so nginx never serves a half-written file.
mkdir -p "$out_dir"
cat >"$out_dir/runtime-config.js.tmp" <<EOF
window.__APP_CONFIG__ = Object.freeze({
  "POSTHOG_KEY": "$posthog_key",
  "POSTHOG_UI_HOST": "$posthog_ui_host",
  "ANALYTICS_CONSENT_MODE": "$consent_mode",
  "ANALYTICS_HANDOFF_ORIGINS": "$handoff_origins",
  "APP_ENVIRONMENT": "$app_environment"
})
EOF
mv "$out_dir/runtime-config.js.tmp" "$out_dir/runtime-config.js"
