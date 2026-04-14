'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseContextRef, processContextFile, contextFileCharBudget, groupBySkill, MAX_CONTEXT_FILE_CHARS } = require('../context');

// ---------------------------------------------------------------------------
// parseContextRef
// ---------------------------------------------------------------------------

describe('parseContextRef', () => {
  it('parses a valid owner/repo:path ref', () => {
    const result = parseContextRef('OvertureMaps/schema:docs/overview.md');
    assert.deepEqual(result, { owner: 'OvertureMaps', repo: 'schema', filePath: 'docs/overview.md' });
  });

  it('parses a ref with a nested file path', () => {
    const result = parseContextRef('acme-org/my-repo:a/b/c/file.md');
    assert.deepEqual(result, { owner: 'acme-org', repo: 'my-repo', filePath: 'a/b/c/file.md' });
  });

  it('parses a ref with a file at the repo root', () => {
    const result = parseContextRef('owner/repo:README.md');
    assert.deepEqual(result, { owner: 'owner', repo: 'repo', filePath: 'README.md' });
  });

  it('returns null when the colon separator is missing', () => {
    assert.equal(parseContextRef('OvertureMaps/schema/docs/overview.md'), null);
  });

  it('returns null when the repo portion has no slash (missing owner)', () => {
    assert.equal(parseContextRef('schema:docs/overview.md'), null);
  });

  it('returns null for an empty string', () => {
    assert.equal(parseContextRef(''), null);
  });

  it('returns null when owner is empty', () => {
    assert.equal(parseContextRef('/repo:path.md'), null);
  });

  it('returns null when repo is empty', () => {
    assert.equal(parseContextRef('owner/:path.md'), null);
  });

  it('returns null when filePath is empty', () => {
    assert.equal(parseContextRef('owner/repo:'), null);
  });

  it('uses the first colon as the separator (filePath may contain colons)', () => {
    const result = parseContextRef('owner/repo:path/to:file.md');
    assert.deepEqual(result, { owner: 'owner', repo: 'repo', filePath: 'path/to:file.md' });
  });
});

// ---------------------------------------------------------------------------
// processContextFile
// ---------------------------------------------------------------------------

/** Encode a string to base64 the same way GitHub's API does. */
function toBase64(str) {
  return Buffer.from(str, 'utf-8').toString('base64');
}

describe('processContextFile', () => {
  it('decodes base64 content and returns it', () => {
    const { content } = processContextFile(toBase64('Hello world'));
    assert.equal(content, 'Hello world');
  });

  it('strips YAML frontmatter via compressMarkdown', () => {
    const raw = '---\nname: foo\n---\n# Body\n\nContent here.';
    const { content } = processContextFile(toBase64(raw));
    assert.ok(!content.includes('name: foo'));
    assert.match(content, /Content here\./);
  });

  it('strips HTML comments via compressMarkdown', () => {
    const raw = '# Title\n\n<!-- hidden -->\n\nBody.';
    const { content } = processContextFile(toBase64(raw));
    assert.ok(!content.includes('hidden'));
  });

  it('returns truncated: false when content is within the budget', () => {
    const { truncated } = processContextFile(toBase64('Short content.'));
    assert.equal(truncated, false);
  });

  it('returns truncated: false when content exactly equals maxChars', () => {
    const raw = 'x'.repeat(100);
    const { content, truncated } = processContextFile(toBase64(raw), 100);
    assert.equal(content.length, 100);
    assert.equal(truncated, false);
  });

  it('truncates content that exceeds maxChars and sets truncated: true', () => {
    const raw = 'x'.repeat(200);
    const { content, truncated } = processContextFile(toBase64(raw), 100);
    assert.equal(truncated, true);
    assert.ok(content.startsWith('x'.repeat(100)));
  });

  it('appends a truncation notice when content is cut', () => {
    const raw = 'x'.repeat(200);
    const { content } = processContextFile(toBase64(raw), 100);
    assert.match(content, /truncated by the review system/);
  });

  it('uses MAX_CONTEXT_FILE_CHARS as the default budget', () => {
    // Content just under the default limit — should not be truncated
    const raw = 'x'.repeat(MAX_CONTEXT_FILE_CHARS);
    const { truncated } = processContextFile(toBase64(raw));
    assert.equal(truncated, false);
  });

  it('truncates when content exceeds MAX_CONTEXT_FILE_CHARS by default', () => {
    const raw = 'x'.repeat(MAX_CONTEXT_FILE_CHARS + 1);
    const { truncated } = processContextFile(toBase64(raw));
    assert.equal(truncated, true);
  });

  it('handles multi-line content with blank-line collapsing', () => {
    const raw = 'Line one\n\n\n\nLine two';
    const { content } = processContextFile(toBase64(raw));
    assert.equal(content, 'Line one\n\nLine two');
  });
});

