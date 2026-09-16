#!/usr/bin/env bash
set -euo pipefail

stage="Validate size limit"
if [[ ! "$MAX_BYTES" =~ ^[0-9]+$ ]]; then
  echo "::error::max-crate-size-bytes must be a non-negative integer"
  exit 1
fi

stage="Package"
cargo package --locked --manifest-path "$MANIFEST_PATH"
stage="Check package size"
crate_file="${TARGET_DIRECTORY}/package/${CRATE_NAME}-${CRATE_VERSION}.crate"
size=$(stat --format=%s "$crate_file")
echo "$CRATE_NAME package size: ${size} bytes"
echo "size=$size" >> "$GITHUB_OUTPUT"
if ! [ "$size" -le "$MAX_BYTES" ]; then
  echo "::error::$CRATE_NAME package is ${size} bytes, exceeding the ${MAX_BYTES}-byte limit"
  exit 1
fi
