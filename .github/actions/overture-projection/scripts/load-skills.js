/**
 * @file load-skills.js
 * @description Step 1b — Load skills from disk.
 *
 * Reads every SKILL.md under $SKILLS_DIR, parses YAML frontmatter, filters to
 * skills targeting the `pr-reviewer` surface (or with no surfaces field), and
 * writes the result to ai-review-skills.json for later steps.
 *
 * Context files are NOT fetched here — deferred to Step 3b so only skills that
 * survive model selection pay the network cost.
 *
 * Env vars consumed:
 *   SKILLS_DIR  — absolute path to the skills directory on disk
 *   RUNNER_TEMP — standard Actions temp dir for inter-step artefacts
 *
 * Outputs written:
 *   $RUNNER_TEMP/ai-review-skills.json  — Skill[]
 *
 * @param {import('@actions/github-script').AsyncFunctionArguments} args
 */
module.exports = async ({ core }) => {
  const fs   = require('fs');
  const path = require('path');
  const { filterSkills } = require('./lib/skills');

  const skillsDir = process.env.SKILLS_DIR;

  if (!fs.existsSync(skillsDir)) {
    core.warning(`⚠️ Skills directory not found: ${skillsDir} — no skills will be loaded.`);
    fs.writeFileSync(process.env.RUNNER_TEMP + '/ai-review-skills.json', JSON.stringify([]));
    return;
  }

  const skillFolders = fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);
  core.info(`🗂️  Found ${skillFolders.length} skill(s): ${skillFolders.join(', ')}`);

  const rawSkills = skillFolders.map(name => ({
    name,
    raw: fs.readFileSync(path.join(skillsDir, name, 'SKILL.md'), 'utf-8'),
  }));

  const skills     = filterSkills(rawSkills);
  const skippedCount = rawSkills.length - skills.length;
  if (skippedCount > 0) {
    const skippedNames = rawSkills
      .filter(s => !skills.some(k => k.name === s.name))
      .map(s => s.name)
      .join(', ');
    core.info(`⏭️  Skipped ${skippedCount} skill(s) not targeting pr-reviewer surface: ${skippedNames}`);
  }

  core.startGroup(`📚 Skills loaded (${skills.length} of ${rawSkills.length})`);
  for (const skill of skills) {
    const cfNote = skill.contextFiles.length > 0
      ? ` — ${skill.contextFiles.length} context file(s) pending selection`
      : '';
    core.info(`  📄 ${skill.name}${cfNote}`);
  }
  core.endGroup();

  fs.writeFileSync(
    path.join(process.env.RUNNER_TEMP, 'ai-review-skills.json'),
    JSON.stringify(skills)
  );
};
