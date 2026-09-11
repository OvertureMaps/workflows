# Publish Cargo Crate to crates.io <!-- omit in toc -->

A composite GitHub Action that dry-run publishes a Cargo crate, checks its packaged size against crates.io's 10MB cap, optionally verifies its version against a release tag, and (unless `dry-run-only`) publishes it for real using a short-lived crates.io Trusted Publishing (OIDC) token.

- [How-to guides](#how-to-guides)
- [Reference](#reference)
- [Explanation](#explanation)

## How-to guides

### Publish a crate on release

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

      - name: Publish my-crate
        uses: OvertureMaps/workflows/.github/actions/publish-crate-to-crates-io@main
        with:
          manifest-path: my-crate/Cargo.toml
          release-tag: ${{ github.event.release.tag_name }}
```

### Publish multiple crates in dependency order

Call the action once per crate, in the order your crates depend on each other:

```yaml
- name: Publish base crate
  uses: OvertureMaps/workflows/.github/actions/publish-crate-to-crates-io@main
  with:
    manifest-path: base-crate/Cargo.toml
    release-tag: ${{ github.event.release.tag_name }}

- name: Publish dependent crate
  uses: OvertureMaps/workflows/.github/actions/publish-crate-to-crates-io@main
  with:
    manifest-path: dependent-crate/Cargo.toml
    release-tag: ${{ github.event.release.tag_name }}
```

Each call re-authenticates on its own: crates.io's Trusted Publishing docs don't confirm one OIDC token is valid for more than one crate, so this action mints a fresh token per invocation rather than sharing one across crates.

<details>
<summary>Validate packaging on every push/PR, without publishing</summary>

Set `dry-run-only: true` and drop `release-tag`. This needs no `environment`,
no `id-token: write`, and no crates.io Trusted Publisher config, since it
never authenticates:

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
- `dry-run-only` (optional): When `"true"`, stops after the dry-run and size check: no crates.io authentication, no real `cargo publish`. Default `"false"`.

### Outputs

- `crate-name`: The crate's name, read from its `Cargo.toml`.
- `crate-version`: The crate's version, read from its `Cargo.toml`.
- `crate-size-bytes`: The packaged `.crate` file size, in bytes.

### Permissions

For a real publish (`dry-run-only` unset or `"false"`):

```yaml
permissions:
  contents: read
  id-token: write
```

Plus a job-level `environment:` matching the crate's Trusted Publisher config on crates.io exactly (repo, workflow file name, and environment name are all part of that config). For `dry-run-only: true`, only `contents: read` is needed; no `environment` or `id-token: write`.

### Requirements

- `cargo` and `jq` on `PATH` (both preinstalled on GitHub-hosted `ubuntu-latest` runners).
- A [crates.io Trusted Publisher configuration](https://crates.io/docs/trusted-publishing) for the crate, naming this repo, the calling workflow's file name, and the `environment` used, unless `dry-run-only: true`.

## Explanation

### Why a shared action

Dry-run, size check, and version check are the same three commands
(`cargo publish --dry-run`, `cargo package` + a `stat` on the `.crate`,
comparing `Cargo.toml`'s version to a tag) whether they gate a real release
or just validate packaging in CI. Consolidating them here means a workspace
with several crates (or several repos) get all three checks for free, called
once per crate, instead of each repo re-deriving its own dry-run/size/version
script.

### Trusted Publishing, not a stored token

This action never takes a `CARGO_REGISTRY_TOKEN` input. It authenticates via
[`rust-lang/crates-io-auth-action`](https://github.com/rust-lang/crates-io-auth-action),
which exchanges the caller's GitHub Actions OIDC identity token for a
short-lived crates.io token, scoped to whatever repo/workflow/environment
combination the crate's Trusted Publisher config on crates.io names. There's
no long-lived secret to store, rotate, or leak.

### Per-crate re-authentication

Each call to this action authenticates on its own before publishing. crates.io's
docs describe a Trusted Publisher configuration as being registered per crate,
but don't document whether a single minted token is valid across more than one
crate in the same job. Re-authenticating per crate avoids relying on that
undocumented behavior, at the cost of one extra OIDC round-trip per crate.
