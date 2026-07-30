# Sync Issue Fields <!-- omit in toc -->

A composite GitHub Action that syncs an issue form's Type/Scope-style dropdown
answers onto the repo-level issue `type` and an org-level issue field, without
clobbering values already set by manual triage.

- [How-to guides](#how-to-guides)
- [Reference](#reference)
- [Explanation](#explanation)

## How-to guides

### Sync Type and Scope on newly opened issues

```yaml
# .github/workflows/sync-issue-fields.yml
name: Sync issue fields

on:
  issues:
    types: [opened]

concurrency:
  group: sync-issue-fields-${{ github.event.issue.number }}
  cancel-in-progress: true

jobs:
  sync-fields:
    runs-on: ubuntu-latest
    permissions:
      issues: write
    steps:
      - name: Sync Type and Scope
        uses: OvertureMaps/workflows/.github/actions/sync-issue-fields@main
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

> Pin to a commit SHA rather than `@main` for reproducible builds, e.g.
> `uses: OvertureMaps/workflows/.github/actions/sync-issue-fields@<sha>`.

This assumes an issue form with `type` and `scope` fields (matching the
default `type-form-field`/`scope-form-field` inputs) and an org-level issue
field named `Scope`. Nothing happens if the issue wasn't created from a
template with those fields.

### Use different form field IDs or org field name

If your issue form uses different field `id`s, or the org-level field isn't
named `Scope`, point the action at them explicitly:

```yaml
- name: Sync Type and Priority
  uses: OvertureMaps/workflows/.github/actions/sync-issue-fields@main
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    scope-form-field: priority
    scope-org-field-name: Priority
```

### Provide a separate token for the org-field lookup

If `github-token` 403s on `GET /orgs/{org}/issue-fields` (see
[The org-fields token question](#the-org-fields-token-question) below), pass a
GitHub App's credentials to use for that one lookup instead:

```yaml
- name: Sync Type and Scope
  uses: OvertureMaps/workflows/.github/actions/sync-issue-fields@main
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    org-fields-client-id: "Iv23liXXXXXXXXXXXXXX"
    org-fields-private-key: ${{ secrets.SYNC_ISSUE_FIELDS_APP_PEM }}
```

## Reference

### Inputs

- `github-token` (**required**): Token with push access to the repo, used to read and patch the issue. Composite action inputs can't default to the `github.token` context, so this must be passed explicitly, e.g. `${{ secrets.GITHUB_TOKEN }}`.
- `type-form-field` (optional): Issue form field `id` holding the Type dropdown answer. Default `type`.
- `scope-form-field` (optional): Issue form field `id` holding the Scope-equivalent dropdown answer. Default `scope`.
- `scope-org-field-name` (optional): Name of the org-level issue field to write the `scope-form-field` answer to, looked up by name via `GET /orgs/{org}/issue-fields` since field IDs differ per org. Default `Scope`.
- `org-fields-client-id` / `org-fields-private-key` (optional): GitHub App client ID and private key used to generate an installation token for the org-level field lookup only. Falls back to `github-token` when `org-fields-private-key` is empty. `org-fields-private-key` cannot be defaulted, as GitHub Actions doesn't allow secrets as input defaults — pass `${{ secrets.YOUR_APP_PEM }}`.
- `issue-number` (optional): Issue number to operate on. Defaults to the triggering issue (`context.issue.number`). Override for testing or non-`issues` triggers.

### Outputs

This action has no outputs. It either patches the issue or skips.

### Permissions

Requires a `github-token` with:

```yaml
permissions:
  issues: write
```

### Supported trigger events

The action reads `issue-number` (input) or `context.issue.number`, so it must
run on an `issues` event, or pass `issue-number` explicitly from another
trigger.

## Explanation

### Why one PATCH for two fields

Both writes happen in a single `PATCH /repos/{owner}/{repo}/issues/{issue_number}`
call, which accepts a `type` string param (the repo-level system field) and an
`issue_field_values: [{field_id, value}]` array (org-level custom fields) —
confirmed against the [GitHub REST API OpenAPI spec](https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/dereferenced/api.github.com.deref.json)
(`patch /repos/{owner}/{repo}/issues/{issue_number}`, properties `type` and
`issue_field_values`). Both only require push access to the repo, no org-level
token needed for the write side.

### Doesn't clobber manual triage

Before writing anything, the action checks the issue's current `type` and
`issue_field_values`. If a field is already set, its form answer is dropped
from the patch instead of overwriting it, so triaging an issue by hand before
the action runs (or a slow trigger firing after someone's already set it)
never gets reverted.

### The org-fields token question

GitHub's org-level Issue Fields REST docs mention `read:org` scope for
PAT/OAuth callers of `GET /orgs/{org}/issue-fields`, and a field's visibility
can be set to `organization_members_only`. Whether the default `GITHUB_TOKEN`
from a repo-scoped workflow can read that endpoint is unverified without a
live run against a real org. If it 403s, pass `org-fields-client-id` and
`org-fields-private-key` for a GitHub App with org-level read access, mirroring
the App-token pattern in [`check-linked-issue`](../check-linked-issue). That
token is scoped narrowly to the one lookup step; the issue get/patch calls
always use `github-token`.
