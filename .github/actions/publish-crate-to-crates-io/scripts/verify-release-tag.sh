#!/usr/bin/env bash
set -euo pipefail

if [ -z "$RELEASE_TAG" ]; then
  exit 0
fi

expected="${RELEASE_TAG#v}"
if [ "$CRATE_VERSION" != "$expected" ]; then
  echo "::error::$CRATE_NAME Cargo.toml version ($CRATE_VERSION) does not match release tag ($expected)"
  exit 1
fi
echo "$CRATE_NAME version $CRATE_VERSION matches release tag"
