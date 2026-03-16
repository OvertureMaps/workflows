# generate-schema-docs

A composite GitHub Action that generates Markdown reference documentation from the
Pydantic schema models in [OvertureMaps/schema](https://github.com/OvertureMaps/schema)
using the `overture-codegen` tool.

- [How-to guides](#how-to-guides)
- [Reference](#reference)
- [Explanation](#explanation)

## How-to guides

### Generate docs from the latest schema (default)

The simplest usage: check out the schema at `main` and write generated Markdown into
a directory of your choice.

```yaml
- name: Generate schema markdown docs
  uses: OvertureMaps/workflows/.github/actions/generate-schema-docs@main
  with:
    output-dir: ${{ github.workspace }}/docs/schema/reference
```

### Pin to a specific schema version

Use `schema-ref` to target a release tag or commit SHA instead of `main`:

```yaml
- name: Generate schema markdown docs
  uses: OvertureMaps/workflows/.github/actions/generate-schema-docs@main
  with:
    output-dir: ${{ github.workspace }}/docs/schema/reference
    schema-ref: v1.4.0
```

### Use when the schema repo is already checked out

If your workflow has already checked out `OvertureMaps/schema` (e.g. because it
runs inside that repo's own CI), pass `skip-checkout: 'true'` and point
`schema-path` at the existing checkout:

```yaml
- name: Check out schema repo
  uses: actions/checkout@v6

# ... other steps ...

- name: Generate schema markdown docs
  uses: OvertureMaps/workflows/.github/actions/generate-schema-docs@main
  with:
    output-dir: ${{ github.workspace }}/_docs/docs/schema/reference
    schema-path: .        # schema is checked out at the workspace root
    skip-checkout: 'true'
```

### Use a custom checkout path

If you need the schema checked out at a non-default location (e.g. to avoid
colliding with another checkout), set `schema-path`:

```yaml
- name: Generate schema markdown docs
  uses: OvertureMaps/workflows/.github/actions/generate-schema-docs@main
  with:
    output-dir: ${{ github.workspace }}/site/reference
    schema-path: _schema-v2
    schema-ref: v2.0.0-rc1
```

## Reference

### Inputs

| Input | Required | Default | Description |
| --- | :---: | --- | --- |
| `output-dir` | ✅ | — | Directory where generated Markdown files are written. Accepts an absolute path or a path relative to `GITHUB_WORKSPACE`. Created by `overture-codegen` if it does not already exist. |
| `schema-ref` | | `main` | Branch, tag, or SHA of `OvertureMaps/schema` to check out. Ignored when `skip-checkout` is `'true'`. |
| `schema-path` | | `_schema` | Path (relative to `GITHUB_WORKSPACE`) where the schema repo is checked out. Used as the checkout destination, the source of `.python-version`, and the working directory for package installation and code generation. |
| `skip-checkout` | | `'false'` | Set to `'true'` to skip checking out the schema repo. Use this when the repo is already present at `schema-path` — for example, when running inside the schema repo's own CI. |

### Outputs

This action has no outputs. Generated files are written directly to `output-dir`.

### Permissions

This action performs no GitHub API calls and requires no `permissions` block.

### Prerequisites

Python and uv do not need to be pre-installed — the action sets them up itself using
`actions/setup-python` and `astral-sh/setup-uv`. The Python version is read from
`.python-version` inside the schema repo.

## Explanation

### What it does

The action runs the `overture-codegen` CLI (the `overture-schema-codegen` package
from `OvertureMaps/schema`) with `generate --format markdown`. This tool introspects
the Pydantic models that define the Overture schema and emits one Markdown file per
type, suitable for rendering as a Docusaurus reference section.

### Why this lives in the workflows repo

Originally this action lived inside `OvertureMaps/schema`. Both the `docs` and
`schema` repos need to build schema reference previews (the `docs` repo for its
staging deploy, the `schema` repo for PR previews). Centralising the action here
means the generation logic is defined once and versioned independently of either
consumer.

### The `skip-checkout` escape hatch

Composite actions cannot be self-referential — a workflow running inside
`OvertureMaps/schema` cannot ask this action to check out `OvertureMaps/schema`
again on top of itself. `skip-checkout: 'true'` lets the caller signal that the
repo is already in place, so the action skips the checkout step and uses whatever
is at `schema-path`.

### Python environment

Dependencies are installed with [uv](https://github.com/astral-sh/uv) via `uv sync`,
scoping the install to the `overture-schema` and `overture-schema-codegen` packages
only, with `--no-dev` to keep the environment lean. `uv run` is used to invoke the
CLI so that it executes inside the managed virtual environment without requiring an
explicit activation step.
