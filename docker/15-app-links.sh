#!/bin/sh
# Writes the iOS and Android app-association files to
# $RUNTIME_CONFIG_DIR/well-known/, which nginx.conf serves as
# /.well-known/apple-app-site-association and /.well-known/assetlinks.json. The
# entrypoint runs it after 10-runtime-config.sh and before
# 20-envsubst-on-templates.sh, under `set -e`, so a non-zero exit stops the
# container before nginx starts.
#
#   IOS_APP_IDS        comma-separated <team id>.<bundle id>
#   ANDROID_APP_LINKS  comma-separated <package>:<SHA-256 certificate fingerprint>
#
# Each entry must match its pattern. The patterns admit no quote, backslash,
# space or newline, so a value is written into JSON as it is, without escaping.
# A mismatch stops the container and the error names the variable, never its
# value. An unset or empty variable writes no file and removes a stale one, so
# nginx answers 404 for it.
set -eu

out_dir=${RUNTIME_CONFIG_DIR:-/tmp/runtime}/well-known

ios_id='[A-Z0-9]{10}\.[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+'
android_package='[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+'
android_fingerprint='([0-9A-F]{2}:){31}[0-9A-F]{2}'
android_link="$android_package:$android_fingerprint"

# check NAME VALUE ENTRY WHAT: exits 1, naming NAME and WHAT it must be, unless
# VALUE is empty or a comma-separated list of ENTRY. The newline test comes
# first because grep matches line by line.
check() {
  [ -z "$2" ] && return 0
  if [ "$(printf '%s' "$2" | wc -l)" -ne 0 ] || ! printf '%s\n' "$2" | grep -Eq "^($3)(,($3))*\$"; then
    echo "15-app-links.sh: $1 must be $4; the value given does not match (not shown)" >&2
    exit 1
  fi
}

ios_app_ids=${IOS_APP_IDS:-}
android_app_links=${ANDROID_APP_LINKS:-}

check IOS_APP_IDS "$ios_app_ids" "$ios_id" \
  'comma-separated <team id>.<bundle id>, the team id ten uppercase letters or digits'
check ANDROID_APP_LINKS "$android_app_links" "$android_link" \
  'comma-separated <package>:<SHA-256 fingerprint as 32 uppercase hex pairs joined by colons>'

# put FILE CONTENT: writes beside the target and renames, so nginx never serves
# a half-written file. An empty CONTENT removes the file instead.
put() {
  if [ -z "$2" ]; then
    rm -f "$out_dir/$1"
    return 0
  fi
  mkdir -p "$out_dir"
  printf '%s\n' "$2" >"$out_dir/$1.tmp"
  mv "$out_dir/$1.tmp" "$out_dir/$1"
}

aasa=
if [ -n "$ios_app_ids" ]; then
  ids=$(printf '%s' "$ios_app_ids" | sed 's/,/","/g')
  aasa='{"applinks":{"details":[{"appIDs":["'$ids'"],"components":[{"/":"/auth/link"},{"/":"/auth/confirm"},{"/":"/invitations/accept"},{"/":"/invitations/confirm"},{"/":"/settings/account/security"},{"/":"/tenants/*"}]}]},"webcredentials":{"apps":["'$ids'"]}}'
fi

assetlinks=
if [ -n "$android_app_links" ]; then
  # Split at the first colon: the fingerprint holds the rest.
  statements=
  rest=$android_app_links
  while [ -n "$rest" ]; do
    entry=${rest%%,*}
    case $rest in *,*) rest=${rest#*,} ;; *) rest= ;; esac
    statements="${statements:+$statements,}"'{"relation":["delegate_permission/common.handle_all_urls","delegate_permission/common.get_login_creds"],"target":{"namespace":"android_app","package_name":"'${entry%%:*}'","sha256_cert_fingerprints":["'${entry#*:}'"]}}'
  done
  assetlinks="[$statements]"
fi

put apple-app-site-association "$aasa"
put assetlinks.json "$assetlinks"
