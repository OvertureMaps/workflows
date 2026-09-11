#!/usr/bin/env bash
set -eo pipefail

# crates.io's Trusted Publisher configuration binds a token to an
# organization/repository, a workflow file, and an optional environment
# claim from the GitHub OIDC ID token. This is purely informational, to help
# a consumer cross-check those fields against crates.io's Trusted Publisher
# settings for the crate; this action never reads OIDC tokens itself.
workflow_file="${GITHUB_WORKFLOW_REF:-unknown}"
workflow_file="${workflow_file#*/*/}"
workflow_file="${workflow_file%@*}"

echo "::notice::Trusted Publisher config surface for $CRATE_NAME: repository ${GITHUB_REPOSITORY:-unknown}, workflow $workflow_file. If this job also runs under a GitHub Actions environment, crates.io's Trusted Publisher config may need that environment name too."
