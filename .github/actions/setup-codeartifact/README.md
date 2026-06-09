# Authenticate with AWS CodeArtifact <!-- omit in toc -->

A composite GitHub Action that assumes an IAM role via OIDC, acquires an AWS CodeArtifact authorization token, and writes a Maven `settings.xml` so subsequent `mvn` commands can resolve and deploy artifacts against CodeArtifact.

- [How-to guides](#how-to-guides)
- [Reference](#reference)
- [Explanation](#explanation)

## How-to guides

### Authenticate before a Maven step

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      id-token: write # required for OIDC role assumption
      contents: read
    steps:
      - uses: actions/checkout@v4

      - name: Authenticate with CodeArtifact
        uses: OvertureMaps/workflows/.github/actions/setup-codeartifact@main
        with:
          aws-role-arn: arn:aws:iam::123456789012:role/codeartifact-publisher
          codeartifact-domain: overture
          codeartifact-domain-owner: "123456789012"
          codeartifact-repository: maven-releases

      - name: Resolve and deploy
        run: mvn deploy --settings ~/.m2/settings.xml
```

> Pin to a commit SHA rather than `@main` for reproducible builds, e.g.
> `uses: OvertureMaps/workflows/.github/actions/setup-codeartifact@<sha>`.

## Reference

### Inputs

- `aws-role-arn` (**required**): IAM role ARN to assume via OIDC.
- `aws-region` (optional): AWS region where CodeArtifact is hosted. Default `us-west-2`.
- `codeartifact-domain` (**required**): CodeArtifact domain name.
- `codeartifact-domain-owner` (**required**): AWS account ID that owns the CodeArtifact domain.
- `codeartifact-repository` (**required**): CodeArtifact repository name.

### Outputs

This action has no outputs. It configures the environment for later steps: it
acquires a CodeArtifact authorization token (masked, passed internally via a
step output rather than `$GITHUB_ENV`) and writes `~/.m2/settings.xml`.

### Permissions

The job must grant OIDC token issuance so the role can be assumed:

```yaml
permissions:
  id-token: write
  contents: read
```

AWS permissions are governed by the assumed IAM role, which must allow
`codeartifact:GetAuthorizationToken`, `sts:GetServiceBearerToken`, and the
read/write CodeArtifact actions needed by downstream Maven steps.

## Explanation

### Why a dedicated auth step

CodeArtifact authorization tokens are short-lived and must be regenerated per
run. Centralizing OIDC role assumption, token acquisition, and `settings.xml`
generation in one step keeps credential handling auditable and lets any Maven
step in the same job resolve or deploy artifacts without bespoke setup.

### The token boundary

The authorization token is masked in logs and written to `$GITHUB_ENV` so the
generated `settings.xml` can reference it. Because `$GITHUB_ENV` is readable by
all subsequent steps in the job, treat the runner as trusted for the duration of
the job and call this action only in jobs you control.
