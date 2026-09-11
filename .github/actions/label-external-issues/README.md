# Label External Issues

A composite GitHub Action that labels org-wide issues opened by users who
aren't members of the org.

## Explanation

### What it does

There's no way to add a workflow to every repo in the org at once, and a
per-repo `issues: opened` trigger wouldn't cover repos this action isn't
added to. So this runs as a scheduled batch job instead: on each run it
searches the org for issues that are open, unlabeled with the configured
label, and created within the lookback window, then for each one:

- Skips it if the author is a bot (bots are never org members, so they'd
  otherwise always be mislabeled as external)
- Checks org membership for the author
- Adds the label if the author isn't a member; otherwise skips it

The lookback window (default 180 minutes) should stay comfortably larger
than the schedule interval so a missed or delayed run doesn't drop issues.

### Why a GitHub App

The default `GITHUB_TOKEN` is scoped to a single repo and can't read org
membership or write labels in other repos. This action mints an installation
token from a dedicated GitHub App, which needs:

- Organization permissions: Members read
- Repository permissions: Issues write (on every repo it should label)

## How-to guides

### Run on a schedule (how this repo uses it)

See [`label-external-issues.yml`](../../workflows/label-external-issues.yml):
checkout this repo, assume a narrow OIDC role, fetch the app PEM from AWS
Secrets Manager, then reference the action locally. The role, secret, and
GitHub App are managed in `omf-github-terraform`.

```yaml
on:
  schedule:
    - cron: "*/30 * * * *"
  workflow_dispatch:
    inputs:
      dry_run:
        type: boolean
        default: false

jobs:
  label:
    runs-on: ubuntu-slim
    permissions:
      contents: read
      id-token: write # for OIDC authentication with AWS
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false

      - uses: aws-actions/configure-aws-credentials@v6
        with:
          aws-region: us-west-2
          role-to-assume: arn:aws:iam::816069134238:role/gha-label-external-issues-secrets-reader

      - uses: aws-actions/aws-secretsmanager-get-secrets@v3
        with:
          secret-ids: |
            LABEL_EXTERNAL_PEM, omf-github-terraform/label-external-issues/pem

      - uses: ./.github/actions/label-external-issues
        with:
          clientId: "<app-client-id>" # not sensitive
          privateKey: ${{ env.LABEL_EXTERNAL_PEM }}
          dryRun: ${{ inputs.dry_run || 'false' }}
```

### Dry run

Trigger the workflow manually with `dry_run` checked, or pass
`dryRun: "true"` to the action. Intended changes are logged but not applied.

### One-time setup required

This action needs a dedicated GitHub App before it can run for real:

1. Create a GitHub App (or extend an existing internal one) with
   **Organization: Members (read)** and **Repository: Issues (write)**
   permissions, and install it on every repo that should be covered.
2. Add the app's client ID, OIDC role, and Secrets Manager PEM entry in
   `omf-github-terraform`, matching the naming convention this workflow
   expects (`LABEL_EXTERNAL_APP_CLIENT_ID`, `gha-label-external-issues-secrets-reader`,
   `omf-github-terraform/label-external-issues/pem`).
3. Create the `external` label (or your chosen name) in each target repo,
   or its default label templates, so the action can apply it.

Until then, `label-external-issues.yml`'s placeholder client ID will cause
runs to fail at the token-minting step.

## Reference

### Inputs

- `clientId` (**required**): Client ID of the GitHub App used to mint the
  installation token.
- `privateKey` (**required**): Private key for the app. Must come from an
  already-masked source (a GitHub Actions secret, or
  `aws-actions/aws-secretsmanager-get-secrets` as this repo does): the
  action re-masks the value line-by-line as defense in depth, but it cannot
  mask the value's handling before it arrives as an input. Include the full
  PEM block with a trailing newline.
- `label` (optional): Label to apply to issues from non-members. Defaults
  to `external`.
- `lookbackMinutes` (optional): How far back to search for newly opened
  issues, in minutes. Defaults to `180`.
- `dryRun` (optional): `"true"` to log intended changes without applying
  them. Defaults to `"false"`.

### Outputs

This action has no outputs. Results are logged, with a summary notice at the
end.
