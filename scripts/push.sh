#!/usr/bin/env bash
# /**
#  * Runs the full lint and test gate, then pushes without the pre-push hook.
#  * A long pre-push hook can outlast the SSH connection and drop the push, so
#  * the gate runs before git push opens the connection. Arguments go to git push.
#  */
set -euo pipefail

if ! pnpm gate; then
  echo 'Gate failed: fix the errors above, then run pnpm push again.' >&2
  exit 1
fi

exec git push --no-verify "$@"
