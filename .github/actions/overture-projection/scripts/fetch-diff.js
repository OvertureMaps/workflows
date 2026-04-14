/**
 * @file fetch-diff.js
 * @description Step 2 — Fetch PR metadata and diff.
 *
 * Makes four parallel GitHub API calls to collect everything downstream steps
 * need about the pull request:
 *   1. PR metadata  (title, body, branch refs, author association, file count)
 *   2. Changed files with patches (up to MAX_FILES)
 *   3. Closing-issue references via GraphQL (best-effort; silently degraded if
 *      the token lacks issues:read)
 *   4. Repository licence (best-effort; null if unavailable)
 *
 * Changed files are filtered against IGNORE_FILES patterns, then whole files
 * are dropped once the total diff character budget is exhausted (in API order;
 * later files may still be included if they are smaller than remaining budget).
 * No patch is ever truncated mid-diff; the model only sees complete patches.
 *
 * Env vars consumed:
 *   MAX_FILES       — max number of changed files to include (default 20)
 *   MAX_DIFF_CHARS  — fetch ceiling: max chars of patch content to pull from GitHub API (default 100000)
 *   IGNORE_FILES    — newline-separated glob patterns for files to skip
 *   PR_NUMBER       — PR number override (falls back to event payload)
 *   REPOSITORY      — target repo in owner/repo format (falls back to context)
 *   RUNNER_TEMP     — standard Actions temp dir for inter-step artefacts
 *
 * Outputs written:
 *   $RUNNER_TEMP/ai-review-diff.json  — PRData
 *
 * Step outputs set:
 *   changed-paths  — newline-separated list of included file paths
 *
 * @param {import('@actions/github-script').AsyncFunctionArguments} args
 */
module.exports = async ({ github, context, core }) => {
  const fs   = require('fs');
  const path = require('path');
  const { buildIgnorePatterns, isIgnored, applyFileBudget } = require('./lib/diff');
  const { resolveRepo, resolvePrNumber } = require('./lib/github');
  const { DEFAULT_MAX_DIFF_CHARS } = require('./lib/defaults');

  const maxFiles     = parseInt(process.env.MAX_FILES) || 20;
  const fetchCeiling = parseInt(process.env.MAX_DIFF_CHARS) || DEFAULT_MAX_DIFF_CHARS;

  const ignorePatterns = buildIgnorePatterns(process.env.IGNORE_FILES);
  const { owner, repo } = resolveRepo(process.env.REPOSITORY, context.repo);
  const prNumber = resolvePrNumber(context.payload.pull_request?.number, process.env.PR_NUMBER);
  if (!prNumber) {
    core.setFailed('No PR number available: set the pr-number input or trigger via a pull_request event.');
    return;
  }

  const [prResp, filesResp, issuesResp, licenseResp] = await Promise.all([
    github.rest.pulls.get({ owner, repo, pull_number: prNumber }),
    github.rest.pulls.listFiles({ owner, repo, pull_number: prNumber, per_page: maxFiles }),

    // GraphQL for closing-issue refs — best-effort, requires issues:read
    github.graphql(`
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            closingIssuesReferences(first: 10) {
              nodes { number title url }
            }
          }
        }
      }`, { owner, repo, number: prNumber }
    ).catch(err => {
      core.warning(`⚠️ GraphQL closingIssuesReferences failed (check issues:read permission): ${err.message}`);
      return null;
    }),

    // Repo licence — best-effort, null if repo has no licence file
    github.rest.licenses.getForRepo({ owner, repo }).catch(() => null),
  ]);

  const linkedIssues   = issuesResp?.repository?.pullRequest?.closingIssuesReferences?.nodes ?? [];
  const includedFiles  = filesResp.data.filter(f => !isIgnored(f, ignorePatterns));
  const ignoredFiles   = filesResp.data.filter(f =>  isIgnored(f, ignorePatterns));

  if (ignoredFiles.length > 0) {
    core.info(`⏭️  Ignored ${ignoredFiles.length} file(s): ${ignoredFiles.map(f => f.filename).join(', ')}`);
  }

  const { included: files, skipped: budgetSkippedFiles } = applyFileBudget(includedFiles, fetchCeiling);
  core.info(`📐 Fetch ceiling: ${fetchCeiling} chars — fetched ${files.length} file(s), ceiling-skipped ${budgetSkippedFiles.length} file(s)`);
  if (budgetSkippedFiles.length > 0) {
    core.info(`⚠️  Ceiling-skipped (not fetched): ${budgetSkippedFiles.map(f => f.filename).join(', ')}`);
  }

  const prData = {
    number:             prResp.data.number,
    title:              prResp.data.title,
    body:               prResp.data.body?.trim() || '',
    totalFiles:         prResp.data.changed_files,
    headRef:            prResp.data.head.ref,
    baseRef:            prResp.data.base.ref,
    authorAssociation:  prResp.data.author_association ?? null,
    linkedIssues,
    repoLicense:        licenseResp?.data?.license?.spdx_id ?? null,
    files,
    budgetSkippedFiles: budgetSkippedFiles.map(f => f.filename),
  };

  fs.writeFileSync(
    path.join(process.env.RUNNER_TEMP, 'ai-review-diff.json'),
    JSON.stringify(prData)
  );
  core.setOutput('changed-paths', files.map(f => f.filename).join('\n'));
  core.info(
    `📂 Fetched diff: ${files.length} of ${prData.totalFiles} file(s)` +
    `${prData.repoLicense ? ` | license: ${prData.repoLicense}` : ''}` +
    ` | linked issues: ${prData.linkedIssues.length}` +
    ` | author: ${prData.authorAssociation ?? 'unknown'}`
  );
};
