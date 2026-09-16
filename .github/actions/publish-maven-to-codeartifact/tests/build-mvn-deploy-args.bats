#!/usr/bin/env bats
# Unit tests for scripts/build-mvn-deploy-args.sh.

setup() {
  script="${BATS_TEST_DIRNAME}/../scripts/build-mvn-deploy-args.sh"

  export MAVEN_REPOSITORY_ID="codeartifact"
  export CODEARTIFACT_REPO_URL="https://example.d.codeartifact.us-west-2.amazonaws.com/maven/repo/"
  export BUILD_BRANCH="main"
  export BUILD_COMMIT="deadbeef"
  export WORKFLOW_RUN_ID="123"
  export WORKFLOW_RUN_NUMBER="7"
  export BUILD_ENV="release"
  unset REVISION PROFILES PROJECTS || true
}

@test "always includes the base clean deploy arguments" {
  run "$script"

  [ "$status" -eq 0 ]
  [[ "${lines[0]}" == "clean" ]]
  [[ "${lines[1]}" == "deploy" ]]
  [[ "${lines[2]}" == "-ntp" ]]
  [[ " ${lines[*]} " == *" -DaltDeploymentRepository=codeartifact::${CODEARTIFACT_REPO_URL} "* ]]
  [[ " ${lines[*]} " == *" -Dbuild.branch=main "* ]]
  [[ " ${lines[*]} " == *" -Dbuild.commit=deadbeef "* ]]
  [[ " ${lines[*]} " == *" -Dworkflow.run_id=123 "* ]]
  [[ " ${lines[*]} " == *" -Dworkflow.run_number=7 "* ]]
  [[ " ${lines[*]} " == *" -Dmaven.test.skip=true "* ]]
  [[ " ${lines[*]} " == *" -Denv=release "* ]]
}

@test "omits -Drevision, -P, and -pl when unset" {
  run "$script"

  [ "$status" -eq 0 ]
  for line in "${lines[@]}"; do
    [[ "$line" != -Drevision=* ]]
    [[ "$line" != -P* ]]
    [[ "$line" != -pl ]]
  done
}

@test "adds -Drevision when REVISION is set" {
  export REVISION="1.4.0"
  run "$script"

  [ "$status" -eq 0 ]
  [[ " ${lines[*]} " == *" -Drevision=1.4.0 "* ]]
}

@test "adds -P<profiles> when PROFILES is set" {
  export PROFILES="spark35,extra-profile"
  run "$script"

  [ "$status" -eq 0 ]
  [[ " ${lines[*]} " == *" -Pspark35,extra-profile "* ]]
}

@test "adds -pl <projects> as two separate arguments when PROJECTS is set" {
  export PROJECTS="my-module"
  run "$script"

  [ "$status" -eq 0 ]
  local pl_index=-1
  for i in "${!lines[@]}"; do
    if [[ "${lines[$i]}" == "-pl" ]]; then
      pl_index=$i
      break
    fi
  done
  [ "$pl_index" -ge 0 ]
  [ "${lines[$((pl_index + 1))]}" = "my-module" ]
}
