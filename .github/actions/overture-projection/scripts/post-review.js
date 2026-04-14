/**
 * @file post-review.js
 * @description Step 4 — Compose prompt and post review.
 *
 * Assembles the system and user prompts from skills, context files, and PR
 * data, calls the review model, then posts the result as a PR comment in one
 * of three modes: update (upsert), new (fresh review every run), or dry-run
 * (log only).
 *
 * Env vars consumed:
 *   AI_TOKEN          — GitHub token (github-models) or Anthropic API key (anthropic)
 *   MODEL_PROVIDER    — 'github-models' (default) | 'anthropic'
 *   MODEL_ID          — model ID for the review
 *   MAX_OUTPUT_TOKENS — max tokens the model may generate (default varies by provider)
 *   MAX_INPUT_TOKENS  — max input tokens available (default varies by provider; see defaults.js)
 *   SELECTED_SKILLS   — JSON array of skill names from Step 3
 *   COMMENT_MODE    — 'update' | 'new' (default 'new')
 *   COMMENT_TAG     — HTML marker for update-mode comment identification
 *   DRY_RUN         — 'true' to skip posting and print instead
 *   PR_NUMBER       — PR number override (falls back to event payload)
 *   REPOSITORY      — target repo in owner/repo format (falls back to context)
 *   RUNNER_TEMP     — standard Actions temp dir for inter-step artefacts
 *
 * @param {import('@actions/github-script').AsyncFunctionArguments} args
 */
