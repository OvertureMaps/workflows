#!/usr/bin/env bash
set -euo pipefail

stage="$1"
case "$stage" in
  read-manifest)
    expected=(read-manifest --manifest-path "$MANIFEST_PATH")
    ;;
  publish)
    if [ "${2:-}" = "--dry-run" ]; then
      stage=dry-run
      expected=(publish --dry-run --locked --manifest-path "$MANIFEST_PATH")
    else
      expected=(publish --locked --manifest-path "$MANIFEST_PATH")
    fi
    ;;
  package)
    expected=(package --locked --manifest-path "$MANIFEST_PATH")
    ;;
  metadata)
    expected=(metadata --no-deps --format-version 1 --manifest-path "$MANIFEST_PATH")
    ;;
  *)
    echo "Unexpected cargo command: $stage" >&2
    exit 90
    ;;
esac

printf '%s\n' "$stage" >> "$MOCK_CARGO_LOG"
[ "$#" -eq "${#expected[@]}" ] || exit 91
for argument in "${expected[@]}"; do
  [ "$1" = "$argument" ] || exit 92
  shift
done
[ -f "$MANIFEST_PATH" ] || exit 93
[ "${CARGO_REGISTRY_TOKEN-unset}" = "$MOCK_EXPECT_TOKEN" ] || exit 94
[ "${CARGO_REGISTRIES_CRATES_IO_TOKEN-unset}" = "$MOCK_EXPECT_NAMED_TOKEN" ] || exit 95
[ "$(cat "$CARGO_HOME/credentials.toml")" = "$MOCK_EXPECT_CREDENTIALS" ] || exit 96

if [ "${MOCK_FAIL_STAGE:-}" = "$stage" ]; then
  echo "Mock cargo $stage failed" >&2
  exit 42
fi

case "$stage" in
  read-manifest)
    cat "$MOCK_MANIFEST_JSON"
    ;;
  package)
    if [ "${MOCK_MISSING_PACKAGE:-false}" != "true" ]; then
      mkdir -p "$MOCK_TARGET_DIRECTORY/package"
      truncate -s "$MOCK_CRATE_SIZE" "$MOCK_TARGET_DIRECTORY/package/example-crate-1.2.3.crate"
    fi
    ;;
  metadata)
    if [ "${MOCK_INVALID_METADATA:-false}" = "true" ]; then
      printf '{"workspace_root":"unused"}\n'
    else
      jq -n --arg target "$MOCK_TARGET_DIRECTORY" --arg workspace "$MOCK_WORKSPACE_ROOT" \
        '{target_directory: $target, workspace_root: $workspace}'
    fi
    ;;
esac
