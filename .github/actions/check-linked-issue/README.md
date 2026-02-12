# Check Linked Issue

A composite GitHub Action that verifies a pull request has at least one linked GitHub issue.

## Explanation

### What it does

This action queries the GitHub GraphQL API for `closingIssuesReferences` on a
pull request. It detects issues linked by:

- Body keywords: `Fixes #123`, `Closes #456`, `Resolves owner/repo#789`
- Manual linking via the GitHub UI sidebar

If no linked issues are found, the step fails with a message guiding the author
to link one.

### Why GraphQL over regex

| Approach | Body keywords | UI-linked issues | Cross-repo refs | Format-proof |
|----------|:---:|:---:|:---:|:---:|
| Regex on PR body | ✅ | ❌ | Fragile | ❌ |
| `closingIssuesReferences` | ✅ | ✅ | ✅ | ✅ |

The GraphQL approach reflects GitHub's actual internal linkage rather than
parsing text, making it reliable across formatting styles and linking methods.

## How-to guides

### Use the reusable workflow (recommended)

The simplest way to adopt this check from any repo in the OvertureMaps
organization. Create a workflow file in your repo:

```yaml
# .github/workflows/check-issue.yml
name: Check Linked Issue

on:
  pull_request:
    types: [opened, edited, synchronize]

jobs:
  check-issue:
    uses: OvertureMaps/workflows/.github/workflows/check-issue.yml@main
```

No checkout step is needed — GitHub resolves the reusable workflow and its
actions automatically.

### Use the composite action directly from this repo

If you need to combine this check with other steps in an existing job, check out
the action and reference it locally:

```yaml
# .github/workflows/pr-checks.yml
name: PR Checks

on:
  pull_request:
    types: [opened, edited, synchronize]

permissions:
  contents: read
  pull-requests: read

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout workflows repo
        uses: actions/checkout@v4
        with:
          repository: OvertureMaps/workflows
          sparse-checkout: .github/actions/check-linked-issue
          path: .workflows

      - name: Check for linked issue
        uses: ./.workflows/.github/actions/check-linked-issue

      # ... additional steps in the same job
```

## Reference

### Permissions

Requires the default `GITHUB_TOKEN` with:

```yaml
permissions:
  contents: read
  pull-requests: read
```

For private repos, these permissions allow the token to read PR metadata and
query linked issues. Cross-repo issue detection is limited to public repos and
repos within the same organization that the token has access to.

### Inputs

This action has no inputs.

### Outputs

This action has no outputs. It either passes or fails the step.

### Supported trigger events

The action reads `context.payload.pull_request.number`, so it must run on a
`pull_request` or `pull_request_target` event.
