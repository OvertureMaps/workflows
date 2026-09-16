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

<details>
<summary>Publish one profile/module from a multi-platform aggregator pom</summary>

For a root aggregator pom that defines one profile per platform line (e.g. a
Spark 3.5 build and a Spark 4.1 build sharing one module tree), set `profiles`
and `projects` per matrix row instead of `working-directory`, since the
profiles only exist in the root pom. Use `revision` if the pom's version comes
from the CI-friendly `${revision}` property rather than a hardcoded version,
and `java-version` if the platform line needs a JDK other than the one in
`.java-version`.

```yaml
- name: Publish spark35 build
  uses: OvertureMaps/workflows/.github/actions/publish-maven-to-codeartifact@main
  with:
    aws-role-arn: arn:aws:iam::123456789012:role/codeartifact-publisher
    codeartifact-domain: overture
    codeartifact-domain-owner: "123456789012"
    codeartifact-repository: maven-releases
    profiles: spark35
    projects: my-module
    revision: 1.4.0
    java-version: "11"
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
- `maven-repository-id` (optional): The Maven `<server>`/`<repository>` id used for CodeArtifact auth and deploy. Default `codeartifact`. Must match the id your `pom.xml`'s `<repositories><repository>` declares, otherwise Maven silently skips attaching CodeArtifact credentials when *resolving* dependencies. Only override this if your repo's convention differs from `codeartifact`.
- `version` (optional): Artifact version override. When set, the pom version is overridden via `mvn versions:set` and the project is built with dev naming (`-Denv=dev`). When empty (default), the project's release version is published unchanged (`-Denv=release`). Mutually exclusive with `revision`.
- `revision` (optional): Value for the `-Drevision` property, for poms that use the CI-friendly `${revision}` version placeholder instead of a hardcoded version. Passed straight through to `mvn deploy` rather than rewriting the pom. Setting it also builds with `-Denv=dev`. Mutually exclusive with `version`.
- `profiles` (optional): Comma-separated Maven profiles to activate, passed as `-P`.
- `projects` (optional): Comma-separated Maven reactor projects to build, passed as `-pl`. Use this instead of `working-directory` when a module can't be built standalone, e.g. its build profiles live in the root aggregator pom. When set, the manifest step looks under `<projects>/target` for the built JAR instead of `target`.
- `working-directory` (optional): Directory containing the Maven project (its `pom.xml` and `.java-version`). Defaults to the repository root (`.`). Set this to publish a project that lives in a subdirectory.
- `java-version` (optional): JDK version to use, overriding the `.java-version` file in `working-directory`. Set this when the same tree needs different JDKs for different matrix rows.
- `commit` (optional): Commit SHA recorded as `build.commit` in the JAR manifest. Defaults to the checked-out workspace HEAD (`git rev-parse HEAD`), which matches the tree actually built — unlike `github.sha`, which is the merge-ref SHA on `pull_request` events. Override only if the build tree is not a git checkout.

### Outputs

This action has no outputs. It deploys the project's artifacts to CodeArtifact
and prints the built JAR's `MANIFEST.MF` to the step log when one is found.

### Permissions

```yaml
permissions:
  id-token: write
  contents: read
```

The assumed IAM role must allow `codeartifact:GetAuthorizationToken`,
`sts:GetServiceBearerToken`, and the publish actions for the target repository.

### Requirements

- A `.java-version` file in the `working-directory`, unless `java-version` is set.
- A git checkout (the default `actions/checkout` state) so `build.commit` can
  default to the workspace HEAD. Pass the `commit` input if the tree is not a
  git checkout.

### Testing

The `mvn` argument and JAR-resolution logic lives in `scripts/*.sh`, not
inline in `action.yml`, so it can run under [bats](https://bats-core.readthedocs.io/)
without a real Maven build or CodeArtifact credentials. `tests/*.bats` covers
each script; `.github/workflows/test-publish-maven-to-codeartifact.yml` runs
them on any change under this directory. Run them locally with:

```sh
bats .github/actions/publish-maven-to-codeartifact/tests/
```

## Explanation

### What it does

The action runs four phases in one job step: JDK setup (Temurin, version from
`.java-version` or the `java-version` input, Maven cache), CodeArtifact
authentication (delegated to `setup-codeartifact`), an optional `mvn
versions:set` when `version` is supplied, then `mvn clean deploy` with build
provenance properties (`build.branch`, `build.commit`, `workflow.run_id`,
`workflow.run_number`) plus any `-Drevision`, `-P`, and `-pl` flags from
`revision`, `profiles`, and `projects`. Tests are skipped during deploy; run
them in a separate CI step.

### Commit provenance

`build.commit` defaults to the checked-out workspace HEAD (`git rev-parse HEAD`),
not `github.sha`. On `pull_request` events `github.sha` is the ephemeral
merge-ref SHA, which diverges from the commit a caller actually checked out
(e.g. `pull_request.head.sha`). Deriving it from HEAD keeps the manifest's commit
in lock-step with the built tree regardless of the caller's checkout strategy;
pass the `commit` input to override.

### Release vs dev publishing

The `version` and `revision` inputs each switch the build to `-Denv=dev`.
Empty publishes the pom's release version unchanged with `-Denv=release`. A
non-empty `version` overrides the pom version via `versions:set` (rewriting
the pom in the checkout); a non-empty `revision` instead passes `-Drevision`
straight to `mvn deploy`, for poms that resolve their version from the
CI-friendly `${revision}` property. Use whichever matches how your pom
declares its version — they're mutually exclusive, and the action fails fast
in a validation step if both are set.

### Building a single module from a multi-platform aggregator pom

Some projects define one Maven profile per platform line in a shared root pom
(e.g. separate Spark 3.5 and Spark 4.1 builds over the same module tree). The
profiles only exist in the root pom, so the build has to run from there with
`-pl <module>` rather than pointing `working-directory` at the module — set
`profiles` and `projects` for this instead. The manifest step then looks for
the built JAR under `<projects>/target`. It matches a `*-shaded.jar` first,
falls back to any `*.jar` at the top of that directory, and prints a warning
(without failing the step) if neither is found, since not every module
produces a fat JAR.

### Self-referential authentication

Inside a composite action, `uses: ./...` resolves against the **caller's**
checkout, not this repo. So the internal authentication step references
`OvertureMaps/workflows/.github/actions/setup-codeartifact@main` by full path
(with a `zizmor: ignore[unpinned-uses]` comment) rather than a `./` relative
path. The `@main` ref is tightened to a commit SHA in a follow-up once merged.
