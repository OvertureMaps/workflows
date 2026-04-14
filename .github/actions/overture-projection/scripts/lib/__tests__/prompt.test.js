'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSystemPrompt,
  buildUserPromptPreamble,
  buildUserPrompt,
  isTestFile,
  DOCS_EXTENSIONS,
} = require('../prompt');

// ---------------------------------------------------------------------------
// DOCS_EXTENSIONS
// ---------------------------------------------------------------------------

describe('DOCS_EXTENSIONS', () => {
  it('is a Set', () => {
    assert.ok(DOCS_EXTENSIONS instanceof Set);
  });

  it('contains .md', () => {
    assert.ok(DOCS_EXTENSIONS.has('.md'));
  });

  it('contains .mdx', () => {
    assert.ok(DOCS_EXTENSIONS.has('.mdx'));
  });

  it('contains .rst', () => {
    assert.ok(DOCS_EXTENSIONS.has('.rst'));
  });

  it('contains .txt', () => {
    assert.ok(DOCS_EXTENSIONS.has('.txt'));
  });
});

// ---------------------------------------------------------------------------
// isTestFile
// ---------------------------------------------------------------------------

describe('isTestFile', () => {
  // directory-based matches
  it('matches files inside a tests/ directory', () => {
    assert.ok(isTestFile('tests/utils.test.js'));
  });

  it('matches files inside a test/ directory', () => {
    assert.ok(isTestFile('test/unit/parser.js'));
  });

  it('matches files inside a __tests__/ directory', () => {
    assert.ok(isTestFile('src/__tests__/foo.js'));
  });

  it('matches files inside a spec/ directory', () => {
    assert.ok(isTestFile('spec/models/user_spec.rb'));
  });

  // suffix-based matches
  it('matches *.test.js suffix', () => {
    assert.ok(isTestFile('src/utils.test.js'));
  });

  it('matches *.spec.ts suffix', () => {
    assert.ok(isTestFile('src/components/Button.spec.ts'));
  });

  it('matches *_test.go suffix', () => {
    assert.ok(isTestFile('pkg/parser/parser_test.go'));
  });

  it('matches *-test.js suffix', () => {
    assert.ok(isTestFile('lib/helper-test.js'));
  });

  // Python conventions
  it('matches test_foo.py at the root', () => {
    assert.ok(isTestFile('test_parser.py'));
  });

  it('matches test_foo.py in a subdirectory', () => {
    assert.ok(isTestFile('mypackage/test_utils.py'));
  });

  // non-test files
  it('returns false for a regular source file', () => {
    assert.equal(isTestFile('src/index.js'), false);
  });

  it('returns false for a file named "context.ts"', () => {
    assert.equal(isTestFile('src/context.ts'), false);
  });

  it('returns false for a docs file', () => {
    assert.equal(isTestFile('docs/README.md'), false);
  });
});

// ---------------------------------------------------------------------------
// buildSystemPrompt
// ---------------------------------------------------------------------------