// ---------------------------------------------------------------------------
// groupBySkill
// ---------------------------------------------------------------------------

describe('groupBySkill', () => {
  it('groups entries by skillName', () => {
    const entries = [
      { skillName: 'a', ref: 'o/r:f1', content: 'c1' },
      { skillName: 'b', ref: 'o/r:f2', content: 'c2' },
      { skillName: 'a', ref: 'o/r:f3', content: 'c3' },
    ];
    const result = groupBySkill(entries);
    assert.equal(result['a'].length, 2);
    assert.equal(result['b'].length, 1);
  });

  it('filters out null entries', () => {
    const entries = [
      { skillName: 'a', ref: 'o/r:f', content: 'c' },
      null,
      null,
    ];
    const result = groupBySkill(entries);
    assert.equal(result['a'].length, 1);
    assert.equal(Object.keys(result).length, 1);
  });

  it('returns an empty object for an all-null array', () => {
    assert.deepEqual(groupBySkill([null, null]), {});
  });

  it('returns an empty object for an empty array', () => {
    assert.deepEqual(groupBySkill([]), {});
  });

  it('preserves ref and content on grouped entries', () => {
    const entry = { skillName: 'a', ref: 'owner/repo:path.md', content: 'text' };
    const result = groupBySkill([entry]);
    assert.deepEqual(result['a'][0], entry);
  });

  it('skills with all-null fetches are absent from the result', () => {
    const result = groupBySkill([null]);
    assert.ok(!('a' in result));
  });
});

// ---------------------------------------------------------------------------
// MAX_CONTEXT_FILE_CHARS
// ---------------------------------------------------------------------------

describe('MAX_CONTEXT_FILE_CHARS', () => {
  it('is a positive number', () => {
    assert.ok(typeof MAX_CONTEXT_FILE_CHARS === 'number' && MAX_CONTEXT_FILE_CHARS > 0);
  });
});

// ---------------------------------------------------------------------------
// contextFileCharBudget
// ---------------------------------------------------------------------------

describe('contextFileCharBudget', () => {
  it('returns 10% of maxInputTokens × 4 chars/token', () => {
    assert.equal(contextFileCharBudget(6200),   Math.floor(6200   * 4 * 0.1));
    assert.equal(contextFileCharBudget(190000), Math.floor(190000 * 4 * 0.1));
  });

  it('returns a larger budget for large token windows (anthropic)', () => {
    assert.ok(contextFileCharBudget(190000) > contextFileCharBudget(6200));
  });

  it('applies the override cap when it is smaller than the dynamic budget', () => {
    // dynamic = 190000 * 4 * 0.1 = 76000; cap = 20000
    assert.equal(contextFileCharBudget(190000, 20000), 20000);
  });

  it('does not apply the cap when it exceeds the dynamic budget', () => {
    // dynamic = 6200 * 4 * 0.1 = 2480; cap = 99999
    assert.equal(contextFileCharBudget(6200, 99999), Math.floor(6200 * 4 * 0.1));
  });

  it('ignores a zero override (no cap)', () => {
    assert.equal(contextFileCharBudget(6200, 0), Math.floor(6200 * 4 * 0.1));
  });

  it('ignores a falsy override (no cap)', () => {
    assert.equal(contextFileCharBudget(6200, undefined), Math.floor(6200 * 4 * 0.1));
  });

  it('returns a positive integer', () => {
    const result = contextFileCharBudget(6200);
    assert.ok(Number.isInteger(result));
    assert.ok(result > 0);
  });
});