module.exports = async ({ github, context, core }) => {
  const fs   = require('fs');
  const path = require('path');
  const { YELLOW, BLUE, RESET, logRateLimit, callChatCompletion } = require('./lib/models');
  const { buildSystemPrompt, buildUserPrompt, buildUserPromptPreamble } = require('./lib/prompt');
  const { resolveRepo, resolvePrNumber } = require('./lib/github');
  const { diffCharBudget, applyFileBudget } = require('./lib/diff');
  const { getProviderDefaults, DEFAULT_PROVIDER } = require('./lib/defaults');

  const token    = process.env.AI_TOKEN;
  const provider = process.env.MODEL_PROVIDER || DEFAULT_PROVIDER;
  const providerDefaults = getProviderDefaults(provider);
  const modelId         = process.env.MODEL_ID || providerDefaults.model;
  const maxOutputTokens = parseInt(process.env.MAX_OUTPUT_TOKENS) || providerDefaults.maxOutputTokens;
  const maxInputTokens  = parseInt(process.env.MAX_INPUT_TOKENS)  || providerDefaults.maxInputTokens;
  const selectedNames   = JSON.parse(process.env.SELECTED_SKILLS || '[]');

  const skills         = JSON.parse(fs.readFileSync(path.join(process.env.RUNNER_TEMP, 'ai-review-skills.json'),  'utf-8'));
  const prData         = JSON.parse(fs.readFileSync(path.join(process.env.RUNNER_TEMP, 'ai-review-diff.json'),    'utf-8'));
  const contextBySkill = JSON.parse(fs.readFileSync(path.join(process.env.RUNNER_TEMP, 'ai-review-context.json'), 'utf-8'));

  // ── System prompt ────────────────────────────────────────────────────────────

  const finalSkills  = selectedNames.map(n => skills.find(s => s.name === n)).filter(Boolean);
  const systemPrompt = buildSystemPrompt(finalSkills, contextBySkill);

  if (finalSkills.length > 0) {
    core.info(`📝 Compressed ${finalSkills.length} selected skill(s): ${finalSkills.map(s => s.name).join(', ')}`);
  }

  // ── Dynamic diff budget ───────────────────────────────────────────────────────
  // Now that we have the actual system prompt we can compute how many chars
  // remain for the diff blocks.  We measure the user-prompt preamble (everything
  // except the per-file diff blocks) so the budget accounts for PR metadata too.

  const preambleChars   = buildUserPromptPreamble(prData).length;
  const systemChars     = systemPrompt ? systemPrompt.length : 0;
  const nonDiffChars    = systemChars + preambleChars;
  const charBudget      = diffCharBudget(nonDiffChars, maxInputTokens);
  const estNonDiffToks  = Math.round(nonDiffChars / 4);

  core.info(
    `📐 Dynamic diff budget: ${maxInputTokens} input tokens − ${estNonDiffToks} non-diff tokens` +
    ` = ${YELLOW}${Math.round(charBudget / 4)} tokens (${charBudget} chars) for diffs${RESET}`
  );

  // Trim files to fit the budget (whole-file dropping, same logic as before).
  const allFiles = prData.files;
  const { included: trimmedFiles, skipped: dynamicSkipped } = applyFileBudget(allFiles, charBudget);

  if (dynamicSkipped.length > 0) {
    core.info(`⚠️  Prompt-budget-skipped: ${dynamicSkipped.map(f => f.filename).join(', ')}`);
  }

  // Merge any files already skipped at fetch time with newly skipped files.
  const allSkipped = [
    ...(prData.budgetSkippedFiles ?? []),
    ...dynamicSkipped.map(f => f.filename),
  ];

  const trimmedPrData = { ...prData, files: trimmedFiles, budgetSkippedFiles: allSkipped };

  // ── User prompt ──────────────────────────────────────────────────────────────

  const userPrompt = buildUserPrompt(trimmedPrData);

  // ── Model call ───────────────────────────────────────────────────────────────

  const totalChars  = systemChars + userPrompt.length;
  const estTokens   = Math.round(totalChars / 4);
  core.info(`📏 Estimated prompt size: ${YELLOW}~${estTokens} tokens${RESET} (${totalChars} chars)`);
  if (estTokens > maxInputTokens) {
    core.warning(`⚠️ Estimated prompt (${estTokens} tokens) exceeds safe input budget (${maxInputTokens} tokens). The API call may fail.`);
  }

  core.info(`🤖 Calling ${BLUE}${modelId}${RESET} for review…`);
  let reviewResult;
  try {
    reviewResult = await callChatCompletion({
      provider,
      token,
      model:       modelId,
      messages: [
        // System prompt is omitted entirely when no skills were selected, which
        // lets the model fall back to its built-in code review behaviour.
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        { role: 'user', content: userPrompt },
      ],
      maxTokens:   maxOutputTokens,
      temperature: 0.2,
    });
  } catch (err) {
    core.setFailed(`Model API error: ${err.message}`);
    return;
  }

  logRateLimit(reviewResult.rawResponse, 'review', core);
  core.info(`🪙  Review: ${YELLOW}${reviewResult.usage.input} in + ${reviewResult.usage.output} out = ${reviewResult.usage.total} tokens${RESET}`);

  if (reviewResult.finishReason && reviewResult.finishReason !== 'stop') {
    core.warning(`⚠️ Review model finish_reason: ${reviewResult.finishReason} — response may be truncated; consider increasing max_tokens`);
  }

  const reviewBody = reviewResult.text;
  if (!reviewBody) {
    core.setFailed('Model returned an empty response');
    return;
  }

  // ── Post review ──────────────────────────────────────────────────────────────

  const { owner, repo } = resolveRepo(process.env.REPOSITORY, context.repo);
  const prNumber        = resolvePrNumber(context.payload.pull_request?.number, process.env.PR_NUMBER);
  const commentMode     = process.env.COMMENT_MODE || 'new';

  /**
   * Hidden HTML comment embedded in every 'update' mode comment body.
   * Used to locate an existing comment to edit on subsequent workflow runs,
   * preventing duplicate review comments accumulating on the PR.
   */
  const MARKER = `<!-- ${process.env.COMMENT_TAG || 'ai-pr-review'} -->`;

  const green = '\u001b[32;1m';
  const reset = '\u001b[0m';

  if (process.env.DRY_RUN === 'true') {
    // Print to the Actions log without posting — useful for local act testing
    core.startGroup('🔎 AI review (dry run)');
    core.info(reviewBody);
    core.endGroup();
    core.notice('🧪 Dry run — review not posted to PR.');
  } else if (commentMode === 'update') {
    // Upsert: find an existing comment with our marker and edit it in place,
    // or create a new one if this is the first run on this PR.
    const markedBody = `${MARKER}\n${reviewBody}`;
    const comments   = await github.rest.issues.listComments({
      owner, repo, issue_number: prNumber, per_page: 100,
    });
    const existing = comments.data.find(c => c.body?.includes(MARKER));
    if (existing) {
      const { data: updated } = await github.rest.issues.updateComment({
        owner, repo, comment_id: existing.id, body: markedBody,
      });
      core.info(`${green}✅ AI review updated → ${updated.html_url}${reset}`);
    } else {
      const { data: created } = await github.rest.issues.createComment({
        owner, repo, issue_number: prNumber, body: markedBody,
      });
      core.info(`${green}✅ AI review posted → ${created.html_url}${reset}`);
    }
  } else {
    // 'new' mode: always create a fresh PR review event
    const { data: review } = await github.rest.pulls.createReview({
      owner, repo,
      pull_number: prNumber,
      body: reviewBody,
      event: 'COMMENT',
    });
    core.info(`${green}✅ AI review posted → ${review.html_url}${reset}`);
  }
};
