# s5cmd <!-- omit in toc -->

A composite GitHub Action that installs [s5cmd](https://github.com/peak/s5cmd) at a pinned version and runs a single S3 operation. The interface mirrors the `aws s3` CLI so it is immediately familiar.

- [How-to guides](#how-to-guides)
- [Reference](#reference)
- [Explanation](#explanation)

## How-to guides

### Copy a local file to S3

```yaml
- name: Upload artifact
  uses: OvertureMaps/workflows/.github/actions/s5cmd@main
  with:
    command: cp
    source: ./dist/output.parquet
    destination: s3://my-bucket/builds/output.parquet
```

<details>
<summary>Copy with additional flags</summary>

```yaml
- name: Upload with ACL
  uses: OvertureMaps/workflows/.github/actions/s5cmd@main
  with:
    command: cp
    flags: --acl public-read --cache-control max-age=3600
    source: ./dist/output.parquet
    destination: s3://my-bucket/builds/output.parquet
```

</details>

<details>
<summary>Sync a directory to S3</summary>

```yaml
- name: Sync build output
  uses: OvertureMaps/workflows/.github/actions/s5cmd@main
  with:
    command: sync
    source: ./dist/
    destination: s3://my-bucket/builds/
```

</details>

<details>
<summary>Delete an object</summary>

```yaml
- name: Remove stale artifact
  uses: OvertureMaps/workflows/.github/actions/s5cmd@main
  with:
    command: rm
    source: s3://my-bucket/builds/old-output.parquet
```

</details>

<details>
<summary>Move (rename) an S3 object</summary>

```yaml
- name: Promote artifact
  uses: OvertureMaps/workflows/.github/actions/s5cmd@main
  with:
    command: mv
    source: s3://my-bucket/staging/output.parquet
    destination: s3://my-bucket/release/output.parquet
```

</details>

<details>
<summary>Run a batch of operations from a manifest</summary>

Create a manifest file with one s5cmd command per line:

```
cp s3://src-bucket/a.parquet s3://dst-bucket/a.parquet
cp s3://src-bucket/b.parquet s3://dst-bucket/b.parquet
rm s3://old-bucket/stale.parquet
```

Then pass it via `batch-file`:

```yaml
- name: Batch upload
  uses: OvertureMaps/workflows/.github/actions/s5cmd@main
  with:
    command: run
    batch-file: ./commands.txt
```

</details>

<details>
<summary>Use with AWS credentials</summary>

Credentials must be configured before this action runs:

```yaml
jobs:
  upload:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/my-role
          aws-region: us-east-1

      - name: Upload build artifact
        uses: OvertureMaps/workflows/.github/actions/s5cmd@main
        with:
          command: cp
          source: ./dist/output.parquet
          destination: s3://my-bucket/builds/output.parquet
```

</details>

## Reference

### Subcommand mapping

| aws s3 | s5cmd | Notes |
|---|---|---|
| `aws s3 cp` | `cp` | Copy objects between local and S3, or S3-to-S3 |
| `aws s3 mv` | `mv` | Move (copy + delete) |
| `aws s3 rm` | `rm` | Delete objects |
| `aws s3 ls` | `ls` | List objects or buckets |
| `aws s3 sync` | `sync` | Incremental sync between local and S3 |
| _(no equivalent)_ | `run` | Batch mode: execute a manifest file of s5cmd commands concurrently |

### Inputs

- `command` (**required**): s5cmd subcommand to execute. Must be one of: `cp`, `mv`, `rm`, `ls`, `sync`, `run`. An unsupported value fails the validation step immediately with a clear error.

- `source` (optional): Source path for `cp`, `mv`, `rm`, `ls`, and `sync`  a local filesystem path or an S3 URI (`s3://bucket/key`). Not valid with `run`; use `batch-file` instead.

- `destination` (optional): Destination path  a local filesystem path or an S3 URI (`s3://bucket/key`). Required for `cp`, `mv`, and `sync`. Not valid with `run`.

- `batch-file` (optional): Local path to a manifest file, for use with `run` only. Each line contains one complete s5cmd command. Not valid with any other subcommand; use `source` instead.

- `flags` (optional): Additional flags for the subcommand, as a single string. Passed before the positional arguments. Example: `"--acl public-read --storage-class STANDARD_IA"`.

- `version` (optional): s5cmd release version to install. Defaults to `2.3.0`. Prefer the default to ensure reproducible builds across all callers.

### Outputs

This action has no outputs. It passes or fails the step based on the s5cmd exit code.

### Permissions

This action performs no GitHub API calls; no `permissions` block is required on the job.

AWS permissions are governed entirely by the IAM role or credentials configured before this action runs. The role must have sufficient S3 permissions for the operation (e.g. `s3:PutObject` for `cp`, `s3:DeleteObject` for `rm`).

### Supported runner operating systems

Support mirrors [`peak/action-setup-s5cmd`](https://github.com/peak/action-setup-s5cmd): Linux and macOS runners are supported. Windows runners are not.

| OS | Supported |
|---|:---:|
| `ubuntu-*` (Linux) | ✅ |
| `macos-*` | ✅ |
| `windows-*` | ❌ |

### Caching

Installation caching is handled by [`peak/action-setup-s5cmd`](https://github.com/peak/action-setup-s5cmd). No additional cache configuration is needed.

## Explanation

### How installation works

Installation is delegated to [`peak/action-setup-s5cmd`](https://github.com/peak/action-setup-s5cmd), the official setup action maintained by the s5cmd authors. It queries the GitHub Releases API to find the correct asset for the runner OS and architecture, downloads it, and adds the binary to `PATH`. Pinning to a specific commit SHA of `action-setup-s5cmd` ensures the install behaviour is reproducible alongside the s5cmd version pin.

### Why s5cmd instead of the aws s3 CLI

| Capability | `aws s3` CLI | `s5cmd` |
|---|:---:|:---:|
| Parallel transfers (default) | ❌ single-thread | ✅ concurrent |
| Transfer speed on large workloads | Baseline | 10–100× faster |
| Pinned, single static binary | ❌ | ✅ |
| Familiar subcommands | ✅ | ✅ |
| S3-compatible storage (MinIO, R2, etc.) | ✅ | ✅ |
| Wildcard / glob support | Limited | ✅ |
| Runs without Python runtime | ❌ | ✅ |

s5cmd ships as a self-contained static binary with no runtime dependencies, making it fast to install and immune to Python or boto3 version conflicts in the runner environment.

### The authentication boundary

This action deliberately performs no credential configuration. AWS credentials must already be present in the environment before this action runs — typically via `aws-actions/configure-aws-credentials`. This separation keeps credential management as a single, auditable step in your workflow rather than embedding it inside every S3 operation.

### The source / batch-file distinction

Standard subcommands (`cp`, `mv`, `rm`, `ls`, `sync`) operate on explicit paths via `source` and `destination`. The `run` subcommand is different: it reads a manifest file of pre-composed s5cmd commands and executes them all concurrently. Because the two models are structurally incompatible, they use separate inputs — `source` for path-based commands, `batch-file` for `run`. Providing the wrong input for a given subcommand fails the validation step immediately with a clear error.

### Why batch mode matters

Unlike the `aws s3` CLI, which processes operations sequentially, s5cmd's `run` dispatches all commands in the manifest simultaneously. For workloads involving hundreds or thousands of objects, this is the primary reason to prefer s5cmd over the aws CLI — a manifest of 10,000 copy operations completes in roughly the same wall-clock time as a single one.
