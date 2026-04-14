'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  diffCharBudget,
  buildIgnorePatterns,
  isIgnored,
  applyFileBudget,
} = require('../diff');

// ---------------------------------------------------------------------------
// buildIgnorePatterns
// ---------------------------------------------------------------------------

describe('buildIgnorePatterns', () => {
  it('returns an empty array for an empty string', () => {
    assert.deepEqual(buildIgnorePatterns(''), []);
  });

  it('returns an empty array for undefined', () => {
    assert.deepEqual(buildIgnorePatterns(undefined), []);
  });

  it('compiles a single exact-match pattern', () => {
    const [re] = buildIgnorePatterns('package-lock.json');
    assert.ok(re.test('package-lock.json'));
    assert.ok(!re.test('package.json'));
  });

  it('compiles a wildcard pattern using *', () => {
    const [re] = buildIgnorePatterns('*.lock');
    assert.ok(re.test('yarn.lock'));
    assert.ok(re.test('foo.lock'));
  });

  it('escapes regex metacharacters in patterns', () => {
    const [re] = buildIgnorePatterns('dist/bundle.min.js');
    assert.ok(re.test('dist/bundle.min.js'));
    assert.ok(!re.test('dist/bundleXminYjs'));
  });

  it('ignores empty lines and whitespace-only lines', () => {
    const patterns = buildIgnorePatterns('*.lock\n\n   \npackage-lock.json');
    assert.equal(patterns.length, 2);
  });

  it('compiles multiple patterns from a newline-separated string', () => {
    const patterns = buildIgnorePatterns('*.lock\npackage-lock.json\n*.min.js');
    assert.equal(patterns.length, 3);
  });
});

// ---------------------------------------------------------------------------
// isIgnored
// ---------------------------------------------------------------------------

describe('isIgnored', () => {
  it('returns false when no patterns are provided', () => {
    assert.equal(isIgnored({ filename: 'src/index.js' }, []), false);
  });

  it('matches on the full path', () => {
    const patterns = buildIgnorePatterns('dist/bundle.js');
    assert.equal(isIgnored({ filename: 'dist/bundle.js' }, patterns), true);
  });

  it('matches on the basename (allows *.lock to catch subdir/yarn.lock)', () => {
    const patterns = buildIgnorePatterns('*.lock');
    assert.equal(isIgnored({ filename: 'subdir/yarn.lock' }, patterns), true);
  });

  it('does not ignore a file that has no matching pattern', () => {
    const patterns = buildIgnorePatterns('*.lock');
    assert.equal(isIgnored({ filename: 'src/index.js' }, patterns), false);
  });

  it('matches an exact basename in a subdirectory', () => {
    const patterns = buildIgnorePatterns('package-lock.json');
    assert.equal(isIgnored({ filename: 'frontend/package-lock.json' }, patterns), true);
  });
});

// ---------------------------------------------------------------------------
// applyFileBudget
// ---------------------------------------------------------------------------

/** Build a minimal file fixture. */
function file(filename, patchLen) {
  return { filename, status: 'modified', additions: 1, deletions: 0, patch: 'x'.repeat(patchLen) };
}

/** Build a binary (no-patch) file fixture. */
function binaryFile(filename) {
  return { filename, status: 'modified', additions: 0, deletions: 0, patch: undefined };
}

