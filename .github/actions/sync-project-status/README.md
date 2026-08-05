# Sync Project Status

A composite GitHub Action that keeps the `Status` field in sync for issues
belonging to more than one org-level ProjectV2.

## Explanation

### What it does

ProjectsV2 has no workflow trigger for field edits, so this runs as a
scheduled batch job. For each issue (or PR) that is an item in two or more of
the configured projects:

- If statuses differ, the most recently updated `Status` wins (based on the
  field value's `updatedAt`) and is copied to the other projects
- Status option names are matched case-insensitively, so `In Progress` and
  `In progress` count as already in sync
- A status set in only one project propagates to projects where it's unset
- Archived items, items in only one project, and items with no status
  anywhere are ignored
- A mismatch whose status name has no matching option in the target project
  is logged as a warning and skipped

The GraphQL/IO code lives in `src/projects.js`; the planning logic in
`src/plan.js` is pure and side-effect free.

### Why a GitHub App

The default `GITHUB_TOKEN` cannot read or write org-level ProjectsV2. This
action mints an installation token from a dedicated GitHub App, which needs:

- Organization permissions: Projects read & write
- Repository permissions: Issues read, Pull requests read

## How-to guides

### Run on a schedule (how this repo uses it)

See [`sync-project-status.yml`](../../workflows/sync-project-status.yml):
checkout this repo, assume a narrow OIDC role, fetch the app PEM from AWS
Secrets Manager, then reference the action locally. The role, secret, and
GitHub App are managed in `omf-github-terraform`.

```yaml
on:
  schedule:
    - cron: "17 */3 * * *"
  workflow_dispatch:
    inputs:
      dry_run:
        type: boolean
        default: false

jobs:
  sync:
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
          role-to-assume: arn:aws:iam::816069134238:role/gha-project-manager-secrets-reader

      - uses: aws-actions/aws-secretsmanager-get-secrets@v3
        with:
          secret-ids: |
            PROJECT_MANAGER_PEM, omf-github-terraform/project-manager/pem

      - uses: ./.github/actions/sync-project-status
        with:
          clientId: "Iv23limfwiJlCIqHPHrd" # overture-project-manager app, not sensitive
          privateKey: ${{ env.PROJECT_MANAGER_PEM }}
          dryRun: ${{ inputs.dry_run || 'false' }}
```

### Dry run

Trigger the workflow manually with `dry_run` checked, or pass
`dryRun: "true"` to the action. Intended changes are logged but not applied.

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
- `projectNumbers` (optional): Comma-separated org project numbers to sync.
  Defaults to `84,78,54` (Overture, places-surge, CloudDevOps).
- `dryRun` (optional): `"true"` to log intended changes without applying
  them. Defaults to `"false"`.

### Outputs

This action has no outputs. Results are logged, with a summary notice at the
end.

### Conflict resolution

Last write wins: whichever project's `Status` was edited most recently is the
source of truth for that item on each run. Between runs, conflicting edits in
different projects are resolved in favor of the later edit.
