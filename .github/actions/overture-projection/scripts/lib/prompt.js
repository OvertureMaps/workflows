/**
 * @file lib/prompt.js
 * @description System and user prompt assembly for the review model.
 *
 * Used by post-review.js. Extracted for unit-testability — both functions are
 * pure string transformations over plain data objects with no I/O or API calls,
 * making them straightforward to exercise with snapshot tests.
 */

'use strict';

const { compressMarkdown } = require('./markdown');

/**
 * @typedef {Object} Skill
 * @property {string}   name - Skill ID.
 * @property {string}   raw  - Full SKILL.md content including frontmatter.
 */

/**
 * @typedef {Object} ContextEntry
 * @property {string} ref     - `owner/repo:path` ref string.
 * @property {string} content - Compressed file content.
 */

/**
 * Assembles the system prompt from the ordered list of selected skills and
 * their fetched context files.
 *
 * Each skill block is formatted as:
 * ```
 * <!-- skill: <name> -->
 * <compressed SKILL.md body>
 * [## Context Files
 * [<ref>]
 * <content>]
 * ```
 * Blocks are separated by `---` horizontal rules so the model can treat them
 * as distinct instruction sets. The system prompt is empty string when no
 * skills are provided, which signals to the caller to omit the system message
 * entirely (letting the model use its built-in review behaviour).
 *
 * @param {Skill[]}                         skills        - Selected skills in display order.
 * @param {Record<string, ContextEntry[]>}  contextBySkill - Map of skill name to fetched context entries.
 * @returns {string} System prompt string, or empty string if `skills` is empty.
 *
 * @example
 * buildSystemPrompt(
 *   [{ name: 'pr-review', raw: '---\nname: pr-review\n---\nReview all PRs.' }],
 *   {}
 * )
 * // => '<!-- skill: pr-review -->\nReview all PRs.'
 */
function buildSystemPrompt(skills, contextBySkill) {
  if (skills.length === 0) return '';
  return skills
    .map(s => {
      const body       = compressMarkdown(s.raw);
      const ctxEntries = contextBySkill[s.name] || [];
      const ctxBlocks  = ctxEntries.map(r => `[${r.ref}]\n${r.content}`).join('\n\n');
      const content    = ctxBlocks ? `${body}\n\n## Context Files\n\n${ctxBlocks}` : body;
      return `<!-- skill: ${s.name} -->\n${content}`;
    })
    .join('\n\n---\n\n');
}

/**
 * @typedef {Object} FileDiff
 * @property {string} filename  - Repo-relative file path.
 * @property {string} status    - Change status (added, modified, removed, renamed, etc.).
 * @property {number} additions - Lines added.
 * @property {number} deletions - Lines deleted.
 * @property {string} patch     - Full diff patch text (never truncated mid-diff).
 */

/**
 * @typedef {Object} PRData
 * @property {number}      number              - PR number.
 * @property {string}      title               - PR title.
 * @property {string}      body                - PR description (empty string if absent).
 * @property {number}      totalFiles          - Total changed files (may exceed files.length).
 * @property {string}      headRef             - Source branch.
 * @property {string}      baseRef             - Target branch.
 * @property {string|null} authorAssociation   - Author association from GitHub API, or null.
 * @property {Array}       linkedIssues        - Closing-issue reference nodes.
 * @property {string|null} repoLicense         - SPDX licence ID, or null.
 * @property {FileDiff[]}  files               - Files whose full patch fits within the diff budget.
 * @property {string[]}    budgetSkippedFiles  - Filenames dropped because the diff budget was exhausted.
 */

/**
 * File extensions considered documentation-only.
 * When every changed file has one of these extensions the PR is flagged as
 * `PR type: docs-only` and the tests-present check is suppressed.
 *
 * @type {Set<string>}
 */
const DOCS_EXTENSIONS = new Set(['.md', '.mdx', '.rst', '.txt', '.adoc']);

/**
 * Returns `true` if the filename looks like a test file.
 *
 * Matches common conventions:
 * - Directory-based: `tests/`, `test/`, `__tests__/`, `spec/`
 * - Suffix-based:    `.test.js`, `.spec.ts`, `_test.go`, `-test.js`
 * - Python:          `test_foo.py` (anywhere in path)
 *
 * @param {string} filename - Repo-relative file path.
 * @returns {boolean}
 */
function isTestFile(filename) {
  return (
    /\/(tests?|__tests?__|spec)\//i.test(filename) ||
    /[._-](test|spec)\.[^.]+$/.test(filename) ||
    /^tests?\//i.test(filename) ||
    /\/test_[^/]+\.py$/.test(filename) ||
    /^test_[^/]+\.py$/.test(filename)
  );
}

/**
 * Assembles the user prompt from PR metadata and file diffs.
 *
 * The prompt is structured as:
 * 1. A header line with branch names, licence, description flag, PR type,
 *    test coverage flag, and author association.
 * 2. The PR description body (or a placeholder).
 * 3. A linked-issues line.
 * 4. One fenced diff block per changed file.
 * 5. An optional truncation notice when files were omitted due to MAX_FILES.
 *
 * All inputs are plain data — no I/O or API calls occur here.
 *
 * @param {PRData} prData - Structured PR metadata and file diffs.
 * @returns {string} User prompt string ready for the chat-completions API.
 */
