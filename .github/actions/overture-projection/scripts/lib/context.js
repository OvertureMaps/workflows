/**
 * @file lib/context.js
 * @description Context-file fetching utilities.
 *
 * Used by fetch-context.js. Extracted for unit-testability — ref parsing,
 * content processing, and truncation are pure transformations with no I/O.
 */

'use strict';

const { compressMarkdown } = require('./markdown');
const { DEFAULT_MAX_CONTEXT_FILE_CHARS } = require('./defaults');

/**
 * Maximum character length for any single context file after compression
 * when no dynamic budget is available (legacy / test fallback only).
 * Sourced from defaults.js — update it there.
 *
 * @type {number}
 */
const MAX_CONTEXT_FILE_CHARS = DEFAULT_MAX_CONTEXT_FILE_CHARS;

/**
 * Computes the per-file character budget for context files.
 *
 * Allocates 10 % of the total input token budget (converted to chars at
 * 4 chars/token) so that context files scale with the model's context window.
 * An optional hard cap (`maxOverride`) lets callers enforce an upper bound
 * regardless of how large the window is.
 *
 * @param {number} maxInputTokens  - Provider input-token budget (e.g. 6200 or 190000).
 * @param {number} [maxOverride=0] - Hard cap in chars; 0 / falsy means no cap.
 * @returns {number} Character limit to pass to processContextFile.
 *
 * @example
 * contextFileCharBudget(6200)          // => 2480  (10% of 6200*4)
 * contextFileCharBudget(190000)        // => 76000 (10% of 190000*4)
 * contextFileCharBudget(190000, 20000) // => 20000 (cap applied)
 */
function contextFileCharBudget(maxInputTokens, maxOverride = 0) {
  const dynamic = Math.floor(maxInputTokens * 4 * 0.1);
  return (maxOverride > 0) ? Math.min(dynamic, maxOverride) : dynamic;
}

/**
 * @typedef {Object} ParsedRef
 * @property {string} owner    - Repository owner.
 * @property {string} repo     - Repository name.
 * @property {string} filePath - Path to the file within the repository.
 */

/**
 * Parses an `owner/repo:path` context-file ref string into its components.
 *
 * Returns `null` if the ref is malformed (missing colon separator, or the
 * repo portion does not contain a `/`).
 *
 * @param {string} ref - Raw ref string from SKILL.md frontmatter.
 * @returns {ParsedRef|null}
 *
 * @example
 * parseContextRef('OvertureMaps/schema:docs/overview.md')
 * // => { owner: 'OvertureMaps', repo: 'schema', filePath: 'docs/overview.md' }
 *
 * parseContextRef('bad-ref')
 * // => null
 */
function parseContextRef(ref) {
  const sep = ref.indexOf(':');
  if (sep === -1) return null;
  const repoFull = ref.slice(0, sep);
  const filePath = ref.slice(sep + 1);
  const slash = repoFull.indexOf('/');
  if (slash === -1) return null;
  const owner = repoFull.slice(0, slash);
  const repo  = repoFull.slice(slash + 1);
  if (!owner || !repo || !filePath) return null;
  return { owner, repo, filePath };
}

/**
 * @typedef {Object} BudgetResult
 * @property {string}  content   - Content, possibly truncated.
 * @property {boolean} truncated - `true` if the content was cut to fit the budget.
 */

/**
 * Decodes a base64-encoded file payload, compresses the Markdown, and
 * truncates to `maxChars` if necessary.
 *
 * The truncation notice appended when the content is too long is intentionally
 * visible to the model so it knows the context is partial.
 *
 * @param {string} base64Content - Raw base64 string from the GitHub Contents API.
 * @param {number} [maxChars]    - Character limit (defaults to MAX_CONTEXT_FILE_CHARS).
 * @returns {BudgetResult}
 */
function processContextFile(base64Content, maxChars = MAX_CONTEXT_FILE_CHARS) {
  const decoded    = Buffer.from(base64Content, 'base64').toString('utf-8');
  let   content    = compressMarkdown(decoded);
  const truncated  = content.length > maxChars;
  if (truncated) {
    content =
      content.slice(0, maxChars) +
      '\n\n[This context file was intentionally truncated by the review system to fit the token budget. The content above is a partial extract — the remainder is not available in this review.]';
  }
  return { content, truncated };
}

/**
 * Groups an array of fetched context entries (which may include `null` for
 * failed fetches) by skill name.
 *
 * Null entries are silently dropped. Skills with no successful fetches are
 * absent from the returned map.
 *
 * @typedef {Object} ContextEntry
 * @property {string} skillName - Skill that owns this context file.
 * @property {string} ref       - Original `owner/repo:path` ref.
 * @property {string} content   - Compressed file content (possibly truncated).
 *
 * @param {(ContextEntry|null)[]} entries - Mixed array of entries and nulls.
 * @returns {Record<string, ContextEntry[]>}
 *
 * @example
 * groupBySkill([
 *   { skillName: 'a', ref: 'o/r:f', content: '...' },
 *   null,
 *   { skillName: 'a', ref: 'o/r:g', content: '...' },
 *   { skillName: 'b', ref: 'o/r:h', content: '...' },
 * ])
 * // => { a: [{...}, {...}], b: [{...}] }
 */
function groupBySkill(entries) {
  const result = {};
  for (const entry of entries) {
    if (!entry) continue;
    (result[entry.skillName] ??= []).push(entry);
  }
  return result;
}

module.exports = { parseContextRef, processContextFile, contextFileCharBudget, groupBySkill, MAX_CONTEXT_FILE_CHARS };
