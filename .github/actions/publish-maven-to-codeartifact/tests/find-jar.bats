#!/usr/bin/env bats
# Unit tests for scripts/find-jar.sh.

bats_require_minimum_version 1.5.0

setup() {
  script="${BATS_TEST_DIRNAME}/../scripts/find-jar.sh"
  workdir="$(mktemp -d)"
}

teardown() {
  rm -rf "$workdir"
}

@test "finds a *-shaded.jar under target/" {
  mkdir -p "$workdir/target"
  touch "$workdir/target/app-1.0-shaded.jar"

  WORKING_DIRECTORY="$workdir" run "$script"

  [ "$status" -eq 0 ]
  [ "$output" = "$workdir/target/app-1.0-shaded.jar" ]
}

@test "falls back to any *.jar when no shaded jar exists" {
  mkdir -p "$workdir/target"
  touch "$workdir/target/app-1.0.jar"

  WORKING_DIRECTORY="$workdir" run "$script"

  [ "$status" -eq 0 ]
  [ "$output" = "$workdir/target/app-1.0.jar" ]
}

@test "prefers the shaded jar over a plain jar" {
  mkdir -p "$workdir/target"
  touch "$workdir/target/app-1.0.jar"
  touch "$workdir/target/app-1.0-shaded.jar"

  WORKING_DIRECTORY="$workdir" run "$script"

  [ "$status" -eq 0 ]
  [ "$output" = "$workdir/target/app-1.0-shaded.jar" ]
}

@test "looks under <projects>/target when PROJECTS is set" {
  mkdir -p "$workdir/my-module/target"
  touch "$workdir/my-module/target/app-shaded.jar"
  mkdir -p "$workdir/target"
  touch "$workdir/target/other-shaded.jar"

  WORKING_DIRECTORY="$workdir" PROJECTS="my-module" run "$script"

  [ "$status" -eq 0 ]
  [ "$output" = "$workdir/my-module/target/app-shaded.jar" ]
}

@test "uses only the first PROJECTS entry when a comma-separated list is given" {
  mkdir -p "$workdir/module-a/target"
  touch "$workdir/module-a/target/app-shaded.jar"

  WORKING_DIRECTORY="$workdir" PROJECTS="module-a,module-b" run "$script"

  [ "$status" -eq 0 ]
  [ "$output" = "$workdir/module-a/target/app-shaded.jar" ]
}

@test "warns and exits 0 with no output when no jar is found" {
  mkdir -p "$workdir/target"

  WORKING_DIRECTORY="$workdir" run --separate-stderr "$script"

  [ "$status" -eq 0 ]
  [ -z "$output" ]
  [[ "$stderr" == *"::warning::"* ]]
}

@test "warns and exits 0 with no output when target/ does not exist" {
  WORKING_DIRECTORY="$workdir" run --separate-stderr "$script"

  [ "$status" -eq 0 ]
  [ -z "$output" ]
  [[ "$stderr" == *"::warning::"* ]]
}

@test "does not recurse into subdirectories for the plain-jar fallback" {
  mkdir -p "$workdir/target/nested"
  touch "$workdir/target/nested/dependency.jar"

  WORKING_DIRECTORY="$workdir" run --separate-stderr "$script"

  [ "$status" -eq 0 ]
  [ -z "$output" ]
}
