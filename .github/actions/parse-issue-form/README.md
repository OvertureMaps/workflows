# Parse Issue Form <!-- omit in toc -->

A composite GitHub Action that fetches an issue and parses its issue-form
answers into structured data, as a building block for issue-form-driven
automation. It doesn't act on the issue itself — pair it with an action or
script that consumes its outputs.

- [How-to guides](#how-to-guides)
- [Reference](#reference)
- [Explanation](#explanation)

## How-to guides

### Read an issue form's answers in a workflow

```yaml
# .github/workflows/my-automation.yml
name: My issue-form automation

on:
  issues:
    types: [opened]

jobs:
  automate:
    runs-on: ubuntu-latest
    permissions:
      issues: read
    steps:
      - name: Parse issue form
        id: parsed
        uses: OvertureMaps/workflows/.github/actions/parse-issue-form@main
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}

      - name: Use the answers
        uses: actions/github-script@v8
        env:
          ANSWERS: ${{ steps.parsed.outputs.answers }}
        with:
          script: |
            const answers = JSON.parse(process.env.ANSWERS);
            if (!answers.type) {
              core.info("Issue wasn't created from a template with a Type field, skipping.");
              return;
            }
            core.info(`Type answer: ${answers.type}`);
```

> Pin to a commit SHA rather than `@main` for reproducible builds, e.g.
> `uses: OvertureMaps/workflows/.github/actions/parse-issue-form@<sha>`.

### Build a new field-sync action on top of this one

[`sync-issue-fields`](../sync-issue-fields) is the first consumer: it calls
this action, then writes selected answers onto the issue's repo-level `type`
and an org-level issue field. Any new issue-form-driven automation (auto-
assigning, auto-labeling, notifying elsewhere) should follow the same shape:
call `parse-issue-form` first, then add only the behavior-specific logic on
top, rather than re-implementing the fetch-and-parse step.

## Reference

### Inputs

- `github-token` (**required**): Token with read access to the repo, used to fetch the issue. Composite action inputs can't default to the `github.token` context, so this must be passed explicitly, e.g. `${{ secrets.GITHUB_TOKEN }}`.
- `issue-number` (optional): Issue number to fetch and parse. Defaults to the triggering issue (`context.issue.number`). Override for testing or non-`issues` triggers.

### Outputs

- `issue-number`: The issue number that was fetched (resolved `issue-number` input or `context.issue.number`).
- `answers`: JSON object mapping issue form field `id` to its answer, e.g. `{"type": "Bug", "scope": "Base"}`. `{}` if the issue has no parseable form answers — always check for this before assuming a template was used (see [Handling issues that don't match the expected template](#handling-issues-that-dont-match-the-expected-template)).
- `type-name`: The issue's existing repo-level type name, or empty if unset.
- `field-values`: JSON array of the issue's existing org-level `issue_field_values` (each with `issue_field_id`, `issue_field_name`, `value`, etc.), or `[]` if none are set.

### Permissions

Requires a `github-token` with:

```yaml
permissions:
  issues: read
```

### Supported trigger events

The action reads `issue-number` (input) or `context.issue.number`, so it must
run on an `issues` event, or pass `issue-number` explicitly from another
trigger.

## Explanation

### Why a separate action from the fields it syncs

Fetching and parsing the issue is the same first step for any issue-form
automation, regardless of what happens with the answers afterward.
Separating it out means new automations built on issue-form answers (see
[`sync-issue-fields`](../sync-issue-fields)) don't re-implement the fetch,
the `github-issue-parser` call, or the JSON shape, and existing consumers
aren't affected if a new consumer changes its own behavior-specific logic.

### Handling issues that don't match the expected template

GitHub Actions has no way to trigger only for issues created from a specific
template — the `issues` event doesn't expose a per-template filter, and an
issue form's own `labels:` key (if configured) can only be checked with a
runtime `if:` in the consuming job, not the trigger itself. So this action
always runs and always returns whatever it finds: `answers` is `{}` for a
free-form issue, one created from an unrelated template, or one from a
template with different field `id`s than expected.

Consumers must treat a missing key in `answers` as "no opinion" and skip that
behavior, not as an error — `sync-issue-fields` does exactly this for its
`type`/`scope` answers. This action does not fail or warn on empty answers
itself, since "not this template" is an expected, common case, not a fault.
