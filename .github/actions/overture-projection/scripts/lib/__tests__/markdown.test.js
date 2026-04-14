'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { compressMarkdown } = require('../markdown');

describe('compressMarkdown', () => {
  it('strips YAML frontmatter block', () => {
    const input = '---\ntitle: foo\nauthor: bar\n---\n# Hello\n\nWorld';
    assert.equal(compressMarkdown(input), '# Hello\n\nWorld');
  });

  it('leaves content unchanged when no frontmatter is present', () => {
    const input = '# Hello\n\nWorld';
    assert.equal(compressMarkdown(input), '# Hello\n\nWorld');
  });

  it('strips HTML comments', () => {
    const input = '# Title\n\n<!-- this is a comment -->\n\nBody text.';
    assert.equal(compressMarkdown(input), '# Title\n\nBody text.');
  });

  it('strips multi-line HTML comments', () => {
    const input = '# Title\n\n<!--\nfoo\nbar\n-->\n\nBody.';
    assert.equal(compressMarkdown(input), '# Title\n\nBody.');
  });

  it('collapses 3+ consecutive blank lines to a single blank line', () => {
    const input = 'Line one\n\n\n\nLine two';
    assert.equal(compressMarkdown(input), 'Line one\n\nLine two');
  });

  it('preserves a single blank line (paragraph break)', () => {
    const input = 'Para one\n\nPara two';
    assert.equal(compressMarkdown(input), 'Para one\n\nPara two');
  });

  it('trims leading and trailing whitespace', () => {
    const input = '\n\n# Hello\n\nWorld\n\n';
    assert.equal(compressMarkdown(input), '# Hello\n\nWorld');
  });

  it('trims trailing whitespace from individual lines', () => {
    const input = 'Line one   \nLine two  ';
    assert.equal(compressMarkdown(input), 'Line one\nLine two');
  });

  it('handles frontmatter + comment + excess blank lines together', () => {
    const input = '---\nname: foo\n---\n\n<!-- note -->\n\n\n\n# Body\n\nContent';
    assert.equal(compressMarkdown(input), '# Body\n\nContent');
  });

  it('returns empty string for a frontmatter-only file', () => {
    const input = '---\nname: foo\n---\n';
    assert.equal(compressMarkdown(input), '');
  });
});
