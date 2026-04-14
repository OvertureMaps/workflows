/**
 * @file fetch-context.js
 * @description Step 3b — Fetch context files for selected skills only.
 *
 * Skills can declare `context-files` in their frontmatter — cross-repo
 * Markdown files that give the review model additional grounding. This step
 * fetches those files via the GitHub Contents API, compresses them, and
 * truncates each one to a per-file character budget before storage.
 *
 * The per-file budget is computed dynamically as 10% of the input token budget
 * (converted to chars at 4 chars/token), so context files scale with the
 * model's context window. An optional hard cap (MAX_CONTEXT_FILE_CHARS_OVERRIDE)
 * lets callers enforce a tighter ceiling regardless of the token budget.
 *
 * This does NOT affect the overall prompt context size — only individual
 * skill context files declared via `context-files:` in skill frontmatter.
 *
 * Fetching is deferred to this step so that only skills that survived model
 * selection incur the network cost. All fetches run in parallel.
 *
 * Env vars consumed:
 *   CONTEXT_TOKEN                — installation token (or fallback github-token) for API calls
 *   SELECTED_SKILLS              — JSON array of selected skill names from Step 3
 *   MODEL_PROVIDER               — 'github-models' (default) | 'anthropic'
 *   MAX_INPUT_TOKENS             — input token budget (used to compute per-file char limit)
 *   MAX_CONTEXT_FILE_CHARS_OVERRIDE — optional hard cap in chars per context file
 *   RUNNER_TEMP                  — standard Actions temp dir for inter-step artefacts
 *
 * Outputs written:
 *   $RUNNER_TEMP/ai-review-context.json  — Record<skillName, ContextEntry[]>
 *
 * @param {import('@actions/github-script').AsyncFunctionArguments} args
 */
module.exports = async ({ core }) => {
  const fs   = require('fs');
  const path = require('path');
  const { parseContextRef, processContextFile, contextFileCharBudget, groupBySkill, MAX_CONTEXT_FILE_CHARS } = require('./lib/context');
  const { getProviderDefaults, DEFAULT_PROVIDER } = require('./lib/defaults');

  const provider     = process.env.MODEL_PROVIDER || DEFAULT_PROVIDER;
  const maxInputTokens = parseInt(process.env.MAX_INPUT_TOKENS) || getProviderDefaults(provider).maxInputTokens;
  const override       = parseInt(process.env.MAX_CONTEXT_FILE_CHARS_OVERRIDE) || 0;
  const perFileLimit   = contextFileCharBudget(maxInputTokens, override);

  core.info(
    `📎 Context file char limit: ${perFileLimit} chars per file` +
    (override > 0 ? ` (dynamic budget capped at ${override})` : ` (10% of ${maxInputTokens} input tokens)`)
  );

  const skills         = JSON.parse(fs.readFileSync(path.join(process.env.RUNNER_TEMP, 'ai-review-skills.json'), 'utf-8'));
  const selectedNames  = new Set(JSON.parse(process.env.SELECTED_SKILLS || '[]'));
  const selectedSkills = skills.filter(s => selectedNames.has(s.name));

  /**
   * @typedef {Object} ContextRef
   * @property {string} skillName - The skill that declared this context-file ref.
   * @property {string} ref       - The raw `owner/repo:path` ref string.
   */

  /** @type {ContextRef[]} Flat list of all context-file refs across selected skills. */
  const allRefs = selectedSkills.flatMap(s =>
    (s.contextFiles || []).map(ref => ({ skillName: s.name, ref }))
  );

  if (allRefs.length === 0) {
    core.info('⏭️  No context files to fetch for selected skills');
    fs.writeFileSync(path.join(process.env.RUNNER_TEMP, 'ai-review-context.json'), JSON.stringify({}));
    return;
  }

  /** @type {(ContextEntry|null)[]} */
  const fetchedContext = await Promise.all(
    allRefs.map(async ({ skillName, ref }) => {
      const parsed = parseContextRef(ref);
      if (!parsed) {
        core.warning(`⚠️ Skill '${skillName}': bad context-file ref '${ref}' (expected owner/repo:path)`);
        return null;
      }
      const { owner: cfOwner, repo: cfRepo, filePath } = parsed;
      try {
        core.info(`  ↓ [${skillName}] fetching ${ref}`);
        const apiUrl  = `https://api.github.com/repos/${cfOwner}/${cfRepo}/contents/${filePath}`;
        const apiResp = await fetch(apiUrl, {
          headers: {
            'Authorization': `Bearer ${process.env.CONTEXT_TOKEN}`,
            'Accept': 'application/vnd.github+json',
          },
        });
        if (!apiResp.ok) throw new Error(`HTTP ${apiResp.status}`);

        const data = await apiResp.json();
        const { content, truncated } = processContextFile(data.content, perFileLimit);

        if (truncated) {
          core.warning(
            `  ✂️  [${skillName}] ${ref} was truncated to ${perFileLimit} chars` +
            ` — consider trimming this context file to only the sections relevant to the skill`
          );
        }
        return { skillName, ref, content };
      } catch (err) {
        core.warning(`❌ [${skillName}] could not fetch ${ref} — ${err.message}`);
        return null;
      }
    })
  );

  const contextBySkill = groupBySkill(fetchedContext);

  core.startGroup(`📎 Context files fetched`);
  for (const [skillName, entries] of Object.entries(contextBySkill)) {
    for (const e of entries) core.info(`  ✅ [${skillName}] ${e.ref} (${e.content.length} chars)`);
  }
  core.endGroup();

  fs.writeFileSync(
    path.join(process.env.RUNNER_TEMP, 'ai-review-context.json'),
    JSON.stringify(contextBySkill)
  );
};
