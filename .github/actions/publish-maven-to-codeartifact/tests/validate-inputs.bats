#!/usr/bin/env bats
# Unit tests for scripts/validate-inputs.sh.

bats_require_minimum_version 1.5.0

setup() {
  script="${BATS_TEST_DIRNAME}/../scripts/validate-inputs.sh"
  unset VERSION REVISION || true
}

@test "passes when neither version nor revision is set" {
  run "$script"
  [ "$status" -eq 0 ]
}

@test "passes when only version is set" {
  export VERSION="1.4.0-dev-1"
  run "$script"
  [ "$status" -eq 0 ]
}

@test "passes when only revision is set" {
  export REVISION="1.4.0"
  run "$script"
  [ "$status" -eq 0 ]
}

@test "fails fast when both version and revision are set" {
  export VERSION="1.4.0-dev-1"
  export REVISION="1.4.0"
  run --separate-stderr "$script"

  [ "$status" -eq 1 ]
  [[ "$stderr" == *"mutually exclusive"* ]]
}
