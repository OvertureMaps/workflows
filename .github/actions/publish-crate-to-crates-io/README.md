# Publish Cargo Crate to crates.io <!-- omit in toc -->

A composite GitHub Action that dry-run publishes a Cargo crate, checks its packaged size against crates.io's 10MB cap, optionally verifies its version against a release tag, and (unless `dry-run-only`) publishes it using caller-provided Cargo credentials.

- [How-to guides](#how-to-guides)
- [Reference](#reference)
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

This action doesn't request OIDC tokens or require a GitHub environment.
The calling workflow sets permissions and any environment required by its
authentication method. The Trusted Publishing example uses `id-token: write`
and an environment matching the crate's Trusted Publisher configuration.
Checkout needs `contents: read`.

### Requirements

- `cargo` and `jq` on `PATH` (both preinstalled on GitHub-hosted `ubuntu-latest` runners).
- Caller-provided Cargo credentials for a real publish, such as `CARGO_REGISTRY_TOKEN` set through the calling step's `env`. No credentials are needed for `dry-run-only: true`.

## Explanation

### Why a shared action

Dry-run, size check, and version check are the same three commands
(`cargo publish --dry-run`, `cargo package` + a `stat` on the `.crate`,
comparing `Cargo.toml`'s version to a tag) whether they gate a real release
or just validate packaging in CI. Consolidating them here means a workspace
with several crates (or several repos) get all three checks for free, called
once per crate, instead of each repo re-deriving its own dry-run/size/version
script.

### Consumer-owned authentication

The action uses Cargo's existing credential configuration without obtaining or
overriding tokens. The caller chooses the authentication method and owns token
scope, refresh, OIDC permissions, and environment configuration.
