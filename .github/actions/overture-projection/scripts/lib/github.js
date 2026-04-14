/**
 * @file lib/github.js
 * @description GitHub context resolution helpers.
 *
 * Used by fetch-diff.js and post-review.js, both of which need to resolve the
 * target repository and PR number from either explicit env var overrides or the
 * Actions event context. Extracted for unit-testability — the fallback logic is
 * easy to misconfigure and benefits from isolated tests.
 */

'use strict';

/**
 * Resolves the target repository as `{ owner, repo }`.
 *
 * Prefers the `REPOSITORY` environment variable (set from the `repository`
 * action input) so that cross-repo reviews work correctly. Falls back to
 * `context.repo`, which is derived from the workflow's own repository and
 * would be wrong when reviewing a PR in a different repo.
 *
 * @param {string|undefined}          repositoryEnv - Value of `process.env.REPOSITORY`.
 * @param {{ owner: string, repo: string }} contextRepo  - `context.repo` from the Actions context.
 * @returns {{ owner: string, repo: string }}
 *
 * @example
 * resolveRepo('OvertureMaps/overture-tiles', { owner: 'OvertureMaps', repo: 'omf-devex' })
 * // => { owner: 'OvertureMaps', repo: 'overture-tiles' }
 *
 * resolveRepo(undefined, { owner: 'OvertureMaps', repo: 'omf-devex' })
 * // => { owner: 'OvertureMaps', repo: 'omf-devex' }
 */
function resolveRepo(repositoryEnv, contextRepo) {
  if (repositoryEnv) {
    const [owner, repo] = repositoryEnv.split('/');
    return { owner, repo };
  }
  return { owner: contextRepo.owner, repo: contextRepo.repo };
}

/**
 * Resolves the pull request number to review.
 *
 * Prefers the PR number from the event payload (set automatically on
 * `pull_request` events). Falls back to parsing `PR_NUMBER` env var, which
 * is required for `workflow_dispatch` triggers where no PR payload is present.
 *
 * Returns `null` when neither source yields a valid positive integer, which
 * the caller should treat as a hard failure.
 *
 * @param {number|undefined} payloadPrNumber - `context.payload.pull_request?.number`.
 * @param {string|undefined} prNumberEnv     - Value of `process.env.PR_NUMBER`.
 * @returns {number|null} PR number, or `null` if unavailable.
 *
 * @example
 * resolvePrNumber(42, undefined)   // => 42
 * resolvePrNumber(undefined, '7')  // => 7
 * resolvePrNumber(undefined, '')   // => null
 */
function resolvePrNumber(payloadPrNumber, prNumberEnv) {
  if (payloadPrNumber) return payloadPrNumber;
  const parsed = parseInt(prNumberEnv);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

module.exports = { resolveRepo, resolvePrNumber };
