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
default `type-form-field`/`scope-form-field` inputs). `scope-org-field-id`
defaults to the OvertureMaps org's `Scope` field, so no further configuration
is needed for repos in this org. Nothing happens if the issue wasn't created
from a template with those fields.

### Use different form field IDs, or target a different org-level field

```yaml
- name: Sync Type and Priority
  uses: OvertureMaps/workflows/.github/actions/sync-issue-fields@main
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    scope-form-field: priority
    scope-org-field-id: "12345678" # OvertureMaps org's "Priority" field
```

Find an org-level field's ID with `gh api orgs/OvertureMaps/issue-fields`.

## Reference

### Inputs

- `github-token` (**required**): Token with push access to the repo, used to read and patch the issue. Composite action inputs can't default to the `github.token` context, so this must be passed explicitly, e.g. `${{ secrets.GITHUB_TOKEN }}`.
- `type-form-field` (optional): Issue form field `id` holding the Type dropdown answer. Default `type`.
- `scope-form-field` (optional): Issue form field `id` holding the Scope-equivalent dropdown answer. Default `scope`.
- `scope-org-field-id` (optional): Numeric ID of the org-level issue field to write the `scope-form-field` answer to. Default `44814929`, the OvertureMaps org's `Scope` field. Override only to target a different org-level field.
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

### Why this exists

Issue forms are the easiest way to get a reporter to pick a `Type` or `Scope`
value at creation time, but a form dropdown answer only lives as plain text
in the issue body. It doesn't filter issue search, doesn't drive board views,
and doesn't show up in the repo-level `type` or org-level field's own UI,
until something copies it over. Without this action, that copy step is
manual: someone has to open the issue, read the form answer, then set the
system `type` and the org field by hand, which is easy to skip or get wrong
for high-volume repos with many incoming issues. This action does that copy
automatically on `issues: opened`, so the form answer and the actual fields
agree without a triager touching either.

### Why one PATCH for two fields

Both writes happen in a single `PATCH /repos/{owner}/{repo}/issues/{issue_number}`
call, which accepts a `type` string param (the repo-level system field) and an
`issue_field_values: [{field_id, value}]` array (org-level custom fields) —
confirmed against the [GitHub REST API OpenAPI spec](https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/dereferenced/api.github.com.deref.json)
(`patch /repos/{owner}/{repo}/issues/{issue_number}`, properties `type` and
`issue_field_values`). Both only require push access to the repo.

### Doesn't clobber manual triage

Before writing anything, the action checks the issue's current `type` and
`issue_field_values`. If a field is already set, its form answer is dropped
from the patch instead of overwriting it, so triaging an issue by hand before
the action runs (or a slow trigger firing after someone's already set it)
never gets reverted.

### Why the field ID is hardcoded, not looked up by name

`PATCH .../issues/{n}` needs a numeric `field_id`, and turning a field's name
into that ID means calling `GET /orgs/{org}/issue-fields` — which [only
accepts classic PATs or OAuth app tokens with `read:org`](https://docs.github.com/en/rest/orgs/issue-fields),
not `GITHUB_TOKEN` or fine-grained PATs. That would mean shipping a whole
second credential (a PAT or GitHub App) just to resolve a name this action
only ever needs to resolve once.

Since this action is OvertureMaps-only and org-level field IDs are stable
once created, `scope-org-field-id` defaults directly to the numeric ID of the
org's `Scope` field. That keeps the whole action running on nothing but
`github-token`. If OvertureMaps ever needs to target a different org-level
field, look its ID up once with `gh api orgs/OvertureMaps/issue-fields` and
pass it via `scope-org-field-id` — no extra token required either way.
