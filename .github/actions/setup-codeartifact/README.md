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
- `maven-repository-id` (optional): The Maven `<server>`/`<repository>` id written to `settings.xml`. Default `codeartifact`. Must match the id your `pom.xml`'s `<repositories><repository>` declares, otherwise Maven silently skips attaching CodeArtifact credentials when *resolving* dependencies (deploys are unaffected — see [The repository id must match](#the-repository-id-must-match) below). Only override this if your repo's convention differs from `codeartifact`.

### Outputs

The action's primary effect is environmental: it acquires a CodeArtifact
authorization token (masked, passed internally via a step output rather than
`$GITHUB_ENV`) and writes `~/.m2/settings.xml`. It also echoes the CodeArtifact
metadata back as outputs so later steps can pipe from a single source of truth
instead of re-specifying it:

- `codeartifact-domain` — the domain name.
- `codeartifact-domain-owner` — the owning AWS account ID.
- `codeartifact-repository` — the repository name.
- `aws-region` — the AWS region.
- `repository-url` — the fully-composed Maven repository URL
  (`https://<domain>-<owner>.d.codeartifact.<region>.amazonaws.com/maven/<repo>/`).

The authorization token is intentionally **not** exposed as an output — it lives
only in `settings.xml`.

```yaml
- name: Authenticate with CodeArtifact
  id: ca
  uses: OvertureMaps/workflows/.github/actions/setup-codeartifact@main
  with:
    aws-role-arn: arn:aws:iam::123456789012:role/codeartifact-publisher
    codeartifact-domain: overture
    codeartifact-domain-owner: "123456789012"
    codeartifact-repository: maven-releases

- name: Deploy with the piped URL
  run: mvn deploy -DaltDeploymentRepository="overture::${{ steps.ca.outputs.repository-url }}" --settings ~/.m2/settings.xml
```

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

The authorization token is masked in logs and passed from the token step to the
settings step via a step output (not `$GITHUB_ENV`), then embedded into the
`~/.m2/settings.xml` written by an inline bash step (a `cat <<EOF` heredoc — no
third-party action). Keeping it out of `$GITHUB_ENV` means it is not
exposed as an environment variable to later steps — but `settings.xml` itself is
readable by any subsequent step in the job, so still treat the runner as trusted
for the duration of the job and call this action only in jobs you control.

### Runtime

The action pins `aws-actions/configure-aws-credentials` to v6.2.0, which runs on
the Node.js 24 runtime. The `settings.xml` is written by an inline bash step
rather than a third-party action, so this action carries no Node 20 runtime
dependency.

### The repository id must match

Maven only attaches a `<server>`'s credentials to a `<repository>` when their
`<id>` values are byte-for-byte identical. This action writes both the
`<server>` and `<repository>` in `settings.xml` using the `maven-repository-id`
input (default `codeartifact`) — **not** `codeartifact-domain` — specifically
so it matches the id your `pom.xml`'s `<repositories><repository>` declares.

If the ids don't match, `mvn` dependency *resolution* fails with a 401 from
CodeArtifact as soon as the `actions/setup-java` Maven cache is cold (warm
caches mask the bug because Maven never needs to hit the network). Publishing
(`mvn deploy`) is unaffected either way, since it's piped a fully-qualified
`-DaltDeploymentRepository=<id>::default::<url>` at the command line, bypassing
`pom.xml` repository ids entirely.

Keep your `pom.xml` repository id as `codeartifact` (the convention used by
consuming repos) and you don't need to pass `maven-repository-id` at all.

