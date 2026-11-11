# Releaser app token <!-- omit in toc -->

A composite GitHub Action that mints a short-lived installation token for a GitHub App (defaults to overture-releaser; override inputs for any other app): assume an IAM role via OIDC, fetch the app PEM from AWS Secrets Manager, create the token, then clear the PEM.

- [How-to guides](#how-to-guides)
- [Reference](#reference)
- [Explanation](#explanation)

## How-to guides

### Create a token

```yaml
jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      id-token: write # OIDC role assumption
      contents: read
    steps:
      - name: Generate app token
        id: app-token
        uses: OvertureMaps/workflows/.github/actions/releaser-token@<sha> # vX.Y.Z

      - run: gh release create ...
        env:
          GH_TOKEN: ${{ steps.app-token.outputs.token }}
```

### Use a different app

```yaml
- uses: OvertureMaps/workflows/.github/actions/releaser-token@<sha> # vX.Y.Z
  with:
    client-id: Iv23liexample
    secret-id: path/to/other/pem
    role-to-assume: arn:aws:iam::123456789012:role/other-reader
    owner: OtherOrg
    repositories: repo-a,repo-b
```

The PEM is exposed to later steps as `APP_PEM` until cleared.

### Migrate a consumer

1. Confirm the repo is in the matching `*_secrets_reader_repos` list in `omf-github-terraform` `oidc-aws.tf`.
2. Replace the inline AWS credentials, Secrets Manager and `create-github-app-token` steps with this action, pinned `@<sha> # vX.Y.Z`, with `id-token: write` and `contents: read` on the job.
3. After the first successful run on the default branch, manually delete the GitHub Actions secrets this replaces so a stale PEM is not left lying around:
   - Repo-level: Settings > Secrets and variables > Actions, or `gh secret delete <NAME> --repo OvertureMaps/<repo>`.
   - Org-level: remove the repo from the secret's selected repositories, or delete the secret once no repo uses it (`gh secret delete <NAME> --org OvertureMaps`).
   - Dependabot-scoped copies too: add `--app dependabot`.

   Known candidates: `OVERTURE_PULL_REQUESTER_APP_PEM` (`schema`, `tf-data-platform`) and `OVERTURE_TF_DATA_PLATFORM_GH_AUTOMATION_APP_PEM` (`overture-matchers`).

### Keep the PEM in the environment

Set `clear-pem: "false"` to leave `APP_PEM` in `$GITHUB_ENV`.

### Receive updates via Dependabot

Pin by SHA with a version comment and group this repo's bumps:

```yaml
- package-ecosystem: github-actions
  directory: /
  groups:
    overture-workflows:
      patterns: ["OvertureMaps/workflows*"]
      update-types: [minor, patch]
```

A floating `@vN` tag is possible only with branch protection and release-only retagging, and needs `# zizmor: ignore[unpinned-uses]`.

## Reference

| Input | Default | Description |
|-------|---------|-------------|
| `permission-contents` | `write` | Permission level for the token's `contents` scope |
| `clear-pem` | `true` | Clear `APP_PEM` after the token step (runs on failure too) |
| `role-to-assume` | `arn:aws:iam::816069134238:role/gha-releaser-secrets-reader` | IAM role used to read the secret |
| `secret-id` | `omf-github-terraform/releaser/pem` | Secrets Manager secret id |
| `client-id` | `Iv23lijru2e660v1zJQO` | GitHub App client ID (not sensitive) |
| `aws-region` | `us-west-2` | AWS region |
| `owner` | current owner | Installation owner to scope the token to |
| `repositories` | current repo | Comma or newline-separated repositories to scope the token to (current repo even when `owner` is set; set it explicitly for another owner). A non-empty value with no repository names fails the action |
| `permission-pull-requests` | _(omitted)_ | Permission level for `pull-requests` |
| `permission-workflows` | _(omitted)_ | Permission level for `workflows` |
| `permission-actions` | _(omitted)_ | Permission level for `actions` |
| `permission-issues` | _(omitted)_ | Permission level for `issues` |
| `permission-dependabot-secrets` | _(omitted)_ | Permission level for `dependabot_secrets` |
| `clear-aws-credentials` | `false` | Also clear `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_SESSION_TOKEN` (runs on failure too) |

Pass `permission-contents: ""` to omit the `contents` scope, but set at least one other `permission-*` input: the action fails if none is set, because an empty set would grant the token every permission of the app installation.

| Output | Description |
|--------|-------------|
| `token` | GitHub App installation token |

Caller permissions required: `id-token: write`, `contents: read`.

## Explanation

Composite actions cannot grant permissions, so the calling job must declare them. The PEM is exported by `aws-secretsmanager-get-secrets` to `$GITHUB_ENV`; the final step blanks it with `if: always()` so a failed token step does not leave it for later steps. AWS credentials exported by `configure-aws-credentials` stay in the job unless `clear-aws-credentials` is `true`. The `secrets-outside-env` zizmor suppression is justified once here: the PEM is intentionally read from the environment.
