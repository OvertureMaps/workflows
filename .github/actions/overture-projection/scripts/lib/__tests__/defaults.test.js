'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
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
} = require('../defaults');

describe('defaults', () => {
  // ── Provider ───────────────────────────────────────────────────────────────

  it('DEFAULT_PROVIDER is a non-empty string', () => {
    assert.equal(typeof DEFAULT_PROVIDER, 'string');
    assert.ok(DEFAULT_PROVIDER.length > 0);
  });

  it('DEFAULT_PROVIDER matches the github-models getProviderDefaults key', () => {
    const d = getProviderDefaults(DEFAULT_PROVIDER);
    assert.equal(d.model, GITHUB_MODELS_DEFAULT_MODEL);
  });

  // ── Model IDs ──────────────────────────────────────────────────────────────

  it('exports GITHUB_MODELS_DEFAULT_MODEL as a non-empty string', () => {
    assert.equal(typeof GITHUB_MODELS_DEFAULT_MODEL, 'string');
    assert.ok(GITHUB_MODELS_DEFAULT_MODEL.length > 0);
  });

  it('exports GITHUB_MODELS_DEFAULT_SELECTION as a non-empty string', () => {
    assert.equal(typeof GITHUB_MODELS_DEFAULT_SELECTION, 'string');
    assert.ok(GITHUB_MODELS_DEFAULT_SELECTION.length > 0);
  });

  it('exports ANTHROPIC_DEFAULT_MODEL as a non-empty string', () => {
    assert.equal(typeof ANTHROPIC_DEFAULT_MODEL, 'string');
    assert.ok(ANTHROPIC_DEFAULT_MODEL.length > 0);
  });

  it('exports ANTHROPIC_DEFAULT_SELECTION as a non-empty string', () => {
    assert.equal(typeof ANTHROPIC_DEFAULT_SELECTION, 'string');
    assert.ok(ANTHROPIC_DEFAULT_SELECTION.length > 0);
  });

  it('GitHub Models defaults are distinct from Anthropic defaults', () => {
    assert.notEqual(GITHUB_MODELS_DEFAULT_MODEL,     ANTHROPIC_DEFAULT_MODEL);
    assert.notEqual(GITHUB_MODELS_DEFAULT_SELECTION, ANTHROPIC_DEFAULT_SELECTION);
  });

  it('review model and selection model are distinct within each provider', () => {
    assert.notEqual(GITHUB_MODELS_DEFAULT_MODEL,  GITHUB_MODELS_DEFAULT_SELECTION);
    assert.notEqual(ANTHROPIC_DEFAULT_MODEL,       ANTHROPIC_DEFAULT_SELECTION);
  });

  // ── Token / budget limits ──────────────────────────────────────────────────

  it('GITHUB_MODELS_MAX_INPUT_TOKENS is a positive integer', () => {
    assert.equal(typeof GITHUB_MODELS_MAX_INPUT_TOKENS, 'number');
    assert.ok(Number.isInteger(GITHUB_MODELS_MAX_INPUT_TOKENS));
    assert.ok(GITHUB_MODELS_MAX_INPUT_TOKENS > 0);
  });

  it('GITHUB_MODELS_MAX_OUTPUT_TOKENS is a positive integer', () => {
    assert.equal(typeof GITHUB_MODELS_MAX_OUTPUT_TOKENS, 'number');
    assert.ok(Number.isInteger(GITHUB_MODELS_MAX_OUTPUT_TOKENS));
    assert.ok(GITHUB_MODELS_MAX_OUTPUT_TOKENS > 0);
  });

  it('ANTHROPIC_MAX_INPUT_TOKENS is a positive integer', () => {
    assert.equal(typeof ANTHROPIC_MAX_INPUT_TOKENS, 'number');
    assert.ok(Number.isInteger(ANTHROPIC_MAX_INPUT_TOKENS));
    assert.ok(ANTHROPIC_MAX_INPUT_TOKENS > 0);
  });

  it('ANTHROPIC_MAX_OUTPUT_TOKENS is a positive integer', () => {
    assert.equal(typeof ANTHROPIC_MAX_OUTPUT_TOKENS, 'number');
    assert.ok(Number.isInteger(ANTHROPIC_MAX_OUTPUT_TOKENS));
    assert.ok(ANTHROPIC_MAX_OUTPUT_TOKENS > 0);
  });

  it('Anthropic has a much larger input token budget than GitHub Models', () => {
    assert.ok(ANTHROPIC_MAX_INPUT_TOKENS > GITHUB_MODELS_MAX_INPUT_TOKENS * 10);
  });

  it('DEFAULT_MAX_DIFF_CHARS is a positive integer', () => {
    assert.equal(typeof DEFAULT_MAX_DIFF_CHARS, 'number');
    assert.ok(Number.isInteger(DEFAULT_MAX_DIFF_CHARS));
    assert.ok(DEFAULT_MAX_DIFF_CHARS > 0);
  });

  it('DEFAULT_MAX_CONTEXT_FILE_CHARS is a positive integer', () => {
    assert.equal(typeof DEFAULT_MAX_CONTEXT_FILE_CHARS, 'number');
    assert.ok(Number.isInteger(DEFAULT_MAX_CONTEXT_FILE_CHARS));
    assert.ok(DEFAULT_MAX_CONTEXT_FILE_CHARS > 0);
  });

  it('DEFAULT_MAX_DIFF_CHARS is larger than DEFAULT_MAX_CONTEXT_FILE_CHARS', () => {
    assert.ok(DEFAULT_MAX_DIFF_CHARS > DEFAULT_MAX_CONTEXT_FILE_CHARS);
  });

  // ── getProviderDefaults ────────────────────────────────────────────────────

  it('returns github-models defaults for "github-models"', () => {
    const d = getProviderDefaults('github-models');
    assert.equal(d.model,           GITHUB_MODELS_DEFAULT_MODEL);
    assert.equal(d.selectionModel,  GITHUB_MODELS_DEFAULT_SELECTION);
    assert.equal(d.maxInputTokens,  GITHUB_MODELS_MAX_INPUT_TOKENS);
    assert.equal(d.maxOutputTokens, GITHUB_MODELS_MAX_OUTPUT_TOKENS);
  });

  it('returns anthropic defaults for "anthropic"', () => {
    const d = getProviderDefaults('anthropic');
    assert.equal(d.model,           ANTHROPIC_DEFAULT_MODEL);
    assert.equal(d.selectionModel,  ANTHROPIC_DEFAULT_SELECTION);
    assert.equal(d.maxInputTokens,  ANTHROPIC_MAX_INPUT_TOKENS);
    assert.equal(d.maxOutputTokens, ANTHROPIC_MAX_OUTPUT_TOKENS);
  });

  it('falls back to github-models defaults for an unknown provider', () => {
    const d = getProviderDefaults('unknown-provider');
    assert.equal(d.model,           GITHUB_MODELS_DEFAULT_MODEL);
    assert.equal(d.maxInputTokens,  GITHUB_MODELS_MAX_INPUT_TOKENS);
  });

  it('Anthropic defaults have significantly more input tokens than GitHub Models', () => {
    const ghd = getProviderDefaults('github-models');
    const acd = getProviderDefaults('anthropic');
    assert.ok(acd.maxInputTokens > ghd.maxInputTokens * 10);
  });

  it('returned object has all required keys', () => {
    for (const provider of ['github-models', 'anthropic']) {
      const d = getProviderDefaults(provider);
      assert.ok('model'           in d, `${provider}: missing model`);
      assert.ok('selectionModel'  in d, `${provider}: missing selectionModel`);
      assert.ok('maxInputTokens'  in d, `${provider}: missing maxInputTokens`);
      assert.ok('maxOutputTokens' in d, `${provider}: missing maxOutputTokens`);
    }
  });
});
