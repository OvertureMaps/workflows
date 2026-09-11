#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
export RELEASE_TAG="${RELEASE_TAG:-}"
export MAX_BYTES="${MAX_BYTES:-10485760}"
DRY_RUN_ONLY="${DRY_RUN_ONLY:-false}"

manifest=$(cargo read-manifest --manifest-path "$MANIFEST_PATH")
export CRATE_NAME CRATE_VERSION
CRATE_NAME=$(jq -er '.name | strings | select(length > 0)' <<< "$manifest")
CRATE_VERSION=$(jq -er '.version | strings | select(length > 0)' <<< "$manifest")
echo "name=$CRATE_NAME" >> "$GITHUB_OUTPUT"
echo "version=$CRATE_VERSION" >> "$GITHUB_OUTPUT"

bash "$script_dir/verify-release-tag.sh"
cargo publish --dry-run --locked --manifest-path "$MANIFEST_PATH"
bash "$script_dir/package-and-check-size.sh"

if [ "$DRY_RUN_ONLY" != "true" ]; then
  cargo publish --locked --manifest-path "$MANIFEST_PATH"
fi
