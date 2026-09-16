#!/usr/bin/env bats
# Unit tests for scripts/resolve-build-commit.sh.

setup() {
  script="${BATS_TEST_DIRNAME}/../scripts/resolve-build-commit.sh"
}

@test "prints COMMIT_OVERRIDE when set, without touching git" {
  export COMMIT_OVERRIDE="deadbeefcafe"
  run "$script"

  [ "$status" -eq 0 ]
  [ "$output" = "deadbeefcafe" ]
}

@test "falls back to git rev-parse HEAD when COMMIT_OVERRIDE is unset" {
  unset COMMIT_OVERRIDE
  run "$script"

  [ "$status" -eq 0 ]
  [ "$output" = "$(git rev-parse HEAD)" ]
}

@test "falls back to git rev-parse HEAD when COMMIT_OVERRIDE is empty" {
  export COMMIT_OVERRIDE=""
  run "$script"

  [ "$status" -eq 0 ]
  [ "$output" = "$(git rev-parse HEAD)" ]
}
