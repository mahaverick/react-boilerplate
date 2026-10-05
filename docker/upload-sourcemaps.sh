#!/bin/sh
# Uploads dist/'s source maps to every PostHog project in
# POSTHOG_SOURCEMAP_PROJECTS, one posthog-cli run per project, after the
# Dockerfile's inject. Unset projects skip the upload; set projects with no
# token, or any failed upload, fail the build, so an image whose maps are
# missing is never pushed. The token is read from the BuildKit secret file
# and never printed.
set -eu

projects=$(printf '%s' "${POSTHOG_SOURCEMAP_PROJECTS:-}" | tr -d ' \t\r\n')
token_file=${POSTHOG_CLI_TOKEN_FILE:-/run/secrets/posthog_cli_token}
cli=${POSTHOG_CLI:-node_modules/.bin/posthog-cli}
directory=${SOURCEMAP_DIRECTORY:-dist}
export POSTHOG_CLI_HOST="${POSTHOG_CLI_HOST:-https://us.posthog.com}"

# Only commas and whitespace is as good as unset.
if [ -z "$(printf '%s' "$projects" | tr -d ',')" ]; then
  echo 'sourcemaps: not configured, skipping upload'
  exit 0
fi

case $POSTHOG_CLI_HOST in
  https://*) ;;
  *)
    echo 'sourcemaps: POSTHOG_CLI_HOST must start with https://' >&2
    exit 1
    ;;
esac

# A secret passed empty arrives as an empty file; one not passed, as none.
if [ ! -s "$token_file" ]; then
  echo 'sourcemaps: POSTHOG_SOURCEMAP_PROJECTS is set but the posthog_cli_token secret is missing or empty' >&2
  exit 1
fi
token=$(cat "$token_file")

for project in $(printf '%s' "$projects" | tr ',' ' '); do
  case $project in
    *[!0-9]*)
      echo "sourcemaps: a project id is digits only, got: $project" >&2
      exit 1
      ;;
  esac
done

for project in $(printf '%s' "$projects" | tr ',' ' '); do
  # No --release-* flags: in event mode they record nothing (the events carry
  # the release). No --no-fail and no `|| true`: a failed upload fails the build.
  if ! POSTHOG_CLI_TOKEN=$token POSTHOG_CLI_ENV_ID=$project "$cli" sourcemap upload --directory "$directory"; then
    echo "sourcemaps: upload to project $project failed" >&2
    exit 1
  fi
  echo "sourcemaps: uploaded to project $project"
done
