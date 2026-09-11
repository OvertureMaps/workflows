#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

setup() {
  action_dir="$(cd "$BATS_TEST_DIRNAME/.." && pwd)"
  action_file="$action_dir/action.yml"
  workdir="$BATS_TEST_TMPDIR/work space"
  mkdir -p "$workdir/bin" "$workdir/member crate" "$workdir/cargo home"
  cp "$BATS_TEST_DIRNAME/fixtures/cargo.sh" "$workdir/bin/cargo"
  chmod +x "$workdir/bin/cargo"
  cp "$BATS_TEST_DIRNAME/fixtures/Cargo.toml" "$workdir/member crate/Cargo.toml"
  export PATH="$workdir/bin:$PATH"
  export ACTION_PATH="$action_dir"
  export MANIFEST_PATH="$workdir/member crate/Cargo.toml"
  export GITHUB_OUTPUT="$workdir/github output"
  export MOCK_CARGO_LOG="$workdir/cargo calls"
  export MOCK_MANIFEST_JSON="$BATS_TEST_DIRNAME/fixtures/manifest.json"
  export MOCK_WORKSPACE_ROOT="$workdir"
  export MOCK_TARGET_DIRECTORY="$workdir/target"
  export MOCK_CRATE_SIZE=32
  export CARGO_HOME="$workdir/cargo home"
  export MOCK_EXPECT_CREDENTIALS=""
  export MOCK_EXPECT_TOKEN=unset MOCK_EXPECT_NAMED_TOKEN=unset
  unset RELEASE_TAG MAX_BYTES DRY_RUN_ONLY MOCK_FAIL_STAGE
  unset MOCK_MISSING_PACKAGE MOCK_INVALID_METADATA CARGO_TARGET_DIR
  unset CARGO_REGISTRY_TOKEN CARGO_REGISTRIES_CRATES_IO_TOKEN
  : > "$GITHUB_OUTPUT"
  : > "$MOCK_CARGO_LOG"
  : > "$CARGO_HOME/credentials.toml"
}

run_action() {
  local command
  command=$(sed -n 's/^      run: //p' "$action_file")
  [ "$command" = 'bash "$ACTION_PATH/scripts/publish-crate.sh"' ]
  run bash -c "$command"
}

assert_calls() {
  [ "$(cat "$MOCK_CARGO_LOG")" = "$1" ]
}

assert_no_publish() {
  ! grep -qx publish "$MOCK_CARGO_LOG"
}

@test "publishes with manifest outputs, exact command flags and default inputs" {
  run_action

  [ "$status" -eq 0 ]
  [ "$(cat "$GITHUB_OUTPUT")" = $'name=example-crate\nversion=1.2.3\nsize=32' ]
  assert_calls $'read-manifest\ndry-run\npackage\nmetadata\npublish'
  [[ "$output" != *"matches release tag"* ]]
}

@test "accepts an empty release tag" {
  export RELEASE_TAG=""
  run_action

  [ "$status" -eq 0 ]
  assert_calls $'read-manifest\ndry-run\npackage\nmetadata\npublish'
}

@test "accepts a matching release tag" {
  export RELEASE_TAG=1.2.3
  run_action

  [ "$status" -eq 0 ]
  [[ "$output" == *"example-crate version 1.2.3 matches release tag"* ]]
}

@test "accepts a matching release tag with one leading v" {
  export RELEASE_TAG=v1.2.3
  run_action

  [ "$status" -eq 0 ]
  [[ "$output" == *"matches release tag"* ]]
}

@test "rejects a mismatched release tag before dry-run" {
  export RELEASE_TAG=v2.0.0
  run_action

  [ "$status" -eq 1 ]
  [[ "$output" == *"does not match release tag (2.0.0)"* ]]
  assert_calls read-manifest
  assert_no_publish
}

@test "strips only one leading v" {
  export RELEASE_TAG=vv1.2.3
  run_action

  [ "$status" -eq 1 ]
  [[ "$output" == *"does not match release tag (v1.2.3)"* ]]
  assert_calls read-manifest
}

@test "treats release tag shell syntax as data" {
  export RELEASE_TAG='$(touch unexpected-tag-command)'
  cd "$workdir"
  run_action

  [ "$status" -eq 1 ]
  [ ! -e unexpected-tag-command ]
  assert_calls read-manifest
}

@test "accepts a package one byte below the default limit" {
  export MOCK_CRATE_SIZE=10485759
  run_action

  [ "$status" -eq 0 ]
  grep -qx size=10485759 "$GITHUB_OUTPUT"
}

@test "accepts a package exactly at the default limit" {
  export MOCK_CRATE_SIZE=10485760
  run_action

  [ "$status" -eq 0 ]
  grep -qx size=10485760 "$GITHUB_OUTPUT"
}

