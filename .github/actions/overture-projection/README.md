# Overture PRojection

Posts an AI-generated code review comment on a pull request. Skills drive what the model looks for — each skill is a `SKILL.md` file that provides focused review instructions for a particular concern.

Supports [GitHub Models](https://docs.github.com/en/github-models) (default) and [Anthropic](https://docs.anthropic.com/en/docs/about-claude/models) as model providers.

## How it works

1. **Load skills** — sparse-checkouts `omf-devex/skills/`, parses frontmatter, filters to `pr-reviewer` surface. Raw content is stored; nothing is fetched yet.
2. **Fetch PR diff** — title, body, branch refs, closing issues (GraphQL), and changed file patches up to `max-diff-chars`.
3. **Select skills** — a fast/cheap model reads skill descriptions and changed file paths, picks which optional skills apply, and logs its reasoning. `always-skills` bypass this step entirely.
4. **Fetch context files** — only for selected skills; fetched in parallel via the GitHub App token, compressed, and capped per file at `max-context-file-chars` (defaults to 10% of the input token budget).
5. **Post review** — builds system prompt from selected skills + context, trims the diff to the remaining token budget, calls the review model, and posts or updates a PR comment.

## Recipes

### GitHub Copilot (default)

No extra secrets needed beyond the standard workflow token.

```yaml
permissions:
  contents: read
  pull-requests: write
  issues: read
  models: read

steps:
  - uses: OvertureMaps/workflows/.github/actions/overture-projection@030d1cf86ff0013daa6f41ba0073cf048ec2d494 # reusable-PRojection-workflow
    with:
      github-token: ${{ secrets.GITHUB_TOKEN }}
      app-private-key: ${{ secrets.OVERTURE_PROJECTION_APP_PEM }}
```

**Automatic defaults** (GitHub Models gpt-4.1, 8,000 token context window):

| Input | Auto default |
| --- | --- |
| `model` | `gpt-4.1` |
| `selection-model` | `gpt-4.1-mini` |
| `max-input-tokens` | `6200` (= 8,000 − 1 500 output − 300 margin) |
| `max-output-tokens` | `1500` |

### Anthropic

Add `ANTHROPIC_API_KEY` as a repo or org secret. All current Claude models have a 200k token context window.

```yaml
permissions:
  contents: read
  pull-requests: write
  issues: read

steps:
  - uses: OvertureMaps/workflows/.github/actions/overture-projection@030d1cf86ff0013daa6f41ba0073cf048ec2d494 # reusable-PRojection-workflow
    with:
      model-provider: anthropic
      model: claude-opus-4-6
      anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
      app-private-key: ${{ secrets.OVERTURE_PROJECTION_APP_PEM }}
```

Token limits (`max-input-tokens`, `max-output-tokens`) default automatically to the right values for the provider — you only need to set them if you're using a model with a non-standard context window.

**Automatic defaults** (Anthropic 200k context window):

| Input | Auto default |
| --- | --- |
| `model` | `claude-opus-4-6` |
| `selection-model` | `claude-haiku-4-6` |
| `max-input-tokens` | `190000` (= 200k − 4,096 output − ~6,000 margin) |
| `max-output-tokens` | `4096` |

Note: `models: read` permission is not required when using Anthropic.

## Inputs

### Provider

| Input | Default | Description |
| --- | --- | --- |
| `model-provider` | `github-models` | `github-models` or `anthropic` |
| `model` | _(default)_ | Model ID for the review. Defaults to `gpt-4.1` (github-models) or `claude-opus-4-6` (anthropic) |
| `selection-model` | _(default)_ | Model ID for skill selection. Defaults to `gpt-4.1-mini` (github-models) or `claude-haiku-4-6` (anthropic) |
| `max-input-tokens` | _(default)_ | Max input tokens. Defaults to `6200` (github-models) or `190000` (anthropic). Override only for non-standard context windows |
| `max-output-tokens` | _(default)_ | Max tokens the model may generate. Defaults to `1500` (github-models) or `4096` (anthropic) |
| `github-token` | `github.token` | Token with `pull-requests:write`, `models:read`, and read access to `omf-devex`. Not used for model calls when `model-provider` is `anthropic` |
| `anthropic-api-key` | _(empty)_ | Anthropic API key. Required when `model-provider` is `anthropic` |

### Auth

| Input | Default | Description |
| --- | --- | --- |
| `app-id` | `Iv23liBMB2dC9UQJ5pHL` | Overture PRojection GitHub App Client ID |
| `app-private-key` | _(empty)_ | GitHub App private key (`secrets.OVERTURE_PROJECTION_APP_PEM`). Used to generate an installation token for cross-repo context file reads. Falls back to `github-token` if omitted |

### Behaviour

| Input | Default | Description |
| --- | --- | --- |
| `always-skills` | `pr-review` | Comma-separated skill names included on every run, bypassing model selection |
| `devex-ref` | `main` | Git ref of `omf-devex` to load skills from |
| `max-files` | `20` | Maximum number of changed files to fetch from the GitHub API |
| `max-diff-chars` | `100000` | Fetch ceiling for diff content. The actual amount sent to the model is computed dynamically based on the remaining token budget after skills and metadata |
| `max-context-file-chars` | _(default)_ | Hard cap per individual skill context file (the cross-repo files declared via `context-files:` in skill frontmatter — not the overall prompt context). Defaults to 10% of the input token budget (~2 500 chars for github-models, ~76 000 for anthropic). Set this to enforce a tighter ceiling regardless of token budget |
| `comment-mode` | `update` | `update` edits the existing comment in place; `new` posts a fresh PR review each run |
| `comment-tag` | `overture-projection` | Hidden HTML marker used to identify the managed comment in `update` mode |
| `pr-number` | _(event)_ | PR number to review. Required for `workflow_dispatch` triggers |
| `repository` | _(current repo)_ | Target repository in `owner/repo` format |
| `dry-run` | `false` | Print the review body to the log without posting it |

## Token budget

The action computes the diff budget dynamically at review time:

```
diff budget = (max-input-tokens × 4 chars/token) − system prompt chars − user prompt preamble chars
```

Files are included whole (never truncated mid-diff); once the budget is exhausted, remaining files are listed in the review with a recommendation to split the PR.

`max-input-tokens` and `max-output-tokens` default automatically based on the provider (see `scripts/lib/defaults.js`). You only need to set them explicitly when using a model with a non-standard context window:

| Provider | `max-input-tokens` | `max-output-tokens` | Basis |
| --- | --- | --- | --- |
| `github-models` | `6200` | `1500` | 8,000 context − 1,500 output − 300 margin |
| `anthropic` | `190000` | `4096` | 200k context − 4,096 output − ~6,000 margin |

## Skills

Skills live in `omf-devex/skills/<name>/SKILL.md`. The folder name is the skill ID — it must match the `name` frontmatter field and is what you pass to `always-skills`.

Only skills with `surfaces: [pr-reviewer]` (or no `surfaces` field) are loaded. Skills tagged `surfaces: [agent]` are filtered out before the selection model sees them.

- `always-skills` bypass selection and are always included in the system prompt.
- All other `pr-reviewer` skills are passed to the selection model with their `description`; the model picks which are relevant to the PR.
- `context-files` are fetched after selection, so only selected skills pay the network cost.

For full frontmatter field reference and authoring guidance see the [omf-devex README](../../../../README.md#skills).

## Required workflow permissions

```yaml
permissions:
  contents: read        # checkout
  pull-requests: write  # post/update review comment
  issues: read          # closingIssuesReferences GraphQL query
  models: read          # GitHub Models API (not needed for anthropic provider)
```
