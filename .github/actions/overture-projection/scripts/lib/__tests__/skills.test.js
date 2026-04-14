'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseFrontmatter, filterSkills } = require('../skills');

// ---------------------------------------------------------------------------
// parseFrontmatter
// ---------------------------------------------------------------------------

describe('parseFrontmatter', () => {
  it('returns empty defaults when no frontmatter block is present', () => {
    const result = parseFrontmatter('# Just a heading\n\nBody text.');
    assert.deepEqual(result, { description: '', contextFiles: [], surfaces: null });
  });

  it('parses an inline description', () => {
    const raw = '---\ndescription: Checks container images\nsurfaces: [pr-reviewer]\n---\n# Body';
    const { description } = parseFrontmatter(raw);
    assert.equal(description, 'Checks container images');
  });

  it('strips surrounding quotes from description', () => {
    const raw = "---\ndescription: 'Quoted description'\n---\n";
    const { description } = parseFrontmatter(raw);
    assert.equal(description, 'Quoted description');
  });

  it('parses a block-scalar description (> form)', () => {
    const raw = '---\ndescription: >\n  This is a long\n  description.\n---\n';
    const { description } = parseFrontmatter(raw);
    // Collapsed to a single line
    assert.ok(description.includes('This is a long'));
  });

  it('returns surfaces as an array when present', () => {
    const raw = '---\ndescription: foo\nsurfaces: [pr-reviewer, agent]\n---\n';
    const { surfaces } = parseFrontmatter(raw);
    assert.deepEqual(surfaces, ['pr-reviewer', 'agent']);
  });

  it('returns surfaces: null when the surfaces field is absent', () => {
    const raw = '---\ndescription: foo\n---\n';
    const { surfaces } = parseFrontmatter(raw);
    assert.equal(surfaces, null);
  });

  it('returns surfaces: [] for an empty bracket list', () => {
    const raw = '---\ndescription: foo\nsurfaces: []\n---\n';
    const { surfaces } = parseFrontmatter(raw);
    assert.deepEqual(surfaces, []);
  });

  it('parses context-files list', () => {
    const raw = [
      '---',
      'description: foo',
      'context-files:',
      '  - OvertureMaps/schema:docs/overview.md',
      '  - OvertureMaps/schema:docs/spec.md',
      '---',
    ].join('\n');
    const { contextFiles } = parseFrontmatter(raw);
    assert.deepEqual(contextFiles, [
      'OvertureMaps/schema:docs/overview.md',
      'OvertureMaps/schema:docs/spec.md',
    ]);
  });

  it('returns empty contextFiles when field is absent', () => {
    const raw = '---\ndescription: foo\n---\n';
    const { contextFiles } = parseFrontmatter(raw);
    assert.deepEqual(contextFiles, []);
  });

  it('handles a single-item surfaces list', () => {
    const raw = '---\nsurfaces: [pr-reviewer]\n---\n';
    const { surfaces } = parseFrontmatter(raw);
    assert.deepEqual(surfaces, ['pr-reviewer']);
  });
});

// ---------------------------------------------------------------------------
// filterSkills
// ---------------------------------------------------------------------------

describe('filterSkills', () => {
  it('includes skills whose surfaces contain pr-reviewer', () => {
    const skills = [
      { name: 'a', raw: '---\ndescription: A\nsurfaces: [pr-reviewer]\n---\n' },
    ];
    const result = filterSkills(skills);
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'a');
  });

  it('excludes skills whose surfaces do not include pr-reviewer', () => {
    const skills = [
      { name: 'b', raw: '---\ndescription: B\nsurfaces: [agent]\n---\n' },
    ];
    const result = filterSkills(skills);
    assert.equal(result.length, 0);
  });

  it('includes skills with no surfaces field (legacy pass-through)', () => {
    const skills = [
      { name: 'c', raw: '# No frontmatter at all\n\nBody.' },
    ];
    const result = filterSkills(skills);
    assert.equal(result.length, 1);
    assert.equal(result[0].name, 'c');
  });

  it('includes multi-surface skills that contain pr-reviewer', () => {
    const skills = [
      { name: 'd', raw: '---\ndescription: D\nsurfaces: [pr-reviewer, agent]\n---\n' },
    ];
    const result = filterSkills(skills);
    assert.equal(result.length, 1);
  });

  it('returns the correct shape for each included skill', () => {
    const skills = [
      {
        name: 'e',
        raw: [
          '---',
          'description: My skill',
          'surfaces: [pr-reviewer]',
          'context-files:',
          '  - owner/repo:path/to/file.md',
          '---',
          '# Body',
        ].join('\n'),
      },
    ];
    const [skill] = filterSkills(skills);
    assert.equal(skill.name, 'e');
    assert.equal(skill.description, 'My skill');
    assert.deepEqual(skill.contextFiles, ['owner/repo:path/to/file.md']);
    assert.ok(typeof skill.raw === 'string');
  });

  it('handles a mixed array correctly', () => {
    const skills = [
      { name: 'pr',    raw: '---\nsurfaces: [pr-reviewer]\n---\n' },
      { name: 'agent', raw: '---\nsurfaces: [agent]\n---\n' },
      { name: 'both',  raw: '---\nsurfaces: [pr-reviewer, agent]\n---\n' },
      { name: 'none',  raw: '# no frontmatter' },
    ];
    const result = filterSkills(skills);
    const names = result.map(s => s.name);
    assert.deepEqual(names, ['pr', 'both', 'none']);
  });

  it('returns an empty array for an empty input', () => {
    assert.deepEqual(filterSkills([]), []);
  });
});
