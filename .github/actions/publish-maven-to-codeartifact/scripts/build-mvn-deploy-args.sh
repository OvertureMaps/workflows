#!/usr/bin/env bash
# Prints the `mvn clean deploy` arguments, one per line, driven by
# environment variables set by action.yml. Kept separate from action.yml so
# the flag logic (especially the optional -Drevision/-P/-pl flags) can be
# unit tested without running a full composite action.
#
# Required: MAVEN_REPOSITORY_ID, CODEARTIFACT_REPO_URL, BUILD_BRANCH,
#            BUILD_COMMIT, WORKFLOW_RUN_ID, WORKFLOW_RUN_NUMBER, BUILD_ENV
# Optional: REVISION, PROFILES, PROJECTS
set -euo pipefail

printf '%s\n' \
  clean deploy -ntp \
  "-DaltDeploymentRepository=${MAVEN_REPOSITORY_ID}::${CODEARTIFACT_REPO_URL}" \
  "-Dbuild.branch=${BUILD_BRANCH}" \
  "-Dbuild.commit=${BUILD_COMMIT}" \
  "-Dworkflow.run_id=${WORKFLOW_RUN_ID}" \
  "-Dworkflow.run_number=${WORKFLOW_RUN_NUMBER}" \
  -Dmaven.test.skip=true \
  "-Denv=${BUILD_ENV}" \
  --settings "$HOME/.m2/settings.xml"

[ -n "${REVISION:-}" ] && printf -- '-Drevision=%s\n' "$REVISION"
[ -n "${PROFILES:-}" ] && printf -- '-P%s\n' "$PROFILES"
[ -n "${PROJECTS:-}" ] && printf -- '-pl\n%s\n' "$PROJECTS"

exit 0
