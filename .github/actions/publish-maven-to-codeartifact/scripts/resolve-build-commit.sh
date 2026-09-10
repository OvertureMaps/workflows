#!/usr/bin/env bash
# Prints the commit SHA to record as `build.commit`.
#
# Defaults to the checked-out workspace HEAD rather than `github.sha`, which
# is the merge-ref SHA on `pull_request` events and diverges from the tree
# actually built. Set COMMIT_OVERRIDE to bypass HEAD detection entirely (e.g.
# when the build tree is not a git checkout).
set -euo pipefail

if [ -n "${COMMIT_OVERRIDE:-}" ]; then
  printf '%s\n' "$COMMIT_OVERRIDE"
else
  git rev-parse HEAD
fi
