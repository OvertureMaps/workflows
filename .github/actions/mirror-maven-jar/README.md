# Mirror Public JAR to CodeArtifact <!-- omit in toc -->

A composite GitHub Action that mirrors a single pre-built public JAR into AWS CodeArtifact, skipping the upload if that version already exists. The JAR can be downloaded from a remote URL or supplied as a local file.

- [How-to guides](#how-to-guides)
- [Reference](#reference)
- [Explanation](#explanation)

## How-to guides

### Mirror a public JAR from a URL

`setup-codeartifact` must run earlier in the **same job** to configure AWS
credentials and Maven `settings.xml`.

```yaml
jobs:
  mirror:
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
          codeartifact-repository: maven-third-party

      - name: Mirror libphonenumber
        uses: OvertureMaps/workflows/.github/actions/mirror-maven-jar@main
        with:
          group-id: com.googlecode.libphonenumber
          artifact-id: libphonenumber
          version: "8.13.48"
          jar-url: https://repo1.maven.org/maven2/com/googlecode/libphonenumber/libphonenumber/8.13.48/libphonenumber-8.13.48.jar
          codeartifact-domain: overture
          codeartifact-domain-owner: "123456789012"
          codeartifact-repository: maven-third-party
          aws-region: us-west-2
```

<details>
<summary>Mirror a local JAR file</summary>

Use `jar-path` instead of `jar-url` for a JAR already on disk:

```yaml
- name: Mirror local JAR
  uses: OvertureMaps/workflows/.github/actions/mirror-maven-jar@main
  with:
    group-id: com.example
    artifact-id: my-lib
    version: "1.0.0"
    jar-path: ./vendor/my-lib-1.0.0.jar
    codeartifact-domain: overture
    codeartifact-domain-owner: "123456789012"
    codeartifact-repository: maven-third-party
    aws-region: us-west-2
```

</details>

> Pin to a commit SHA rather than `@main` for reproducible builds, e.g.
> `uses: OvertureMaps/workflows/.github/actions/mirror-maven-jar@<sha>`.

## Reference

### Inputs

- `group-id` (**required**): Maven groupId (e.g. `com.googlecode.libphonenumber`).
- `artifact-id` (**required**): Maven artifactId (e.g. `libphonenumber`).
- `version` (**required**): Maven version to mirror (e.g. `8.13.48`).
- `jar-url` (optional): Remote URL to download the JAR from. Mutually exclusive with `jar-path`.
- `jar-path` (optional): Local path to an existing JAR file. Mutually exclusive with `jar-url`.
- `codeartifact-domain` (**required**): CodeArtifact domain name.
- `codeartifact-domain-owner` (**required**): AWS account ID that owns the CodeArtifact domain.
- `codeartifact-repository` (**required**): CodeArtifact repository name.
- `aws-region` (**required**): AWS region where CodeArtifact is hosted.

### Outputs

This action has no outputs. It either uploads the JAR or skips when the version
already exists.

### Prerequisites

This action neither authenticates nor installs a toolchain, so the job must
provide both before calling it:

- **A JDK + Maven on the runner.** The action invokes `mvn deploy:deploy-file`,
  so `mvn` must be on `PATH` — typically via `actions/setup-java` (with
  `distribution`/`java-version`), which also provisions Maven. GitHub-hosted
  runners include Maven by default; minimal or self-hosted runners may not.
- **`setup-codeartifact` called earlier in the same job.** This action has no
  internal authentication step — it relies on the AWS credentials and
  `~/.m2/settings.xml` that `setup-codeartifact` configures.

## Explanation

### Idempotent mirroring

The action first calls `aws codeartifact describe-package-version`. If the
version already exists, the download and publish steps are skipped, so reruns
are safe and cheap. Only missing versions are fetched and deployed via
`mvn deploy:deploy-file` with a generated pom.

### URL vs local file

`jar-url` and `jar-path` are mutually exclusive. With `jar-url`, the JAR is
downloaded to `_downloaded.jar` and published; with `jar-path`, the existing
file is published in place. When the version is not yet mirrored, a validation
step enforces that exactly one of the two is provided — supplying neither or
both fails fast with a clear error rather than a confusing Maven failure.

### Why it has no auth step

Unlike `publish-maven-to-codeartifact`, this action assumes authentication already
happened in the same job via `setup-codeartifact`. This lets a single job mirror
many JARs after one authentication step, avoiding repeated OIDC role assumptions.