/**
 * @typedef {Object} UserPromptParts
 * @property {string} prHeader      - Title + branch/metadata line + description.
 * @property {string} issuesSection - Linked-issues line.
 * @property {string} filesHeader   - "## Changed Files (N of M)" line.
 * @property {string} apiOmittedNote - Note about files not fetched due to MAX_FILES, or ''.
 * @property {string} skippedSection - "## Files Not Reviewed" block, or ''.
 */

/**
 * Builds the structural parts of the user prompt that do not include the per-file
 * diff blocks. Used both by {@link buildUserPrompt} (which adds the diff blocks)
 * and by `post-review.js` to measure non-diff overhead before computing the
 * dynamic diff character budget.
 *
 * @param {PRData} prData
 * @returns {UserPromptParts}
 */
function buildUserPromptParts(prData) {
  const licenseNote     = prData.repoLicense ? `License: ${prData.repoLicense}` : 'License: unknown';
  const descriptionNote = prData.body ? 'Description: ✅' : 'Description: ❌ missing';

  const docsOnly =
    prData.files.length > 0 &&
    prData.files.every(f => DOCS_EXTENSIONS.has('.' + f.filename.split('.').pop().toLowerCase()));
  const prTypeNote = docsOnly ? 'PR type: docs-only' : 'PR type: code';

  const hasTests   = prData.files.some(f => isTestFile(f.filename));
  const testsNote  = docsOnly ? '' : ` | Tests: ${hasTests ? '✅' : '❌ none in diff'}`;
  const authorNote = prData.authorAssociation ? ` | Author: ${prData.authorAssociation}` : '';

  const prHeader =
    `## ${prData.title}\n\n` +
    `Branch: \`${prData.headRef}\` → \`${prData.baseRef}\` | ${licenseNote} | ${descriptionNote} | ${prTypeNote}${testsNote}${authorNote}\n\n` +
    `${prData.body || '(no description)'}`;

  const issuesSection = `Linked issue: ${
    prData.linkedIssues?.length > 0
      ? `✅ ${prData.linkedIssues.map(i => `#${i.number}`).join(', ')}`
      : '❌ none'
  }`;

  // Files omitted due to MAX_FILES API page limit (not in diff at all)
  const apiOmittedCount = prData.totalFiles - prData.files.length - (prData.budgetSkippedFiles?.length ?? 0);
  const apiOmittedNote  = apiOmittedCount > 0
    ? `\n> Note: ${apiOmittedCount} additional file(s) not fetched (exceeds max-files limit).\n`
    : '';

  const filesHeader = `## Changed Files (${prData.files.length} of ${prData.totalFiles})${apiOmittedNote}`;

  // Files fetched but dropped because the diff character budget was exhausted
  const skipped = prData.budgetSkippedFiles ?? [];
  const skippedSection = skipped.length > 0
    ? `\n\n## Files Not Reviewed (diff budget exhausted)\n\n` +
      `The following ${skipped.length} file(s) were changed in this PR but could not be included ` +
      `because the diff is too large to fit in the model's context window. ` +
      `List each of these files in an **🚩 Flags** item and recommend that the contributor ` +
      `break this PR into smaller, more focused pull requests:\n\n` +
      skipped.map(f => `- \`${f}\``).join('\n')
    : '';

  return { prHeader, issuesSection, filesHeader, apiOmittedNote, skippedSection };
}

/**
 * Returns the user prompt text that does not include per-file diff blocks —
 * the preamble (intro, PR header, issues, file-count line) plus the
 * skipped-files section. Used by `post-review.js` to measure non-diff overhead
 * before computing the dynamic diff character budget.
 *
 * Note: this uses `prData.files` only for metadata (count, docs-only flag,
 * tests flag). Pass the full file list so the flags are accurate before
 * trimming occurs.
 *
 * @param {PRData} prData
 * @returns {string}
 */
function buildUserPromptPreamble(prData) {
  const { prHeader, issuesSection, filesHeader, skippedSection } = buildUserPromptParts(prData);
  return `Review this pull request.\n\n${prHeader}\n\n${issuesSection}\n\n${filesHeader}\n\n` +
    skippedSection;
}

/**
 * Assembles the user prompt from PR metadata and file diffs.
 *
 * The prompt is structured as:
 * 1. A header line with branch names, licence, description flag, PR type,
 *    test coverage flag, and author association.
 * 2. The PR description body (or a placeholder).
 * 3. A linked-issues line.
 * 4. One fenced diff block per changed file.
 * 5. An optional truncation notice when files were omitted due to MAX_FILES.
 *
 * All inputs are plain data — no I/O or API calls occur here.
 *
 * @param {PRData} prData - Structured PR metadata and file diffs.
 * @returns {string} User prompt string ready for the chat-completions API.
 */
function buildUserPrompt(prData) {
  const { prHeader, issuesSection, filesHeader, skippedSection } = buildUserPromptParts(prData);

  const diffBlocks = prData.files.map(
    f => `### ${f.filename} [${f.status}] +${f.additions} -${f.deletions}\n\`\`\`diff\n${f.patch}\n\`\`\``
  );

  return (
    `Review this pull request.\n\n${prHeader}\n\n${issuesSection}\n\n` +
    `${filesHeader}\n\n` +
    diffBlocks.join('\n\n') +
    skippedSection
  );
}

module.exports = {
  buildSystemPrompt,
  buildUserPromptParts,
  buildUserPromptPreamble,
  buildUserPrompt,
  isTestFile,
  DOCS_EXTENSIONS,
};
