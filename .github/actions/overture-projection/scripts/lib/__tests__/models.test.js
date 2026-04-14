'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { YELLOW, BLUE, RESET, logRateLimit, callChatCompletion } = require('../models');

// ---------------------------------------------------------------------------
// ANSI constants
// ---------------------------------------------------------------------------

describe('ANSI constants', () => {
  it('YELLOW is the correct escape sequence', () => {
    assert.equal(YELLOW, '\x1b[33m');
  });

  it('BLUE is the correct escape sequence', () => {
    assert.equal(BLUE, '\x1b[34m');
  });

  it('RESET is the correct escape sequence', () => {
    assert.equal(RESET, '\x1b[0m');
  });
});

// ---------------------------------------------------------------------------
// logRateLimit
// ---------------------------------------------------------------------------

/** Build a minimal fake Response with the provided headers. */
function fakeResp(headers = {}) {
  return {
    headers: {
      get: (name) => headers[name] ?? null,
    },
  };
}

describe('logRateLimit', () => {
  it('no-ops when neither remaining-requests nor remaining-tokens header is present', () => {
    const calls = [];
    const core = { info: (m) => calls.push(['info', m]), warning: (m) => calls.push(['warning', m]) };
    logRateLimit(fakeResp({}), 'test', core);
    assert.equal(calls.length, 0);
  });

  it('calls core.info for normal (non-warning) levels', () => {
    const calls = [];
    const core = { info: (m) => calls.push(['info', m]), warning: (m) => calls.push(['warning', m]) };
    logRateLimit(
      fakeResp({
        'x-ratelimit-remaining-requests': '100',
        'x-ratelimit-remaining-tokens': '50000',
        'x-ratelimit-limit-tokens': '100000',
      }),
      'selection',
      core,
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'info');
    assert.match(calls[0][1], /selection rate limit/);
  });

  it('calls core.warning when remaining-requests ≤ 10', () => {
    const calls = [];
    const core = { info: (m) => calls.push(['info', m]), warning: (m) => calls.push(['warning', m]) };
    logRateLimit(
      fakeResp({
        'x-ratelimit-remaining-requests': '5',
        'x-ratelimit-remaining-tokens': '50000',
        'x-ratelimit-limit-tokens': '100000',
      }),
      'review',
      core,
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'warning');
  });

  it('calls core.warning when remaining-tokens ≤ 1000', () => {
    const calls = [];
    const core = { info: (m) => calls.push(['info', m]), warning: (m) => calls.push(['warning', m]) };
    logRateLimit(
      fakeResp({
        'x-ratelimit-remaining-requests': '500',
        'x-ratelimit-remaining-tokens': '999',
        'x-ratelimit-limit-tokens': '100000',
      }),
      'review',
      core,
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'warning');
  });

  it('calls core.warning at the exact boundary (remaining-requests = 10)', () => {
    const calls = [];
    const core = { info: (m) => calls.push(['info', m]), warning: (m) => calls.push(['warning', m]) };
    logRateLimit(
      fakeResp({
        'x-ratelimit-remaining-requests': '10',
        'x-ratelimit-remaining-tokens': '50000',
        'x-ratelimit-limit-tokens': '100000',
      }),
      'review',
      core,
    );
    assert.equal(calls[0][0], 'warning');
  });

  it('calls core.warning at the exact boundary (remaining-tokens = 1000)', () => {
    const calls = [];
    const core = { info: (m) => calls.push(['info', m]), warning: (m) => calls.push(['warning', m]) };
    logRateLimit(
      fakeResp({
        'x-ratelimit-remaining-requests': '500',
        'x-ratelimit-remaining-tokens': '1000',
        'x-ratelimit-limit-tokens': '100000',
      }),
      'review',
      core,
    );
    assert.equal(calls[0][0], 'warning');
  });

  it('includes retry-after in the message when header is present', () => {
    const calls = [];
    const core = { info: (m) => calls.push(['info', m]), warning: (m) => calls.push(['warning', m]) };
    logRateLimit(
      fakeResp({
        'x-ratelimit-remaining-requests': '100',
        'x-ratelimit-remaining-tokens': '50000',
        'x-ratelimit-limit-tokens': '100000',
        'retry-after': '30',
      }),
      'review',
      core,
    );
    assert.match(calls[0][1], /retry-after: 30s/);
  });

  it('works when only remaining-requests is present (remaining-tokens null)', () => {
    const calls = [];
    const core = { info: (m) => calls.push(['info', m]), warning: (m) => calls.push(['warning', m]) };
    logRateLimit(
      fakeResp({ 'x-ratelimit-remaining-requests': '200' }),
      'review',
      core,
    );
    assert.equal(calls.length, 1);
  });

  it('works when only remaining-tokens is present (remaining-requests null)', () => {
    const calls = [];
    const core = { info: (m) => calls.push(['info', m]), warning: (m) => calls.push(['warning', m]) };
    logRateLimit(
      fakeResp({ 'x-ratelimit-remaining-tokens': '5000', 'x-ratelimit-limit-tokens': '100000' }),
      'review',
      core,
    );
    assert.equal(calls.length, 1);
  });
});

