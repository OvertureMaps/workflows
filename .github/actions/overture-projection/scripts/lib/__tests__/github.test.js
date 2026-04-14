'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolveRepo, resolvePrNumber } = require('../github');

// ---------------------------------------------------------------------------
// resolveRepo
// ---------------------------------------------------------------------------

describe('resolveRepo', () => {
  const contextRepo = { owner: 'OvertureMaps', repo: 'omf-devex' };

  it('returns the parsed env repo when REPOSITORY env is set', () => {
    const result = resolveRepo('OvertureMaps/overture-tiles', contextRepo);
    assert.deepEqual(result, { owner: 'OvertureMaps', repo: 'overture-tiles' });
  });

  it('falls back to context.repo when REPOSITORY env is undefined', () => {
    const result = resolveRepo(undefined, contextRepo);
    assert.deepEqual(result, { owner: 'OvertureMaps', repo: 'omf-devex' });
  });

  it('falls back to context.repo when REPOSITORY env is empty string', () => {
    const result = resolveRepo('', contextRepo);
    assert.deepEqual(result, { owner: 'OvertureMaps', repo: 'omf-devex' });
  });

  it('correctly splits owner and repo from REPOSITORY env', () => {
    const { owner, repo } = resolveRepo('acme-org/my-repo', contextRepo);
    assert.equal(owner, 'acme-org');
    assert.equal(repo, 'my-repo');
  });
});

// ---------------------------------------------------------------------------
// resolvePrNumber
// ---------------------------------------------------------------------------

describe('resolvePrNumber', () => {
  it('returns the payload PR number when it is a positive integer', () => {
    assert.equal(resolvePrNumber(42, undefined), 42);
  });

  it('parses the PR_NUMBER env var when payload is undefined', () => {
    assert.equal(resolvePrNumber(undefined, '7'), 7);
  });

  it('returns null when neither source yields a valid number', () => {
    assert.equal(resolvePrNumber(undefined, ''), null);
  });

  it('returns null for a non-numeric PR_NUMBER env var', () => {
    assert.equal(resolvePrNumber(undefined, 'abc'), null);
  });

  it('returns null for a zero PR_NUMBER env var (not a valid PR)', () => {
    assert.equal(resolvePrNumber(undefined, '0'), null);
  });

  it('returns null for a negative PR_NUMBER env var', () => {
    assert.equal(resolvePrNumber(undefined, '-5'), null);
  });

  it('prefers the payload number over the env var when both are present', () => {
    assert.equal(resolvePrNumber(10, '99'), 10);
  });

  it('returns null when payload is 0 and env var is absent', () => {
    // 0 is falsy — treated same as undefined
    assert.equal(resolvePrNumber(0, undefined), null);
  });
});
