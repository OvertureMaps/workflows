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
- `token-env-var` (optional): Name of the environment variable the masked CodeArtifact token is exported to via `$GITHUB_ENV`, available to every later step in the job. Default `CODEARTIFACT_AUTH_TOKEN`. Set to an empty string to skip the export and rely on the `token` output instead (see [Using the token with tools that wrap Maven](#using-the-token-with-tools-that-wrap-maven)).

### Outputs

The action's primary effect is environmental: it acquires a CodeArtifact
authorization token (masked, exported to `$GITHUB_ENV` under `token-env-var`)
and writes `~/.m2/settings.xml`. It also echoes the CodeArtifact metadata back
as outputs so later steps can pipe from a single source of truth instead of
re-specifying it:

- `codeartifact-domain` — the domain name.
- `codeartifact-domain-owner` — the owning AWS account ID.
- `codeartifact-repository` — the repository name.
- `aws-region` — the AWS region.
- `repository-url` — the fully-composed Maven repository URL
  (`https://<domain>-<owner>.d.codeartifact.<region>.amazonaws.com/maven/<repo>/`).
- `token` — the masked CodeArtifact authorization token. Only needed if you
  set `token-env-var` to an empty string and want the token scoped to a single
  step instead of the whole job (see below).

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

### Using the token with tools that wrap Maven

By default the token is exported to `$GITHUB_ENV` as `CODEARTIFACT_AUTH_TOKEN`
— the same convention used by `aws-actions/configure-aws-credentials` (which
exports `AWS_*`) and AWS's own CodeArtifact docs — so it's ambiently available
to every later step in the job, no extra wiring required. Tools that shell out
to Maven internally using their own settings file (e.g. `databricks bundle
deploy` running a Maven build against a project's checked-in
`.m2/settings.xml`, which expects the token via `${env.SOME_VAR}`) can read it
directly, renaming it via `token-env-var` if they expect a different name:

```yaml
- name: Authenticate with CodeArtifact
  uses: OvertureMaps/workflows/.github/actions/setup-codeartifact@main
  with:
    aws-role-arn: arn:aws:iam::123456789012:role/codeartifact-publisher
    codeartifact-domain: overture
    codeartifact-domain-owner: "123456789012"
    codeartifact-repository: maven-releases
    token-env-var: OVERTURE_CODEARTIFACT_AUTH_TOKEN

- name: Deploy via Databricks bundle (wraps its own Maven build)
  run: databricks bundle deploy
```

If you'd rather not expose the token job-wide, set `token-env-var: ""` and
wire the `token` output narrowly onto just the one step that needs it instead:

```yaml
- name: Authenticate with CodeArtifact
  id: ca
  uses: OvertureMaps/workflows/.github/actions/setup-codeartifact@main
  with:
    aws-role-arn: arn:aws:iam::123456789012:role/codeartifact-publisher
    codeartifact-domain: overture
    codeartifact-domain-owner: "123456789012"
    codeartifact-repository: maven-releases
    token-env-var: ""

- name: Deploy via Databricks bundle (wraps its own Maven build)
  env:
    OVERTURE_CODEARTIFACT_AUTH_TOKEN: ${{ steps.ca.outputs.token }}
  run: databricks bundle deploy
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

The authorization token is masked in logs and exported two ways: to
`$GITHUB_ENV` under `token-env-var` (default `CODEARTIFACT_AUTH_TOKEN`), and
as this action's `token` output — then embedded into the `~/.m2/settings.xml`
written by an inline bash step (a `cat <<EOF` heredoc — no third-party
action). The `$GITHUB_ENV` export follows the same convention used by
`aws-actions/configure-aws-credentials` and AWS's own CodeArtifact docs: it
makes the token ambiently available to every later step in the job, the same
way those tokens are meant to be consumed by arbitrary AWS/Maven tooling.
`settings.xml` is likewise readable by any subsequent step. Treat the runner
as trusted for the duration of the job and call this action only in jobs you
control — same expectation as any other credential-setup action.

If you want the token scoped more narrowly than the whole job, set
`token-env-var: ""` to skip the `$GITHUB_ENV` export and wire the `token`
output onto just the step(s) that need it instead (see [Using the token with
tools that wrap Maven](#using-the-token-with-tools-that-wrap-maven)).

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