// ---------------------------------------------------------------------------
// callChatCompletion
// ---------------------------------------------------------------------------

/**
 * Builds a minimal fake fetch Response.
 * @param {number} status
 * @param {object} body   - JSON body to return.
 * @param {object} [hdrs] - Headers map.
 */
function fakeFetchResp(status, body, hdrs = {}) {
  return {
    ok:     status >= 200 && status < 300,
    status,
    text:   async () => JSON.stringify(body),
    json:   async () => body,
    headers: { get: (n) => hdrs[n] ?? null },
  };
}

/** GitHub Models success response fixture. */
const GH_SUCCESS = {
  choices: [{ message: { content: 'Review text' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
};

/** Anthropic success response fixture. */
const ANTHROPIC_SUCCESS = {
  content:     [{ type: 'text', text: 'Anthropic review' }],
  stop_reason: 'end_turn',
  usage:       { input_tokens: 120, output_tokens: 60 },
};

describe('callChatCompletion', () => {
  let originalFetch;

  before(() => { originalFetch = globalThis.fetch; });
  after(()  => { globalThis.fetch = originalFetch; });

  // ── GitHub Models ──────────────────────────────────────────────────────────

  it('calls the GitHub Models endpoint by default (no provider set)', async () => {
    let calledUrl;
    globalThis.fetch = async (url) => { calledUrl = url; return fakeFetchResp(200, GH_SUCCESS); };
    await callChatCompletion({ token: 'tok', model: 'm', messages: [], maxTokens: 100 });
    assert.match(calledUrl, /models\.inference\.ai\.azure\.com/);
  });

  it('calls the GitHub Models endpoint when provider is github-models', async () => {
    let calledUrl;
    globalThis.fetch = async (url) => { calledUrl = url; return fakeFetchResp(200, GH_SUCCESS); };
    await callChatCompletion({ provider: 'github-models', token: 'tok', model: 'm', messages: [], maxTokens: 100 });
    assert.match(calledUrl, /models\.inference\.ai\.azure\.com/);
  });

  it('sends Bearer auth to GitHub Models', async () => {
    let calledHeaders;
    globalThis.fetch = async (_url, opts) => { calledHeaders = JSON.parse(opts.body); return fakeFetchResp(200, GH_SUCCESS); };
    // headers are in opts, body has model — check Authorization separately
    globalThis.fetch = async (_url, opts) => {
      calledHeaders = opts.headers;
      return fakeFetchResp(200, GH_SUCCESS);
    };
    await callChatCompletion({ provider: 'github-models', token: 'mytoken', model: 'm', messages: [], maxTokens: 100 });
    assert.equal(calledHeaders['Authorization'], 'Bearer mytoken');
  });

  it('normalises GitHub Models response to ChatResult shape', async () => {
    globalThis.fetch = async () => fakeFetchResp(200, GH_SUCCESS);
    const result = await callChatCompletion({ token: 'tok', model: 'm', messages: [], maxTokens: 100 });
    assert.equal(result.text, 'Review text');
    assert.equal(result.finishReason, 'stop');
    assert.equal(result.usage.input, 100);
    assert.equal(result.usage.output, 50);
    assert.equal(result.usage.total, 150);
  });

  it('includes response_format when jsonMode is true (GitHub Models)', async () => {
    let sentBody;
    globalThis.fetch = async (_url, opts) => { sentBody = JSON.parse(opts.body); return fakeFetchResp(200, GH_SUCCESS); };
    await callChatCompletion({ token: 'tok', model: 'm', messages: [], maxTokens: 100, jsonMode: true });
    assert.deepEqual(sentBody.response_format, { type: 'json_object' });
  });

  it('omits response_format when jsonMode is false (GitHub Models)', async () => {
    let sentBody;
    globalThis.fetch = async (_url, opts) => { sentBody = JSON.parse(opts.body); return fakeFetchResp(200, GH_SUCCESS); };
    await callChatCompletion({ token: 'tok', model: 'm', messages: [], maxTokens: 100, jsonMode: false });
    assert.ok(!('response_format' in sentBody));
  });

  it('throws an Error with status and body on non-2xx GitHub Models response', async () => {
    globalThis.fetch = async () => fakeFetchResp(413, { error: { message: 'too large' } });
    await assert.rejects(
      () => callChatCompletion({ token: 'tok', model: 'm', messages: [], maxTokens: 100 }),
      (err) => {
        assert.equal(err.status, 413);
        assert.match(err.message, /413/);
        return true;
      },
    );
  });

  // ── Anthropic ─────────────────────────────────────────────────────────────

  it('calls the Anthropic endpoint when provider is anthropic', async () => {
    let calledUrl;
    globalThis.fetch = async (url) => { calledUrl = url; return fakeFetchResp(200, ANTHROPIC_SUCCESS); };
    await callChatCompletion({ provider: 'anthropic', token: 'sk-key', model: 'claude-opus-4-5', messages: [{ role: 'user', content: 'Hi' }], maxTokens: 100 });
    assert.match(calledUrl, /api\.anthropic\.com/);
  });

  it('sends x-api-key and anthropic-version headers', async () => {
    let calledHeaders;
    globalThis.fetch = async (_url, opts) => {
      calledHeaders = opts.headers;
      return fakeFetchResp(200, ANTHROPIC_SUCCESS);
    };
    await callChatCompletion({ provider: 'anthropic', token: 'sk-abc', model: 'claude-opus-4-5', messages: [{ role: 'user', content: 'Hi' }], maxTokens: 100 });
    assert.equal(calledHeaders['x-api-key'], 'sk-abc');
    assert.ok(calledHeaders['anthropic-version']);
  });

  it('normalises Anthropic response to ChatResult shape', async () => {
    globalThis.fetch = async () => fakeFetchResp(200, ANTHROPIC_SUCCESS);
    const result = await callChatCompletion({ provider: 'anthropic', token: 'k', model: 'm', messages: [{ role: 'user', content: 'Hi' }], maxTokens: 100 });
    assert.equal(result.text, 'Anthropic review');
    assert.equal(result.finishReason, 'stop'); // end_turn → stop
    assert.equal(result.usage.input, 120);
    assert.equal(result.usage.output, 60);
    assert.equal(result.usage.total, 180);
  });

  it('maps max_tokens stop_reason to length finish reason', async () => {
    globalThis.fetch = async () => fakeFetchResp(200, { ...ANTHROPIC_SUCCESS, stop_reason: 'max_tokens' });
    const result = await callChatCompletion({ provider: 'anthropic', token: 'k', model: 'm', messages: [{ role: 'user', content: 'Hi' }], maxTokens: 100 });
    assert.equal(result.finishReason, 'length');
  });

  it('extracts system messages into the Anthropic system field', async () => {
    let sentBody;
    globalThis.fetch = async (_url, opts) => { sentBody = JSON.parse(opts.body); return fakeFetchResp(200, ANTHROPIC_SUCCESS); };
    await callChatCompletion({
      provider: 'anthropic', token: 'k', model: 'm', maxTokens: 100,
      messages: [
        { role: 'system', content: 'Be helpful.' },
        { role: 'user',   content: 'Review this.' },
      ],
    });
    assert.equal(sentBody.system, 'Be helpful.');
    assert.equal(sentBody.messages.length, 1);
    assert.equal(sentBody.messages[0].role, 'user');
  });

  it('appends JSON instruction to system prompt when jsonMode is true (Anthropic)', async () => {
    let sentBody;
    globalThis.fetch = async (_url, opts) => { sentBody = JSON.parse(opts.body); return fakeFetchResp(200, ANTHROPIC_SUCCESS); };
    await callChatCompletion({
      provider: 'anthropic', token: 'k', model: 'm', maxTokens: 100, jsonMode: true,
      messages: [{ role: 'user', content: 'Hi' }],
    });
    assert.match(sentBody.system, /Respond with valid JSON only/);
  });

  it('throws an Error with status and body on non-2xx Anthropic response', async () => {
    globalThis.fetch = async () => fakeFetchResp(401, { error: { message: 'Unauthorized' } });
    await assert.rejects(
      () => callChatCompletion({ provider: 'anthropic', token: 'bad', model: 'm', messages: [], maxTokens: 100 }),
      (err) => {
        assert.equal(err.status, 401);
        return true;
      },
    );
  });
});
