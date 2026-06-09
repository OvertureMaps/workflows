# Build and Publish Maven Project to CodeArtifact <!-- omit in toc -->

A composite GitHub Action that builds a Maven project from source and publishes its artifacts to AWS CodeArtifact. It sets up the JDK, authenticates with CodeArtifact, optionally overrides the version for dev builds, deploys, and prints the shaded JAR manifest.

- [How-to guides](#how-to-guides)
- [Reference](#reference)
- [Explanation](#explanation)

## How-to guides

### Publish a release build

```yaml
jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      id-token: write # required for OIDC role assumption
      contents: read
    steps:
      - uses: actions/checkout@v4

      - name: Build and publish to CodeArtifact
        uses: OvertureMaps/workflows/.github/actions/publish-maven-to-codeartifact@main
        with:
          aws-role-arn: arn:aws:iam::123456789012:role/codeartifact-publisher
          codeartifact-domain: overture
          codeartifact-domain-owner: "123456789012"
          codeartifact-repository: maven-releases
```

<details>
<summary>Publish a dev build with an overridden version</summary>

Set `version` to publish a dev-named artifact. The pom version is overridden via
`mvn versions:set` and the build runs with `-Denv=dev`.

```yaml
- name: Publish dev build
  uses: OvertureMaps/workflows/.github/actions/publish-maven-to-codeartifact@main
  with:
    aws-role-arn: arn:aws:iam::123456789012:role/codeartifact-publisher
    codeartifact-domain: overture
    codeartifact-domain-owner: "123456789012"
    codeartifact-repository: maven-snapshots
    version: 1.4.0-dev-${{ github.run_number }}
```

</details>

> Pin to a commit SHA rather than `@main` for reproducible builds, e.g.
> `uses: OvertureMaps/workflows/.github/actions/publish-maven-to-codeartifact@<sha>`.

## Reference

### Inputs

- `aws-role-arn` (**required**): IAM role ARN to assume via OIDC for CodeArtifact access.
- `aws-region` (optional): AWS region where CodeArtifact is hosted. Default `us-west-2`.
- `codeartifact-domain` (**required**): CodeArtifact domain name.
- `codeartifact-domain-owner` (**required**): AWS account ID that owns the CodeArtifact domain.
- `codeartifact-repository` (**required**): CodeArtifact repository name.
- `version` (optional): Artifact version override. When set, the pom version is overridden via `mvn versions:set` and the project is built with dev naming (`-Denv=dev`). When empty (default), the project's release version is published unchanged (`-Denv=release`).
- `working-directory` (optional): Directory containing the Maven project (its `pom.xml` and `.java-version`). Defaults to the repository root (`.`). Set this to publish a project that lives in a subdirectory.
- `commit` (optional): Commit SHA recorded as `build.commit` in the JAR manifest. Defaults to the checked-out workspace HEAD (`git rev-parse HEAD`), which matches the tree actually built — unlike `github.sha`, which is the merge-ref SHA on `pull_request` events. Override only if the build tree is not a git checkout.

### Outputs

This action has no outputs. It deploys the project's artifacts to CodeArtifact
and prints the shaded JAR's `MANIFEST.MF` to the step log.

### Permissions

```yaml
permissions:
  id-token: write
  contents: read
```

The assumed IAM role must allow `codeartifact:GetAuthorizationToken`,
`sts:GetServiceBearerToken`, and the publish actions for the target repository.

### Requirements

- A `.java-version` file in the `working-directory` (consumed by `actions/setup-java`).
- A Maven build that produces a `*-shaded.jar` under `target/`.
- A git checkout (the default `actions/checkout` state) so `build.commit` can
  default to the workspace HEAD. Pass the `commit` input if the tree is not a
  git checkout.

## Explanation

### What it does

The action runs four phases in one job step: JDK setup (Temurin, version from
`.java-version`, Maven cache), CodeArtifact authentication (delegated to
`setup-codeartifact`), an optional `mvn versions:set` when `version` is
supplied, then `mvn clean deploy` with build provenance properties
(`build.branch`, `build.commit`, `workflow.run_id`, `workflow.run_number`). Tests
are skipped during deploy; run them in a separate CI step.

### Commit provenance

`build.commit` defaults to the checked-out workspace HEAD (`git rev-parse HEAD`),
not `github.sha`. On `pull_request` events `github.sha` is the ephemeral
merge-ref SHA, which diverges from the commit a caller actually checked out
(e.g. `pull_request.head.sha`). Deriving it from HEAD keeps the manifest's commit
in lock-step with the built tree regardless of the caller's checkout strategy;
pass the `commit` input to override.

### Release vs dev publishing

The `version` input switches between two modes. Empty publishes the pom's
release version unchanged with `-Denv=release`. A non-empty value overrides the
pom version and builds with `-Denv=dev`, enabling dev-named snapshot publishing
without editing the pom in source control.

### Self-referential authentication

Inside a composite action, `uses: ./...` resolves against the **caller's**
checkout, not this repo. So the internal authentication step references
`OvertureMaps/workflows/.github/actions/setup-codeartifact@main` by full path
(with a `zizmor: ignore[unpinned-uses]` comment) rather than a `./` relative
path. The `@main` ref is tightened to a commit SHA in a follow-up once merged.
