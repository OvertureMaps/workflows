# uv Publish to CodeArtifact <!-- omit in toc -->

A composite GitHub Action that publishes an already-built Python wheel/sdist to an AWS CodeArtifact pypi repository via `uv publish`. It installs `uv`, authenticates with CodeArtifact, and publishes — re-running it for a version that's already published is a no-op instead of a failure.

- [How-to guides](#how-to-guides)
- [Reference](#reference)
- [Explanation](#explanation)

## How-to guides

### Publish a build

Build the package first (this action doesn't build it — see [Explanation](#why-this-action-doesnt-build-the-package)), then publish:

```yaml
jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      id-token: write # required for OIDC role assumption
      contents: read
    steps:
      - uses: actions/checkout@v4

      - uses: astral-sh/setup-uv@v10
      - run: uv build

      - name: Publish to CodeArtifact
        uses: OvertureMaps/workflows/.github/actions/uv-publish-to-codeartifact@main
        with:
          aws-role-arn: arn:aws:iam::123456789012:role/codeartifact-publisher
          codeartifact-domain: overture-pypi
          codeartifact-domain-owner: "123456789012"
          codeartifact-repository: overture
```

> Pin to a commit SHA rather than `@main` for reproducible builds, e.g.
> `uses: OvertureMaps/workflows/.github/actions/uv-publish-to-codeartifact@<sha>`.

### Dual-publish to two CodeArtifact accounts

To publish the same build to two CodeArtifact accounts in one job (e.g. a
legacy account and a new MCD-mirrored one during a migration), call the
action twice with distinct role/domain/owner inputs:

```yaml
- name: Publish to legacy CodeArtifact
  uses: OvertureMaps/workflows/.github/actions/uv-publish-to-codeartifact@main
  with:
    aws-role-arn: arn:aws:iam::505071440022:role/codeartifact-publisher
    codeartifact-domain: overture-pypi
    codeartifact-domain-owner: "505071440022"
    codeartifact-repository: overture

- name: Publish to MCD CodeArtifact
  uses: OvertureMaps/workflows/.github/actions/uv-publish-to-codeartifact@main
  with:
    aws-role-arn: arn:aws:iam::763944545891:role/codeartifact-publisher
    codeartifact-domain: overture-pypi
    codeartifact-domain-owner: "763944545891"
    codeartifact-repository: overture
```

Since each call's `--check-url` only checks that call's own index, a version
already published to one account is unaffected by (and doesn't skip)
publishing to the other.

### Publishing a subdirectory project

```yaml
- name: Publish to CodeArtifact
  uses: OvertureMaps/workflows/.github/actions/uv-publish-to-codeartifact@main
  with:
    aws-role-arn: arn:aws:iam::123456789012:role/codeartifact-publisher
    codeartifact-domain: overture-pypi
    codeartifact-domain-owner: "123456789012"
    codeartifact-repository: overture
    working-directory: python/
```

## Reference

### Inputs

- `aws-role-arn` (**required**): IAM role ARN to assume via OIDC for CodeArtifact access.
- `aws-region` (optional): AWS region where CodeArtifact is hosted. Default `us-west-2`.
- `codeartifact-domain` (**required**): CodeArtifact domain name.
- `codeartifact-domain-owner` (**required**): AWS account ID that owns the CodeArtifact domain.
- `codeartifact-repository` (**required**): CodeArtifact repository name.
- `files` (optional): Glob of already-built distribution files to publish. Default `dist/*`. Resolved relative to `working-directory`.
- `working-directory` (optional): Directory containing the built distribution files. Defaults to the repository root (`.`). Set this to publish a project that lives in a subdirectory.
- `check-url` (optional): Whether to pass `--check-url` to `uv publish` so re-running this action for an already-published version is a no-op instead of a failure (see [Idempotent re-runs via `--check-url`](#idempotent-re-runs-via---check-url)). Default `true`. Set to `false` only if the target index doesn't support the check, or duplicate versions should hard-fail instead of no-op.

### Outputs

This action has no outputs. Its job ends at publish; if a later step needs
CodeArtifact metadata (domain, region, tokens, etc.), call
[`setup-codeartifact`](../setup-codeartifact/README.md) directly instead of
(or alongside) this action.

### Permissions

```yaml
permissions:
  id-token: write
  contents: read
```

The assumed IAM role must allow `codeartifact:GetAuthorizationToken`,
`sts:GetServiceBearerToken`, and `codeartifact:PublishPackageVersion` (plus
the other write actions CodeArtifact requires) for the target repository.

### Requirements

- The distribution files matched by `files` must already exist under
  `working-directory` (build them with `uv build` or equivalent in an earlier
  step).

## Explanation

### What it does

The action runs three steps: installs `uv` (`astral-sh/setup-uv`),
authenticates with CodeArtifact (delegated to
[`setup-codeartifact`](../setup-codeartifact/README.md) with `format: pypi`),
then runs `uv publish` with the composed publish/index URLs and the
CodeArtifact token as credentials.

### Why this action doesn't build the package

`publish-maven-to-codeartifact`, the Maven equivalent, builds the project
itself because Maven projects share one `mvn clean deploy` convention. Python
projects don't: version derivation, build backends, and directory layout vary
per repo (e.g. places-quality-model computes its version from commit count by
rewriting `__version__` before calling `uv build`). Building here would mean
either picking one convention and forcing it on every caller, or growing
enough options to reimplement each repo's build step anyway. Instead, this
action starts from an already-built `dist/` (or caller-specified `files`),
the same boundary `uv publish` itself draws.

### Idempotent re-runs via `--check-url`

`uv publish` retries failed uploads on its own, but a partially-failed
publish (some files uploaded, some not) needs a safe way to retry the whole
command. `--check-url <index>` (passed here as the CodeArtifact pypi index
URL, i.e. `pypi-index-url` from `setup-codeartifact`, not the publish
endpoint) checks that index for files that already exist byte-identical to
what's being uploaded and skips them, including races between parallel
uploads. That makes re-running this action for a version that's already
published a no-op instead of a failure — no custom skip-logic needed. See the
[uv publish guide](https://docs.astral.sh/uv/guides/package/#publishing-your-package)
for details.

This is on by default (`check-url: true`). Set it to `false` only if the
target index can't be queried the way `--check-url` expects, or a duplicate
version should hard-fail rather than silently no-op.

### Self-referential authentication

Inside a composite action, `uses: ./...` resolves against the **caller's**
checkout, not this repo. So the internal authentication step references
`OvertureMaps/workflows/.github/actions/setup-codeartifact@main` by full path
(with a `zizmor: ignore[unpinned-uses]` comment) rather than a `./` relative
path, mirroring `publish-maven-to-codeartifact`.
