/**
 * @file select-skills.js
 * @description Step 3 — Select applicable skills via a fast model.
 *
 * Splits the loaded skill list into always-skills (included unconditionally)
 * and optional skills (submitted to the selection model). The model responds
 * with a JSON object nominating which optional skills apply and a per-skill
 * reasoning sentence.
 *
 * The final skill set (always + selected) is written to the `selected` step
 * output as a JSON array for consumption by Steps 3b and 4.
 *
 * Env vars consumed:
 *   AI_TOKEN           — GitHub token (github-models) or Anthropic API key (anthropic)
 *   MODEL_PROVIDER     — 'github-models' (default) | 'anthropic'
 *   ALWAYS_SKILLS      — comma-separated skill names to always include
 *   SELECTION_MODEL_ID — model ID for skill selection (fast/cheap)
 *   CHANGED_PATHS      — newline-separated file paths from Step 2
 *   RUNNER_TEMP        — standard Actions temp dir for inter-step artefacts
 *
 * Step outputs set:
 *   selected  — JSON array of skill names (always-skills first)
 *
 * @param {import('@actions/github-script').AsyncFunctionArguments} args
 */
module.exports = async ({ core }) => {
  const fs   = require('fs');
  const path = require('path');
  const { YELLOW, BLUE, RESET, logRateLimit, callChatCompletion } = require('./lib/models');
  const { getProviderDefaults, DEFAULT_PROVIDER } = require('./lib/defaults');

  const token            = process.env.AI_TOKEN;
  const provider         = process.env.MODEL_PROVIDER || DEFAULT_PROVIDER;
  const alwaysSkills     = new Set(
    (process.env.ALWAYS_SKILLS || '').split(',').map(s => s.trim()).filter(Boolean)
  );
  const selectionModelId = process.env.SELECTION_MODEL_ID ||
    getProviderDefaults(provider).selectionModel;
  const changedPaths     = process.env.CHANGED_PATHS || '';

  const skills = JSON.parse(fs.readFileSync(path.join(process.env.RUNNER_TEMP, 'ai-review-skills.json'), 'utf-8'));
  const prData = JSON.parse(fs.readFileSync(path.join(process.env.RUNNER_TEMP, 'ai-review-diff.json'),   'utf-8'));

  // Partition skills into always-included and model-selectable groups
  const alwaysNames = skills.filter(s =>  alwaysSkills.has(s.name)).map(s => s.name);
  const selectable  = skills.filter(s => !alwaysSkills.has(s.name));

  /** @type {string[]} Names of optional skills chosen by the selection model. */
  let selectedNames = [];

  if (selectable.length > 0) {
    core.info(`🔍 Selecting from ${selectable.length} optional skill(s) using ${BLUE}${selectionModelId}${RESET}`);

    // One-line summary per skill fed to the selection model
    const indexSummary = selectable.map(s => `- ${s.name}: ${s.description}`).join('\n');

    let result;
    try {
      result = await callChatCompletion({
        provider,
        token,
        model:       selectionModelId,
        messages: [
          {
            role: 'system',
            content: 'Select which review skills apply to this pull request. Respond with JSON only: {"skills": ["name"], "reasoning": {"name": "one sentence why included or excluded"}}. Include a reasoning entry for every available skill whether selected or not. Empty skills array if none apply.',
          },
          {
            role: 'user',
            content:
              `PR title: ${prData.title}\n\n` +
              `PR description: ${prData.body || '(none)'}\n\n` +
              `Changed files:\n${changedPaths}\n\n` +
              `Optional skills:\n${indexSummary}`,
          },
        ],
        maxTokens:   600,
        temperature: 0.1,
        jsonMode:    true,
      });
    } catch (err) {
      core.warning(`⚠️ Skill selection failed (${err.status ?? 'network'}) — using always-skills only: ${err.message}`);
      result = null;
    }

    if (result) {
      logRateLimit(result.rawResponse, 'selection', core);
      core.info(`🪙 Selection: ${YELLOW}${result.usage.input} in + ${result.usage.output} out = ${result.usage.total} tokens${RESET}`);

      if (result.finishReason && result.finishReason !== 'stop') {
        core.warning(`⚠️ Selection model finish_reason: ${result.finishReason}`);
      }

      try {
        const parsed = JSON.parse(result.text);
        // Guard against the model hallucinating skill names not in the index
        selectedNames = (parsed.skills || []).filter(n => selectable.some(s => s.name === n));

        // Log per-skill reasoning for every selectable skill (selected or not)
        const reasoning = parsed.reasoning || {};
        core.startGroup('🧠 Skill selection reasoning');
        for (const skill of selectable) {
          const reason = reasoning[skill.name] || '(no reasoning provided)';
          const chosen = selectedNames.includes(skill.name) ? '✅ selected' : '⏭️ skipped';
          core.info(`${chosen}  ${skill.name}: ${reason}`);
        }
        core.endGroup();
      } catch {
        core.warning(`⚠️ Skill selection returned non-JSON: ${result.text}`);
      }
    }
  }

  // Always-skills come first so pr-review (the structural skill) is always the
  // first system-prompt block regardless of which optional skills were chosen.
  const finalNames = [...alwaysNames, ...selectedNames];
  core.info(`✅ Final skill set: ${finalNames.join(', ') || '(none)'}`);
  core.setOutput('selected', JSON.stringify(finalNames));
};
