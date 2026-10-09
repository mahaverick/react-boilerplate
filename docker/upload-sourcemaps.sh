#!/bin/sh
# Uploads dist/'s source maps to every PostHog project in
# POSTHOG_SOURCEMAP_PROJECTS, one posthog-cli run per project, after the
# Dockerfile's inject. Unset projects skip the upload; set projects with no
# token, no maps to upload, or any failed, skipped or empty upload, fail the
# build, so an image whose maps are missing is never pushed. The token is
# read from the BuildKit secret file and never printed.
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

# A build with no maps (a vite config that stopped emitting them) would
# otherwise upload nothing, pass, and ship chunks no frame can be mapped from.
if ! find "$directory" -name '*.map' -type f | grep -q .; then
  echo "sourcemaps: no source maps under $directory to upload" >&2
  exit 1
fi

for project in $(printf '%s' "$projects" | tr ',' ' '); do
  # No --release-* flags: in event mode they record nothing (the events carry
  # the release). No --no-fail and no `|| true`: a failed upload fails the build.
  # The output is captured, then printed, so it can be read for skipped chunks.
  if ! output=$(POSTHOG_CLI_TOKEN=$token POSTHOG_CLI_ENV_ID=$project "$cli" sourcemap upload --directory "$directory" 2>&1); then
    if [ -n "$output" ]; then printf '%s\n' "$output" >&2; fi
    echo "sourcemaps: upload to project $project failed" >&2
    exit 1
  fi
  if [ -n "$output" ]; then printf '%s\n' "$output"; fi
  # The CLI exits 0 after skipping a chunk as too large, or after finding
  # nothing to upload, and either chunk would then ship with no map behind
  # it: its output is the only sign. Its exact wording is not documented, so
  # any "too large" fails unless that line's count is an explicit zero
  # ("skipped 0 too large").
  if printf '%s\n' "$output" | grep -i 'too large' \
    | grep -Eiv '(^|[^0-9])0[^0-9]{0,8}too large|too large[^0-9]{0,8}0([^0-9]|$)' | grep -q .; then
    echo "sourcemaps: posthog-cli skipped chunks as too large for project $project" >&2
    exit 1
  fi
  # Nothing uploaded fails too, unless a non-zero count says the maps were
  # already there ("12 already uploaded", "skipped 3 existing"): a re-run of
  # a build whose upload went through finds nothing new to send.
  if printf '%s\n' "$output" | grep -Eiq 'uploaded 0([^0-9]|$)|no source ?maps? (were )?found' \
    && ! printf '%s\n' "$output" \
      | grep -Eiq '(^|[^0-9])[1-9][0-9]*[^0-9.,;]{0,30}(already|existing)|(already|existing)[^0-9.,;]{0,30}[1-9]'; then
    echo "sourcemaps: posthog-cli uploaded no source maps to project $project" >&2
    exit 1
  fi
  echo "sourcemaps: uploaded to project $project"
done