@test "rejects a package one byte above the default limit" {
  export MOCK_CRATE_SIZE=10485761
  run_action

  [ "$status" -eq 1 ]
  [[ "$output" == *"exceeding the 10485760-byte limit"* ]]
  grep -qx size=10485761 "$GITHUB_OUTPUT"
  assert_calls $'read-manifest\ndry-run\npackage\nmetadata'
  assert_no_publish
}

@test "honors a smaller custom size limit" {
  export MAX_BYTES=31
  run_action

  [ "$status" -eq 1 ]
  [[ "$output" == *"exceeding the 31-byte limit"* ]]
  assert_no_publish
}

@test "accepts a package exactly at a custom size limit" {
  export MAX_BYTES=32
  run_action

  [ "$status" -eq 0 ]
}

@test "honors a larger custom size limit" {
  export MAX_BYTES=10485761 MOCK_CRATE_SIZE=10485761
  run_action

  [ "$status" -eq 0 ]
}

@test "rejects malformed size limits without publishing" {
  for limit in -1 1.5 abc '$(touch unexpected-limit-command)'; do
    export MAX_BYTES="$limit"
    run_action

    [ "$status" -eq 1 ]
    [[ "$output" == *"must be a non-negative integer"* ]]
    assert_no_publish
  done
}

@test "an out-of-range integer size limit fails closed" {
  export MAX_BYTES=999999999999999999999999
  run_action

  [ "$status" -eq 1 ]
  assert_no_publish
}

@test "dry-run-only validates the package without a real publish" {
  export DRY_RUN_ONLY=true
  run_action

  [ "$status" -eq 0 ]
  grep -qx size=32 "$GITHUB_OUTPUT"
  assert_calls $'read-manifest\ndry-run\npackage\nmetadata'
  assert_no_publish
}

@test "dry-run-only still fails when package validation fails" {
  export DRY_RUN_ONLY=true MAX_BYTES=31
  run_action

  [ "$status" -eq 1 ]
  assert_calls $'read-manifest\ndry-run\npackage\nmetadata'
  assert_no_publish
}

@test "only the literal true disables publishing" {
  export DRY_RUN_ONLY=TRUE
  run_action

  [ "$status" -eq 0 ]
  assert_calls $'read-manifest\ndry-run\npackage\nmetadata\npublish'
}

@test "explicit false publishes after validation" {
  export DRY_RUN_ONLY=false
  run_action

  [ "$status" -eq 0 ]
  assert_calls $'read-manifest\ndry-run\npackage\nmetadata\npublish'
}

@test "handles action, manifest, output and configured target paths with spaces" {
  export ACTION_PATH="$workdir/action with spaces"
  export MOCK_TARGET_DIRECTORY="$workdir/configured target"
  mkdir -p "$ACTION_PATH"
  cp -R "$action_dir/scripts" "$ACTION_PATH/scripts"
  run_action

  [ "$status" -eq 0 ]
  [ -f "$MOCK_TARGET_DIRECTORY/package/example-crate-1.2.3.crate" ]
  [ ! -e "$workdir/target/package" ]
  grep -qx size=32 "$GITHUB_OUTPUT"
}

@test "accepts a repository-relative member manifest with spaces" {
  cd "$workdir"
  export MANIFEST_PATH="member crate/Cargo.toml"
  run_action

  [ "$status" -eq 0 ]
  assert_calls $'read-manifest\ndry-run\npackage\nmetadata\npublish'
}

@test "uses metadata target_directory with an inherited CARGO_TARGET_DIR" {
  export CARGO_TARGET_DIR="$workdir/consumer target"
  export MOCK_TARGET_DIRECTORY="$CARGO_TARGET_DIR"
  run_action

  [ "$status" -eq 0 ]
  [ -f "$CARGO_TARGET_DIR/package/example-crate-1.2.3.crate" ]
  [ ! -e "$workdir/target/package" ]
}

@test "propagates read-manifest failure without dry-run or publishing" {
  export MOCK_FAIL_STAGE=read-manifest
  run_action

  [ "$status" -eq 42 ]
  assert_calls read-manifest
  [ ! -s "$GITHUB_OUTPUT" ]
}

@test "propagates dry-run failure without packaging or publishing" {
  export MOCK_FAIL_STAGE=dry-run
  run_action

  [ "$status" -eq 42 ]
  assert_calls $'read-manifest\ndry-run'
  assert_no_publish
}

@test "propagates package failure without metadata or publishing" {
  export MOCK_FAIL_STAGE=package
  run_action

  [ "$status" -eq 42 ]
  assert_calls $'read-manifest\ndry-run\npackage'
  assert_no_publish
}

