/**
 * @file lib/models.js
 * @description Model API utilities shared by select-skills.js and post-review.js.
 *
 * Supports two providers:
 *   - 'github-models' (default) — OpenAI-compatible endpoint proxied by GitHub
 *   - 'anthropic'               — Anthropic Messages API
 *
 * Both return a normalised {@link ChatResult} so callers don't need to branch
 * on the provider themselves.
 */

'use strict';

/** @type {string} ANSI escape for yellow text — used for token counts. */
const YELLOW = '\x1b[33m';

/** @type {string} ANSI escape for blue text — used for model names. */
const BLUE = '\x1b[34m';

/** @type {string} ANSI escape to reset colour. */
const RESET = '\x1b[0m';

/**
 * @typedef {Object} ChatMessage
 * @property {'system'|'user'|'assistant'} role
 * @property {string} content
 */

/**
 * @typedef {Object} ChatOptions
 * @property {'github-models'|'anthropic'} provider  - Which API to call.
 * @property {string}   token      - Auth token (GitHub token or Anthropic API key).
 * @property {string}   model      - Model ID (e.g. 'gpt-4.1' or 'claude-opus-4-5').
 * @property {ChatMessage[]} messages - Ordered message list.
 * @property {number}   maxTokens  - Maximum output tokens.
 * @property {number}   [temperature=0.2] - Sampling temperature.
 * @property {boolean}  [jsonMode=false]  - Request JSON output (GitHub Models only;
 *   for Anthropic, a JSON instruction is injected into the system prompt instead).
 */

/**
 * @typedef {Object} ChatResult
 * @property {string}        text        - The model's response text.
 * @property {string|null}   finishReason - Normalised stop reason ('stop', 'length', etc.) or null.
 * @property {{ input: number, output: number, total: number }} usage - Token counts.
 * @property {Response}      rawResponse - The raw fetch Response (for rate-limit header inspection).
 */

/**
 * Calls the GitHub Models OpenAI-compatible chat-completions endpoint.
 *
 * @param {ChatOptions} opts
 * @returns {Promise<Response>} Raw fetch response.
 */
