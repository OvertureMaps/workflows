/**
 * @file lib/markdown.js
 * @description Markdown compression utility.
 *
 * Shared by fetch-context.js (compressing context files before storage) and
 * post-review.js (compressing skill bodies before prompt assembly).
 */

'use strict';

/**
 * Strips YAML frontmatter and HTML comments from a Markdown string, then
 * collapses runs of three or more blank lines to a single blank line and
 * trims leading/trailing whitespace.
 *
 * Reduces token cost when Markdown is injected into a model prompt without
 * losing any instructional content.
 *
 * @param {string} text - Raw Markdown content, optionally with YAML frontmatter.
 * @returns {string} Compressed Markdown.
 *
 * @example
 * compressMarkdown('---\nname: foo\n---\n\n# Hello\n\n\n\nWorld')
 * // => '# Hello\n\nWorld'
 */
function compressMarkdown(text) {
  const stripped   = text.replace(/^---\n[\s\S]*?\n---\n?/, '');
  const noComments = stripped.replace(/<!--[\s\S]*?-->/g, '');
  return noComments
    .split('\n')
    .map(l => l.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = { compressMarkdown };
