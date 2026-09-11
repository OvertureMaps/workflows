#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
export RELEASE_TAG="${RELEASE_TAG:-}"
export MAX_BYTES="${MAX_BYTES:-10485760}"
DRY_RUN_ONLY="${DRY_RUN_ONLY:-false}"

CRATE_NAME=""
CRATE_VERSION=""
size=""
stage="Read manifest"
tag_result="Not checked"
publish_result="Dry-run passed"
if [ -z "$RELEASE_TAG" ]; then
  tag_result="Skipped"
fi
source "$script_dir/job-summary.sh"
trap finish_publish EXIT

manifest=$(cargo read-manifest --manifest-path "$MANIFEST_PATH")
export CRATE_NAME CRATE_VERSION
CRATE_NAME=$(jq -er '.name | strings | select(length > 0)' <<< "$manifest")
CRATE_VERSION=$(jq -er '.version | strings | select(length > 0)' <<< "$manifest")
echo "name=$CRATE_NAME" >> "$GITHUB_OUTPUT"
echo "version=$CRATE_VERSION" >> "$GITHUB_OUTPUT"

stage="Verify release tag"
bash "$script_dir/verify-release-tag.sh"
if [ -n "$RELEASE_TAG" ]; then
  tag_result="Matched"
fi
stage="Dry-run publish"
cargo publish --dry-run --locked --manifest-path "$MANIFEST_PATH"
source "$script_dir/package-and-check-size.sh"

if [ "$DRY_RUN_ONLY" != "true" ]; then
  stage="Publish"
  cargo publish --locked --manifest-path "$MANIFEST_PATH"
  publish_result="Published"
fi