describe('buildSystemPrompt', () => {
  it('returns empty string when skills array is empty', () => {
    assert.equal(buildSystemPrompt([], {}), '');
  });

  it('wraps a single skill in a comment header', () => {
    const skills = [{ name: 'pr-review', raw: '---\nname: pr-review\n---\nReview all PRs.' }];
    const result = buildSystemPrompt(skills, {});
    assert.match(result, /<!-- skill: pr-review -->/);
    assert.match(result, /Review all PRs\./);
  });

  it('strips frontmatter from the skill body', () => {
    const skills = [{ name: 'pr-review', raw: '---\nname: pr-review\n---\nBody text.' }];
    const result = buildSystemPrompt(skills, {});
    assert.ok(!result.includes('name: pr-review'));
    assert.match(result, /Body text\./);
  });

  it('separates multiple skills with --- dividers', () => {
    const skills = [
      { name: 'skill-a', raw: '# Skill A' },
      { name: 'skill-b', raw: '# Skill B' },
    ];
    const result = buildSystemPrompt(skills, {});
    assert.match(result, /---/);
    assert.match(result, /<!-- skill: skill-a -->/);
    assert.match(result, /<!-- skill: skill-b -->/);
  });

  it('appends a ## Context Files section when context entries are provided', () => {
    const skills = [{ name: 'my-skill', raw: 'Skill body.' }];
    const contextBySkill = {
      'my-skill': [
        { ref: 'owner/repo:path/to/file.md', content: 'File content here.' },
      ],
    };
    const result = buildSystemPrompt(skills, contextBySkill);
    assert.match(result, /## Context Files/);
    assert.match(result, /\[owner\/repo:path\/to\/file\.md\]/);
    assert.match(result, /File content here\./);
  });

  it('does not include ## Context Files when context is empty for a skill', () => {
    const skills = [{ name: 'my-skill', raw: 'Skill body.' }];
    const result = buildSystemPrompt(skills, { 'my-skill': [] });
    assert.ok(!result.includes('## Context Files'));
  });

  it('does not include ## Context Files when skill has no entry in contextBySkill', () => {
    const skills = [{ name: 'my-skill', raw: 'Skill body.' }];
    const result = buildSystemPrompt(skills, {});
    assert.ok(!result.includes('## Context Files'));
  });

  it('preserves skill order in the output', () => {
    const skills = [
      { name: 'first', raw: 'First body.' },
      { name: 'second', raw: 'Second body.' },
    ];
    const result = buildSystemPrompt(skills, {});
    assert.ok(result.indexOf('<!-- skill: first -->') < result.indexOf('<!-- skill: second -->'));
  });
});

// ---------------------------------------------------------------------------
// buildUserPrompt
// ---------------------------------------------------------------------------

/** Minimal valid PRData fixture. */
function makePRData(overrides = {}) {
  return {
    number: 1,
    title: 'Test PR',
    body: 'This is the description.',
    totalFiles: 1,
    headRef: 'feature/foo',
    baseRef: 'main',
    authorAssociation: 'CONTRIBUTOR',
    linkedIssues: [],
    repoLicense: 'Apache-2.0',
    budgetSkippedFiles: [],
    files: [
      { filename: 'src/index.js', status: 'modified', additions: 5, deletions: 2, patch: '@@ -1 +1 @@\n-old\n+new' },
    ],
    ...overrides,
  };
}

describe('buildUserPrompt', () => {
  it('includes the PR title in the output', () => {
    const result = buildUserPrompt(makePRData());
    assert.match(result, /Test PR/);
  });

  it('includes branch names', () => {
    const result = buildUserPrompt(makePRData());
    assert.match(result, /feature\/foo/);
    assert.match(result, /main/);
  });

  it('includes the license when present', () => {
    const result = buildUserPrompt(makePRData());
    assert.match(result, /Apache-2\.0/);
  });

  it('shows "License: unknown" when repoLicense is null', () => {
    const result = buildUserPrompt(makePRData({ repoLicense: null }));
    assert.match(result, /License: unknown/);
  });

  it('shows description: ✅ when body is present', () => {
    const result = buildUserPrompt(makePRData());
    assert.match(result, /Description: ✅/);
  });

  it('shows description: ❌ missing when body is empty string', () => {
    const result = buildUserPrompt(makePRData({ body: '' }));
    assert.match(result, /Description: ❌ missing/);
  });

  it('shows PR type: code for a code-only PR', () => {
    const result = buildUserPrompt(makePRData());
    assert.match(result, /PR type: code/);
  });

  it('shows PR type: docs-only when all files are docs extensions', () => {
    const result = buildUserPrompt(makePRData({
      files: [
        { filename: 'docs/README.md', status: 'modified', additions: 1, deletions: 0, patch: '+line' },
      ],
    }));
    assert.match(result, /PR type: docs-only/);
  });

  it('suppresses the tests note for docs-only PRs', () => {
    const result = buildUserPrompt(makePRData({
      files: [
        { filename: 'docs/README.md', status: 'modified', additions: 1, deletions: 0, patch: '+line' },
      ],
    }));
    assert.ok(!result.includes('Tests:'));
  });

  it('shows Tests: ✅ when a test file is present', () => {
    const result = buildUserPrompt(makePRData({
      files: [
        { filename: 'src/index.js', status: 'modified', additions: 1, deletions: 0, patch: '+x' },
        { filename: 'tests/index.test.js', status: 'added', additions: 10, deletions: 0, patch: '+test' },
      ],
    }));
    assert.match(result, /Tests: ✅/);
  });

  it('shows Tests: ❌ none in diff when no test files are present', () => {
    const result = buildUserPrompt(makePRData());
    assert.match(result, /Tests: ❌ none in diff/);
  });

  it('includes author association', () => {
    const result = buildUserPrompt(makePRData());
    assert.match(result, /Author: CONTRIBUTOR/);
  });

  it('omits the Author note when authorAssociation is null', () => {
    const result = buildUserPrompt(makePRData({ authorAssociation: null }));
    assert.ok(!result.includes('Author:'));
  });

  it('shows linked issues when present', () => {
    const result = buildUserPrompt(makePRData({ linkedIssues: [{ number: 42 }] }));
    assert.match(result, /#42/);
  });

  it('shows no linked issue when list is empty', () => {
    const result = buildUserPrompt(makePRData({ linkedIssues: [] }));
    assert.match(result, /Linked issue: ❌ none/);
  });

  it('includes a diff block for each file', () => {
    const result = buildUserPrompt(makePRData({
      files: [
        { filename: 'src/a.js', status: 'added', additions: 1, deletions: 0, patch: '+a' },
        { filename: 'src/b.js', status: 'modified', additions: 2, deletions: 1, patch: '-b\n+B' },
      ],
      totalFiles: 2,
    }));
    assert.match(result, /src\/a\.js/);
    assert.match(result, /src\/b\.js/);
    assert.match(result, /```diff/);
  });

  it('does not include any omitted/skipped notes when all files fit', () => {
    const result = buildUserPrompt(makePRData({ totalFiles: 1, budgetSkippedFiles: [] }));
    assert.ok(!result.includes('omitted'));
    assert.ok(!result.includes('Not Reviewed'));
  });

  it('shows an API-omitted note when totalFiles exceeds files + budgetSkippedFiles', () => {
    // 10 total, 1 included, 0 budget-skipped → 9 not fetched from API
    const result = buildUserPrompt(makePRData({ totalFiles: 10, budgetSkippedFiles: [] }));
    assert.match(result, /9 additional file\(s\) not fetched/);
  });

  it('does not show API-omitted note when all files accounted for', () => {
    // 3 total, 1 included, 2 budget-skipped → 0 API-omitted
    const result = buildUserPrompt(makePRData({
      totalFiles: 3,
      budgetSkippedFiles: ['src/b.js', 'src/c.js'],
    }));
    assert.ok(!result.includes('not fetched'));
  });

  it('renders the skipped-files section when budgetSkippedFiles is non-empty', () => {
    const result = buildUserPrompt(makePRData({
      totalFiles: 3,
      budgetSkippedFiles: ['src/b.js', 'src/c.js'],
    }));
    assert.match(result, /Files Not Reviewed/);
    assert.match(result, /`src\/b\.js`/);
    assert.match(result, /`src\/c\.js`/);
  });

  it('instructs the model to recommend smaller PRs in the skipped-files section', () => {
    const result = buildUserPrompt(makePRData({
      totalFiles: 2,
      budgetSkippedFiles: ['src/big.js'],
    }));
    assert.match(result, /smaller.*pull request/i);
  });

  it('does not render the skipped-files section when budgetSkippedFiles is empty', () => {
    const result = buildUserPrompt(makePRData({ budgetSkippedFiles: [] }));
    assert.ok(!result.includes('Files Not Reviewed'));
  });

  it('does not render the skipped-files section when budgetSkippedFiles is absent', () => {
    // Legacy prData without the field
    const data = makePRData();
    delete data.budgetSkippedFiles;
    const result = buildUserPrompt(data);
    assert.ok(!result.includes('Files Not Reviewed'));
  });

  it('uses (no description) placeholder when body is empty', () => {
    const result = buildUserPrompt(makePRData({ body: '' }));
    assert.match(result, /\(no description\)/);
  });
});

// ---------------------------------------------------------------------------
// buildUserPromptPreamble
// ---------------------------------------------------------------------------

describe('buildUserPromptPreamble', () => {
  it('is a string', () => {
    assert.equal(typeof buildUserPromptPreamble(makePRData()), 'string');
  });

  it('includes the PR title', () => {
    assert.match(buildUserPromptPreamble(makePRData()), /Test PR/);
  });

  it('includes branch names', () => {
    const result = buildUserPromptPreamble(makePRData());
    assert.match(result, /feature\/foo/);
    assert.match(result, /main/);
  });

  it('does not include any diff fences (no per-file blocks)', () => {
    assert.ok(!buildUserPromptPreamble(makePRData()).includes('```diff'));
  });

  it('does not include file patch content', () => {
    const result = buildUserPromptPreamble(makePRData());
    assert.ok(!result.includes('-old\n+new'));
  });

  it('length is less than the full buildUserPrompt length (diff blocks are absent)', () => {
    const full     = buildUserPrompt(makePRData());
    const preamble = buildUserPromptPreamble(makePRData());
    assert.ok(preamble.length < full.length);
  });

  it('includes the skipped-files section when budgetSkippedFiles is non-empty', () => {
    const result = buildUserPromptPreamble(makePRData({ totalFiles: 3, budgetSkippedFiles: ['src/b.js'] }));
    assert.match(result, /Files Not Reviewed/);
  });

  it('does not include the skipped-files section when budgetSkippedFiles is empty', () => {
    assert.ok(!buildUserPromptPreamble(makePRData()).includes('Files Not Reviewed'));
  });
});
