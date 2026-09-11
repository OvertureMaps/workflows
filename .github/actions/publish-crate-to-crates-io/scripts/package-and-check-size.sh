#!/usr/bin/env bash
set -euo pipefail

if [[ ! "$MAX_BYTES" =~ ^[0-9]+$ ]]; then
  echo "::error::max-crate-size-bytes must be a non-negative integer"
  exit 1
fi

cargo package --locked --manifest-path "$MANIFEST_PATH"
metadata=$(cargo metadata --no-deps --format-version 1 --manifest-path "$MANIFEST_PATH")
target_directory=$(jq -er '.target_directory | strings | select(length > 0)' <<< "$metadata")
crate_file="${target_directory}/package/${CRATE_NAME}-${CRATE_VERSION}.crate"
size=$(stat --format=%s "$crate_file")
echo "$CRATE_NAME package size: ${size} bytes"
echo "size=$size" >> "$GITHUB_OUTPUT"
if ! [ "$size" -le "$MAX_BYTES" ]; then
  echo "::error::$CRATE_NAME package is ${size} bytes, exceeding the ${MAX_BYTES}-byte limit"
  exit 1
fi
