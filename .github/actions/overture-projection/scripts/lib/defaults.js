'use strict';

/**
 * @file lib/defaults.js
 * @description Canonical runtime defaults for Overture PRojection.
 *
 * All model IDs and token/budget numbers used as runtime fallbacks live here.
 * When Anthropic or GitHub Models releases a new generation, or token limits
 * change, update this file only — scripts and tests import from here rather
 * than hardcoding values.
 *
 * NOTE: action.yml and workflow YAML `default:` fields are static and cannot
 * reference this file. Mirror any changes there too (see inline comments).
 */

// ── Model IDs ─────────────────────────────────────────────────────────────────

/** Default model provider. */
const DEFAULT_PROVIDER = 'github-models';

/** Default review model when model-provider is 'github-models'. */
const GITHUB_MODELS_DEFAULT_MODEL      = 'gpt-4.1';

/** Default skill-selection model when model-provider is 'github-models'. */
const GITHUB_MODELS_DEFAULT_SELECTION  = 'gpt-4.1-mini';

/** Default review model when model-provider is 'anthropic'. */
const ANTHROPIC_DEFAULT_MODEL          = 'claude-opus-4-6';

/** Default skill-selection model when model-provider is 'anthropic'. */
const ANTHROPIC_DEFAULT_SELECTION      = 'claude-haiku-4-6';

// ── Token / budget limits — GitHub Models ─────────────────────────────────────

/**
 * Default max input tokens for GitHub Models gpt-4.1.
 * 8 000 context − 1 500 output − 300 tokenisation margin = 6 200.
 * Mirror: action.yml `max-input-tokens` default.
 *
 * @type {number}
 */
const GITHUB_MODELS_MAX_INPUT_TOKENS = 6200;

/**
 * Default max output tokens for GitHub Models.
 * Mirror: action.yml `max-output-tokens` default.
 *
 * @type {number}
 */
const GITHUB_MODELS_MAX_OUTPUT_TOKENS = 1500;

// ── Token / budget limits — Anthropic ────────────────────────────────────────

/**
 * Default max input tokens for Anthropic Claude models (200k context window).
 * 200 000 − 4 096 output − ~6 000 tokenisation margin ≈ 190 000.
 *
 * @type {number}
 */
const ANTHROPIC_MAX_INPUT_TOKENS = 190000;

/**
 * Default max output tokens for Anthropic Claude models.
 *
 * @type {number}
 */
const ANTHROPIC_MAX_OUTPUT_TOKENS = 4096;

// ── Other budget limits ───────────────────────────────────────────────────────

/**
 * Default fetch ceiling for diff content pulled from the GitHub API (chars).
 * This is a fetch guard only — actual context trimming uses the dynamic budget.
 * Mirror: action.yml `max-diff-chars` default.
 *
 * @type {number}
 */
const DEFAULT_MAX_DIFF_CHARS = 100000;

/**
 * Maximum character length for any single context file after compression.
 * At ~4 chars/token this is roughly 1 250 tokens per file.
 * Mirror: context.js MAX_CONTEXT_FILE_CHARS (kept as a named re-export there).
 *
 * @type {number}
 */
const DEFAULT_MAX_CONTEXT_FILE_CHARS = 5000;

// ── Provider defaults lookup ──────────────────────────────────────────────────

/**
 * @typedef {Object} ProviderDefaults
 * @property {string} model          - Default review model ID.
 * @property {string} selectionModel - Default skill-selection model ID.
 * @property {number} maxInputTokens - Default max input tokens.
 * @property {number} maxOutputTokens - Default max output tokens.
 */

/**
 * Returns the canonical defaults for a given provider.
 * Use this instead of branching on the provider string in scripts.
 *
 * @param {'github-models'|'anthropic'} provider
 * @returns {ProviderDefaults}
 */
function getProviderDefaults(provider) {
  if (provider === 'anthropic') {
    return {
      model:           ANTHROPIC_DEFAULT_MODEL,
      selectionModel:  ANTHROPIC_DEFAULT_SELECTION,
      maxInputTokens:  ANTHROPIC_MAX_INPUT_TOKENS,
      maxOutputTokens: ANTHROPIC_MAX_OUTPUT_TOKENS,
    };
  }
  return {
    model:           GITHUB_MODELS_DEFAULT_MODEL,
    selectionModel:  GITHUB_MODELS_DEFAULT_SELECTION,
    maxInputTokens:  GITHUB_MODELS_MAX_INPUT_TOKENS,
    maxOutputTokens: GITHUB_MODELS_MAX_OUTPUT_TOKENS,
  };
}

module.exports = {
  DEFAULT_PROVIDER,
  GITHUB_MODELS_DEFAULT_MODEL,
  GITHUB_MODELS_DEFAULT_SELECTION,
  ANTHROPIC_DEFAULT_MODEL,
  ANTHROPIC_DEFAULT_SELECTION,
  GITHUB_MODELS_MAX_INPUT_TOKENS,
  GITHUB_MODELS_MAX_OUTPUT_TOKENS,
  ANTHROPIC_MAX_INPUT_TOKENS,
  ANTHROPIC_MAX_OUTPUT_TOKENS,
  DEFAULT_MAX_DIFF_CHARS,
  DEFAULT_MAX_CONTEXT_FILE_CHARS,
  getProviderDefaults,
};