@test "propagates metadata failure without publishing" {
  export MOCK_FAIL_STAGE=metadata
  run_action

  [ "$status" -eq 42 ]
  assert_calls $'read-manifest\ndry-run\npackage\nmetadata'
  assert_no_publish
}

@test "propagates real publish failure" {
  export MOCK_FAIL_STAGE=publish
  run_action

  [ "$status" -eq 42 ]
  assert_calls $'read-manifest\ndry-run\npackage\nmetadata\npublish'
}

@test "fails on a missing package without publishing" {
  export MOCK_MISSING_PACKAGE=true
  run_action

  [ "$status" -ne 0 ]
  ! grep -q '^size=' "$GITHUB_OUTPUT"
  assert_no_publish
}

@test "fails on missing metadata target_directory without publishing" {
  export MOCK_INVALID_METADATA=true
  run_action

  [ "$status" -ne 0 ]
  assert_no_publish
}

@test "rejects invalid manifest JSON or missing manifest fields" {
  export MOCK_MANIFEST_JSON="$workdir/manifest.json"
  for manifest in 'not json' '{}' '{"name":"example-crate"}' '{"version":"1.2.3"}'; do
    printf '%s\n' "$manifest" > "$MOCK_MANIFEST_JSON"
    run_action

    [ "$status" -ne 0 ]
    assert_no_publish
    ! grep -qx dry-run "$MOCK_CARGO_LOG"
  done
}

@test "inherits the consumer registry token unchanged at every Cargo stage" {
  export CARGO_REGISTRY_TOKEN="consumer token with spaces"
  export MOCK_EXPECT_TOKEN="$CARGO_REGISTRY_TOKEN"
  run_action

  [ "$status" -eq 0 ]
  assert_calls $'read-manifest\ndry-run\npackage\nmetadata\npublish'
  [[ "$output" != *"$CARGO_REGISTRY_TOKEN"* ]]
}

@test "inherits named registry credentials and Cargo credential files unchanged" {
  export CARGO_REGISTRIES_CRATES_IO_TOKEN="consumer named token"
  export MOCK_EXPECT_NAMED_TOKEN="$CARGO_REGISTRIES_CRATES_IO_TOKEN"
  export MOCK_EXPECT_CREDENTIALS=$'[registry]\ntoken = "consumer-file-token"'
  printf '%s\n' "$MOCK_EXPECT_CREDENTIALS" > "$CARGO_HOME/credentials.toml"
  run_action

  [ "$status" -eq 0 ]
  [ "$(cat "$CARGO_HOME/credentials.toml")" = "$MOCK_EXPECT_CREDENTIALS" ]
  [[ "$output" != *"consumer-file-token"* ]]
}

@test "publishes with consumer file credentials and no token environment variables" {
  export MOCK_EXPECT_CREDENTIALS=$'[registry]\ntoken = "consumer-file-only-token"'
  printf '%s\n' "$MOCK_EXPECT_CREDENTIALS" > "$CARGO_HOME/credentials.toml"
  run_action

  [ "$status" -eq 0 ]
  assert_calls $'read-manifest\ndry-run\npackage\nmetadata\npublish'
}

@test "action wiring preserves public outputs and delegates all authentication" {
  expected=$(cat <<'YAML'
outputs:
  crate-name:
    description: The crate's name, read from its Cargo.toml.
    value: ${{ steps.publish.outputs.name }}
  crate-version:
    description: The crate's version, read from its Cargo.toml.
    value: ${{ steps.publish.outputs.version }}
  crate-size-bytes:
    description: The packaged .crate file size, in bytes.
    value: ${{ steps.publish.outputs.size }}

runs:
  using: composite
  steps:
    - name: Validate and publish crate
      id: publish
      shell: bash
      env:
        ACTION_PATH: ${{ github.action_path }}
        MANIFEST_PATH: ${{ inputs.manifest-path }}
        RELEASE_TAG: ${{ inputs.release-tag }}
        MAX_BYTES: ${{ inputs.max-crate-size-bytes }}
        DRY_RUN_ONLY: ${{ inputs.dry-run-only }}
      run: bash "$ACTION_PATH/scripts/publish-crate.sh"
YAML
)
  [ "$(sed -n '/^outputs:/,$p' "$action_file" | tr -d '\r')" = "$expected" ]
  [ "$(sed -n '/^inputs:/,/^outputs:/s/^  \([^ ]*\):$/\1/p' "$action_file" | tr -d '\r')" = \
    $'manifest-path\nrelease-tag\nmax-crate-size-bytes\ndry-run-only' ]
  grep -q 'default: "10485760"' "$action_file"
  grep -q 'default: "false"' "$action_file"
  grep -q 'default: ""' "$action_file"
}
