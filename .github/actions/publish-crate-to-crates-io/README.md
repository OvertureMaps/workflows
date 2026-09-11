# Publish Cargo Crate to crates.io <!-- omit in toc -->

A composite GitHub Action that dry-run publishes a Cargo crate, checks its packaged size against crates.io's 10MB cap, optionally verifies its version against a release tag, and (unless `dry-run-only`) publishes it using caller-provided Cargo credentials.

This action targets crates.io Trusted Publishing only. It isn't a generic registry
publisher.

- [How-to guides](#how-to-guides)
- [Reference](#reference)
- [Testing](#testing)
- [Explanation](#explanation)

## How-to guides

### Publish a crate on release

The calling workflow owns authentication. This example uses crates.io Trusted
Publishing and passes its short-lived token through `CARGO_REGISTRY_TOKEN`.

```yaml
on:
  release:
    types: [created]

jobs:
  publish:
    runs-on: ubuntu-latest
    environment: crates-io # must match the crate's Trusted Publisher config
    permissions:
      contents: read
      id-token: write # required to mint the crates.io OIDC token
    steps:
      - uses: actions/checkout@v4

      - name: Authenticate with crates.io
        id: auth
        uses: rust-lang/crates-io-auth-action@c6f97d42243bad5fab37ca0427f495c86d5b1a18 # v1.0.5

      - name: Publish my-crate
        uses: OvertureMaps/workflows/.github/actions/publish-crate-to-crates-io@main
        env:
          CARGO_REGISTRY_TOKEN: ${{ steps.auth.outputs.token }}
        with:
          manifest-path: my-crate/Cargo.toml
          release-tag: ${{ github.event.release.tag_name }}
```

### Publish multiple crates in dependency order

Call the action once per crate, in dependency order. The caller supplies
credentials for each invocation:

```yaml
- name: Authenticate for base crate
  id: auth-base
  uses: rust-lang/crates-io-auth-action@c6f97d42243bad5fab37ca0427f495c86d5b1a18 # v1.0.5

- name: Publish base crate
  uses: OvertureMaps/workflows/.github/actions/publish-crate-to-crates-io@main
  env:
    CARGO_REGISTRY_TOKEN: ${{ steps.auth-base.outputs.token }}
  with:
    manifest-path: base-crate/Cargo.toml
    release-tag: ${{ github.event.release.tag_name }}

- name: Authenticate for dependent crate
  id: auth-dependent
  uses: rust-lang/crates-io-auth-action@c6f97d42243bad5fab37ca0427f495c86d5b1a18 # v1.0.5

- name: Publish dependent crate
  uses: OvertureMaps/workflows/.github/actions/publish-crate-to-crates-io@main
  env:
    CARGO_REGISTRY_TOKEN: ${{ steps.auth-dependent.outputs.token }}
  with:
    manifest-path: dependent-crate/Cargo.toml
    release-tag: ${{ github.event.release.tag_name }}
```

This example authenticates before each crate. Credential scope and refresh
remain the caller's responsibility.

<details>
<summary>Validate packaging on every push/PR, without publishing</summary>

Set `dry-run-only: true` and drop `release-tag`. This needs no `environment`,
no `id-token: write`, and no credentials:

```yaml
jobs:
  check-packaging:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4

      - name: Check my-crate packages cleanly
        uses: OvertureMaps/workflows/.github/actions/publish-crate-to-crates-io@main
        with:
          manifest-path: my-crate/Cargo.toml
          dry-run-only: "true"
```

</details>

> Pin to a commit SHA rather than `@main` for reproducible builds, e.g.
> `uses: OvertureMaps/workflows/.github/actions/publish-crate-to-crates-io@<sha>`.

## Reference

### Inputs

- `manifest-path` (**required**): Path to the crate's `Cargo.toml`, relative to the repository root.
- `release-tag` (optional): Git tag the release is cut from (e.g. `v1.2.3` or `1.2.3`). When set, the crate's `Cargo.toml` version must match it exactly (a leading `v` is stripped before comparing). Leave empty to skip the check, e.g. for a CI dry-run that has no release tag yet.
- `max-crate-size-bytes` (optional): Maximum allowed packaged `.crate` size, in bytes. Default `10485760` (10MB, crates.io's upload cap).
- `dry-run-only` (optional): When `"true"`, stops after the dry-run and size check without publishing. No credentials needed. Default `"false"`.

### Outputs

- `crate-name`: The crate's name, read from its `Cargo.toml`.
- `crate-version`: The crate's version, read from its `Cargo.toml`.
- `crate-size-bytes`: The packaged `.crate` file size, in bytes.

### Permissions

This action doesn't request OIDC tokens or configure a GitHub environment.
The calling workflow grants `id-token: write` for crates.io Trusted Publishing
and configures any environment required by the crate's Trusted Publisher settings.
Checkout needs `contents: read`.

### Requirements

- Bash and GNU `stat` (the action runs on Linux runners).
- `cargo` and `jq` on `PATH` (both preinstalled on GitHub-hosted `ubuntu-latest` runners).
- For a real publish, the caller obtains a short-lived token through crates.io Trusted Publishing/OIDC and passes it as `CARGO_REGISTRY_TOKEN` through the calling step's `env`. No credentials are needed for `dry-run-only: true`.

### Job summary

Each invocation appends a crate table to `$GITHUB_STEP_SUMMARY` with the name,
version, release-tag check, package size and limit in bytes, and result.
Failed runs name the failed stage and retain the original exit code.
Unmeasured sizes are marked `Not measured`; `Published` appears only after
`cargo publish` succeeds. The summary contains no credentials or authentication
status. Local runs without `$GITHUB_STEP_SUMMARY` skip the summary.

## Testing

Run from the repository root with Bats 1.5.0 or later, Bash, `jq`, GNU `stat`,
and GNU `truncate` on `PATH`:

```bash
bats .github/actions/publish-crate-to-crates-io/tests/
```

The tests execute the action's shell entrypoint with mocked Cargo commands and
local fixtures. They cover release tags, size limits, paths with spaces, Cargo
failures, outputs, job summaries, and inherited credentials without network builds
or publication.
The path-filtered `test-publish-crate-to-crates-io.yml` workflow runs the same suite.
Real Cargo builds, crates.io authentication, and publication need a consumer workflow
test.

## Explanation

### Why a shared action

Dry-run, size check, and version check are the same three commands
(`cargo publish --dry-run`, `cargo package` + a `stat` on the `.crate`,
comparing `Cargo.toml`'s version to a tag) whether they gate a real release
or just validate packaging in CI. Consolidating them here means a workspace
with several crates (or several repos) gets all three checks for free, called
once per crate, instead of each repo re-deriving its own dry-run/size/version
script.

### Consumer-owned authentication

The action uses Cargo's existing credential configuration without obtaining or
overriding tokens. The caller owns crates.io Trusted Publishing authentication,
token scope and refresh, OIDC permissions, and environment configuration.
The action doesn't validate token provenance.

### Package location

The size check reads `target_directory` from `cargo metadata`, so workspace
members and custom target directories use Cargo's configured package location.