describe('applyFileBudget', () => {
  it('includes all files when total patch length is within budget', () => {
    const files = [file('a.js', 200), file('b.js', 200)];
    const { included, skipped } = applyFileBudget(files, 500);
    assert.equal(included.length, 2);
    assert.equal(skipped.length, 0);
  });

  it('includes all files when total patch length exactly equals budget', () => {
    const files = [file('a.js', 250), file('b.js', 250)];
    const { included, skipped } = applyFileBudget(files, 500);
    assert.equal(included.length, 2);
    assert.equal(skipped.length, 0);
  });

  it('drops the file that would exceed the budget', () => {
    const files = [file('a.js', 400), file('b.js', 400)];
    const { included, skipped } = applyFileBudget(files, 500);
    assert.equal(included.length, 1);
    assert.equal(included[0].filename, 'a.js');
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0].filename, 'b.js');
  });

  it('never truncates a patch mid-diff — included patches are always complete', () => {
    const patch = 'x'.repeat(400);
    const files = [{ filename: 'a.js', status: 'modified', additions: 1, deletions: 0, patch }];
    const { included } = applyFileBudget(files, 500);
    assert.equal(included[0].patch, patch);
  });

  it('continues including files after a skip when they fit in remaining budget', () => {
    // a.js (100) fits (used=100); b.js (400) does not fit (100+400 > 300, skipped);
    // c.js (50) fits in remaining 200 (100+50=150 ≤ 300, included)
    const files = [file('a.js', 100), file('b.js', 400), file('c.js', 50)];
    const { included, skipped } = applyFileBudget(files, 300);
    assert.equal(included.length, 2);
    assert.deepEqual(included.map(f => f.filename), ['a.js', 'c.js']);
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0].filename, 'b.js');
  });

  it('skips multiple files when budget runs out early', () => {
    const files = [file('a.js', 100), file('b.js', 400), file('c.js', 400)];
    const { included, skipped } = applyFileBudget(files, 300);
    assert.equal(included.length, 1);
    assert.equal(included[0].filename, 'a.js');
    assert.equal(skipped.length, 2);
    assert.deepEqual(skipped.map(f => f.filename), ['b.js', 'c.js']);
  });

  it('replaces absent patches with a placeholder string for binary files', () => {
    const files = [binaryFile('image.png')];
    const { included } = applyFileBudget(files, 500);
    assert.equal(included[0].patch, '(binary or no textual diff)');
  });

  it('counts binary file patch length as 0 (does not drain budget)', () => {
    const files = [binaryFile('image.png'), file('a.js', 400)];
    const { included } = applyFileBudget(files, 400);
    assert.equal(included.length, 2);
  });

  it('returns empty included and skipped arrays for empty input', () => {
    const { included, skipped } = applyFileBudget([], 1000);
    assert.deepEqual(included, []);
    assert.deepEqual(skipped, []);
  });

  it('preserves filename, status, additions, deletions on included files', () => {
    const f = { filename: 'src/foo.js', status: 'added', additions: 5, deletions: 0, patch: 'abc' };
    const { included } = applyFileBudget([f], 1000);
    assert.equal(included[0].filename, 'src/foo.js');
    assert.equal(included[0].status, 'added');
    assert.equal(included[0].additions, 5);
    assert.equal(included[0].deletions, 0);
  });

  it('skipped entries are the original raw file objects', () => {
    // a.js (100) fits; b.js (600) does not
    const files = [file('a.js', 100), file('b.js', 600)];
    const { skipped } = applyFileBudget(files, 500);
    assert.equal(skipped[0].filename, 'b.js');
  });
});

// ---------------------------------------------------------------------------
// diffCharBudget
// ---------------------------------------------------------------------------

describe('diffCharBudget', () => {
  it('returns maxInputTokens * 4 when non-diff chars is 0', () => {
    assert.equal(diffCharBudget(0, 6200), 6200 * 4);
  });

  it('subtracts non-diff char cost from the total budget', () => {
    assert.equal(diffCharBudget(4000, 6200), 6200 * 4 - 4000);
  });

  it('returns 0 when non-diff chars exactly equals the full budget', () => {
    assert.equal(diffCharBudget(6200 * 4, 6200), 0);
  });

  it('clamps to 0 when non-diff chars exceeds the full budget', () => {
    assert.equal(diffCharBudget(6200 * 4 + 1000, 6200), 0);
  });

  it('never returns a negative value', () => {
    assert.ok(diffCharBudget(999999, 6200) >= 0);
  });

  it('scales correctly with a large maxInputTokens (e.g. Claude 200k window)', () => {
    assert.equal(diffCharBudget(0, 190000), 190000 * 4);
  });

  it('scales correctly with a small maxInputTokens', () => {
    assert.equal(diffCharBudget(0, 1000), 4000);
  });
});
