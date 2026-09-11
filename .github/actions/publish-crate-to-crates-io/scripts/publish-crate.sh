#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
export RELEASE_TAG="${RELEASE_TAG:-}"
export MAX_BYTES="${MAX_BYTES:-10485760}"
DRY_RUN_ONLY="${DRY_RUN_ONLY:-false}"

CRATE_NAME=""
CRATE_VERSION=""
size=""
stage="Read crate metadata"
tag_result="Not checked"
publish_result="Dry-run passed"
if [ -z "$RELEASE_TAG" ]; then
  tag_result="Skipped"
fi
source "$script_dir/job-summary.sh"
trap finish_publish EXIT

manifest_dir="$(cd -- "$(dirname -- "$MANIFEST_PATH")" && pwd)"
manifest_abs="$manifest_dir/$(basename -- "$MANIFEST_PATH")"

# Select the package whose manifest_path matches the requested manifest,
# since a workspace's metadata lists every member.
metadata=$(cargo metadata --no-deps --format-version 1 --manifest-path "$MANIFEST_PATH")
export CRATE_NAME CRATE_VERSION TARGET_DIRECTORY
CRATE_NAME=$(jq -er --arg manifest "$manifest_abs" \
  '.packages[] | select(.manifest_path == $manifest) | .name | strings | select(length > 0)' <<< "$metadata")
CRATE_VERSION=$(jq -er --arg manifest "$manifest_abs" \
  '.packages[] | select(.manifest_path == $manifest) | .version | strings | select(length > 0)' <<< "$metadata")
TARGET_DIRECTORY=$(jq -er '.target_directory | strings | select(length > 0)' <<< "$metadata")
echo "name=$CRATE_NAME" >> "$GITHUB_OUTPUT"
echo "version=$CRATE_VERSION" >> "$GITHUB_OUTPUT"
bash "$script_dir/describe-trusted-publisher.sh"

stage="Verify release tag"
bash "$script_dir/verify-release-tag.sh"
if [ -n "$RELEASE_TAG" ]; then
  tag_result="Matched"
fi
stage="Dry-run publish"
cargo publish --dry-run --locked --registry crates-io --manifest-path "$MANIFEST_PATH"
source "$script_dir/package-and-check-size.sh"

if [ "$DRY_RUN_ONLY" != "true" ]; then
  stage="Publish"
  cargo publish --locked --registry crates-io --manifest-path "$MANIFEST_PATH"
  publish_result="Published"
fi
