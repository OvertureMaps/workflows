/**
 * @file lib/diff.js
 * @description PR diff filtering and budget utilities.
 *
 * Used by fetch-diff.js and post-review.js. Extracted for unit-testability —
 * the ignore-pattern compilation and per-file budget trimming are independent
 * of any GitHub API calls and can be exercised with plain data.
 */

'use strict';

/**
 * Computes the character budget for diff content given the number of tokens
 * already consumed by the system prompt and user prompt overhead (everything
 * except the diff blocks themselves), and the configured maximum input tokens.
 *
 * Uses a chars-per-token ratio of 4 as a conservative approximation.
 *
 * @param {number} nonDiffChars   - Characters already consumed by system prompt +
 *   user prompt preamble (headers, issue section, file count line, skipped-files
 *   section, etc.) — everything except the `diffBlocks` themselves.
 * @param {number} maxInputTokens - Maximum tokens available for the full input
 *   prompt (context window minus output reserve and safety margin). Passed in
 *   from config so no provider limits are hardcoded here.
 * @returns {number} Remaining character budget for diff content. Minimum 0.
 *
 * @example
 * diffCharBudget(4000, 6200)  // => (6200 * 4) - 4000 = 20800
 */
function diffCharBudget(nonDiffChars, maxInputTokens) {
  return Math.max(0, maxInputTokens * 4 - nonDiffChars);
}

/**
 * Compiles a newline-separated list of glob-style patterns into anchored
 * regular expressions.
 *
 * Each pattern supports `*` as a wildcard matching any sequence of characters.
 * All other regex metacharacters are escaped. Each compiled regex is tested
 * against both the full file path and the basename (see {@link isIgnored}).
 *
 * Empty lines and lines that are only whitespace are ignored.
 *
 * @param {string} patternsStr - Newline-separated glob patterns (e.g. from `IGNORE_FILES` env var).
 * @returns {RegExp[]} Compiled anchored regexes, one per non-empty pattern.
 *
 * @example
 * buildIgnorePatterns('*.lock\npackage-lock.json')
 * // => [/^.*\.lock$/, /^package-lock\.json$/]
 */
function buildIgnorePatterns(patternsStr) {
  return (patternsStr || '')
    .split('\n')
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'));
}

/**
 * Returns `true` if a file entry should be excluded from the diff sent to the
 * model, based on a set of compiled ignore patterns.
 *
 * Each pattern is tested against both the full repo-relative path and the
 * basename so that e.g. `*.lock` matches `subdir/foo.lock`.
 *
 * @param {{ filename: string }} file     - File entry (only `filename` is read).
 * @param {RegExp[]}             patterns - Compiled patterns from {@link buildIgnorePatterns}.
 * @returns {boolean} `true` if the file matches any ignore pattern.
 *
 * @example
 * const patterns = buildIgnorePatterns('*.lock');
 * isIgnored({ filename: 'package-lock.json' }, patterns); // true
 * isIgnored({ filename: 'src/index.js' },      patterns); // false
 */
function isIgnored(file, patterns) {
  const basename = file.filename.split('/').pop();
  return patterns.some(re => re.test(file.filename) || re.test(basename));
}

/**
 * @typedef {Object} RawFile
 * @property {string}           filename  - Repo-relative file path.
 * @property {string}           status    - Change status from the GitHub API.
 * @property {number}           additions - Lines added.
 * @property {number}           deletions - Lines deleted.
 * @property {string|undefined} patch     - Raw unified-diff patch, or undefined for binary files.
 */

/**
 * @typedef {Object} FileBudgetResult
 * @property {Array<{filename:string,status:string,additions:number,deletions:number,patch:string}>} included
 *   Files whose full patch fits within the character budget, with absent patches replaced by a placeholder.
 * @property {RawFile[]} skipped
 *   Files dropped because the budget was exhausted before their patch could be included.
 */

/**
 * Applies a total character budget across an ordered list of files, keeping
 * whole files rather than truncating individual patches mid-diff.
 *
 * Files are consumed in order. Each file's patch is measured (absent/binary
 * patches count as 0 chars). Once adding the next file would exceed
 * `totalChars`, that file and all subsequent files are placed in `skipped`.
 *
 * This produces cleaner model output than mid-patch truncation: the model
 * receives complete diffs for the files it does see, and can call out the
 * skipped files explicitly in its review.
 *
 * @param {RawFile[]} files      - Files to partition (typically post-ignore-filter).
 * @param {number}    totalChars - Maximum total characters of patch content to include.
 * @returns {FileBudgetResult}
 *
 * @example
 * applyFileBudget([
 *   { filename: 'a.js', patch: 'x'.repeat(400), ... },
 *   { filename: 'b.js', patch: 'y'.repeat(400), ... },
 * ], 500)
 * // => { included: [{ filename: 'a.js', ... }], skipped: [{ filename: 'b.js', ... }] }
 */
function applyFileBudget(files, totalChars) {
  const included = [];
  const skipped  = [];
  let used = 0;

  for (const f of files) {
    const patchLen = f.patch ? f.patch.length : 0;
    if (used + patchLen <= totalChars) {
      included.push({
        filename:  f.filename,
        status:    f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch:     f.patch || '(binary or no textual diff)',
      });
      used += patchLen;
    } else {
      skipped.push(f);
    }
  }

  return { included, skipped };
}

module.exports = {
  diffCharBudget,
  buildIgnorePatterns,
  isIgnored,
  applyFileBudget,
};