async function _callGitHubModels(opts) {
  const body = {
    model:       opts.model,
    messages:    opts.messages,
    max_tokens:  opts.maxTokens,
    temperature: opts.temperature ?? 0.2,
  };
  if (opts.jsonMode) {
    body.response_format = { type: 'json_object' };
  }
  return fetch('https://models.inference.ai.azure.com/chat/completions', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${opts.token}`,
    },
    body: JSON.stringify(body),
  });
}

/**
 * Calls the Anthropic Messages API.
 *
 * System messages are extracted from `opts.messages` (Anthropic takes the
 * system prompt as a top-level string, not as a message role). When
 * `jsonMode` is true, an instruction to respond with JSON only is appended
 * to the system prompt, since Anthropic has no `response_format` field.
 *
 * @param {ChatOptions} opts
 * @returns {Promise<Response>} Raw fetch response.
 */
async function _callAnthropic(opts) {
  const systemMessages = opts.messages.filter(m => m.role === 'system');
  const userMessages   = opts.messages.filter(m => m.role !== 'system');

  let systemText = systemMessages.map(m => m.content).join('\n\n');
  if (opts.jsonMode) {
    systemText = (systemText ? systemText + '\n\n' : '') +
      'Respond with valid JSON only. Do not include any prose before or after the JSON object.';
  }

  const body = {
    model:      opts.model,
    messages:   userMessages,
    max_tokens: opts.maxTokens,
    ...(systemText ? { system: systemText } : {}),
  };
  // Anthropic ignores temperature=0; only set it when explicitly provided and non-default
  if (opts.temperature !== undefined) {
    body.temperature = opts.temperature;
  }

  return fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         opts.token,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
}

/**
 * Strips a markdown code fence from a model response when `jsonMode` was
 * requested. Some models (notably Claude) wrap JSON output in ```json … ```
 * despite being instructed not to. This is applied to all responses so callers
 * always receive raw text.
 *
 * Only strips a fence when the trimmed text starts with ``` — leaves prose
 * responses completely untouched.
 *
 * @param {string} text - Raw model response text.
 * @returns {string} Text with leading/trailing code fence removed, trimmed.
 */
function stripCodeFence(text) {
  const t = text.trim();
  if (!t.startsWith('```')) return t;
  // Remove opening fence line (```json, ```text, ``` etc.) and closing ```
  return t
    .replace(/^```[^\n]*\n/, '')
    .replace(/\n?```\s*$/, '')
    .trim();
}

/**
 * Normalises a successful GitHub Models response body to {@link ChatResult}.
 *
 * @param {object}   json - Parsed response body.
 * @param {Response} resp - Raw fetch Response.
 * @returns {ChatResult}
 */
function _normaliseGitHubModels(json, resp) {
  const choice = json.choices?.[0];
  return {
    text:         stripCodeFence(choice?.message?.content ?? ''),
    finishReason: choice?.finish_reason ?? null,
    usage: {
      input:  json.usage?.prompt_tokens     ?? 0,
      output: json.usage?.completion_tokens ?? 0,
      total:  json.usage?.total_tokens      ?? 0,
    },
    rawResponse: resp,
  };
}

/**
 * Normalises a successful Anthropic response body to {@link ChatResult}.
 *
 * @param {object}   json - Parsed response body.
 * @param {Response} resp - Raw fetch Response.
 * @returns {ChatResult}
 */
function _normaliseAnthropic(json, resp) {
  const raw  = json.content?.find(b => b.type === 'text')?.text ?? '';
  const text = stripCodeFence(raw);
  // Anthropic stop_reason values: 'end_turn', 'max_tokens', 'stop_sequence'
  const finishMap = { end_turn: 'stop', max_tokens: 'length', stop_sequence: 'stop' };
  return {
    text,
    finishReason: finishMap[json.stop_reason] ?? json.stop_reason ?? null,
    usage: {
      input:  json.usage?.input_tokens  ?? 0,
      output: json.usage?.output_tokens ?? 0,
      total:  (json.usage?.input_tokens ?? 0) + (json.usage?.output_tokens ?? 0),
    },
    rawResponse: resp,
  };
}

/**
 * Dispatches a chat-completion request to the configured provider and returns
 * a normalised result.
 *
 * Throws an `Error` (with `.status` and `.body` properties) when the API
 * returns a non-2xx response, so callers can handle errors uniformly.
 *
 * @param {ChatOptions} opts
 * @returns {Promise<ChatResult>}
 *
 * @throws {Error} On non-2xx API response. Error has `.status` (number) and `.body` (string).
 *
 * @example
 * const result = await callChatCompletion({
 *   provider: 'anthropic',
 *   token: process.env.ANTHROPIC_API_KEY,
 *   model: 'claude-opus-4-5',
 *   messages: [{ role: 'user', content: 'Hello' }],
 *   maxTokens: 512,
 * });
 * console.log(result.text);
 */
async function callChatCompletion(opts) {
  const provider = opts.provider || 'github-models';
  const resp = provider === 'anthropic'
    ? await _callAnthropic(opts)
    : await _callGitHubModels(opts);

  if (!resp.ok) {
    const body = await resp.text();
    const err  = new Error(`${provider} API error ${resp.status}: ${body}`);
    err.status = resp.status;
    err.body   = body;
    throw err;
  }

  const json = await resp.json();
  return provider === 'anthropic'
    ? _normaliseAnthropic(json, resp)
    : _normaliseGitHubModels(json, resp);
}

/**
 * Logs GitHub Models rate-limit response headers as an Actions log line.
 *
 * Reads the four standard `x-ratelimit-*` headers and `retry-after` from the
 * response. Emits `core.warning` when either remaining-requests ≤ 10 or
 * remaining-tokens ≤ 1000 (approaching exhaustion); otherwise `core.info`.
 * No-ops silently if neither `x-ratelimit-remaining-requests` nor
 * `x-ratelimit-remaining-tokens` is present (non-Models endpoints, Anthropic).
 *
 * @param {Response}                         resp  - Fetch Response from a Models API call.
 * @param {string}                           label - Short label for the log line (e.g. `'selection'`).
 * @param {{ warning: Function, info: Function }} core  - Actions core logger.
 */
function logRateLimit(resp, label, core) {
  const remainingReqs   = resp.headers.get('x-ratelimit-remaining-requests');
  const remainingTokens = resp.headers.get('x-ratelimit-remaining-tokens');
  const limitTokens     = resp.headers.get('x-ratelimit-limit-tokens');
  const retryAfter      = resp.headers.get('retry-after');

  if (remainingReqs === null && remainingTokens === null) return;

  const tokenPct = (remainingTokens !== null && limitTokens)
    ? ` (${YELLOW}${Math.round((remainingTokens / limitTokens) * 100)}%${RESET})`
    : '';
  const warn = parseInt(remainingReqs) <= 10 || parseInt(remainingTokens) <= 1000;
  const msg =
    `📊 ${label} rate limit: ${YELLOW}${remainingReqs ?? '?'}${RESET} requests remaining, ` +
    `${YELLOW}${remainingTokens ?? '?'}/${limitTokens ?? '?'} tokens${RESET}${tokenPct}` +
    `${retryAfter ? ` — retry-after: ${retryAfter}s` : ''}`;

  warn ? core.warning(`⚠️ ${msg}`) : core.info(msg);
}

module.exports = { YELLOW, BLUE, RESET, logRateLimit, callChatCompletion };
