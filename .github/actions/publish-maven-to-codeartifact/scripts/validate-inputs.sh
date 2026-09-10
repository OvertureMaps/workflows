#!/usr/bin/env bash
# Fails fast when mutually exclusive inputs are both set.
#
# `version` overrides the pom version via `mvn versions:set`; `revision`
# instead passes `-Drevision` straight to `mvn deploy`. Setting both would
# run `versions:set` and pass `-Drevision`, producing an inconsistent
# artifact version depending on which one Maven resolves last.
set -euo pipefail

if [ -n "${VERSION:-}" ] && [ -n "${REVISION:-}" ]; then
  echo "::error::'version' and 'revision' are mutually exclusive; set at most one." >&2
  exit 1
fi
