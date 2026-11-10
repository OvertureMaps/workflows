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

The PEM is always exposed internally as `RELEASER_APP_PEM`, regardless of app.

### Keep the PEM in the environment

Set `clear-pem: "false"` to leave `RELEASER_APP_PEM` in `$GITHUB_ENV`.

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
| `clear-pem` | `true` | Clear `RELEASER_APP_PEM` after the token step (runs on failure too) |
| `role-to-assume` | `arn:aws:iam::816069134238:role/gha-releaser-secrets-reader` | IAM role used to read the secret |
| `secret-id` | `omf-github-terraform/releaser/pem` | Secrets Manager secret id |
| `client-id` | `Iv23lijru2e660v1zJQO` | GitHub App client ID (not sensitive) |
| `aws-region` | `us-west-2` | AWS region |
| `owner` | current owner | Installation owner to scope the token to |
| `repositories` | current repo | Repositories to scope the token to |
| `owner` | current owner | Installation owner to scope the token to |
| `repositories` | current repo | Repositories to scope the token to |

| Output | Description |
|--------|-------------|
| `token` | GitHub App installation token |

Caller permissions required: `id-token: write`, `contents: read`.

## Explanation

Composite actions cannot grant permissions, so the calling job must declare them. The PEM is exported by `aws-secretsmanager-get-secrets` to `$GITHUB_ENV`; the final step blanks it with `if: always()` so a failed token step does not leave it for later steps. AWS credentials exported by `configure-aws-credentials` are not cleared. The `secrets-outside-env` zizmor suppression is justified once here: the PEM is intentionally read from the environment.
